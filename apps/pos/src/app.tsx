import { FormEvent, KeyboardEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient, ApiError } from '@koreacrm/api-client';
import { lookupBarcode } from './barcode-lookup';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@koreacrm/ui';
import type { PosCustomer, PosPage, PosPaymentMethod, PosProduct, PosSale, PosSettings, PosShift, PosStock, PosStore } from '@koreacrm/types';
import { calculateCartWithDiscount, discountBasisPoints, formatMinor, validatePayments } from './calculations';
import { loyaltyPercent, type LoyaltySettings } from './loyalty';
import { buildEscPosReceipt } from './escpos';
import { hasDesktopCache, readCachedCustomers, readCachedProducts, readCatalogCacheStatus, readCatalogRevision, readDatabaseHealth, refreshCatalogCache, type CacheStatus, type DatabaseHealth } from './local-cache';
import { enqueueSale, listSyncQueue, retryConflictSale, setSyncStatus, syncQueueSummary, type QueueEntry, type QueueSummary } from './sync-queue';
import { drainQueue, readyForRetry } from './queue-drain';
import { clearOfflineSession, markOfflineSessionReady, matchOfflineCode, passwordVerifier, readOfflineCodeSessions, readOfflineSession, sameVerifier, saveOfflineCodeSession, saveOfflineSession, type OfflineSession } from './offline-session';
import { projectShiftCash } from './shift-projection';
import { queuedSaleDetails } from './queued-sale-details';
import { isLocalServerUrl, normalizeServerUrl } from './server-url';
import { DebtsModal, JournalModal, ShiftsScreen } from './cloud-screens';
import { printRows, receiptRows } from './print-layout';
import { errorDetail, translateError } from './error-text';
import { defaultParkedLabel, parkReceipt, readParked, writeParked, type ParkedReceipt } from './parked-receipts';
import { ProductImage, type CatalogItem, type PosCatalogProduct } from './product-results';
import { Icon, Kbd, LineEditor, ProductGrid, Sheet, defaultCardView, hasOverlay } from './cloud-ui';
import { PaymentScreen, SaleSuccess, type PaymentPart } from './cloud-payment';
import { CatalogModePopover, CustomerCreateModal, CustomerPickerModal, OpenShiftModal, PopoverMenu, QueueModal, ReceiptDiscountModal, ReturnReasonModal, SellerModal, SettingsPanel, useClock, type NewCustomer, type PosSettingsState } from './cloud-dialogs';
import { categoryNotice as categoryNoticeFor, filterCachedProducts, posCatalogPath, type PosCategory } from './catalog-filters';
import { readStoreConnection, requireMatchingStore, saveStoreConnection } from './store-connection';

const CameraCodeScanner = lazy(() => import('./camera-code-scanner').then(module => ({ default: module.CameraCodeScanner })));
type Overlay = null | 'pay' | 'customer' | 'customerCreate' | 'queue' | 'seller' | 'discount' | 'openShift' | 'menu' | 'more' | 'catalogMode' | 'returnReason';

type Line = { product: Pick<PosProduct, 'id' | 'name' | 'sku' | 'brandId' | 'categoryId'>; imageKey?: string; quantity: number; available: number; priceMinor: number; discountMinor: string };
type SaleRequest = { operationId: string; deviceId: string; cashShiftId?: string; customerId?: string; sellerId?: string; comment?: string; items: { productId: string; quantity: number; priceMinor: string; discountMinor: string }[]; payments: { paymentMethodId: string; amountMinor: string; reference?: string }[] };
type PendingSale = { storeId: string; request: SaleRequest };
const defaultApiUrl = import.meta.env.VITE_API_URL ?? '';
const apiUrlKey = 'koreacrm-pos-api-url-v1';
const pendingKey = 'koreacrm-pos-pending-sale-v1';
const loyaltyKey = 'koreacrm-pos-loyalty-v1';
const deviceKey = 'koreacrm-pos-device-v1';
const savedStoreKey = 'koreacrm-pos-store-v1';
const settingsKey = 'koreacrm-pos-settings-v1';
const appVersion = '0.2.6';
const readSettings = (): PosSettingsState => { const base = { ...defaultCardView, printByDefault: false, printerHost: '', sound: false }; try { const raw = localStorage.getItem(settingsKey); return raw ? { ...base, ...JSON.parse(raw) as Partial<PosSettingsState> } : base; } catch { return base; } };
const message = (caught: unknown) => {
  if (caught instanceof TypeError) return 'Нет связи. Проверьте подключение и попробуйте ещё раз.';
  if (caught instanceof ApiError) {
    const translated = translateError(caught.message);
    if (translated !== caught.message) return translated;
    if (caught.status === 401) return 'Сессия кассира завершилась. Войдите снова.';
    if (caught.status === 403) return 'У вас нет доступа к этому действию. Обратитесь к администратору.';
    if (caught.status >= 500) return 'Сервис временно недоступен. Попробуйте ещё раз позже.';
    if (/^(Forbidden|Unauthorized|Not Found|Internal Server Error|API returned \d+)$/i.test(caught.message)) return `Не удалось выполнить действие (код сервера ${caught.status}). Попробуйте ещё раз.`;
  }
  return translateError(errorDetail(caught));
};
const connectionFailed = (caught: unknown) => caught instanceof TypeError || caught instanceof DOMException && ['TimeoutError', 'AbortError'].includes(caught.name) || (caught instanceof ApiError && caught.status >= 500);
const loginError = (caught: unknown, codeLogin = false) => {
  if (connectionFailed(caught)) return 'Не удалось подключиться. Проверьте интернет и адрес магазина в настройках подключения.';
  if (caught instanceof ApiError && caught.status === 401 && caught.message === 'Invalid scan code') return 'Код кассира не найден или уже заменён. Выдайте новую карточку в разделе «Сотрудники и роли».';
  if (caught instanceof ApiError && caught.status === 401) return codeLogin ? 'Код кассира не подошёл. Попросите администратора выдать новый.' : 'Неверный логин или пароль. Проверьте данные и попробуйте ещё раз.';
  return message(caught);
};
const deviceRegistrationError = (caught: unknown) => {
  if (connectionFailed(caught)) return 'Касса не подключилась: нет связи с сервером. Нажмите «Повторить подключение».';
  if (caught instanceof ApiError && caught.message === 'Device is assigned to another store') return 'Эта касса уже привязана к другому магазину. Выберите его в списке или отвяжите кассу в личном кабинете: «Магазины» → карточка магазина → «Кассы».';
  if (caught instanceof ApiError && caught.message === 'Device is disabled') return 'Эта касса отключена в личном кабинете. Обратитесь к администратору.';
  if (caught instanceof ApiError && caught.message === 'Active store not found') return 'Магазин не найден или не активен. Выберите другой магазин.';
  return `Касса не подключилась: ${message(caught)}`;
};
const russianCount = (count: number, one: string, few: string, many: string) => {
  const remainder = count % 100;
  if (remainder >= 11 && remainder <= 14) return many;
  switch (count % 10) { case 1: return one; case 2: case 3: case 4: return few; default: return many; }
};
function ConflictSaleCard({ entry, methods, disabled, onRetry }: { entry: QueueEntry; methods: PosPaymentMethod[]; disabled: boolean; onRetry: () => void }) {
  const details = queuedSaleDetails(entry.payloadJson);
  const explanation = entry.error?.startsWith('Purchase cost is missing')
    ? 'У товара не указана закупочная себестоимость. В кабинете внесите закупочную партию для этого товара, затем повторите отправку чека.'
    : 'Продажу не удалось отправить. Проверьте товары и оплату или обратитесь к администратору.';
  return <article className="sync-conflict">
    <div className="sync-conflict-heading"><strong>Продажа не принята · {details ? formatMinor(details.totalMinor) : 'сумма неизвестна'}</strong><span>{new Date(entry.createdAt).toLocaleString('ru-RU')}</span></div>
    <p role="alert">{explanation}</p>
    <details><summary>Сведения для поддержки</summary>
      {entry.error && <p>Причина: {entry.error}</p>}
      <p>Номер операции: <code>{entry.operationId}</code></p>
      {details && <><p>Позиций: {details.positions} · Количество: {details.quantity}</p><p>Оплата: {details.payments.map(payment => `${methods.find(method => method.id === payment.paymentMethodId)?.name ?? 'Неизвестный способ'} ${formatMinor(payment.amountMinor)}`).join(' · ')}</p>{details.hasCashShift && <p>Наличные остаются в ожидаемой сумме смены до разрешения ошибки.</p>}</>}
    </details>
    <button type="button" disabled={disabled} onClick={onRetry}>Повторить после исправления</button>
  </article>;
}

