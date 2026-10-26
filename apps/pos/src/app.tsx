import { FormEvent, KeyboardEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient, ApiError } from '@koreacrm/api-client';
import { Button, MoneyInput } from '@koreacrm/ui';
import { invoke } from '@tauri-apps/api/core';
import type { PosCustomer, PosPage, PosPaymentMethod, PosProduct, PosSale, PosSettings, PosShift, PosStock, PosStore } from '@koreacrm/types';
import { calculateCartWithDiscount, formatMinor, validatePayments } from './calculations';
import { loyaltyPercent, type LoyaltySettings } from './loyalty';
import { buildEscPosReceipt } from './escpos';
import { hasDesktopCache, readCachedCustomers, readCachedProducts, readCatalogCacheStatus, refreshCatalogCache, type CacheStatus } from './local-cache';
import { enqueueSale, listSyncQueue, retryConflictSale, setSyncStatus, syncQueueSummary, type QueueEntry, type QueueSummary } from './sync-queue';
import { drainQueue } from './queue-drain';
import { markOfflineSessionReady, matchOfflineCode, passwordVerifier, readOfflineCodeSessions, readOfflineSession, sameVerifier, saveOfflineCodeSession, saveOfflineSession, type OfflineSession } from './offline-session';
import { projectShiftCash } from './shift-projection';
import { queuedSaleDetails } from './queued-sale-details';
import { isLocalServerUrl, normalizeServerUrl } from './server-url';
import { SalesHistory } from './sales-history';
import { ProductResults, type CatalogItem, type PosCatalogProduct } from './product-results';

const CameraCodeScanner = lazy(() => import('./camera-code-scanner').then(module => ({ default: module.CameraCodeScanner })));
type PosScreen = 'sale' | 'history' | 'shift' | 'sync';

type Line = { product: Pick<PosProduct, 'id' | 'name' | 'sku' | 'brandId' | 'categoryId'>; imageKey?: string; quantity: number; available: number; priceMinor: number; discountMinor: string };
type Tender = { id: string; methodId: string; amountMinor: string; reference: string };
type SaleRequest = { operationId: string; deviceId: string; cashShiftId?: string; customerId?: string; items: { productId: string; quantity: number; priceMinor: string; discountMinor: string }[]; payments: { paymentMethodId: string; amountMinor: string; reference?: string }[] };
type PendingSale = { storeId: string; request: SaleRequest };
const defaultApiUrl = import.meta.env.VITE_API_URL ?? '';
const apiUrlKey = 'koreacrm-pos-api-url-v1';
const pendingKey = 'koreacrm-pos-pending-sale-v1';
const loyaltyKey = 'koreacrm-pos-loyalty-v1';
const deviceKey = 'koreacrm-pos-device-v1';
const savedStoreKey = 'koreacrm-pos-store-v1';
const message = (caught: unknown) => {
  if (caught instanceof TypeError) return 'Нет связи. Проверьте подключение и попробуйте ещё раз.';
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'У вас нет доступа к этому действию. Обратитесь к администратору.';
    if (caught.status >= 500) return 'Сервис временно недоступен. Попробуйте ещё раз позже.';
    if (/^(Forbidden|Unauthorized|Not Found|Internal Server Error|API returned \d+)$/i.test(caught.message)) return 'Не удалось выполнить действие. Попробуйте ещё раз.';
  }
  return caught instanceof Error ? caught.message : 'Не удалось выполнить действие.';
};
const connectionFailed = (caught: unknown) => caught instanceof TypeError || caught instanceof DOMException && ['TimeoutError', 'AbortError'].includes(caught.name) || (caught instanceof ApiError && caught.status >= 500);
const loginError = (caught: unknown, codeLogin = false) => {
  if (connectionFailed(caught)) return 'Не удалось подключиться. Проверьте интернет и адрес магазина в настройках подключения.';
  if (caught instanceof ApiError && caught.status === 401 && caught.message === 'Invalid scan code') return 'Код кассира не найден или уже заменён. Выдайте новую карточку в разделе «Сотрудники и роли».';
  if (caught instanceof ApiError && caught.status === 401) return codeLogin ? 'Код кассира не подошёл. Попросите администратора выдать новый.' : 'Неверный логин или пароль. Проверьте данные и попробуйте ещё раз.';
  return message(caught);
};
const validMinor = (value: string) => /^(0|[1-9]\d{0,17})$/.test(value);
const russianCount = (count: number, one: string, few: string, many: string) => {
  const remainder = count % 100;
  if (remainder >= 11 && remainder <= 14) return many;
  switch (count % 10) { case 1: return one; case 2: case 3: case 4: return few; default: return many; }
};
const cartLineTotal = (totalMinor?: bigint) => totalMinor === undefined ? '—' : formatMinor(totalMinor);

