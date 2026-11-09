export const invoiceFields = [
  {
    key: 'barcode',
    label: 'Штрихкод',
    aliases: ['штрихкод', 'штрих код', 'ean', 'barcode'],
  },
  { key: 'sku', label: 'Артикул', aliases: ['артикул', 'sku', 'код товара'] },
  {
    key: 'name',
    label: 'Наименование',
    aliases: [
      'наименование',
      'наименование товара',
      'товар',
      'название',
      'номенклатура',
    ],
  },
  {
    key: 'characteristic',
    label: 'Характеристика',
    aliases: ['характеристика', 'характеристика номенклатуры', 'вариант'],
  },
  {
    key: 'quantity',
    label: 'Количество *',
    aliases: ['количество', 'кол во', 'кол', 'quantity'],
  },
  {
    key: 'price',
    label: 'Цена за единицу *',
    aliases: ['цена', 'цена usd', 'цена tjs', 'price'],
  },
  {
    key: 'discountPercent',
    label: 'Скидка, %',
    aliases: ['скидка', 'скидка %', 'discount'],
  },
  {
    key: 'total',
    label: 'Сумма строки',
    aliases: ['сумма', 'сумма usd', 'сумма tjs', 'итого', 'total'],
  },
] as const;
export type InvoiceField = (typeof invoiceFields)[number]['key'];
export type InvoiceMapping = Record<InvoiceField, number>;
export const emptyInvoiceMapping = Object.fromEntries(
  invoiceFields.map((field) => [field.key, -1]),
) as InvoiceMapping;
const headerKey = (text: string) =>
  text
    .toLocaleLowerCase('ru')
    .replace(/[.№_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export function detectInvoiceHeader(matrix: string[][]) {
  let best = { row: 0, score: 0, mapping: { ...emptyInvoiceMapping } };
  matrix.slice(0, 30).forEach((cells, row) => {
    const headers = cells.map(headerKey);
    const mapping = { ...emptyInvoiceMapping };
    for (const field of invoiceFields)
      mapping[field.key] = headers.findIndex((value) =>
        field.aliases.some((alias) => headerKey(alias) === value),
      );
    const score = Object.values(mapping).filter((value) => value >= 0).length;
    if (score > best.score) best = { row, score, mapping };
  });
  return best;
}
/** Suggest a boundary only for a terminal summary section, never skip a later goods row. */
export function detectInvoiceLastRow(
  matrix: string[][],
  mapping: InvoiceMapping,
  headerRow: number,
) {
  const summary = (cells: string[]) =>
    !/^\d/.test((cells[mapping.price] ?? '').trim()) &&
    /^(?:итого|всего|сумма)(?:\s|:|$)/iu.test(cells.find((cell) => cell.trim())?.trim() ?? '');
  const footer = matrix.findIndex((cells, index) => index > headerRow && summary(cells));
  if (footer < 0) return matrix.length;
  const laterGoods = matrix.slice(footer + 1).some((cells) => {
    if (summary(cells)) return false;
    const quantity = (cells[mapping.quantity] ?? '').trim();
    const identifier = [mapping.name, mapping.sku, mapping.barcode]
      .some((column) => column >= 0 && (cells[column] ?? '').trim());
    return identifier && /^\d+(?:[.,]\d+)?$/.test(quantity);
  });
  if (laterGoods) return matrix.length;
  let end = footer;
  while (end > headerRow + 1 && !matrix[end - 1]?.some((cell) => cell.trim())) end--;
  return end;
}
export function invoiceNumber(text: string) {
  const clean = text
    .trim()
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(clean))
    throw new Error(`Некорректное число: «${text}»`);
  return clean;
}
export function invoiceRows(
  matrix: string[][],
  mapping: InvoiceMapping,
  headerRow: number,
  lastRow: number,
) {
  if (
    mapping.quantity < 0 ||
    mapping.price < 0 ||
    [mapping.name, mapping.sku, mapping.barcode].every((index) => index < 0)
  )
    throw new Error(
      'Сопоставьте количество, цену и хотя бы один идентификатор товара',
    );
  const mapped = Object.values(mapping).filter((index) => index >= 0);
  if (new Set(mapped).size !== mapped.length)
    throw new Error('Одна колонка назначена нескольким полям');
  return matrix.slice(headerRow + 1, lastRow).map((cells, index) => {
    const line = headerRow + index + 2;
    const value = (field: InvoiceField) =>
      mapping[field] < 0 ? '' : (cells[mapping[field]] ?? '').trim();
    try {
      const quantity = Number(invoiceNumber(value('quantity')));
      if (!Number.isSafeInteger(quantity) || quantity <= 0)
        throw new Error('Количество должно быть целым положительным числом');
      return {
        line,
        barcode: value('barcode'),
        sku: value('sku'),
        name: value('name'),
        characteristic: value('characteristic'),
        quantity,
        price: invoiceNumber(value('price')),
        discountPercent: value('discountPercent')
          ? invoiceNumber(value('discountPercent').replace(/%$/, ''))
          : '0',
        ...(value('total') ? { total: invoiceNumber(value('total')) } : {}),
        acceptCalculatedTotal: false,
        excluded: false,
        exclusionReason: '',
      };
    } catch (error) {
      throw new Error(
        `Строка ${line}: ${error instanceof Error ? error.message : 'ошибка данных'}`,
      );
    }
  });
}