export function App() {
  const [deviceId] = useState(() => { const saved = localStorage.getItem(deviceKey); if (saved) return saved; const created = `POS-${crypto.randomUUID()}`; localStorage.setItem(deviceKey, created); return created; });
  const [apiUrl, setApiUrl] = useState(() => {
    const saved = localStorage.getItem(apiUrlKey) ?? defaultApiUrl;
    try { return normalizeServerUrl(saved); } catch { return saved; }
  });
  const [connectionOpen, setConnectionOpen] = useState(() => !localStorage.getItem(apiUrlKey));
  const [storeConnection, setStoreConnection] = useState<PosStore | null>(() => readStoreConnection(localStorage, localStorage.getItem(apiUrlKey) ?? defaultApiUrl));
  const [storeCode, setStoreCode] = useState('');
  const [setupRequested, setSetupRequested] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const clientBaseUrl = useMemo(() => {
    let baseUrl = apiUrl.trim().replace(/\/+$/, '');
    try { baseUrl = normalizeServerUrl(apiUrl); } catch { /* Validate on sign-in. */ }
    return baseUrl;
  }, [apiUrl]);
  const client = useMemo(() => createApiClient(clientBaseUrl, deviceId), [clientBaseUrl, deviceId]);
  useEffect(() => { const saved = readStoreConnection(localStorage, clientBaseUrl); setStoreConnection(saved); setStoreCode(saved?.code ?? ''); }, [clientBaseUrl]);
  const [registrationRequested, setRegistrationRequested] = useState(false);
  const [registerNonce, setRegisterNonce] = useState(0);
  const [deviceError, setDeviceError] = useState('');
  const [signedIn, setSignedIn] = useState(false), [login, setLogin] = useState(''), [cashierName, setCashierName] = useState(''), [password, setPassword] = useState(''), [permissions, setPermissions] = useState<string[]>([]);
  const [loginMode, setLoginMode] = useState<'password' | 'scan'>('password'), [scanCode, setScanCode] = useState(''), [cameraOpen, setCameraOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null), [cacheProgress, setCacheProgress] = useState(''), [cacheError, setCacheError] = useState(''), [cacheBusy, setCacheBusy] = useState(false);
  const cacheBusyRef = useRef(false);
  const [catalogRefreshToken, setCatalogRefreshToken] = useState(0);
  const [databaseHealth, setDatabaseHealth] = useState<DatabaseHealth | null>(null);
  const [queueSummary, setQueueSummary] = useState<QueueSummary | null>(null), [queueNotice, setQueueNotice] = useState('');
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([]);
  const [, setSalesRevision] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>(null), [payOpen, setPayOpen] = useState(false);
  const [sheet, setSheet] = useState<null | 'history' | 'shift' | 'debts' | 'sync' | 'settings'>(null);
  const [receiptScreen, setReceiptScreen] = useState<'sale' | 'history'>('sale');
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const offlineNetwork = !networkOnline && !isLocalServerUrl(apiUrl);
  const [serverReachable, setServerReachable] = useState(true);
  const [offlineSignedIn, setOfflineSignedIn] = useState(false);
  const connectionOffline = offlineSignedIn || offlineNetwork || !serverReachable;
  const offlineCredentialRef = useRef('');
  const offlineCredentialModeRef = useRef<'password' | 'scan'>('password');
  const reconnectingRef = useRef(false);
  const syncBusyRef = useRef(false);
  const [stores, setStores] = useState<PosStore[]>([]), [storeId, setStoreId] = useState(''), [deviceReady, setDeviceReady] = useState(false), [shift, setShift] = useState<PosShift | null>(null);
  const [methods, setMethods] = useState<PosPaymentMethod[]>([]), [customers, setCustomers] = useState<PosCustomer[]>([]), [customerSearch, setCustomerSearch] = useState(''), [customerId, setCustomerId] = useState('');
  const [loyalty, setLoyalty] = useState<LoyaltySettings | null>(null);
  const [search, setSearch] = useState(''), [products, setProducts] = useState<CatalogItem[]>([]), [cart, setCart] = useState<Line[]>([]);
  const [categories, setCategories] = useState<PosCategory[]>([]), [categoryId, setCategoryId] = useState('all');
  const [categoryNotice, setCategoryNotice] = useState('');
  const [catalogPage, setCatalogPage] = useState(1), [catalogTotal, setCatalogTotal] = useState(0), [catalogLoading, setCatalogLoading] = useState(false);
  const [stockNotice, setStockNotice] = useState('');
  const [receipt, setReceipt] = useState<PosSale | null>(null), [pending, setPending] = useState<PendingSale | null>(() => { try { const saved = localStorage.getItem(pendingKey); return saved ? JSON.parse(saved) as PendingSale : null; } catch { return null; } });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [printerHost, setPrinterHost] = useState(() => localStorage.getItem('koreacrm-pos-printer-host') ?? '');
  const searchRef = useRef<HTMLInputElement>(null), scanRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!signedIn && loginMode === 'scan') scanRef.current?.focus(); }, [signedIn, loginMode]);
  const can = (permission: string) => permissions.includes(permission);
  const [lineEditId, setLineEditId] = useState(''), [receiptDiscount, setReceiptDiscount] = useState(0n);
  const [catalogMode, setCatalogMode] = useState<'products' | 'categories'>('products'), [returnMode, setReturnMode] = useState(false);
  const [success, setSuccess] = useState<{ totals: { subtotal: bigint; discount: bigint; total: bigint }; parts: PaymentPart[]; change: bigint; sale: PosSale | null } | null>(null);
  const [settings, setSettings] = useState<PosSettingsState>(readSettings);
  useEffect(() => { try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* Settings stay for this session only. */ } }, [settings]);
  const clock = useClock();
  const [shiftNumber, setShiftNumber] = useState(0);
  useEffect(() => {
    if (!shift || offlineSignedIn || !storeId) { setShiftNumber(0); return; }
    let active = true;
    client.get<PosPage<PosShift>>(`/stores/${storeId}/finance/cash-shifts?limit=100`).then(page => { const index = page.items.findIndex(item => item.id === shift.id); if (active) setShiftNumber(index >= 0 ? page.total - index : 0); }).catch(() => undefined);
    return () => { active = false; };
  }, [client, shift?.id, storeId, offlineSignedIn]);
  const selectedCustomer = customers.find(customer => customer.id === customerId);
  const cartSubtotal = cart.reduce((sum, line) => sum + BigInt(line.priceMinor) * BigInt(line.quantity), 0n);
  const cartPercents = loyalty ? cart.map(line => loyaltyPercent(loyalty, { productId: line.product.id, brandId: line.product.brandId, categoryId: line.product.categoryId }, selectedCustomer?.discountPercent ?? null, cartSubtotal)) : [];
  const cartLines = cart.map(line => ({ productId: line.product.id, quantity: line.quantity, available: line.available, priceMinor: line.priceMinor, discountMinor: line.discountMinor }));
  let cartTotal: ReturnType<typeof calculateCartWithDiscount> | null = null;
  let cartError = '';
  // The whole-receipt discount is capped by what is left after line and loyalty discounts.
  try { if (cart.length && loyalty) { const base = calculateCartWithDiscount(cartLines, cartPercents); cartTotal = calculateCartWithDiscount(cartLines, cartPercents, { kind: 'FIXED', value: (receiptDiscount > base.total ? base.total : receiptDiscount).toString() }); } } catch { cartError = 'Проверьте количество товаров и скидку клиента.'; }
  useEffect(() => { if (!cart.length) setReceiptDiscount(0n); }, [cart.length]);
  // Manual line discounts above the store limit need a manager's account.
  const manualDiscountMinor = cart.reduce((total, line) => total + BigInt(line.discountMinor), 0n) + (cartTotal?.cartDiscountMinor ?? 0n);
  const discountLimitPercent = loyalty?.maxManualDiscountPercent ?? '100';
  const discountOverLimit = !can('sales.discount.unlimited') && cartSubtotal > 0n && manualDiscountMinor * 10000n > cartSubtotal * discountBasisPoints(discountLimitPercent);
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]), [sellerId, setSellerId] = useState('');
  const sellerKey = `koreacrm-pos-seller-v1:${storeId}:${deviceId}`;
  useEffect(() => { try { setSellerId(storeId && deviceId ? localStorage.getItem(sellerKey) ?? '' : ''); } catch { setSellerId(''); } }, [sellerKey, storeId, deviceId]);
  useEffect(() => {
    if (!deviceReady || !storeId || offlineSignedIn || !permissions.includes('sales.create')) return;
    let active = true;
    client.get<{ id: string; name: string }[]>(`/stores/${storeId}/sales/sellers/list`).then(list => { if (active) setSellers(list); }).catch(() => { if (active) setSellers([]); });
    return () => { active = false; };
  }, [client, deviceReady, storeId, offlineSignedIn, permissions]);
  const chooseSeller = (id: string) => { setSellerId(id); try { if (id) localStorage.setItem(sellerKey, id); else localStorage.removeItem(sellerKey); } catch { /* Seller choice is a convenience only. */ } };
  const [parked, setParked] = useState<ParkedReceipt<Line, PosCustomer>[]>([]);
  useEffect(() => { setParked(storeId && deviceId ? readParked<Line, PosCustomer>(localStorage, storeId, deviceId) : []); }, [storeId, deviceId]);
  const saveParked = (next: ParkedReceipt<Line, PosCustomer>[]) => { setParked(next); writeParked(localStorage, storeId, deviceId, next); };
  // Short confirmations disappear on their own so they do not follow the cashier to other screens.
  function flashNotice(text: string) { setQueueNotice(text); window.setTimeout(() => setQueueNotice(current => current === text ? '' : current), 4000); }
  function parkCurrent() {
    if (!cart.length || pending) return;
    const customer = customers.find(value => value.id === customerId) ?? null;
    try { saveParked(parkReceipt(parked, { label: defaultParkedLabel(parked.length, customer ? `${customer.firstName} ${customer.lastName ?? ''}`.trim() : null), lines: cart, customer })); }
    catch (caught) { setError(message(caught)); return; }
    setCart([]); setCustomerId(''); setStockNotice(''); setReceiptDiscount(0n); flashNotice('Чек отложен. Он в «Очереди чеков».');
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }
  function restoreParked(receipt: ParkedReceipt<Line, PosCustomer>) {
    if (cart.length) { setError('В чеке есть товары. Оформите или отложите текущий чек, потом откройте отложенный.'); return; }
    if (receipt.customer) setCustomers(current => current.some(value => value.id === receipt.customer!.id) ? current : [receipt.customer!, ...current]);
    setCart(receipt.lines); setCustomerId(receipt.customer?.id ?? '');
    saveParked(parked.filter(value => value.id !== receipt.id));
    flashNotice('Отложенный чек открыт. Проверьте цены и остатки перед оплатой.');
  }
  const cartQuantities = Object.fromEntries(cart.map(line => [line.product.id, line.quantity]));
  const projectedShift = shift ? projectShiftCash(shift.expectedCashMinor, shift.id, methods.filter(method => method.kind === 'CASH').map(method => method.id), queueEntries) : null;

  async function connectStore(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (offlineNetwork) throw new Error('Для первой настройки кассы нужно подключение к интернету.');
      const normalized = normalizeServerUrl(apiUrl);
      const store = await client.resolvePosStore(storeCode.trim());
      if (pending && pending.storeId !== store.id) throw new Error('Сначала отправьте незавершённую продажу прежней точки.');
      saveStoreConnection(localStorage, normalized, store);
      localStorage.setItem(apiUrlKey, normalized);
      setApiUrl(normalized); setStoreConnection(store); setStoreCode(store.code); setSetupRequested(false); setConnectionOpen(false);
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }

  async function invalidateOfflineCredential(caught: unknown, credential: string, mode: 'password' | 'scan', identityLogin: string) {
    if (!hasDesktopCache() || !(caught instanceof ApiError) || ![401, 403].includes(caught.status)) return;
    try {
      const server = normalizeServerUrl(apiUrl);
      const saved = mode === 'scan' ? await matchOfflineCode(credential, await readOfflineCodeSessions(deviceId, server)) : await readOfflineSession(deviceId, server, identityLogin);
      if (!saved) return;
      if (mode === 'password' && !sameVerifier(await passwordVerifier(credential, saved.salt), saved.verifier)) return;
      await clearOfflineSession(deviceId, server, saved.login);
    } catch (failure) { setCacheError(`Не удалось обновить локальные права: ${message(failure)}`); }
  }

  async function finishOnlineSignIn(identityLogin: string, normalizedApiUrl: string, offlineCredential?: { mode: 'password' | 'scan'; value: string }) {
      setServerReachable(true); localStorage.setItem(apiUrlKey, normalizedApiUrl); setApiUrl(normalizedApiUrl);
      const [me, available, paymentMethods, loyaltySettings] = await Promise.all([client.get<{ userId: string; name: string; login: string; primaryStoreId: string | null; permissions: string[] }>('/auth/me'), client.get<PosStore[]>('/stores'), client.get<PosPaymentMethod[]>('/sale-payment-methods'), client.get<LoyaltySettings>('/loyalty/settings')]);
      setLoyalty(loyaltySettings); localStorage.setItem(`${loyaltyKey}:${normalizedApiUrl}`, JSON.stringify(loyaltySettings));
      if (!me.permissions.includes('sales.create')) throw new Error('Нет права оформлять продажи');
      const active = paymentMethods.filter(method => method.active && (method.kind !== 'BONUS' || loyaltySettings.mode === 'BONUS' && !hasDesktopCache()) && (method.kind !== 'CASH' || me.permissions.includes('finance.cash_view')));
      if (!active.length || !available.length) throw new Error('Нет доступного магазина или способа оплаты');
      const chosen = available.find(store => store.id === storeConnection?.id);
      if (!chosen) throw new Error('Вы не назначены в магазин этой кассы. Обратитесь к администратору.');
      if (pending && pending.storeId !== chosen.id) throw new Error('Сначала отправьте незавершённую продажу прежней точки. Обратитесь к администратору.');
      // The till connects to the chosen store on its own; the cashier never has to press a button for it.
      setRegistrationRequested(true);
      if (hasDesktopCache() && offlineCredential) {
        try {
          const common = { deviceId, apiUrl: normalizedApiUrl, login: identityLogin, userId: me.userId, store: chosen, methods: active, permissions: me.permissions };
          if (offlineCredential.mode === 'password') await saveOfflineSession({ ...common, password: offlineCredential.value });
          else await saveOfflineCodeSession({ ...common, code: offlineCredential.value });
        }
        catch (cacheFailure) { setCacheError(`Локальный вход не сохранён: ${message(cacheFailure)}`); }
      }
      setLogin(me.login || identityLogin); setCashierName(me.name || me.login || identityLogin);
      setUserId(me.userId); setPermissions(me.permissions); setStores([chosen]); setMethods(active); setStoreId(chosen.id);
      setPassword(''); setScanCode(''); setOfflineSignedIn(false); setSignedIn(true);
  }
  async function finishOfflineSignIn(saved: OfflineSession, credential: string, mode: 'password' | 'scan', normalizedApiUrl: string) {
    requireMatchingStore(storeConnection, saved.storeId);
    const status = await readCatalogCacheStatus(saved.userId, saved.storeId);
    if (!status.productCount) throw new Error('Товары ещё не сохранены на кассе. Подключитесь к сети и обновите их.');
    const store = JSON.parse(saved.storeJson) as PosStore;
    const active = JSON.parse(saved.methodsJson) as PosPaymentMethod[];
    const permissions = JSON.parse(saved.permissionsJson) as string[];
    const shift = saved.shiftJson ? JSON.parse(saved.shiftJson) as PosShift : null;
    if (!permissions.includes('sales.create') || !active.length) throw new Error('Локальные права кассира недоступны');
    const customers = await readCachedCustomers(saved.userId, saved.storeId);
    const cachedLoyalty = localStorage.getItem(`${loyaltyKey}:${normalizedApiUrl}`);
    if (!cachedLoyalty) throw new Error('Настройки скидок не сохранены. Подключитесь к серверу и войдите снова.');
    setLoyalty(JSON.parse(cachedLoyalty) as LoyaltySettings);
    offlineCredentialRef.current = credential;
    offlineCredentialModeRef.current = mode;
    localStorage.setItem(apiUrlKey, normalizedApiUrl); setApiUrl(normalizedApiUrl);
    setLogin(saved.login); setLoginMode(mode); setCashierName(saved.login); setUserId(saved.userId); setStoreId(saved.storeId); setStores([store]); setMethods(active); setPermissions(permissions); setShift(shift); setCustomers(customers); setDeviceReady(true); setCacheStatus(status);
    setPassword(''); setScanCode(''); setServerReachable(false); setOfflineSignedIn(true); setSignedIn(true); setQueueNotice('Вы работаете без связи. Продажи сохранятся на кассе и отправятся позже.');
  }
  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!storeConnection) throw new Error('Сначала введите код торговой точки.');
      const normalizedApiUrl = normalizeServerUrl(apiUrl);
      if (offlineNetwork) throw new TypeError('No internet connection');
      await client.login(login, password, storeConnection?.code);
      await finishOnlineSignIn(login, normalizedApiUrl, { mode: 'password', value: password });
    } catch (caught) {
      await invalidateOfflineCredential(caught, password, 'password', login);
      if (hasDesktopCache() && connectionFailed(caught)) {
        try {
          const normalizedApiUrl = normalizeServerUrl(apiUrl);
          const saved = await readOfflineSession(deviceId, normalizedApiUrl, login);
          if (!saved) throw new Error('Для первого входа без интернета сначала войдите на этой кассе с паролем при подключённом сервере и обновите товары.');
          if (!sameVerifier(await passwordVerifier(password, saved.salt), saved.verifier)) throw new Error('Неверный пароль');
          await finishOfflineSignIn(saved, password, 'password', normalizedApiUrl);
        } catch (offlineFailure) { setError(message(offlineFailure)); }
      } else { if (connectionFailed(caught) || (caught instanceof Error && caught.message.startsWith('Укажите адрес магазина'))) setConnectionOpen(true); setError(loginError(caught)); }
    }
    finally { setBusy(false); }
  }
  async function authenticateCode(code: string) {
    setBusy(true); setError('');
    try {
      if (!storeConnection) throw new Error('Сначала введите код торговой точки.');
      const normalizedApiUrl = normalizeServerUrl(apiUrl);
      if (offlineNetwork) throw new TypeError('No internet connection');
      const identityLogin = await client.loginWithPosCode(code.trim(), storeConnection?.code);
      await finishOnlineSignIn(identityLogin, normalizedApiUrl, { mode: 'scan', value: code.trim() });
    } catch (caught) {
      await invalidateOfflineCredential(caught, code.trim(), 'scan', '');
      if (hasDesktopCache() && connectionFailed(caught)) {
        try {
          const normalizedApiUrl = normalizeServerUrl(apiUrl);
          const sessions = await readOfflineCodeSessions(deviceId, normalizedApiUrl);
          if (!sessions.length) throw new Error('Для входа по коду без интернета сначала войдите с этой карточкой при подключённом сервере и обновите товары.');
          const saved = await matchOfflineCode(code.trim(), sessions);
          if (!saved) throw new Error('Код кассира не найден среди сохранённых на этой кассе.');
          await finishOfflineSignIn(saved, code.trim(), 'scan', normalizedApiUrl);
        } catch (offlineFailure) { setError(message(offlineFailure)); }
      } else { if (connectionFailed(caught) || (caught instanceof Error && caught.message.startsWith('Укажите адрес магазина'))) setConnectionOpen(true); setError(loginError(caught, true)); }
    }
    finally { setBusy(false); }
  }
  function signInWithCode(event: FormEvent) { event.preventDefault(); void authenticateCode(scanCode); }
  const cameraDetected = useCallback((code: string) => { setCameraOpen(false); setScanCode(code); void authenticateCode(code); }, [client, apiUrl, pending, storeConnection?.id, storeConnection?.code]);
  async function signOut() { setBusy(true); try { await client.logout(); } catch { /* End this cashier session even if the server is unreachable. */ } finally { offlineCredentialRef.current = ''; reconnectingRef.current = false; setOfflineSignedIn(false); setSignedIn(false); setOverlay(null); setSheet(null); setPayOpen(false); setSuccess(null); setReturnMode(false); setCart([]); setStockNotice(''); setReceipt(null); setPermissions([]); setUserId(''); setCashierName(''); setLogin(''); setPassword(''); setScanCode(''); setCustomerId(''); setCustomers([]); setShift(null); setDeviceReady(false); setDeviceError(''); setRegistrationRequested(false); setStores([]); setStoreId(''); setCacheStatus(null); setCacheError(''); setQueueSummary(null); setQueueEntries([]); setQueueNotice(''); setLoginMode('scan'); setBusy(false); } }
  const refreshQueueSummary = useCallback(async () => {
    if (!hasDesktopCache() || !userId || !storeId) return;
    const [summary, entries] = await Promise.all([syncQueueSummary(userId, storeId), listSyncQueue(userId, storeId)]);
    setQueueSummary(summary); setQueueEntries(entries);
  }, [userId, storeId]);
  useEffect(() => { if (signedIn && userId && storeId) void refreshQueueSummary().catch(caught => setQueueNotice(`Не удалось проверить сохранённые продажи: ${message(caught)}`)); }, [signedIn, userId, storeId, refreshQueueSummary]);
  const syncQueuedSales = useCallback(async (force = false) => {
    if (!hasDesktopCache() || !signedIn || offlineSignedIn || offlineNetwork || !deviceReady || !userId || !storeId || syncBusyRef.current) return;
    syncBusyRef.current = true;
    try {
      const entries = readyForRetry(await listSyncQueue(userId, storeId), new Date().toISOString(), force);
      const outcome = await drainQueue(entries,
        async entry => {
          const request = JSON.parse(entry.payloadJson) as SaleRequest;
          try { await client.post(`/stores/${storeId}/sales/sync`, request); }
          catch (caught) { if (!(caught instanceof ApiError) || caught.status !== 404) throw caught; await client.post(`/stores/${storeId}/sales`, request); }
        },
        (entry, status, error) => setSyncStatus(userId, storeId, entry.operationId, status, error),
        caught => caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 401 && caught.status !== 403,
      );
      if (outcome.conflicts) setQueueNotice('Некоторые продажи требуют проверки. Откройте раздел «Отправка продаж».');
      else if (outcome.synced) setQueueNotice(`Отправлено сохранённых продаж: ${outcome.synced}.`);
      if (outcome.synced) setSalesRevision(value => value + 1);
      if (outcome.stopped) setServerReachable(false);
      else if (outcome.synced) setServerReachable(true);
      if (outcome.synced && shift && can('finance.cash_view')) {
        try {
          const page = await client.get<PosPage<PosShift>>(`/stores/${storeId}/finance/cash-shifts?limit=100`);
          const refreshed = page.items.find(value => value.id === shift.id && value.status === 'OPEN') ?? null;
          setShift(refreshed);
          const store = stores.find(value => value.id === storeId);
          if (store && hasDesktopCache()) await markOfflineSessionReady(deviceId, apiUrl.trim().replace(/\/+$/, ''), login, store, refreshed);
        } catch (caught) { setCacheError(`Данные смены после синхронизации не обновлены: ${message(caught)}`); }
      }
      await refreshQueueSummary();
    } catch (caught) { setQueueNotice(`Не удалось проверить сохранённые продажи: ${message(caught)}`); }
    finally { syncBusyRef.current = false; }
  }, [signedIn, offlineSignedIn, offlineNetwork, deviceReady, userId, storeId, client, refreshQueueSummary, shift, permissions, stores, deviceId, apiUrl, login, loginMode]);
  async function retryConflict(entry: QueueEntry) {
    if (!deviceReady || offlineSignedIn || !userId || !storeId) return;
    setBusy(true); setError('');
    try {
      await retryConflictSale(userId, storeId, entry.operationId);
      await refreshQueueSummary();
      await syncQueuedSales();
    } catch (caught) { setError(`Не удалось повторно проверить продажу: ${message(caught)}`); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!signedIn || !offlineSignedIn || !offlineCredentialRef.current) return;
    let active = true, checking = false;
    const reconnect = async () => {
      if (checking || !offlineCredentialRef.current || offlineNetwork) return;
      checking = true;
      try {
        if (offlineCredentialModeRef.current === 'scan') await client.loginWithPosCode(offlineCredentialRef.current, storeConnection?.code);
        else await client.login(login, offlineCredentialRef.current, storeConnection?.code);
        const [me, paymentMethods, loyaltySettings] = await Promise.all([client.get<{ userId: string; name: string; login: string; permissions: string[] }>('/auth/me'), client.get<PosPaymentMethod[]>('/sale-payment-methods'), client.get<LoyaltySettings>('/loyalty/settings')]);
        if (!me.permissions.includes('sales.create') || me.userId !== userId) throw new Error('Права кассира изменились. Выйдите и войдите заново при подключённом сервере.');
        const activeMethods = paymentMethods.filter(method => method.active && (method.kind !== 'BONUS' || loyaltySettings.mode === 'BONUS' && !hasDesktopCache()) && (method.kind !== 'CASH' || me.permissions.includes('finance.cash_view')));
        if (!activeMethods.length) throw new Error('Доступные способы оплаты изменились. Выйдите и войдите заново.');
        if (active) { setLoyalty(loyaltySettings); localStorage.setItem(`${loyaltyKey}:${apiUrl.trim().replace(/\/+$/, '')}`, JSON.stringify(loyaltySettings)); offlineCredentialRef.current = ''; reconnectingRef.current = true; setCashierName(me.name || me.login || login); setPermissions(me.permissions); setMethods(activeMethods); setServerReachable(true); setOfflineSignedIn(false); setQueueNotice('Связь восстановлена. Отправляем сохранённые продажи.'); }
      } catch (caught) {
        await invalidateOfflineCredential(caught, offlineCredentialRef.current, offlineCredentialModeRef.current, login);
        if (active && ((caught instanceof ApiError && [401, 403].includes(caught.status)) || (caught instanceof Error && !connectionFailed(caught) && !(caught instanceof ApiError)))) { offlineCredentialRef.current = ''; setDeviceReady(false); setQueueNotice('Не удалось восстановить вход. Когда появится связь, выйдите и войдите снова.'); }
      } finally { checking = false; }
    };
    void reconnect();
    const timer = window.setInterval(() => void reconnect(), 5000);
    window.addEventListener('online', reconnect);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('online', reconnect); };
  }, [signedIn, offlineSignedIn, offlineNetwork, client, login, userId, storeConnection?.code]);
  useEffect(() => {
    if (!signedIn || !deviceReady || !userId || !storeId || !hasDesktopCache()) return;
    void syncQueuedSales(true);
    const timer = window.setInterval(() => void syncQueuedSales(), 5000);
    const online = () => void syncQueuedSales(true);
    window.addEventListener('online', online);
    return () => { window.clearInterval(timer); window.removeEventListener('online', online); };
  }, [signedIn, deviceReady, userId, storeId, offlineNetwork, syncQueuedSales]);
  useEffect(() => {
    const update = () => setNetworkOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const updateLocalCache = useCallback(async () => {
    if (!hasDesktopCache() || offlineSignedIn || !userId || !storeId || cacheBusyRef.current) return;
    cacheBusyRef.current = true;
    setCacheBusy(true); setCacheError('');
    try {
      const status = await refreshCatalogCache(client, userId, storeId, permissions, setCacheProgress);
      setCacheStatus(status); setCacheProgress(''); setCatalogRefreshToken(value => value + 1); setServerReachable(true);
    } catch (caught) { setCacheError(message(caught)); setCacheProgress(''); if (connectionFailed(caught)) setServerReachable(false); }
    finally { cacheBusyRef.current = false; setCacheBusy(false); }
  }, [client, offlineSignedIn, userId, storeId, permissions]);
  useEffect(() => {
    if (!signedIn || offlineSignedIn || !deviceReady || !userId || !storeId || !hasDesktopCache()) return;
    let active = true;
    readCatalogCacheStatus(userId, storeId).then(status => { if (active) setCacheStatus(status); }).catch(caught => { if (active) setCacheError(message(caught)); });
    void updateLocalCache();
    return () => { active = false; };
  }, [signedIn, offlineSignedIn, deviceReady, userId, storeId, updateLocalCache]);
  useEffect(() => {
    if (!signedIn || offlineSignedIn || offlineNetwork || !deviceReady || !userId || !storeId || !hasDesktopCache()) return;
    let checking = false;
    const check = async () => {
      if (checking || cacheBusyRef.current) return;
      checking = true;
      try {
        const revision = await readCatalogRevision(client, storeId);
        const status = await readCatalogCacheStatus(userId, storeId);
        if (status.revision !== revision) await updateLocalCache();
        else setServerReachable(true);
      } catch (caught) { if (connectionFailed(caught)) setServerReachable(false); }
      finally { checking = false; }
    };
    const timer = window.setInterval(() => void check(), 30000);
    const online = () => void check();
    window.addEventListener('online', online);
    return () => { window.clearInterval(timer); window.removeEventListener('online', online); };
  }, [signedIn, offlineSignedIn, offlineNetwork, deviceReady, userId, storeId, client, updateLocalCache]);
  useEffect(() => {
    if (!signedIn || sheet !== 'sync' || !hasDesktopCache()) return;
    let active = true;
    void readDatabaseHealth().then(health => { if (active) setDatabaseHealth(health); }).catch(() => { if (active) setDatabaseHealth({ integrity: 'error', journalMode: 'unknown' }); });
    return () => { active = false; };
  }, [signedIn, sheet]);
  useEffect(() => {
    if (!signedIn || offlineSignedIn || !storeId || !registrationRequested) return;
    let active = true;
    setDeviceReady(false); setShift(null); setDeviceError('');
    if (!reconnectingRef.current) { setCart([]); setStockNotice(''); setReceipt(null); setCustomerId(''); }
    reconnectingRef.current = false;
    void (async () => {
      try {
        await client.post(`/stores/${storeId}/pos-devices`, { deviceId, appVersion });
        const tasks: Promise<unknown>[] = [can('finance.cash_view') ? client.get<PosPage<PosShift>>(`/stores/${storeId}/finance/cash-shifts?limit=100`) : Promise.resolve({ items: [] })];
        if (can('customers.view')) tasks.push(client.get<PosPage<PosCustomer>>('/customers?limit=100'));
        const [shiftPage, customerPage] = await Promise.all(tasks);
        if (!active) return;
        const opened = (shiftPage as PosPage<PosShift>).items.find(value => value.deviceId === deviceId && value.status === 'OPEN') ?? null;
        setShift(opened); setCustomers((customerPage as PosPage<PosCustomer> | undefined)?.items ?? []); setDeviceReady(true); localStorage.setItem(`${savedStoreKey}:${userId}`, storeId);
        if (hasDesktopCache()) await markOfflineSessionReady(deviceId, apiUrl.trim().replace(/\/+$/, ''), login, stores.find(store => store.id === storeId)!, opened).catch(caught => setCacheError(`Локальный вход не готов: ${message(caught)}`));
      } catch (caught) {
        if (!active) return;
        setDeviceError(deviceRegistrationError(caught));
        // Lost connection: try again by itself instead of waiting for the cashier.
        if (connectionFailed(caught)) window.setTimeout(() => { if (active) setRegisterNonce(value => value + 1); }, 15_000);
      }
    })();
    return () => { active = false; };
  }, [signedIn, offlineSignedIn, storeId, registrationRequested, registerNonce, client, deviceId, permissions, apiUrl, login, stores, loginMode]);
  useEffect(() => {
    if (!signedIn || !storeId) { setCategories([]); setCategoryNotice(''); return; }
    let active = true;
    const key = `koreacrm-pos-categories-v1:${client.baseUrl()}:${storeId}`;
    try { const saved = localStorage.getItem(key); if (saved) setCategories(JSON.parse(saved) as PosCategory[]); } catch { /* Refresh from server. */ }
    if (!offlineSignedIn && !offlineNetwork) void client.get<PosCategory[]>(`/stores/${storeId}/pos-products/categories`).then(rows => {
      if (!active) return;
      setCategories(rows);
      setCategoryNotice(categoryNoticeFor({ rows }));
      localStorage.setItem(key, JSON.stringify(rows));
    }).catch(caught => {
      if (active && !connectionFailed(caught)) setCategoryNotice(categoryNoticeFor({ status: caught instanceof ApiError ? caught.status : 0 }));
    });
    return () => { active = false; };
  }, [signedIn, storeId, client, offlineSignedIn, offlineNetwork, catalogRefreshToken]);
  useEffect(() => {
    if (!signedIn || !storeId) { setProducts([]); setCatalogTotal(0); return; }
    let active = true;
    const query = search.trim();
    if (catalogPage === 1) { setProducts([]); setCatalogTotal(0); }
    setCatalogLoading(true);
    const timer = window.setTimeout(() => { (offlineSignedIn || offlineNetwork ? Promise.reject(new TypeError('Offline session')) : client.get<PosPage<PosCatalogProduct>>(posCatalogPath(storeId, query, categoryId, catalogPage))).then(page => { if (active) { setProducts(previous => catalogPage === 1 ? page.items : [...previous, ...page.items.filter(item => !previous.some(existing => existing.id === item.id))]); setCatalogTotal(page.total); setServerReachable(true); } }).catch(async caught => {
      if (!active) return;
      if (hasDesktopCache() && userId && storeId && connectionFailed(caught)) {
        try {
          const cached = await readCachedProducts(userId, storeId);
          if (active) { const matches = filterCachedProducts(cached, query, categoryId); setProducts(matches.slice(0, catalogPage * 24)); setCatalogTotal(matches.length); setServerReachable(false); setQueueNotice('Нет связи. Показаны товары, сохранённые на кассе.'); }
        } catch (cacheFailure) { if (active) setError(message(cacheFailure)); }
      } else setError(message(caught));
    }).finally(() => { if (active) setCatalogLoading(false); }); }, query ? 200 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [signedIn, search, categoryId, catalogPage, client, userId, storeId, offlineSignedIn, offlineNetwork, catalogRefreshToken]);
  useEffect(() => {
    if (!signedIn || !can('customers.view') || !customerSearch.trim()) return;
    if (offlineSignedIn || offlineNetwork) {
      void readCachedCustomers(userId, storeId).then(rows => {
        const query = customerSearch.trim().toLocaleLowerCase('ru');
        setCustomers(previous => { const matches = rows.filter(customer => `${customer.firstName} ${customer.lastName ?? ''} ${customer.phone}`.toLocaleLowerCase('ru').includes(query)); const selected = previous.find(customer => customer.id === customerId); return selected && !matches.some(customer => customer.id === selected.id) ? [selected, ...matches] : matches; });
      }).catch(caught => setError(message(caught)));
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => { client.get<PosPage<PosCustomer>>(`/customers?search=${encodeURIComponent(customerSearch.trim())}&limit=100`).then(page => { if (active) setCustomers(previous => { const selected = previous.find(customer => customer.id === customerId); return selected && !page.items.some(customer => customer.id === selected.id) ? [selected, ...page.items] : page.items; }); }).catch(async caught => { if (!active) return; if (hasDesktopCache() && connectionFailed(caught)) { try { const rows = await readCachedCustomers(userId, storeId); const query = customerSearch.trim().toLocaleLowerCase('ru'); if (active) setCustomers(previous => { const matches = rows.filter(customer => `${customer.firstName} ${customer.lastName ?? ''} ${customer.phone}`.toLocaleLowerCase('ru').includes(query)); const selected = previous.find(customer => customer.id === customerId); return selected && !matches.some(customer => customer.id === selected.id) ? [selected, ...matches] : matches; }); } catch (cacheFailure) { if (active) setError(message(cacheFailure)); } } else setError(message(caught)); }); }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [signedIn, customerSearch, customerId, client, permissions, offlineSignedIn, offlineNetwork, userId, storeId]);
  const keysRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keysRef.current = event => {
      if (event.ctrlKey && (event.key.toLowerCase() === 'q' || event.key.toLowerCase() === 'й')) { event.preventDefault(); requestSignOut(); return; }
      if (hasOverlay() || sheet || payOpen || success) return;
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      const key = event.key.toLowerCase();
      if (event.key === 'F8') { event.preventDefault(); parkCurrent(); return; }
      if (event.key === 'Escape') { if (search) { setSearch(''); setCatalogPage(1); } (target as HTMLElement | null)?.blur?.(); return; }
      if (typing) return;
      if (key === 'f' || key === 'а') { event.preventDefault(); searchRef.current?.focus(); }
      else if ((key === 'c' || key === 'с') && shift) { event.preventDefault(); setOverlay('customer'); }
      else if (event.key === 'Enter' && cart.length) { event.preventDefault(); openPayment(); }
      else if ((event.key === '+' || event.key === '-') && cart.length) { event.preventDefault(); const line = cart.at(-1)!; const next = line.quantity + (event.key === '+' ? 1 : -1); if (next <= 0) setCart(current => current.slice(0, -1)); else changeQuantity(line, String(next)); }
    };
  });
  useEffect(() => {
    if (!signedIn) return;
    const handler = (event: globalThis.KeyboardEvent) => keysRef.current(event);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [signedIn]);

  async function addProduct(product: CatalogItem | PosProduct) {
    const existing = cart.find(line => line.product.id === product.id);
    if (existing) { if (existing.quantity >= existing.available) { setStockNotice(`Для «${product.name}» доступно только ${existing.available} шт. Количество оставлено без изменений.`); return; } setStockNotice(''); setCart(current => current.map(line => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line)); searchRef.current?.focus(); return; }
    setBusy(true); setError('');
    try {
      let available: number, priceMinor: number;
      try {
        if (offlineSignedIn || offlineNetwork) throw new TypeError('Offline session');
        const [settings, stock] = await Promise.all([client.get<PosSettings>(`/stores/${storeId}/products/${product.id}/settings`), client.get<PosPage<PosStock>>(`/stores/${storeId}/stock?search=${encodeURIComponent(product.sku)}&limit=20`)]);
        const row = stock.items.find(item => item.productId === product.id);
        if (!settings?.active || settings.priceMinor === null) throw new Error('У товара нет активной цены');
        if (!row || row.quantity - row.reservedQuantity < 1) throw new Error('Товар закончился');
        available = row.quantity - row.reservedQuantity; priceMinor = settings.priceMinor; setServerReachable(true);
      } catch (caught) {
        if (!hasDesktopCache() || !userId || !storeId || !connectionFailed(caught)) throw caught;
        const cached = (await readCachedProducts(userId, storeId)).find(item => item.id === product.id);
        if (!cached?.active || cached.priceMinor === null || cached.availableQuantity < 1) throw new Error('Этот товар сейчас нельзя добавить в чек.');
        available = cached.availableQuantity; priceMinor = cached.priceMinor; setServerReachable(false);
        setQueueNotice('Нет связи. Цена и остаток взяты из сохранённых данных.');
      }
      setStockNotice(''); setCart(current => [...current, { product, imageKey: 'images' in product ? product.images[0]?.storageKey : 'imageKey' in product ? product.imageKey ?? undefined : undefined, quantity: 1, available, priceMinor, discountMinor: '0' }]); searchRef.current?.focus();
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  function changeQuantity(line: Line, rawValue: string) {
    const requested = Number(rawValue);
    if (!Number.isFinite(requested)) return;
    const quantity = Math.max(1, Math.min(Math.trunc(requested), line.available));
    setCart(current => current.map(item => item.product.id === line.product.id ? { ...item, quantity, discountMinor: (BigInt(item.discountMinor) > BigInt(item.priceMinor) * BigInt(quantity) ? BigInt(item.priceMinor) * BigInt(quantity) : BigInt(item.discountMinor)).toString() } : item));
    setStockNotice(requested > line.available ? `Для «${line.product.name}» доступно только ${line.available} шт. Количество автоматически изменено на ${line.available}.` : '');
  }
  async function scan(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault(); const code = search.trim(); if (!code) return;
    setBusy(true); setError('');
    try {
      if (offlineSignedIn || offlineNetwork) throw new TypeError('Offline session');
      const exact = await lookupBarcode(client, code);
      if (!exact) throw new ApiError(404, 'Barcode not found');
      setBusy(false); await addProduct(exact); setSearch('');
    } catch (caught) {
      setBusy(false);
      if ((caught instanceof ApiError && caught.status === 404) || (hasDesktopCache() && connectionFailed(caught))) { const cached = hasDesktopCache() && userId && storeId ? await readCachedProducts(userId, storeId) : []; const match = [...products, ...cached].find(product => product.sku.toLowerCase() === code.toLowerCase() || ('barcodes' in product && product.barcodes.some(barcode => (typeof barcode === 'string' ? barcode : barcode.value) === code))); if (match) { await addProduct(match); setSearch(''); } else setError('Штрихкод не найден. Выберите товар из списка.'); }
      else setError(message(caught));
    }
  }
  async function createCustomer(data: NewCustomer): Promise<string | null> {
    if (offlineSignedIn || !serverReachable || !can('customers.create')) return 'Для создания клиента нужна связь.';
    try {
      const created = await client.post<PosCustomer>('/customers', data);
      setCustomers(previous => [created, ...previous.filter(customer => customer.id !== created.id)]);
      setCustomerSearch(''); setCustomerId(created.id);
      return null;
    } catch (caught) {
      return caught instanceof ApiError && caught.status === 409 ? 'Клиент с таким телефоном уже есть. Найдите его через поиск.' : message(caught);
    }
  }
  function openPayment() {
    if (!cart.length || busy) return;
    if (!deviceReady) { setError('Касса ещё подключается. Подождите немного.'); return; }
    if (pending) { setError('Сначала проверьте предыдущую продажу.'); return; }
    if (!shift) { setError('Откройте смену.'); return; }
    if (cartError || !cartTotal) { setError(cartError || 'Проверьте чек.'); return; }
    if (returnMode) { setOverlay('returnReason'); return; }
    if (discountOverLimit) { setError(`Ручная скидка больше ${discountLimitPercent}%. Попросите менеджера провести продажу.`); return; }
    setError(''); setPayOpen(true); setOverlay('pay');
  }
  async function returnWithoutReceipt(reason: string) {
    if (!shift || !cartTotal) return;
    setBusy(true); setError('');
    let done = 0;
    try {
      for (const [index, line] of cart.entries()) {
        const amountMinor = cartTotal.lines[index]!.totalMinor.toString();
        if (amountMinor === '0') { done++; continue; }
        await client.post(`/stores/${storeId}/sales/returns/no-receipt`, { operationId: crypto.randomUUID(), deviceId, cashShiftId: shift.id, productId: line.product.id, quantity: line.quantity, amountMinor, reason });
        done++;
      }
      flashNotice(`Возврат оформлен. Выдайте ${formatMinor(cartTotal.total)} смн. наличными.`);
      setCart([]); setReturnMode(false); setOverlay(null);
    } catch (caught) {
      setError(`${done ? `Оформлено позиций: ${done} из ${cart.length}. ` : ''}${message(caught)}`);
      if (done) setCart(current => current.slice(done));
    } finally {
      setBusy(false);
      void refreshShift().catch(caught => setError(message(caught)));
    }
  }
  function requestSignOut() {
    if (busy || pending) return;
    if (cart.length && !window.confirm('В чеке есть товары. Выйти из кассы? Чек не сохранится — его можно отложить через меню «⋮».')) return;
    void signOut();
  }
  async function printSale(sale: PosSale) {
    // Without a network printer the receipt goes to the Windows print dialog (USB printers such as POS-80C).
    if (!printerHost.trim()) { printRows(receiptRows(sale)); return; }
    try { await invoke('print_escpos', { host: printerHost.trim(), bytes: buildEscPosReceipt(sale) }); }
    catch (caught) { setError(`Принтер не ответил: ${message(caught)}`); }
  }
  async function persistShift(value: PosShift | null) {
    const currentStore = stores.find(store => store.id === storeId);
    if (currentStore && hasDesktopCache()) await markOfflineSessionReady(deviceId, apiUrl.trim().replace(/\/+$/, ''), login, currentStore, value).catch(caught => setCacheError(`Данные смены не сохранены локально: ${message(caught)}`));
  }
  async function refreshShift() {
    const page = await client.get<PosPage<PosShift>>(`/stores/${storeId}/finance/cash-shifts?limit=100`);
    const updated = page.items.find(value => value.deviceId === deviceId && value.status === 'OPEN') ?? null;
    setShift(updated); await persistShift(updated);
  }
  async function sendSale(payload: PendingSale): Promise<PosSale> {
    const sale = await client.post<PosSale>(`/stores/${payload.storeId}/sales`, payload.request);
    setServerReachable(true);
    localStorage.removeItem(pendingKey); setPending(null); setReceipt(sale); setReceiptScreen('sale'); setCart([]); setCustomerId(''); setReceiptDiscount(0n);
    setSalesRevision(value => value + 1);
    if (payload.request.payments.some(part => methods.find(method => method.id === part.paymentMethodId)?.kind === 'BONUS')) {
      try { const updated = await client.get<PosPage<PosCustomer>>('/customers?limit=100'); setCustomers(updated.items); }
      catch (caught) { setQueueNotice(`Чек принят, но бонусный баланс клиента не обновился на экране: ${message(caught)}`); }
    }
    if (shift && payload.request.cashShiftId) {
      try {
        const result = await client.get<PosPage<PosShift>>(`/stores/${payload.storeId}/finance/cash-shifts?limit=100`);
        const updated = result.items.find(value => value.id === shift.id) ?? null; setShift(updated);
        if (hasDesktopCache()) await markOfflineSessionReady(deviceId, apiUrl.trim().replace(/\/+$/, ''), login, stores.find(store => store.id === storeId)!, updated).catch(caught => setCacheError(`Данные смены не сохранены локально: ${message(caught)}`));
      } catch (caught) {
        setQueueNotice(`Чек принят, но данные смены не обновились: ${message(caught)}`);
      }
    }
    return sale;
  }
  function clearRejectedAttempt(caught: unknown) { if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 401 && caught.status !== 403) { localStorage.removeItem(pendingKey); setPending(null); } }
  async function retryPending() { if (!pending) return; setBusy(true); setError(''); try { setSuccess({ totals: { subtotal: 0n, discount: 0n, total: BigInt(pending.request.payments.reduce((sum, part) => sum + BigInt(part.amountMinor), 0n)) }, parts: [], change: 0n, sale: await sendSale(pending) }); } catch (caught) { clearRejectedAttempt(caught); setError(message(caught)); } finally { setBusy(false); } }
  async function completeSale(parts: PaymentPart[], change: bigint, print: boolean, comment = '') {
    if (!deviceReady || busy) return;
    const totals = cartTotal;
    if (!totals) return;
    const finish = (sale: PosSale | null) => { setSuccess({ totals: { subtotal: totals.subtotal, discount: totals.discount, total: totals.total }, parts, change, sale }); setPayOpen(false); setOverlay(null); if (sale && print) void printSale(sale); };
    try {
      if (pending) { setBusy(true); setError(''); await sendSale(pending); finish(null); return; }
      const rows = parts.map(part => ({ methodId: part.methodId, amountMinor: part.amountMinor.toString(), kind: part.kind }));
      const cash = rows.some(row => row.kind === 'CASH');
      validatePayments(rows, totals.total, customerId || null, cash ? shift?.id ?? null : null, selectedCustomer?.bonusBalanceMinor ?? '0');
      const request: SaleRequest = { operationId: crypto.randomUUID(), deviceId, ...(shift ? { cashShiftId: shift.id } : {}), ...(customerId ? { customerId } : {}), ...(sellerId && sellers.some(seller => seller.id === sellerId) ? { sellerId } : {}), ...(comment ? { comment } : {}), items: cart.map((line, index) => ({ productId: line.product.id, quantity: line.quantity, priceMinor: String(line.priceMinor), discountMinor: totals.lines[index]!.discountMinor.toString() })), payments: parts.map(part => ({ paymentMethodId: part.methodId, amountMinor: part.amountMinor.toString(), ...(part.reference ? { reference: part.reference } : {}) })) };
      const clearSale = () => { setCart([]); setReceipt(null); setCustomerId(''); setReceiptDiscount(0n); };
      if (hasDesktopCache()) {
        setBusy(true); setError(''); setQueueNotice('');
        await enqueueSale(userId, storeId, request.operationId, request);
        await refreshQueueSummary().catch(caught => setQueueNotice(`Продажа сохранена, но её статус пока не обновился: ${message(caught)}`));
        if (offlineSignedIn || offlineNetwork) {
          setQueueNotice('Продажа сохранена на кассе. Отправим её, когда появится связь.');
          clearSale(); finish(null);
          return;
        }
        try {
          await setSyncStatus(userId, storeId, request.operationId, 'SYNCING');
          const sale = await sendSale({ storeId, request });
          await setSyncStatus(userId, storeId, request.operationId, 'SYNCED');
          await refreshQueueSummary().catch(caught => setQueueNotice(`Чек оформлен, но его статус пока не обновился: ${message(caught)}`));
          finish(sale);
        } catch (caught) {
          const conflict = caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 401 && caught.status !== 403;
          if (connectionFailed(caught)) setServerReachable(false);
          await setSyncStatus(userId, storeId, request.operationId, conflict ? 'CONFLICT' : 'ERROR', message(caught));
          await refreshQueueSummary().catch(() => undefined);
          if (conflict) setQueueNotice('Продажу не удалось отправить. Проверьте её в «Непроведённых».');
          else setQueueNotice('Продажа сохранена на кассе и ждёт отправки.');
          clearSale(); finish(null);
        }
        return;
      }
      const attempt = { storeId, request }; localStorage.setItem(pendingKey, JSON.stringify(attempt)); setPending(attempt); setBusy(true); setError('');
      finish(await sendSale(attempt));
    } catch (caught) {
      clearRejectedAttempt(caught);
      setError(message(caught));
    } finally { setBusy(false); }
  }
if (!signedIn) return <main className="login"><div className="login-shell">
  <aside className="login-story">
    <div className="login-story-mark"><img src="/app-icon.svg" alt="" /></div>
    <div className="login-story-copy">
      <p className="eyebrow">KOREA CRM · КАССА</p>
      <h2>Магазин под контролем.</h2>
    </div>
    <img className="login-story-illustration" src="/login-boutique-v2.png" alt="Продавец за кассой магазина" />
  </aside>
  {showSignup ? <section className="panel login-form login-signup-panel">
    <img className="login-brand-logo" src="/koreacrm-logo.svg" alt="Korea Secret" />
    <span className="login-welcome">НОВЫЙ МАГАЗИН</span>
    <h1>Начните с нами</h1>
    <p className="login-intro">Чтобы подключить кассу, оставьте заявку на сайте Madibaev Studio.</p>
    <div className="login-signup-offer"><img src="/app-icon.svg" alt="" /><h2>Подключить Korea CRM</h2><p>Перейдите на сайт и свяжитесь с нами. Поможем запустить систему для вашего магазина.</p></div>
    <a className="login-external-link" href="https://www.madibaevstudio.online/" target="_blank" rel="noopener noreferrer">Перейти на сайт <span aria-hidden="true">↗</span></a>
    <button className="login-return" type="button" onClick={() => setShowSignup(false)}>Вернуться ко входу</button>
  </section> : !storeConnection || setupRequested ? <form onSubmit={connectStore} className="panel login-form">
    <img className="login-brand-logo" src="/koreacrm-logo.svg" alt="Korea Secret" />
    <span className="login-welcome">ПЕРВАЯ НАСТРОЙКА</span>
    <h1>Подключить точку</h1>
    <p className="login-intro">Введите адрес сервера и ID-код магазина. Касса запомнит точку — повторять настройку при каждом входе не нужно.</p>
    <label>Адрес сервера<input required type="url" value={apiUrl} onChange={event => setApiUrl(event.target.value)} placeholder="https://ваш-магазин.uz/api" /></label>
    <label>ID-код точки<input required autoComplete="off" minLength={2} maxLength={40} value={storeCode} onChange={event => setStoreCode(event.target.value.toUpperCase())} placeholder="Например, SADBARG" /></label>
    <p className="scan-hint">Код находится в ЛК: «Магазины» → карточка точки → «Код подключения кассы». Код точки и личный код кассира — разные вещи.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Проверяем точку…' : 'Сохранить точку'}</Button>
    {storeConnection && <button type="button" className="connection-toggle" disabled={busy} onClick={() => { setSetupRequested(false); setError(''); }}>Отмена</button>}
    <button className="login-signup-button" type="button" onClick={() => setShowSignup(true)}>Подключить новый магазин</button>
  </form> : <form onSubmit={loginMode === 'scan' ? signInWithCode : signIn} className="panel login-form">
    <img className="login-brand-logo" src="/koreacrm-logo.svg" alt="Korea Secret" />
    <span className="login-welcome">ДОБРО ПОЖАЛОВАТЬ</span>
    <h1>Вход в кассу</h1>
    <p className="login-intro"><strong>{storeConnection.name}</strong> · точка {storeConnection.code}<br />Войти могут сотрудники, назначенные в этот магазин.</p>
    <button type="button" className="connection-toggle" disabled={busy} onClick={() => { setStoreCode(storeConnection.code); setSetupRequested(true); setError(''); }}>Изменить точку</button>
    <div className="login-modes"><button type="button" className={loginMode === 'password' ? 'selected' : ''} aria-pressed={loginMode === 'password'} onClick={() => { setCameraOpen(false); setLoginMode('password'); setError(''); }}>Логин и пароль</button><button type="button" className={loginMode === 'scan' ? 'selected' : ''} aria-pressed={loginMode === 'scan'} onClick={() => { setLoginMode('scan'); setError(''); }}>По коду</button></div>
    <div className="connection-settings"><button type="button" className="connection-toggle" aria-expanded={connectionOpen} onClick={() => setConnectionOpen(value => !value)}>{connectionOpen ? 'Скрыть адрес магазина' : 'Изменить адрес магазина'}</button>{connectionOpen && <div className="connection-fields"><label>Адрес магазина<input required type="url" value={apiUrl} onChange={event => setApiUrl(event.target.value)} placeholder="https://ваш-магазин.uz/api" /></label><p className="scan-hint">Ссылку для кассы выдаёт администратор. Обычно её нужно ввести только один раз.</p></div>}</div>
    {loginMode === 'password' ? <><label>Логин<input required autoComplete="username" value={login} onChange={event => setLogin(event.target.value)} /></label><label>Пароль<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label></> : <>
      <button type="button" className="camera-open-button" disabled={busy} onClick={() => { setError(''); setCameraOpen(true); }}>Открыть камеру</button>
      {cameraOpen && <Suspense fallback={<p className="scan-hint">Включаем камеру…</p>}><CameraCodeScanner onDetected={cameraDetected} onClose={() => setCameraOpen(false)} /></Suspense>}
      <label>Код кассира<input required ref={scanRef} autoComplete="off" value={scanCode} onChange={event => setScanCode(event.target.value)} placeholder="Сканируйте или введите код" /></label>
      <p className="scan-hint">Покажите код камере или введите его вручную. Вход выполнится автоматически.</p>
    </>}
    {error && <p role="alert" className="error">{error}</p>}
    <Button variant="primary" type="submit" disabled={busy || !deviceId} className="primary">{loginMode === 'scan' ? 'Войти по коду' : 'Войти в кассу'} <span aria-hidden="true">→</span></Button>
    <button className="login-signup-button" type="button" onClick={() => { setCameraOpen(false); setShowSignup(true); setError(''); }}>Sign up <span>Подключить магазин ↗</span></button>
  </form>}
</div></main>;
  const storeName = stores.find(store => store.id === storeId)?.name ?? '';
  const roleName = can('settings.edit') ? 'Владелец' : can('finance.view') ? 'Управляющий' : 'Кассир';
  const openedAt = (shift as (PosShift & { openedAt?: string }) | null)?.openedAt;
  const unsent = (queueSummary?.pending ?? 0) + (queueSummary?.syncing ?? 0) + (queueSummary?.errors ?? 0) + (queueSummary?.conflicts ?? 0);
  const totalsView = cartTotal ? { subtotal: cartTotal.subtotal, discount: cartTotal.discount, total: cartTotal.total } : { subtotal: 0n, discount: 0n, total: 0n };
  const discountPercentLabel = cartTotal && cartTotal.subtotal > 0n && cartTotal.discount > 0n ? `${(Number(cartTotal.discount * 10000n / cartTotal.subtotal) / 100).toLocaleString('ru-RU')}%` : '';
  const editedLine = cart.find(line => line.product.id === lineEditId);
  const seller = sellers.find(value => value.id === sellerId);
  const syncPanel = <section id="sync" className="panel sync-screen"><div className="screen-heading"><p>Каждый чек отправляется сразу после продажи. Если связь прервётся, касса сохранит чек и отправит его при восстановлении связи.</p></div><div className="sync-center"><div><strong>{offlineNetwork || !serverReachable ? 'Нет связи · чеки сохраняются на кассе' : unsent > 0 ? 'Связь есть · отправляем сохранённые чеки' : 'Связь есть · автоматическая отправка включена'}</strong><span>{unsent > 0 ? `Ожидают отправки: ${unsent} · ` : 'Неотправленных чеков нет · '}Нужна проверка: {queueSummary?.conflicts ?? 0} · Отправлено с этой кассы: {queueSummary?.synced ?? 0}</span><span>{queueSummary?.lastSyncedAt ? `Последняя отправка: ${new Date(queueSummary.lastSyncedAt).toLocaleString('ru-RU')}` : 'Продаж с этой кассы пока не было'}</span></div>{(queueSummary?.pending ?? 0) + (queueSummary?.errors ?? 0) > 0 && <button type="button" onClick={() => void syncQueuedSales(true)} disabled={!deviceReady || offlineNetwork || offlineSignedIn}>Повторить отправку</button>}</div><div className="sync-catalog"><div><strong>Товары без связи</strong><p>{cacheBusy ? cacheProgress || 'Обновляем товары…' : cacheStatus?.lastSyncedAt ? `Сохранено ${cacheStatus.productCount} ${russianCount(cacheStatus.productCount, 'товар', 'товара', 'товаров')} · клиентов: ${cacheStatus.customerCount}` : 'Товары ещё не сохранены'}</p></div><button type="button" disabled={cacheBusy || offlineSignedIn} onClick={() => void updateLocalCache()}>Обновить товары</button></div>{cacheError && <p className="cache-warning">Не удалось обновить товары: {cacheError}</p>}{databaseHealth && <p className="stock-notice">Локальная база: {databaseHealth.integrity === 'ok' ? 'исправна' : 'обнаружена ошибка, требуется восстановление из копии'}</p>}<details className="sync-support"><summary>Сведения для поддержки</summary><p>Номер кассы: {deviceId}</p></details>{queueEntries.filter(entry => entry.status === 'CONFLICT').map(entry => <ConflictSaleCard key={entry.operationId} entry={entry} methods={methods} disabled={busy || offlineSignedIn || !deviceReady || !serverReachable} onRetry={() => void retryConflict(entry)} />)}</section>;
  const notices = [error && { tone: 'error', text: error, clear: () => setError('') }, !deviceReady && deviceError && { tone: 'error', text: deviceError }, stockNotice && { tone: 'info', text: stockNotice, clear: () => setStockNotice('') }, queueNotice && { tone: 'info', text: queueNotice, clear: () => setQueueNotice('') }].filter(Boolean) as { tone: string; text: string; clear?: () => void }[];

  return <main className="cs">
    <section className="cs-left">
      <header className="cs-bar">
        <button type="button" className="cs-mode" aria-label="Режим каталога" onClick={() => setOverlay('catalogMode')}><Icon name={catalogMode === 'products' ? 'tiles' : 'layout'} size={28} /></button>
        <label className="cs-search"><span className="sr-only">Поиск товара</span><input ref={searchRef} value={search} onChange={event => { setCatalogPage(1); setCatalogMode('products'); setSearch(event.target.value); }} onKeyDown={event => void scan(event)} placeholder="Поиск по наименованию, артикулу, штрихкоду, коду" disabled={Boolean(pending)} /><Kbd>F</Kbd></label>
      </header>
      {notices.length > 0 && <div className="cs-notices">{notices.map((notice, index) => <p key={index} className={`cs-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}{notice.clear && <button type="button" aria-label="Скрыть" onClick={notice.clear}><Icon name="close" size={16} /></button>}</p>)}</div>}
      {pending && <div className="cs-notices"><p className="cs-notice is-error">Не удалось получить подтверждение предыдущей продажи. Проверьте её, чтобы не провести дважды. <button type="button" className="cs-text-button is-accent" disabled={busy || !deviceReady || storeId !== pending.storeId} onClick={() => void retryPending()}>ПРОВЕРИТЬ ПРОДАЖУ</button></p></div>}
      <div className="cs-catalog">
        {catalogMode === 'categories' ? <ul className="cs-categories">
          <li><button type="button" className={categoryId === 'all' ? 'is-on' : ''} onClick={() => { setCatalogPage(1); setCategoryId('all'); setCatalogMode('products'); }}>Все товары</button></li>
          {categories.map(category => <li key={category.id}><button type="button" className={categoryId === category.id ? 'is-on' : ''} onClick={() => { setCatalogPage(1); setCategoryId(category.id); setCatalogMode('products'); }}>{category.name}</button></li>)}
        </ul> : <>
          {categoryId !== 'all' && <button type="button" className="cs-chip" onClick={() => { setCatalogPage(1); setCategoryId('all'); }}>{categories.find(category => category.id === categoryId)?.name ?? 'Категория'} <Icon name="close" size={14} /></button>}
          {categoryNotice && <p className="cs-caption">{categoryNotice}</p>}
          {!catalogLoading && search.trim() && products.length === 0 && <p className="cs-empty-search">По запросу «{search}» ничего не найдено</p>}
          <ProductGrid products={products} apiUrl={client.baseUrl()} quantities={cartQuantities} view={settings} locked={busy || Boolean(pending) || !shift || !deviceReady} onAdd={product => void addProduct(product)} onStep={(product, quantity) => { const line = cart.find(item => item.product.id === product.id); if (!line) return; if (quantity <= 0) setCart(current => current.filter(item => item.product.id !== product.id)); else changeQuantity(line, String(quantity)); }} />
          {products.length < catalogTotal && <button type="button" className="cs-more" disabled={catalogLoading} onClick={() => setCatalogPage(page => page + 1)}>{catalogLoading ? 'ЗАГРУЗКА…' : `ПОКАЗАТЬ ЕЩЁ · ${catalogTotal - products.length}`}</button>}
        </>}
      </div>
      <footer className="cs-status">
        <button type="button" className="cs-menu-button" onClick={() => setOverlay('menu')}><Icon name="menu" /> Меню</button>
        <button type="button" className="cs-menu-button" onClick={requestSignOut} disabled={busy || Boolean(pending)} title="Выйти из кассы · Ctrl+Q"><Icon name="logout" /> Выход <Kbd>Ctrl+Q</Kbd></button>
        <span className="cs-status-center">{stores.length > 1 && !shift && !cart.length ? <select aria-label="Магазин" value={storeId} onChange={event => { setCategoryId('all'); setCatalogPage(1); setCategories([]); setStoreId(event.target.value); }} disabled={busy}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select> : storeName} / {shift ? (shiftNumber ? `Смена #${shiftNumber}` : `Смена${openedAt ? ` с ${new Date(openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ' открыта'}`) : 'Смена закрыта'}</span>
        <span className="cs-status-right">{clock.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, {clock.toLocaleDateString('ru-RU', { weekday: 'long' })} {clock.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}<span className={connectionOffline ? 'cs-net is-off' : 'cs-net'} title={connectionOffline ? 'Нет связи · локальный режим' : 'Связь есть'}><Icon name="wifi" size={20} /></span></span>
      </footer>
    </section>
    <div className="cs-divider" />
    <section className={`cs-right${returnMode ? ' is-return' : ''}`}>
      <header className="cs-bar">
        <button type="button" className="cs-customer" onClick={() => setOverlay('customer')} disabled={Boolean(pending)}><Icon name="search" /><span>{selectedCustomer ? `${selectedCustomer.firstName} ${selectedCustomer.lastName ?? ''}`.trim() : 'Розничный покупатель'}</span><Kbd>C</Kbd></button>
        {can('customers.create') && <button type="button" className="cs-add-customer" aria-label="Новый покупатель" disabled={offlineSignedIn || !serverReachable || Boolean(pending)} onClick={() => setOverlay('customerCreate')}><Icon name="personAdd" size={28} /></button>}
      </header>
      {!deviceReady ? <div className="cs-locked"><Icon name="lock" size={72} /><p>{registrationRequested ? 'Подключаем кассу…' : 'Касса не подключена к магазину'}</p><button type="button" className="cs-action is-primary" disabled={busy} onClick={() => registrationRequested ? setRegisterNonce(value => value + 1) : setRegistrationRequested(true)}>{registrationRequested ? 'ПОВТОРИТЬ ПОДКЛЮЧЕНИЕ' : 'ПОДКЛЮЧИТЬ КАССУ'}</button></div>
        : !shift ? <div className="cs-locked"><Icon name="lock" size={72} />{can('finance.cash') ? <button type="button" className="cs-action is-primary" disabled={offlineSignedIn} onClick={() => setOverlay('openShift')}>ОТКРЫТЬ СМЕНУ</button> : <p>Нет права открывать смену</p>}{offlineSignedIn && <p className="cs-caption">Для открытия смены нужна связь</p>}</div>
        : <>
          {returnMode && <p className="cs-return-banner">Возврат без чека · добавьте возвращаемые товары</p>}
          {!cart.length && <div className="cs-section-row"><span>Рекомендации</span><Icon name="settings" size={18} /></div>}
          <div className="cs-lines">
            {!cart.length ? <p className="cs-empty">Выберите товары</p> : <><ul>{cart.map((line, index) => { const gross = BigInt(line.priceMinor) * BigInt(line.quantity); const total = cartTotal?.lines[index]?.totalMinor ?? gross; const discount = gross - total; return <li key={line.product.id}>
              <button type="button" className="cs-line" onClick={() => setLineEditId(line.product.id)} disabled={Boolean(pending)}>
                <span className="cs-line-thumb"><ProductImage key={line.imageKey} storageKey={line.imageKey} apiUrl={client.baseUrl()} /></span>
                <span className="cs-line-main"><strong>{line.product.name}</strong><small>{discount > 0n && gross > 0n && <em className="cs-badge">{(Number(discount * 10000n / gross) / 100).toLocaleString('ru-RU')}% Скидка</em>}Цена: {formatMinor(line.priceMinor)}смн.</small></span>
                <span className="cs-line-qty"><i>×</i>{line.quantity}</span>
                <span className="cs-line-sum"><strong>{formatMinor(total)}</strong>{discount > 0n && <s>{formatMinor(gross)}</s>}</span>
              </button>
              <button type="button" className="cs-line-remove" aria-label={`Убрать ${line.product.name}`} disabled={Boolean(pending)} onClick={() => setCart(current => current.filter(item => item.product.id !== line.product.id))}><Icon name="close" size={18} /></button>
            </li>; })}</ul><div className="cs-section-row"><span>Покупают вместе</span><Icon name="settings" size={18} /></div></>}
          </div>
          <div className="cs-totals">
            {cart.length > 0 && <><div><span>Подытог</span><strong>{formatMinor(totalsView.subtotal)}смн.</strong></div><div><span>Скидка {discountPercentLabel || '0,00%'}</span><button type="button" className="cs-link" onClick={() => setOverlay('discount')} disabled={Boolean(pending) || returnMode}>{formatMinor(totalsView.discount)}смн.</button></div></>}
            {discountOverLimit && <p className="cs-error">Ручная скидка больше {discountLimitPercent}%. Нужен менеджер.</p>}
            {cartError && <p className="cs-error">{cartError}</p>}
            {(!cart.length || parked.length > 0 || unsent > 0) && <div className="cs-queue-chips"><button type="button" className="is-accent" onClick={() => setOverlay('queue')}>ОЧЕРЕДЬ ЧЕКОВ: {parked.length}</button><button type="button" onClick={() => setSheet('sync')} disabled={!hasDesktopCache()}>НЕПРОВЕДЁННЫЕ: {unsent}</button></div>}
          </div>
        </>}
      <footer className="cs-sale-bar">
        <button type="button" className="cs-more-button" aria-label="Действия с чеком" onClick={() => setOverlay('more')} disabled={!shift || Boolean(pending)}><Icon name="more" size={28} /></button>
        <button type="button" className={`cs-sale${returnMode ? ' is-return' : ''}`} disabled={!cart.length || !shift || busy || Boolean(pending) || !cartTotal || (returnMode ? false : discountOverLimit)} onClick={() => openPayment()}><span>{returnMode ? 'ВОЗВРАТ ПРОДАЖИ' : 'ПРОДАЖА'}</span><strong>{formatMinor(totalsView.total)}смн.</strong></button>
      </footer>
    </section>

    {overlay === 'catalogMode' && <CatalogModePopover mode={catalogMode} onPick={setCatalogMode} onClose={() => setOverlay(null)} />}
    {overlay === 'menu' && <PopoverMenu anchor="left" onClose={() => setOverlay(null)} header={<div className="cs-profile"><span className="cs-avatar">{(cashierName || login).slice(0, 1).toUpperCase()}</span><span><strong>{cashierName || login}</strong><small>{roleName}</small></span></div>} items={[
      { label: 'Выйти', icon: 'logout', onClick: () => void signOut() },
      'divider',
      { label: returnMode ? 'Вернуться к продаже' : 'Создать возврат', icon: 'undo', hidden: !shift || !can('sales.return_no_receipt'), onClick: () => { setReturnMode(value => !value); setCart([]); setReceiptDiscount(0n); } },
      { label: 'Закрыть смену', icon: 'lock', danger: true, hidden: !shift || !can('finance.cash'), onClick: () => setSheet('shift') },
      'divider',
      { label: 'Возврат долга', icon: 'debt', hidden: !can('customers.view'), onClick: () => setSheet('debts') },
      { label: 'Журнал чеков', icon: 'receipt', hidden: !can('sales.view'), onClick: () => setSheet('history') },
      { label: 'Смены', icon: 'clock', hidden: !can('finance.cash_view'), onClick: () => setSheet('shift') },
      { label: 'Непроведённые продажи', icon: 'sync', hidden: !hasDesktopCache(), onClick: () => setSheet('sync') },
      { label: 'Настройки', icon: 'settings', onClick: () => setSheet('settings') },
    ]} />}
    {overlay === 'more' && <PopoverMenu anchor="right" onClose={() => setOverlay(null)} header={<button type="button" className="cs-seller-row" disabled={!sellers.length} onClick={() => setOverlay('seller')}><span className="cs-avatar is-gray">{(seller?.name ?? cashierName ?? login).slice(0, 1).toUpperCase()}</span><strong>{seller?.name ?? cashierName ?? login}</strong><small>Продавец</small></button>} items={[
      { label: 'Отложить чек', icon: 'history', hidden: !cart.length || returnMode, onClick: parkCurrent },
      { label: 'Отменить чек', icon: 'close', danger: true, hidden: !cart.length, onClick: () => { setCart([]); setCustomerId(''); setReceiptDiscount(0n); setStockNotice(''); } },
    ]} />}
    {overlay === 'seller' && <SellerModal sellers={sellers} sellerId={seller ? sellerId : ''} onPick={id => { chooseSeller(id); setOverlay(null); }} onClose={() => setOverlay(null)} />}
    {overlay === 'queue' && <QueueModal receipts={parked} onPick={receipt => { restoreParked(receipt); setOverlay(null); }} onDelete={receipt => saveParked(parked.filter(value => value.id !== receipt.id))} onClose={() => setOverlay(null)} />}
    {overlay === 'customer' && <CustomerPickerModal customers={customers} search={customerSearch} onSearch={setCustomerSearch} onPick={customer => { setCustomerId(customer?.id ?? ''); setCustomerSearch(''); setOverlay(payOpen ? 'pay' : null); }} onClose={() => setOverlay(payOpen ? 'pay' : null)} />}
    {overlay === 'customerCreate' && <CustomerCreateModal initial={customerSearch} canDiscount={can('customers.discount.edit')} loyaltyMode={loyalty?.mode ?? 'DISCOUNT'} onCreate={async data => { const problem = await createCustomer(data); if (!problem) setOverlay(payOpen ? 'pay' : null); return problem; }} onClose={() => setOverlay(payOpen ? 'pay' : null)} />}
    {overlay === 'discount' && cartTotal && <ReceiptDiscountModal baseMinor={cartTotal.total + cartTotal.cartDiscountMinor} currentMinor={receiptDiscount} onApply={minor => { setReceiptDiscount(minor); setOverlay(null); }} onClose={() => setOverlay(null)} />}
    {overlay === 'openShift' && <OpenShiftModal client={client} storeId={storeId} deviceId={deviceId} storeName={storeName} errorText={message} onOpened={opened => { setShift(opened); void persistShift(opened); setOverlay(null); flashNotice('Смена открыта.'); }} onClose={() => setOverlay(null)} />}
    {overlay === 'returnReason' && <ReturnReasonModal totalMinor={totalsView.total} busy={busy} onConfirm={reason => void returnWithoutReceipt(reason)} onClose={() => setOverlay(null)} />}
    {editedLine && <LineEditor name={editedLine.product.name} imageKey={editedLine.imageKey} apiUrl={client.baseUrl()} priceMinor={editedLine.priceMinor} quantity={editedLine.quantity} available={editedLine.available} discountMinor={editedLine.discountMinor} onApply={(quantity, discountMinor) => { setCart(current => current.map(item => item.product.id === editedLine.product.id ? { ...item, quantity, discountMinor } : item)); setLineEditId(''); }} onClose={() => setLineEditId('')} />}
    {payOpen && overlay === 'pay' && <PaymentScreen totals={totalsView} methods={methods} customer={selectedCustomer ?? null} shiftOpen={Boolean(shift)} busy={busy} printDefault={settings.printByDefault} onChangeCustomer={() => setOverlay('customer')} onComplete={(parts, change, print, comment) => void completeSale(parts, change, print, comment)} onClose={() => { setPayOpen(false); setOverlay(null); }} />}
    {success && <SaleSuccess totals={success.totals} methods={methods} parts={success.parts} change={success.change} onPrint={success.sale ? () => void printSale(success.sale!) : undefined} onClose={() => { setSuccess(null); window.setTimeout(() => searchRef.current?.focus(), 0); }} />}

    {sheet === 'history' && <JournalModal client={client} storeId={storeId} deviceId={deviceId} shift={shift} canReturn={can('sales.return') && !pending && !projectedShift?.queuedCashMinor} printerHost={printerHost} errorText={message} onPrint={sale => void printSale(sale)} onReturned={() => { setSalesRevision(value => value + 1); void refreshShift().catch(caught => setError(message(caught))); }} onClose={() => setSheet(null)} />}
    {sheet === 'debts' && <DebtsModal client={client} storeId={storeId} shift={shift} methods={methods} canPay={can('finance.customer_pay')} errorText={message} onPaid={cash => { if (cash) void refreshShift().catch(caught => setError(message(caught))); }} onClose={() => setSheet(null)} />}
    {sheet === 'shift' && <Sheet title="Смены" onClose={() => setSheet(null)}><ShiftsScreen client={client} storeId={storeId} deviceId={deviceId} current={shift} canManage={can('finance.cash')} queuedCashMinor={projectedShift?.queuedCashMinor ?? 0n} printerHost={printerHost} errorText={message} onClosed={() => { setShift(null); setReturnMode(false); void persistShift(null); setSheet(null); flashNotice('Смена закрыта.'); }} onCashChanged={() => void refreshShift().catch(caught => setError(message(caught)))} /></Sheet>}
    {sheet === 'sync' && <Sheet title="Непроведённые продажи" onClose={() => setSheet(null)}>{syncPanel}</Sheet>}
    {sheet === 'settings' && <Sheet title="Настройки кассы" onClose={() => setSheet(null)}><SettingsPanel value={{ ...settings, printerHost }} version={appVersion} onChange={next => { setSettings(next); setPrinterHost(next.printerHost); localStorage.setItem('koreacrm-pos-printer-host', next.printerHost); }} /></Sheet>}

    {receipt && receiptScreen === 'history' && <div className="receipt-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setReceipt(null); }}><section id="receipt" className="panel receipt" role="dialog" aria-modal="true" aria-labelledby="receipt-title" onKeyDown={event => { if (event.key === 'Escape') setReceipt(null); }}><div className="receipt-heading"><div><h2 id="receipt-title">Чек {receipt.number}</h2><small>Не является фискальным чеком</small></div><div><button className="quiet" onClick={() => void printSale(receipt)}>Печать</button><button disabled={busy || !printerHost.trim()} onClick={() => void printSale(receipt)}>На чековый принтер</button></div></div>{(receipt.returns?.length ?? 0) > 0 && <p className="receipt-returned">Возврат по этому чеку · возвращено {formatMinor(receipt.returns.reduce((total, item) => total + BigInt(item.amountMinor), 0n))}</p>}<p>{receipt.store.name} · {receipt.store.address ?? ''} · {receipt.store.phone ?? ''}</p><p>{new Date(receipt.createdAt).toLocaleString('ru-RU')} · кассир {receipt.employee.name}{receipt.seller ? ` · продавец ${receipt.seller.name}` : ''}</p>{receipt.customer && <p>{receipt.customer.firstName} {receipt.customer.phone}</p>}<ul>{receipt.items.map(item => <li key={item.id}><span>{item.product.name} × {item.quantity}</span><strong>{formatMinor(item.totalMinor)}</strong></li>)}</ul><p>Скидка: {formatMinor(receipt.discountMinor)}</p><p className="total">Итого <strong>{formatMinor(receipt.totalMinor)}</strong></p>{receipt.payments.map(part => <p key={part.id}>{part.paymentMethod.name}: {formatMinor(part.amountMinor)}</p>)}<button type="button" className="primary receipt-close" autoFocus onClick={() => setReceipt(null)}>Закрыть</button></section></div>}
  </main>;
}
