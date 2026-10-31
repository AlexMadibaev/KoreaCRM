/** A consistent display form for names entered in the cabinet, POS, or imports. */
export function normalizeCustomerName(value: string): string {
  const lower = value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU');
  return lower.replace(/(^|[^\p{L}\p{M}])(\p{L})/gu, (_, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('ru-RU'));
}