function ConflictSaleCard({ entry, methods, disabled, onRetry }: { entry: QueueEntry; methods: PosPaymentMethod[]; disabled: boolean; onRetry: () => void }) {
  const details = queuedSaleDetails(entry.payloadJson);
  return <article className="sync-conflict">
    <div className="sync-conflict-heading"><strong>Продажа не принята · {details ? formatMinor(details.totalMinor) : 'сумма неизвестна'}</strong><span>{new Date(entry.createdAt).toLocaleString('ru-RU')}</span></div>
    <p role="alert">Продажу не удалось отправить. Проверьте товары и оплату или обратитесь к администратору.</p>
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
  const [showSignup, setShowSignup] = useState(false);
  const client = useMemo(() => {
    let baseUrl = apiUrl.trim().replace(/\/+$/, '');
    try { baseUrl = normalizeServerUrl(apiUrl); } catch { /* Validate on sign-in. */ }
    return createApiClient(baseUrl, deviceId);
  }, [apiUrl, deviceId]);
  const [registrationRequested, setRegistrationRequested] = useState(() => Boolean(localStorage.getItem(savedStoreKey)));
  const [registerNonce, setRegisterNonce] = useState(0);
  const [signedIn, setSignedIn] = useState(false), [login, setLogin] = useState(''), [cashierName, setCashierName] = useState(''), [password, setPassword] = useState(''), [permissions, setPermissions] = useState<string[]>([]);
  const [loginMode, setLoginMode] = useState<'password' | 'scan'>('password'), [scanCode, setScanCode] = useState(''), [cameraOpen, setCameraOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null), [cacheProgress, setCacheProgress] = useState(''), [cacheError, setCacheError] = useState(''), [cacheBusy, setCacheBusy] = useState(false);
  const [queueSummary, setQueueSummary] = useState<QueueSummary | null>(null), [queueNotice, setQueueNotice] = useState('');
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([]);
  const [salesRevision, setSalesRevision] = useState(0);
  const [activeScreen, setActiveScreen] = useState<PosScreen>('sale');
  const [receiptScreen, setReceiptScreen] = useState<'sale' | 'history'>('sale');
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const offlineNetwork = !networkOnline && !isLocalServerUrl(apiUrl);
  const [serverReachable, setServerReachable] = useState(true);
  const [offlineSignedIn, setOfflineSignedIn] = useState(false);
  const offlineCredentialRef = useRef('');
  const offlineCredentialModeRef = useRef<'password' | 'scan'>('password');
  const reconnectingRef = useRef(false);
  const syncBusyRef = useRef(false);
  const [stores, setStores] = useState<PosStore[]>([]), [storeId, setStoreId] = useState(''), [deviceReady, setDeviceReady] = useState(false), [shift, setShift] = useState<PosShift | null>(null), [openingCash, setOpeningCash] = useState('0'), [closingCash, setClosingCash] = useState('0');
  const [methods, setMethods] = useState<PosPaymentMethod[]>([]), [customers, setCustomers] = useState<PosCustomer[]>([]), [customerSearch, setCustomerSearch] = useState(''), [customerId, setCustomerId] = useState('');
  const [loyalty, setLoyalty] = useState<LoyaltySettings | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [personalDiscountDraft, setPersonalDiscountDraft] = useState('0');
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false), [customerFirstName, setCustomerFirstName] = useState(''), [customerLastName, setCustomerLastName] = useState(''), [customerPhone, setCustomerPhone] = useState(''), [customerCreateError, setCustomerCreateError] = useState(''), [creatingCustomer, setCreatingCustomer] = useState(false);
  const [search, setSearch] = useState(''), [products, setProducts] = useState<CatalogItem[]>([]), [cart, setCart] = useState<Line[]>([]), [tenders, setTenders] = useState<Tender[]>([]);
  const [stockNotice, setStockNotice] = useState('');
  const [receipt, setReceipt] = useState<PosSale | null>(null), [pending, setPending] = useState<PendingSale | null>(() => { try { const saved = localStorage.getItem(pendingKey); return saved ? JSON.parse(saved) as PendingSale : null; } catch { return null; } });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [printerHost, setPrinterHost] = useState(() => localStorage.getItem('koreacrm-pos-printer-host') ?? '');
  const searchRef = useRef<HTMLInputElement>(null), scanRef = useRef<HTMLInputElement>(null), customerRef = useRef<HTMLInputElement>(null), paymentRef = useRef<HTMLSelectElement>(null);
  const customerNameRef = useRef<HTMLInputElement>(null);
  const customerPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!signedIn && loginMode === 'scan') scanRef.current?.focus(); }, [signedIn, loginMode]);
  useEffect(() => { if (customerCreateOpen) customerNameRef.current?.focus(); }, [customerCreateOpen]);
  useEffect(() => {
    if (!customerPickerOpen) return;
    const close = (event: PointerEvent) => { if (!customerPickerRef.current?.contains(event.target as Node)) setCustomerPickerOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [customerPickerOpen]);
  const can = (permission: string) => permissions.includes(permission);
  const paymentRows = tenders.map(tender => ({ methodId: tender.methodId, amountMinor: tender.amountMinor, kind: methods.find(method => method.id === tender.methodId)?.kind ?? '' }));
  const cashPayment = paymentRows.some(row => row.kind === 'CASH');
  const selectedCustomer = customers.find(customer => customer.id === customerId);
  useEffect(() => { setPersonalDiscountDraft(selectedCustomer?.discountPercent ?? '0'); }, [selectedCustomer?.id, selectedCustomer?.discountPercent]);
  const customerMatches = customers.filter(customer => !customerSearch.trim() || `${customer.firstName} ${customer.lastName ?? ''} ${customer.phone}`.toLocaleLowerCase('ru').includes(customerSearch.trim().toLocaleLowerCase('ru'))).slice(0, 8);
  const customerDiscountPercent = selectedCustomer?.discountPercent ?? '0';
  const cartSubtotal = cart.reduce((sum, line) => sum + BigInt(line.priceMinor) * BigInt(line.quantity), 0n);
  const cartPercents = loyalty ? cart.map(line => loyaltyPercent(loyalty, { productId: line.product.id, brandId: line.product.brandId, categoryId: line.product.categoryId }, selectedCustomer?.discountPercent ?? null, cartSubtotal)) : [];
  const cartLines = cart.map(line => ({ productId: line.product.id, quantity: line.quantity, available: line.available, priceMinor: line.priceMinor, discountMinor: line.discountMinor }));
  let cartTotal: ReturnType<typeof calculateCartWithDiscount> | null = null;
  let cartError = '';
  try { if (cart.length && loyalty) cartTotal = calculateCartWithDiscount(cartLines, cartPercents); } catch { cartError = 'Проверьте количество товаров и скидку клиента.'; }
  const paid = tenders.reduce((total, tender) => total + BigInt(validMinor(tender.amountMinor) ? tender.amountMinor : '0'), 0n);
  const checkoutHint = pending ? 'Сначала проверьте предыдущую продажу.' : !cart.length ? 'Сначала добавьте товар в чек.' : !deviceReady ? 'Подождите, пока касса подключится.' : cartError ? 'Проверьте количество товаров и скидку клиента.' : cashPayment && !shift ? 'Для оплаты наличными нужна открытая кассовая смена. Откройте её до отключения связи.' : cartTotal && paid !== cartTotal.total ? 'Внесённая сумма должна совпадать с итогом чека.' : '';
  const projectedShift = shift ? projectShiftCash(shift.expectedCashMinor, shift.id, methods.filter(method => method.kind === 'CASH').map(method => method.id), queueEntries) : null;

  async function finishOnlineSignIn(identityLogin: string, normalizedApiUrl: string, offlineCredential?: { mode: 'password' | 'scan'; value: string }) {
      setServerReachable(true); localStorage.setItem(apiUrlKey, normalizedApiUrl); setApiUrl(normalizedApiUrl);
      const [me, available, paymentMethods, loyaltySettings] = await Promise.all([client.get<{ userId: string; name: string; login: string; permissions: string[] }>('/auth/me'), client.get<PosStore[]>('/stores'), client.get<PosPaymentMethod[]>('/sale-payment-methods'), client.get<LoyaltySettings>('/loyalty/settings')]);
      setLoyalty(loyaltySettings); localStorage.setItem(`${loyaltyKey}:${normalizedApiUrl}`, JSON.stringify(loyaltySettings));
      if (!me.permissions.includes('sales.create')) throw new Error('Нет права оформлять продажи');
      const active = paymentMethods.filter(method => method.active && (method.kind !== 'BONUS' || loyaltySettings.mode === 'BONUS' && !hasDesktopCache()) && (method.kind !== 'CASH' || me.permissions.includes('finance.cash_view')));
      if (!active.length || !available.length) throw new Error('Нет доступного магазина или способа оплаты');
      const chosen = available.find(store => store.id === pending?.storeId) ?? available.find(store => store.id === localStorage.getItem(savedStoreKey)) ?? available[0]!;
      if (available.length === 1 || localStorage.getItem(savedStoreKey)) setRegistrationRequested(true);
      if (hasDesktopCache() && offlineCredential) {
        try {
          const common = { deviceId, apiUrl: normalizedApiUrl, login: identityLogin, userId: me.userId, store: chosen, methods: active, permissions: me.permissions };
          if (offlineCredential.mode === 'password') await saveOfflineSession({ ...common, password: offlineCredential.value });
          else await saveOfflineCodeSession({ ...common, code: offlineCredential.value });
        }
        catch (cacheFailure) { setCacheError(`Локальный вход не сохранён: ${message(cacheFailure)}`); }
      }
      setLogin(me.login || identityLogin); setCashierName(me.name || me.login || identityLogin);
      setUserId(me.userId); setPermissions(me.permissions); setStores(available); setMethods(active); setStoreId(chosen.id);
      setTenders([{ id: crypto.randomUUID(), methodId: active.find(method => method.kind === 'CASH')?.id ?? active[0]!.id, amountMinor: '0', reference: '' }]); setPassword(''); setScanCode(''); setOfflineSignedIn(false); setSignedIn(true);
  }
  async function finishOfflineSignIn(saved: OfflineSession, credential: string, mode: 'password' | 'scan', normalizedApiUrl: string) {
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
    setLogin(saved.login); setLoginMode(mode); setCashierName(saved.login); setUserId(saved.userId); setStoreId(saved.storeId); setStores([store]); setMethods(active); setPermissions(permissions); setShift(shift); setCustomers(customers); setDeviceReady(true); setCacheStatus(status); setClosingCash(shift?.expectedCashMinor ?? '0');
    setTenders([{ id: crypto.randomUUID(), methodId: active.find(method => method.kind === 'CASH')?.id ?? active[0]!.id, amountMinor: '0', reference: '' }]); setPassword(''); setScanCode(''); setServerReachable(false); setOfflineSignedIn(true); setSignedIn(true); setQueueNotice('Вы работаете без связи. Продажи сохранятся на кассе и отправятся позже.');
  }
  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const normalizedApiUrl = normalizeServerUrl(apiUrl);
      if (offlineNetwork) throw new TypeError('No internet connection');
      await client.login(login, password);
      await finishOnlineSignIn(login, normalizedApiUrl, { mode: 'password', value: password });
    } catch (caught) {
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
      const normalizedApiUrl = normalizeServerUrl(apiUrl);
      if (offlineNetwork) throw new TypeError('No internet connection');
      const identityLogin = await client.loginWithPosCode(code.trim());
      await finishOnlineSignIn(identityLogin, normalizedApiUrl, { mode: 'scan', value: code.trim() });
    } catch (caught) {
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
  const cameraDetected = useCallback((code: string) => { setCameraOpen(false); setScanCode(code); void authenticateCode(code); }, [client, apiUrl, pending]);
  async function signOut() { setBusy(true); try { await client.logout(); } catch { /* End this cashier session even if the server is unreachable. */ } finally { offlineCredentialRef.current = ''; reconnectingRef.current = false; setOfflineSignedIn(false); setSignedIn(false); setActiveScreen('sale'); setCart([]); setStockNotice(''); setReceipt(null); setPermissions([]); setUserId(''); setCashierName(''); setLogin(''); setPassword(''); setScanCode(''); setCustomerId(''); setCustomers([]); setShift(null); setDeviceReady(false); setCacheStatus(null); setCacheError(''); setQueueSummary(null); setQueueEntries([]); setQueueNotice(''); setLoginMode('scan'); setBusy(false); } }
  const refreshQueueSummary = useCallback(async () => {
    if (!hasDesktopCache() || !userId || !storeId) return;
    const [summary, entries] = await Promise.all([syncQueueSummary(userId, storeId), listSyncQueue(userId, storeId)]);
    setQueueSummary(summary); setQueueEntries(entries);
  }, [userId, storeId]);
  useEffect(() => { if (signedIn && userId && storeId) void refreshQueueSummary().catch(caught => setQueueNotice(`Не удалось проверить сохранённые продажи: ${message(caught)}`)); }, [signedIn, userId, storeId, refreshQueueSummary]);
  const syncQueuedSales = useCallback(async () => {
    if (!hasDesktopCache() || !signedIn || offlineSignedIn || offlineNetwork || !deviceReady || !userId || !storeId || syncBusyRef.current) return;
    syncBusyRef.current = true;
    try {
      const entries = await listSyncQueue(userId, storeId);
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
          setShift(refreshed); setClosingCash(refreshed?.expectedCashMinor ?? '0');
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
        if (offlineCredentialModeRef.current === 'scan') await client.loginWithPosCode(offlineCredentialRef.current);
        else await client.login(login, offlineCredentialRef.current);
        const [me, paymentMethods, loyaltySettings] = await Promise.all([client.get<{ userId: string; name: string; login: string; permissions: string[] }>('/auth/me'), client.get<PosPaymentMethod[]>('/sale-payment-methods'), client.get<LoyaltySettings>('/loyalty/settings')]);
        if (!me.permissions.includes('sales.create') || me.userId !== userId) throw new Error('Права кассира изменились. Выйдите и войдите заново при подключённом сервере.');
        const activeMethods = paymentMethods.filter(method => method.active && (method.kind !== 'BONUS' || loyaltySettings.mode === 'BONUS' && !hasDesktopCache()) && (method.kind !== 'CASH' || me.permissions.includes('finance.cash_view')));
        if (!activeMethods.length) throw new Error('Доступные способы оплаты изменились. Выйдите и войдите заново.');
        if (active) { setLoyalty(loyaltySettings); localStorage.setItem(`${loyaltyKey}:${apiUrl.trim().replace(/\/+$/, '')}`, JSON.stringify(loyaltySettings)); offlineCredentialRef.current = ''; reconnectingRef.current = true; setCashierName(me.name || me.login || login); setPermissions(me.permissions); setMethods(activeMethods); setServerReachable(true); setOfflineSignedIn(false); setQueueNotice('Связь восстановлена. Отправляем сохранённые продажи.'); }
      } catch (caught) {
        if (active && ((caught instanceof ApiError && [401, 403].includes(caught.status)) || (caught instanceof Error && !connectionFailed(caught) && !(caught instanceof ApiError)))) { offlineCredentialRef.current = ''; setDeviceReady(false); setQueueNotice('Не удалось восстановить вход. Когда появится связь, выйдите и войдите снова.'); }
      } finally { checking = false; }
    };
    void reconnect();
    const timer = window.setInterval(() => void reconnect(), 5000);
    window.addEventListener('online', reconnect);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('online', reconnect); };
  }, [signedIn, offlineSignedIn, offlineNetwork, client, login, userId]);
  useEffect(() => {
    if (!signedIn || !deviceReady || !userId || !storeId || !hasDesktopCache()) return;
    void syncQueuedSales();
    const timer = window.setInterval(() => void syncQueuedSales(), 5000);
    const online = () => void syncQueuedSales();
    window.addEventListener('online', online);
    return () => { window.clearInterval(timer); window.removeEventListener('online', online); };
  }, [signedIn, deviceReady, userId, storeId, offlineNetwork, syncQueuedSales]);
  useEffect(() => {
    const update = () => setNetworkOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const updateLocalCache = useCallback(async () => {
    if (!hasDesktopCache() || offlineSignedIn || !userId || !storeId) return;
    setCacheBusy(true); setCacheError('');
    try {
      const status = await refreshCatalogCache(client, userId, storeId, permissions, setCacheProgress);
      setCacheStatus(status); setCacheProgress('');
    } catch (caught) { setCacheError(message(caught)); setCacheProgress(''); }
    finally { setCacheBusy(false); }
  }, [client, offlineSignedIn, userId, storeId, permissions]);
  useEffect(() => {
    if (!signedIn || offlineSignedIn || !deviceReady || !userId || !storeId || !hasDesktopCache()) return;
    let active = true;
    readCatalogCacheStatus(userId, storeId).then(status => { if (active) setCacheStatus(status); }).catch(caught => { if (active) setCacheError(message(caught)); });
    void updateLocalCache();
    return () => { active = false; };
  }, [signedIn, offlineSignedIn, deviceReady, userId, storeId, updateLocalCache]);
  useEffect(() => {
    if (!signedIn || offlineSignedIn || !storeId || !registrationRequested) return;
    let active = true;
    setDeviceReady(false); setShift(null);
    if (!reconnectingRef.current) { setCart([]); setStockNotice(''); setReceipt(null); setCustomerId(''); }
    reconnectingRef.current = false;
    void (async () => {
      try {
        await client.post(`/stores/${storeId}/pos-devices`, { deviceId, appVersion: '0.1.4' });
        const tasks: Promise<unknown>[] = [can('finance.cash_view') ? client.get<PosPage<PosShift>>(`/stores/${storeId}/finance/cash-shifts?limit=100`) : Promise.resolve({ items: [] })];
        if (can('customers.view')) tasks.push(client.get<PosPage<PosCustomer>>('/customers?limit=100'));
        const [shiftPage, customerPage] = await Promise.all(tasks);
        if (!active) return;
        const opened = (shiftPage as PosPage<PosShift>).items.find(value => value.deviceId === deviceId && value.status === 'OPEN') ?? null;
        setShift(opened); setClosingCash(opened?.expectedCashMinor ?? '0'); setCustomers((customerPage as PosPage<PosCustomer> | undefined)?.items ?? []); setDeviceReady(true); localStorage.setItem(savedStoreKey, storeId);
        if (hasDesktopCache()) await markOfflineSessionReady(deviceId, apiUrl.trim().replace(/\/+$/, ''), login, stores.find(store => store.id === storeId)!, opened).catch(caught => setCacheError(`Локальный вход не готов: ${message(caught)}`));
      } catch (caught) { if (active) setError(message(caught)); }
    })();
    return () => { active = false; };
  }, [signedIn, offlineSignedIn, storeId, registrationRequested, registerNonce, client, deviceId, permissions, apiUrl, login, stores, loginMode]);
  useEffect(() => {
    if (!signedIn) { setProducts([]); return; }
    let active = true;
    const query = search.trim();
    const timer = window.setTimeout(() => { (offlineSignedIn || offlineNetwork ? Promise.reject(new TypeError('Offline session')) : client.get<PosPage<PosCatalogProduct>>(`/stores/${storeId}/pos-products?limit=${query ? 20 : 8}${query ? `&search=${encodeURIComponent(query)}` : ''}`)).then(page => { if (active) { setProducts(page.items); setServerReachable(true); } }).catch(async caught => {
      if (!active) return;
      if (hasDesktopCache() && userId && storeId && connectionFailed(caught)) {
        try {
          const cached = await readCachedProducts(userId, storeId);
          if (active) { setProducts(cached.filter(product => product.active && product.priceMinor !== null && product.availableQuantity > 0 && (!query || `${product.name} ${product.sku} ${product.barcodes.join(' ')}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))).slice(0, query ? 20 : 8)); setServerReachable(false); setQueueNotice('Нет связи. Показаны товары, сохранённые на кассе.'); }
        } catch (cacheFailure) { if (active) setError(message(cacheFailure)); }
      } else setError(message(caught));
    }); }, query ? 200 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [signedIn, search, client, userId, storeId, offlineSignedIn, offlineNetwork]);
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
  useEffect(() => {
    if (!signedIn) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'F2') { event.preventDefault(); setActiveScreen('sale'); window.setTimeout(() => searchRef.current?.focus(), 0); }
      if (event.key === 'F3') { event.preventDefault(); setActiveScreen('sale'); setCustomerPickerOpen(true); window.setTimeout(() => customerRef.current?.focus(), 0); }
      if (event.key === 'F5') { event.preventDefault(); setActiveScreen('sale'); window.setTimeout(() => paymentRef.current?.focus(), 0); }
      if (event.key === 'Escape' && activeScreen === 'sale') { setSearch(''); setProducts([]); setCustomerPickerOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [signedIn, activeScreen]);

  async function addProduct(product: CatalogItem | PosProduct) {
    const existing = cart.find(line => line.product.id === product.id);
    if (existing) { if (existing.quantity >= existing.available) { setStockNotice(`Для «${product.name}» доступно только ${existing.available} шт. Количество оставлено без изменений.`); return; } setStockNotice(''); setCart(current => current.map(line => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line)); setSearch(''); return; }
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
      setStockNotice(''); setCart(current => [...current, { product, imageKey: 'images' in product ? product.images[0]?.storageKey : undefined, quantity: 1, available, priceMinor, discountMinor: '0' }]); setSearch(''); setProducts([]); searchRef.current?.focus();
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
      const exact = await client.get<PosProduct>(`/products/lookup/barcode/${encodeURIComponent(code)}`);
      setBusy(false); await addProduct(exact);
    } catch (caught) {
      setBusy(false);
      if ((caught instanceof ApiError && caught.status === 404) || (hasDesktopCache() && connectionFailed(caught))) { const cached = hasDesktopCache() && userId && storeId ? await readCachedProducts(userId, storeId) : []; const match = [...products, ...cached].find(product => product.sku.toLowerCase() === code.toLowerCase() || ('barcodes' in product && product.barcodes.some(barcode => (typeof barcode === 'string' ? barcode : barcode.value) === code))); if (match) await addProduct(match); else setError('Штрихкод не найден. Выберите товар из списка.'); }
      else setError(message(caught));
    }
  }
  async function savePersonalDiscount() {
    if (!selectedCustomer || !can('customers.discount.edit') || offlineSignedIn || !serverReachable) return;
    const discountPercent = personalDiscountDraft.trim().replace(',', '.');
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(discountPercent) || Number(discountPercent) > 100) { setError('Укажите скидку от 0 до 100%.'); return; }
    setBusy(true); setError('');
    try {
      const updated = await client.patch<PosCustomer>(`/customers/${selectedCustomer.id}/discount`, { discountPercent });
      setCustomers(current => current.map(customer => customer.id === updated.id ? updated : customer));
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  async function createCustomer(event: FormEvent) {
    event.preventDefault();
    if (creatingCustomer || pending || offlineSignedIn || !serverReachable || !can('customers.create')) return;
    const firstName = customerFirstName.trim();
    const phone = customerPhone.replace(/[\s()-]/g, '');
    if (!firstName) { setCustomerCreateError('Укажите имя клиента.'); return; }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) { setCustomerCreateError('Укажите телефон с кодом страны, например +992901234567.'); return; }
    setCreatingCustomer(true); setCustomerCreateError('');
    try {
      const created = await client.post<PosCustomer>('/customers', { firstName, lastName: customerLastName.trim() || null, phone });
      setCustomers(previous => [created, ...previous.filter(customer => customer.id !== created.id)]);
      setCustomerSearch(''); setCustomerId(created.id); setCustomerPickerOpen(false);
      setCustomerFirstName(''); setCustomerLastName(''); setCustomerPhone(''); setCustomerCreateOpen(false);
    } catch (caught) {
      setCustomerCreateError(caught instanceof ApiError && caught.status === 409 ? 'Клиент с таким телефоном уже есть. Найдите его через поиск.' : message(caught));
    } finally { setCreatingCustomer(false); }
  }
  async function openShift(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const opened = await client.post<PosShift>(`/stores/${storeId}/finance/cash-shifts`, { deviceId, openingCashMinor: openingCash }); setShift(opened); setClosingCash(opened.expectedCashMinor); if (hasDesktopCache()) await markOfflineSessionReady(deviceId, apiUrl.trim().replace(/\/+$/, ''), login, stores.find(store => store.id === storeId)!, opened).catch(caught => setCacheError(`Данные смены не сохранены локально: ${message(caught)}`)); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  async function closeShift(event: FormEvent) {
    event.preventDefault(); if (!shift) return;
    setBusy(true); setError('');
    try { await client.post(`/stores/${storeId}/finance/cash-shifts/${shift.id}/close`, { actualCashMinor: closingCash }); setShift(null); if (hasDesktopCache()) await markOfflineSessionReady(deviceId, apiUrl.trim().replace(/\/+$/, ''), login, stores.find(store => store.id === storeId)!, null).catch(caught => setCacheError(`Данные смены не сохранены локально: ${message(caught)}`)); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  async function sendSale(payload: PendingSale) {
    const sale = await client.post<PosSale>(`/stores/${payload.storeId}/sales`, payload.request);
    setServerReachable(true);
    localStorage.removeItem(pendingKey); setPending(null); setReceipt(sale); setReceiptScreen('sale'); setCart([]); setCustomerId(''); setTenders(current => current.slice(0, 1).map(tender => ({ ...tender, id: crypto.randomUUID(), amountMinor: '0', reference: '' })));
    setSalesRevision(value => value + 1);
    if (payload.request.payments.some(part => methods.find(method => method.id === part.paymentMethodId)?.kind === 'BONUS')) {
      try { const updated = await client.get<PosPage<PosCustomer>>('/customers?limit=100'); setCustomers(updated.items); }
      catch (caught) { setQueueNotice(`Чек принят, но бонусный баланс клиента не обновился на экране: ${message(caught)}`); }
    }
    if (shift && payload.request.cashShiftId) {
      try {
        const result = await client.get<PosPage<PosShift>>(`/stores/${payload.storeId}/finance/cash-shifts?limit=100`);
        const updated = result.items.find(value => value.id === shift.id) ?? null; setShift(updated); setClosingCash(updated?.expectedCashMinor ?? '0');
        if (hasDesktopCache()) await markOfflineSessionReady(deviceId, apiUrl.trim().replace(/\/+$/, ''), login, stores.find(store => store.id === storeId)!, updated).catch(caught => setCacheError(`Данные смены не сохранены локально: ${message(caught)}`));
      } catch (caught) {
        setQueueNotice(`Чек принят, но данные смены не обновились: ${message(caught)}`);
      }
    }
  }
  function clearRejectedAttempt(caught: unknown) { if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 401 && caught.status !== 403) { localStorage.removeItem(pendingKey); setPending(null); } }
  async function retryPending() { if (!pending) return; setBusy(true); setError(''); try { await sendSale(pending); } catch (caught) { clearRejectedAttempt(caught); setError(message(caught)); } finally { setBusy(false); } }
  async function checkout(event: FormEvent) {
    event.preventDefault(); if (!deviceReady) { setError('Касса ещё подключается. Подождите немного.'); return; } if (pending) { setError('Сначала проверьте предыдущую продажу.'); return; }
    try {
      const totals = calculateCartWithDiscount(cartLines, cartPercents);
      validatePayments(paymentRows, totals.total, customerId || null, cashPayment ? shift?.id ?? null : null, selectedCustomer?.bonusBalanceMinor ?? '0');
      const request: SaleRequest = { operationId: crypto.randomUUID(), deviceId, ...(cashPayment && shift ? { cashShiftId: shift.id } : {}), ...(customerId ? { customerId } : {}), items: cart.map((line, index) => ({ productId: line.product.id, quantity: line.quantity, priceMinor: String(line.priceMinor), discountMinor: totals.lines[index]!.discountMinor.toString() })), payments: tenders.map(tender => ({ paymentMethodId: tender.methodId, amountMinor: tender.amountMinor, ...(tender.reference ? { reference: tender.reference } : {}) })) };
      if (hasDesktopCache()) {
        setBusy(true); setError(''); setQueueNotice('');
        await enqueueSale(userId, storeId, request.operationId, request);
        await refreshQueueSummary().catch(caught => setQueueNotice(`Продажа сохранена, но её статус пока не обновился: ${message(caught)}`));
        if (offlineSignedIn || offlineNetwork) {
          setQueueNotice('Продажа сохранена на кассе. Отправим её, когда появится связь.');
          setCart([]); setReceipt(null); setCustomerId('');
          setTenders(current => current.slice(0, 1).map(tender => ({ ...tender, id: crypto.randomUUID(), amountMinor: '0', reference: '' })));
          return;
        }
        try {
          await setSyncStatus(userId, storeId, request.operationId, 'SYNCING');
          await sendSale({ storeId, request });
          await setSyncStatus(userId, storeId, request.operationId, 'SYNCED');
          await refreshQueueSummary().catch(caught => setQueueNotice(`Чек оформлен, но его статус пока не обновился: ${message(caught)}`));
        } catch (caught) {
          const conflict = caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 401 && caught.status !== 403;
          if (connectionFailed(caught)) setServerReachable(false);
          await setSyncStatus(userId, storeId, request.operationId, conflict ? 'CONFLICT' : 'ERROR', message(caught));
          await refreshQueueSummary().catch(() => undefined);
          if (conflict) setQueueNotice('Продажу не удалось отправить. Проверьте её в разделе «Отправка продаж».');
          else setQueueNotice('Продажа сохранена на кассе и ждёт отправки. Проверьте её в разделе «Отправка продаж».');
          setCart([]); setReceipt(null); setCustomerId('');
          setTenders(current => current.slice(0, 1).map(tender => ({ ...tender, id: crypto.randomUUID(), amountMinor: '0', reference: '' })));
        }
        return;
      }
      const attempt = { storeId, request }; localStorage.setItem(pendingKey, JSON.stringify(attempt)); setPending(attempt); setBusy(true); setError('');
      await sendSale(attempt);
    } catch (caught) {
      clearRejectedAttempt(caught);
      setError(message(caught));
    } finally { setBusy(false); }
  }
  async function printEscPos() {
    if (!receipt || !printerHost.trim()) return;
    setBusy(true); setError('');
    try { await invoke('print_escpos', { host: printerHost.trim(), bytes: buildEscPosReceipt(receipt) }); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
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
  </section> : <form onSubmit={loginMode === 'scan' ? signInWithCode : signIn} className="panel login-form">
    <img className="login-brand-logo" src="/koreacrm-logo.svg" alt="Korea Secret" />
    <span className="login-welcome">ДОБРО ПОЖАЛОВАТЬ</span>
    <h1>Вход в кассу</h1>
    <p className="login-intro">Войдите, чтобы начать работу с продажами.</p>
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
  return <main className="pos">
    <aside className="pos-sidebar" aria-label="Навигация кассы">
      <div className="sidebar-brand"><div><img className="sidebar-brand-logo" src="/koreacrm-logo.svg" alt="Korea CRM" /><small>Рабочее место кассира</small></div></div>
      <nav className="sidebar-nav">
        <span>ПРОДАЖИ</span>
        <button type="button" className={activeScreen === 'sale' ? 'active' : ''} aria-current={activeScreen === 'sale' ? 'page' : undefined} onClick={() => setActiveScreen('sale')}><span aria-hidden="true">▦</span> Касса</button>
        <button type="button" className={activeScreen === 'history' ? 'active' : ''} aria-current={activeScreen === 'history' ? 'page' : undefined} onClick={() => setActiveScreen('history')}><span aria-hidden="true">▤</span> История чеков</button>
        <span>УПРАВЛЕНИЕ</span>
        <button type="button" className={activeScreen === 'shift' ? 'active' : ''} aria-current={activeScreen === 'shift' ? 'page' : undefined} onClick={() => setActiveScreen('shift')}><span aria-hidden="true">◷</span> Кассовая смена</button>
        {hasDesktopCache() && <button type="button" className={activeScreen === 'sync' ? 'active' : ''} aria-current={activeScreen === 'sync' ? 'page' : undefined} onClick={() => setActiveScreen('sync')}><span aria-hidden="true">↻</span> Отправка продаж</button>}
      </nav>
      <div className="sidebar-user"><span className="sidebar-avatar">{(cashierName || login).slice(0, 1).toUpperCase()}</span><div><strong>{cashierName || login}</strong><small>{login}</small></div></div>
    </aside>
    <div className="pos-content"><header className="topbar">
    <div className="topbar-brand"><div className="brand-mark" aria-hidden="true">K<span>•</span></div><div><p className="eyebrow">KOREA CRM</p><h1>{activeScreen === 'sale' ? 'Касса продаж' : activeScreen === 'history' ? 'История чеков' : activeScreen === 'shift' ? 'Кассовая смена' : 'Отправка продаж'}</h1></div></div>
    <label>Магазин<select value={storeId} onChange={event => setStoreId(event.target.value)} disabled={busy || deviceReady}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
    {!deviceReady && <button disabled={busy} onClick={() => registrationRequested ? setRegisterNonce(value => value + 1) : setRegistrationRequested(true)}>{registrationRequested ? 'Повторить подключение' : 'Подключить кассу'}</button>}
    <span className={offlineSignedIn ? "connection-pill" : deviceReady ? "connection-pill is-ready" : "connection-pill"}><i aria-hidden="true" />{offlineSignedIn ? "Нет связи" : deviceReady ? "Касса готова" : "Подключаем кассу"}</span>
    <button className="cashier-switch" disabled={busy || Boolean(pending)} onClick={() => void signOut()}>Сменить кассира</button>
  </header>
    {error && <p role="alert" className="error">{error}</p>}
    {activeScreen === 'sync' && cacheError && <p role="status" className="cache-warning">Не удалось обновить товары: {cacheError}. Продажи при наличии связи доступны.</p>}
    {activeScreen === 'sale' && stockNotice && <p role="status" className="stock-notice">{stockNotice}</p>}
    {queueNotice && <p role="status" className="stock-notice">{queueNotice}</p>}
    {activeScreen === 'sync' && hasDesktopCache() && <section id="sync" className="panel sync-screen"><div className="screen-heading"><p className="eyebrow">УПРАВЛЕНИЕ</p><h2>Отправка продаж</h2><p>Каждый чек отправляется сразу после продажи. Если связь прервётся, касса сохранит чек и отправит его при восстановлении связи.</p></div><div className="sync-center"><div><strong>{offlineNetwork || !serverReachable ? 'Нет связи · чеки сохраняются на кассе' : (queueSummary?.pending ?? 0) + (queueSummary?.syncing ?? 0) + (queueSummary?.errors ?? 0) > 0 ? 'Связь есть · отправляем сохранённые чеки' : 'Связь есть · автоматическая отправка включена'}</strong><span>{(queueSummary?.pending ?? 0) + (queueSummary?.syncing ?? 0) + (queueSummary?.errors ?? 0) > 0 ? `Ожидают повторной отправки: ${(queueSummary?.pending ?? 0) + (queueSummary?.syncing ?? 0) + (queueSummary?.errors ?? 0)} · ` : 'Неотправленных чеков нет · '}Нужна проверка: {queueSummary?.conflicts ?? 0} · Отправлено с этой кассы: {queueSummary?.synced ?? 0}</span><span>{queueSummary?.lastSyncedAt ? `Последняя отправка: ${new Date(queueSummary.lastSyncedAt).toLocaleString('ru-RU')}` : 'Продаж с этой кассы пока не было'}</span></div>{(queueSummary?.pending ?? 0) + (queueSummary?.errors ?? 0) > 0 && <button type="button" onClick={() => void syncQueuedSales()} disabled={!deviceReady || offlineNetwork || offlineSignedIn}>Повторить отправку</button>}</div><div className="sync-catalog"><div><strong>Товары без связи</strong><p>{cacheBusy ? cacheProgress || 'Обновляем товары…' : cacheStatus?.lastSyncedAt ? `Сохранено ${cacheStatus.productCount} ${russianCount(cacheStatus.productCount, 'товар', 'товара', 'товаров')}` : 'Товары ещё не сохранены'}</p></div><button type="button" disabled={cacheBusy || offlineSignedIn} onClick={() => void updateLocalCache()}>Обновить товары</button></div><details className="sync-support"><summary>Сведения для поддержки</summary><p>Номер кассы: {deviceId}</p></details>{queueEntries.filter(entry => entry.status === 'CONFLICT').map(entry => <ConflictSaleCard key={entry.operationId} entry={entry} methods={methods} disabled={busy || offlineSignedIn || !deviceReady || !serverReachable} onRetry={() => void retryConflict(entry)} />)}</section>}
    {pending && <section className="panel pending"><h2>Проверка предыдущей продажи</h2><p>Не удалось получить подтверждение. Нажмите «Проверить продажу», чтобы избежать повторного списания. Магазин: {stores.find(store => store.id === pending.storeId)?.name ?? 'другой магазин'}.</p><button disabled={busy || !deviceReady || storeId !== pending.storeId} onClick={() => void retryPending()} className="primary">Проверить продажу</button></section>}
    {activeScreen === 'sale' && <div className="columns" id="workspace">
      <section className="panel catalog-panel" aria-label="Каталог товаров">
        <div className="catalog-heading"><div><p className="eyebrow">КАТАЛОГ</p><h2>Выберите товар</h2><p>Найдите по названию или сканируйте штрихкод</p></div><span className="catalog-count">{products.length} {russianCount(products.length, 'товар', 'товара', 'товаров')}</span></div>
        <label className="catalog-search"><span className="sr-only">Поиск или штрихкод</span><input ref={searchRef} autoFocus value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => void scan(event)} placeholder="Поиск товара или сканирование штрихкода · F2" disabled={Boolean(pending)} /></label>
        <div className="catalog-filters"><span className="active">Все товары</span><span>Нажмите на карточку, чтобы добавить в чек</span></div>
        {search.trim() && products.length === 0 && <div className="catalog-empty">По запросу «{search}» товары не найдены.</div>}
        <ProductResults products={products} apiUrl={apiUrl} disabled={busy || Boolean(pending)} onAdd={product => void addProduct(product)} />
      </section>
      <section className="panel order-panel" aria-label="Текущий чек">
        <div className="order-heading"><div><p className="eyebrow">ПРОДАЖА</p><h2>Текущий чек <span>{cart.length}</span></h2></div><button type="button" className="reset-order" disabled={!cart.length || Boolean(pending)} onClick={() => { setCart([]); setStockNotice(''); }}>Очистить</button></div>
        <div className="order-items">
          {!cart.length && <div className="empty-cart"><div className="empty-cart-icon" aria-hidden="true">▤</div><strong>Чек пока пуст</strong><p>Выберите товар слева, чтобы начать продажу.</p></div>}
          <ul className="cart">{cart.map((line, index) => <li key={line.product.id}>
            <div className="cart-line-main"><div className="cart-line-image">{line.imageKey ? <img src={`${apiUrl.trim().replace(/\/+$/, '')}/product-images/${encodeURIComponent(line.imageKey)}`} alt="" /> : <span aria-hidden="true">▣</span>}</div><div className="item-name"><strong>{line.product.name}</strong><span>{formatMinor(line.priceMinor)} сомони · доступно {line.available}</span></div><button type="button" className="cart-remove" aria-label={`Убрать ${line.product.name}`} disabled={Boolean(pending)} onClick={() => setCart(current => current.filter(item => item.product.id !== line.product.id))}>×</button></div>
            <div className="cart-line-controls"><div className="quantity-control"><button type="button" aria-label={`Уменьшить количество ${line.product.name}`} disabled={Boolean(pending) || line.quantity <= 1} onClick={() => changeQuantity(line, String(line.quantity - 1))}>−</button><input aria-label={`Количество ${line.product.name}`} type="number" min="1" max={line.available} value={line.quantity} disabled={Boolean(pending)} onChange={event => changeQuantity(line, event.target.value)} /><button type="button" aria-label={`Увеличить количество ${line.product.name}`} disabled={Boolean(pending)} onClick={() => changeQuantity(line, String(line.quantity + 1))}>+</button></div><label className="cart-manual-discount">Скидка, сомони<MoneyInput aria-label={`Ручная скидка ${line.product.name}`} valueMinor={line.discountMinor} onMinorChange={minor => setCart(current => current.map(item => item.product.id === line.product.id ? { ...item, discountMinor: (BigInt(minor) > BigInt(item.priceMinor) * BigInt(item.quantity) ? BigInt(item.priceMinor) * BigInt(item.quantity) : BigInt(minor)).toString() } : item))} disabled={Boolean(pending)} /></label><strong>{cartLineTotal(cartTotal?.lines[index]?.totalMinor)} сомони</strong></div>
          </li>)}</ul>
        </div>
        <form className="checkout-form" onSubmit={checkout}>
          <div className="customer-picker" ref={customerPickerRef}>
            <label htmlFor="checkout-customer">Клиент <span className="muted">F3</span></label>
            <div className={`customer-picker-control${selectedCustomer ? ' has-customer' : ''}`}>
              <input id="checkout-customer" ref={customerRef} role="combobox" aria-autocomplete="list" aria-expanded={customerPickerOpen} aria-controls="checkout-customer-options" autoComplete="off" value={customerSearch} onFocus={() => setCustomerPickerOpen(true)} onChange={event => { setCustomerSearch(event.target.value); setCustomerId(''); setCustomerPickerOpen(true); }} onKeyDown={event => { if (event.key === 'Escape') { setCustomerPickerOpen(false); event.currentTarget.blur(); } else if (event.key === 'Enter' && customerPickerOpen) { event.preventDefault(); if (customerSearch.trim() && customerMatches[0]) { setCustomerId(customerMatches[0].id); setCustomerSearch(''); } setCustomerPickerOpen(false); } }} placeholder={selectedCustomer ? `${selectedCustomer.firstName} ${selectedCustomer.lastName ?? ''} · ${selectedCustomer.phone}`.trim() : 'Без клиента · найдите по имени или телефону'} disabled={Boolean(pending)} />
              {selectedCustomer ? <button type="button" className="customer-picker-clear" aria-label="Убрать клиента из чека" disabled={Boolean(pending)} onClick={() => { setCustomerId(''); setCustomerSearch(''); setCustomerPickerOpen(false); }}>×</button> : <button type="button" className="customer-picker-toggle" aria-label="Показать клиентов" aria-expanded={customerPickerOpen} disabled={Boolean(pending)} onClick={() => { if (customerPickerOpen) setCustomerPickerOpen(false); else { setCustomerPickerOpen(true); customerRef.current?.focus(); } }}>⌄</button>}
            </div>
            {customerPickerOpen && !pending && <div className="customer-picker-menu" id="checkout-customer-options" role="listbox" aria-label="Выбор клиента">
              <button type="button" role="option" aria-selected={!customerId} onClick={() => { setCustomerId(''); setCustomerSearch(''); setCustomerPickerOpen(false); }}>Без клиента</button>
              {can('customers.view') && customerMatches.map(customer => <button type="button" role="option" aria-selected={customer.id === customerId} key={customer.id} onClick={() => { setCustomerId(customer.id); setCustomerSearch(''); setCustomerPickerOpen(false); }}><strong>{customer.firstName} {customer.lastName ?? ''}</strong><span>{customer.phone}</span></button>)}
              {can('customers.view') && customerSearch.trim() && customerMatches.length === 0 && <p>Клиент не найден</p>}
              {can('customers.create') && <button type="button" className="customer-picker-create" disabled={creatingCustomer || offlineSignedIn || !serverReachable} onClick={() => { setCustomerCreateError(''); if (/^\+?\d[\d\s()-]*$/.test(customerSearch.trim())) setCustomerPhone(customerSearch.trim()); else setCustomerFirstName(customerSearch.trim()); setCustomerCreateOpen(true); setCustomerPickerOpen(false); }}>＋ Добавить нового клиента</button>}
            </div>}
          </div>
          {selectedCustomer && can('customers.discount.edit') && <div className="customer-personal-discount"><label>Персональная скидка, %<input inputMode="decimal" value={personalDiscountDraft} onChange={event => setPersonalDiscountDraft(event.target.value)} disabled={busy || offlineSignedIn || !serverReachable} /></label><button type="button" className="secondary" onClick={() => void savePersonalDiscount()} disabled={busy || offlineSignedIn || !serverReachable || personalDiscountDraft.replace(',', '.') === selectedCustomer.discountPercent}>Сохранить скидку</button></div>}
          {customerId && customerDiscountPercent !== '0' && <p className="muted">Персональная скидка: {customerDiscountPercent}%.</p>}{selectedCustomer && methods.some(method => method.kind === 'BONUS') && <p className="muted">Доступно бонусов: {formatMinor(selectedCustomer.bonusBalanceMinor ?? '0')}</p>}
          {cartError && <p role="alert" className="cart-discount-error">{cartError}</p>}
          <div className="order-totals"><div><span>Товары</span><strong>{cartTotal ? formatMinor(cartTotal.subtotal) : '0,00'} сомони</strong></div>{selectedCustomer && cartTotal && cartTotal.discount > 0n && <div><span>Скидка клиента ({customerDiscountPercent}%)</span><strong>− {formatMinor(cartTotal.discount)} сомони</strong></div>}<div className="order-total"><span>Итого</span><strong>{cartTotal ? formatMinor(cartTotal.total) : '0,00'} сомони</strong></div></div>
          <div className="payments"><div className="payment-heading"><h3>Способ оплаты <span className="muted">F5</span></h3><button type="button" className="fill-total" disabled={!cartTotal || tenders.length !== 1} onClick={() => setTenders(current => current.map(tender => ({ ...tender, amountMinor: cartTotal!.total.toString() })))}>Внести итог</button></div>
            <div className="payment-shortcuts">{methods.filter(method => ['CARD', 'CASH', 'QR'].includes(method.kind)).slice(0, 3).map(method => <button type="button" key={method.id} className={tenders.length === 1 && tenders[0]?.methodId === method.id ? 'selected' : ''} disabled={Boolean(pending)} onClick={() => setTenders(current => current.length === 1 ? [{ ...current[0]!, methodId: method.id, amountMinor: cartTotal?.total.toString() ?? '0' }] : current.map((part, index) => index === 0 ? { ...part, methodId: method.id } : part))}>{method.name}</button>)}</div>
            {tenders.map((tender, index) => <div className="payment" key={tender.id}><label>Способ<select ref={index === 0 ? paymentRef : undefined} value={tender.methodId} onChange={event => setTenders(current => current.map(part => part.id === tender.id ? { ...part, methodId: event.target.value } : part))} disabled={Boolean(pending)}>{methods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label><label>Сумма, сомони<MoneyInput required aria-label={`Сумма оплаты ${index + 1}`} valueMinor={tender.amountMinor} onMinorChange={minor => setTenders(current => current.map(part => part.id === tender.id ? { ...part, amountMinor: minor } : part))} disabled={Boolean(pending)} /></label><label>Ссылка / номер<input value={tender.reference} onChange={event => setTenders(current => current.map(part => part.id === tender.id ? { ...part, reference: event.target.value } : part))} disabled={Boolean(pending)} /></label>{index > 0 && <button type="button" className="quiet" onClick={() => setTenders(current => current.filter(part => part.id !== tender.id))} disabled={Boolean(pending)}>Убрать</button>}</div>)}
            <button type="button" className="secondary" disabled={Boolean(pending)} onClick={() => setTenders(current => [...current, { id: crypto.randomUUID(), methodId: methods[0]?.id ?? '', amountMinor: '0', reference: '' }])}>Разделить оплату</button><p>Внесено: <strong>{formatMinor(paid)} сомони</strong></p>
          </div>
          {checkoutHint && <p className="checkout-guidance">{checkoutHint}</p>}
          <Button variant="primary" type="submit" className="primary checkout-button" disabled={busy || !deviceReady || Boolean(pending) || !cartTotal || cartTotal.total <= 0n || cartTotal.total !== paid || (cashPayment && !shift)}>Оформить продажу · {cartTotal ? formatMinor(cartTotal.total) : '0,00'} сомони</Button>
        </form>
        {customerCreateOpen && <div className="customer-create-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !creatingCustomer) setCustomerCreateOpen(false); }}><section className="customer-create-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-create-title" onKeyDown={event => { if (event.key === 'Escape' && !creatingCustomer) { event.stopPropagation(); setCustomerCreateOpen(false); } }}>
          <div className="customer-create-heading"><div><p className="eyebrow">КЛИЕНТЫ</p><h3 id="customer-create-title">Новый клиент</h3><p>После сохранения клиент будет выбран в текущем чеке.</p></div><button type="button" aria-label="Закрыть" disabled={creatingCustomer} onClick={() => setCustomerCreateOpen(false)}>×</button></div>
          <form onSubmit={createCustomer}><label>Имя<input ref={customerNameRef} required maxLength={100} value={customerFirstName} onChange={event => setCustomerFirstName(event.target.value)} placeholder="Имя клиента" disabled={creatingCustomer} /></label><label>Фамилия <span className="muted">необязательно</span><input maxLength={100} value={customerLastName} onChange={event => setCustomerLastName(event.target.value)} placeholder="Фамилия" disabled={creatingCustomer} /></label><label>Телефон с кодом страны<input required type="tel" inputMode="tel" value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} placeholder="+992901234567" disabled={creatingCustomer} /></label>
            {customerCreateError && <p role="alert" className="customer-create-error">{customerCreateError}</p>}
            <div className="customer-create-actions"><button type="button" disabled={creatingCustomer} onClick={() => setCustomerCreateOpen(false)}>Отмена</button><button type="submit" className="customer-create-save" disabled={creatingCustomer}>{creatingCustomer ? 'Сохраняем…' : 'Добавить в чек'}</button></div>
          </form>
        </section></div>}
      </section>
    </div>}
    {activeScreen === 'history' && <div id="history"><SalesHistory client={client} storeId={storeId} enabled={deviceReady && !offlineSignedIn && can('sales.view')} revision={salesRevision} canReturn={can('sales.return') && !pending && !projectedShift?.queuedCashMinor} shift={shift} deviceId={deviceId} onReturned={sale => { setSalesRevision(value => value + 1); if (receipt?.id === sale.id) setReceipt(sale); void client.get<PosPage<PosShift>>(`/stores/${storeId}/finance/cash-shifts`).then(async result => { const updated = result.items.find(value => value.id === shift?.id) ?? null; setShift(updated); setClosingCash(updated?.expectedCashMinor ?? '0'); const currentStore = stores.find(store => store.id === storeId); if (currentStore && hasDesktopCache()) await markOfflineSessionReady(deviceId, apiUrl.trim().replace(/\/+$/, ''), login, currentStore, updated); }).catch(caught => setError(message(caught))); }} onPrint={sale => { setReceipt(sale); setReceiptScreen('history'); window.requestAnimationFrame(() => document.getElementById('receipt')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }} /></div>}
    {activeScreen === 'shift' && <section id="shift" className="panel shift-screen"><div className="screen-heading"><p className="eyebrow">УПРАВЛЕНИЕ</p><h2>Кассовая смена</h2><p>Открывайте смену и проверяйте сумму наличных в кассе.</p></div><div className="shift-state"><span>Статус смены</span><strong>{shift ? 'Открыта' : 'Не открыта'}</strong></div><p className="shift-cash">{projectedShift ? `Ожидаемая наличность: ${formatMinor(projectedShift.expectedCashMinor)} сомони${projectedShift.queuedCashMinor > 0n ? ` · ещё не отправлено: ${formatMinor(projectedShift.queuedCashMinor)} сомони` : ''}` : 'На этой кассе нет открытой смены.'}</p>{!shift && can('finance.cash') && <form className="shift-form" onSubmit={openShift}><label>Начальный остаток, сомони<MoneyInput required valueMinor={openingCash} onMinorChange={setOpeningCash} /></label><button className="primary" disabled={busy || !deviceReady || Boolean(pending) || offlineSignedIn}>Открыть смену</button></form>}{shift && can('finance.cash') && <form className="shift-form" onSubmit={closeShift}><label>Фактическая наличность, сомони<MoneyInput required valueMinor={closingCash} onMinorChange={setClosingCash} /></label><button className="primary" disabled={busy || Boolean(pending) || offlineSignedIn || Boolean(projectedShift?.queuedCashMinor)}>Закрыть смену</button></form>}{!can('finance.cash') && <p className="muted">У вас нет права открывать или закрывать кассовую смену.</p>}{offlineSignedIn && <p className="muted">Для управления сменой нужна связь.</p>}</section>}
    {receipt && activeScreen === receiptScreen && <section id="receipt" className="panel receipt"><div className="receipt-heading"><div><h2>Чек {receipt.number}</h2><small>Не является фискальным чеком</small></div><div><button className="quiet" onClick={() => window.print()}>Печать</button><button disabled={busy || !printerHost.trim() || Boolean(receipt.returns?.length)} onClick={() => void printEscPos()}>На чековый принтер</button></div></div>{(receipt.returns?.length ?? 0) > 0 && <p className="receipt-returned">Возврат по этому чеку · возвращено {formatMinor(receipt.returns.reduce((total, item) => total + BigInt(item.amountMinor), 0n))}</p>}<p>{receipt.store.name} · {receipt.store.address ?? ''} · {receipt.store.phone ?? ''}</p><p>{new Date(receipt.createdAt).toLocaleString('ru-RU')} · кассир {receipt.employee.name}</p>{receipt.customer && <p>{receipt.customer.firstName} {receipt.customer.phone}</p>}<ul>{receipt.items.map(item => <li key={item.id}><span>{item.product.name} × {item.quantity}</span><strong>{formatMinor(item.totalMinor)}</strong></li>)}</ul><p>Скидка: {formatMinor(receipt.discountMinor)}</p><p className="total">Итого <strong>{formatMinor(receipt.totalMinor)}</strong></p>{receipt.payments.map(part => <p key={part.id}>{part.paymentMethod.name}: {formatMinor(part.amountMinor)}</p>)}<details className="printer-setting"><summary>Настроить чековый принтер</summary><label>Адрес принтера<input value={printerHost} onChange={event => { setPrinterHost(event.target.value); localStorage.setItem('koreacrm-pos-printer-host', event.target.value); }} placeholder="Например, 192.168.1.50" /></label></details></section>}
    {activeScreen === 'sale' && <p className="footnote">F2 поиск · F3 клиент · F5 оплата · Esc очистить поиск. {hasDesktopCache() ? 'Если пропадёт связь, касса сохранит продажу и отправит её позже.' : 'Для продажи нужна связь с магазином.'}</p>}
    </div>
  </main>;
}
