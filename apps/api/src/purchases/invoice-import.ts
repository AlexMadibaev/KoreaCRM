import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const amount = z
  .string()
  .trim()
  .regex(
    /^\d{1,12}(?:[.,]\d{1,4})?$/,
    'Укажите число, до 4 знаков после запятой',
  );
export const invoiceRowSchema = z.object({
  line: z.number().int().min(1).max(10000),
  barcode: z.string().trim().max(120).default(''),
  sku: z.string().trim().max(100).default(''),
  name: z.string().trim().max(500).default(''),
  characteristic: z.string().trim().max(500).default(''),
  quantity: z.number().int().positive().max(2_147_483_647),
  price: amount,
  discountPercent: amount.default('0'),
  total: amount.optional(),
  acceptCalculatedTotal: z.boolean().default(false),
  productId: z.string().uuid().optional(),
  excluded: z.boolean().default(false),
  exclusionReason: z.string().trim().max(500).default(''),
});
export const invoiceMatchSchema = z.object({ rows: z.array(invoiceRowSchema).min(1).max(300) });
export const invoiceSchema = z
  .object({
    supplierId: z.string().uuid(),
    number: z.string().trim().min(1).max(255),
    date: z.iso.date(),
    filename: z.string().trim().min(1).max(255),
    currency: z.enum(['TJS', 'USD']),
    // No implicit rate: the operator confirms it for this document.
    exchangeRate: z.string().regex(/^\d{1,6}(?:[.,]\d{1,8})?$/),
    rows: z.array(invoiceRowSchema).min(1).max(300),
  })
  .superRefine((value, ctx) => {
    const rate = new Prisma.Decimal(value.exchangeRate.replace(',', '.'));
    if (rate.lte(0) || (value.currency === 'TJS' && !rate.eq(1)))
      ctx.addIssue({
        code: 'custom',
        path: ['exchangeRate'],
        message: 'Для TJS курс равен 1; для USD укажите положительный курс',
      });
    if (new Set(value.rows.map((row) => row.line)).size !== value.rows.length)
      ctx.addIssue({
        code: 'custom',
        path: ['rows'],
        message: 'Номера строк повторяются',
      });
  });
export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type InvoiceRow = z.infer<typeof invoiceRowSchema>;
type Candidate = {
  id: string;
  name: string;
  sku: string;
  barcodes: { value: string }[];
};
const normalize = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
export const isExpenseRow = (
  row: Pick<InvoiceRow, 'name' | 'characteristic'>,
) =>
  /(?:^|\s)(?:тачка|доставка|логистика|упаковка|транспорт|транспортные расходы|delivery|shipping)(?:$|\s)/i.test(
    `${row.name} ${row.characteristic}`,
  );

export function invoiceAmounts(row: InvoiceRow, exchangeRate: string) {
  const price = new Prisma.Decimal(row.price.replace(',', '.'));
  const discount = new Prisma.Decimal(row.discountPercent.replace(',', '.'));
  if (discount.gt(100))
    throw new BadRequestException(`Строка ${row.line}: скидка больше 100%`);
  const net = price.mul(new Prisma.Decimal(100).minus(discount)).div(100);
  const sourceTotal = net
    .mul(row.quantity)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const purchasePriceMinor = net
    .mul(exchangeRate.replace(',', '.'))
    .mul(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  if (purchasePriceMinor.mul(row.quantity).gt('999999999999999999'))
    throw new BadRequestException(`Строка ${row.line}: сумма слишком велика`);
  const mismatch =
    row.total !== undefined &&
    !sourceTotal.eq(
      new Prisma.Decimal(row.total.replace(',', '.')).toDecimalPlaces(
        2,
        Prisma.Decimal.ROUND_HALF_UP,
      ),
    );
  return {
    sourceTotal: sourceTotal.toFixed(2),
    purchasePriceMinor: purchasePriceMinor.toFixed(0),
    totalMinor: purchasePriceMinor.mul(row.quantity).toFixed(0),
    mismatch,
  };
}

export function matchInvoiceRow(row: InvoiceRow, candidates: Candidate[]) {
  // A supplied barcode must not silently fall back to a different SKU/name.
  if (row.productId)
    return candidates.filter((product) => product.id === row.productId);
  if (row.barcode)
    return candidates.filter((product) =>
      product.barcodes.some((barcode) => barcode.value === row.barcode),
    );
  if (row.sku)
    return candidates.filter(
      (product) => normalize(product.sku) === normalize(row.sku),
    );
  const fullName = normalize(
    [row.name, row.characteristic].filter(Boolean).join(' '),
  );
  return fullName
    ? candidates.filter((product) => normalize(product.name) === fullName)
    : [];
}
