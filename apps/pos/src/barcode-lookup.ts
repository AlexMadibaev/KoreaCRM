import type { PosPage, PosProduct } from '@koreacrm/types';

export async function lookupBarcode(
  client: { get<T>(path: string): Promise<T> },
  code: string,
): Promise<PosProduct | undefined> {
  const page = await client.get<PosPage<PosProduct>>(`/products/lookup/barcode/${encodeURIComponent(code)}`);
  return page.items[0];
}
