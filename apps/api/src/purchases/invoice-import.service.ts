import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database.service';
import { PurchasesService } from './purchases.service';
import {
  invoiceAmounts,
  isExpenseRow,
  matchInvoiceRow,
  type InvoiceInput,
  type InvoiceRow,
} from './invoice-import';

@Injectable()
export class InvoiceImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly purchases: PurchasesService,
  ) {}

  private async candidates(rows: InvoiceRow[]) {
    return await this.db.product.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        OR: rows.flatMap((row) => [
          ...(row.productId ? [{ id: row.productId }] : []),
          ...(row.barcode
            ? [{ barcodes: { some: { value: row.barcode } } }]
            : []),
          ...(row.sku
            ? [{ sku: { equals: row.sku, mode: 'insensitive' as const } }]
            : []),
          ...(row.name
            ? [
                {
                  name: {
                    equals: [row.name, row.characteristic]
                      .filter(Boolean)
                      .join(' '),
                    mode: 'insensitive' as const,
                  },
                },
              ]
            : []),
        ]),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcodes: { select: { value: true } },
      },
    });
  }

  async match(rows: InvoiceRow[]) {
    const candidates = await this.candidates(rows);
    return rows.map((row) => {
      const matches = matchInvoiceRow(row, candidates);
      const product = matches.length === 1 ? matches[0]! : null;
      return {
        line: row.line,
        status: row.excluded ? 'EXCLUDED' : isExpenseRow(row) ? 'EXPENSE' : product ? 'FOUND' : matches.length ? 'AMBIGUOUS' : 'NOT_FOUND',
        product: product ? { id: product.id, name: product.name, sku: product.sku } : null,
      };
    });
  }

  async preview(input: InvoiceInput) {
    const supplier = await this.purchases.supplier(input.supplierId);
    if (supplier.status !== 'ACTIVE')
      throw new BadRequestException('Поставщик неактивен');
    const candidates = await this.candidates(input.rows);
    const seen = new Set<string>();
    const rows = input.rows.map((row) => {
      const amounts = invoiceAmounts(row, input.exchangeRate);
      const matches = matchInvoiceRow(row, candidates);
      const product = matches.length === 1 ? matches[0]! : null;
      const issues: string[] = [];
      if (row.excluded) {
        if (!row.exclusionReason)
          issues.push('Укажите причину исключения строки');
      } else {
        if (isExpenseRow(row))
          issues.push(
            'Возможный расход: исключите строку из товарной закупки и учтите расход отдельно',
          );
        if (amounts.mismatch && !row.acceptCalculatedTotal)
          issues.push(
            'Сумма строки не совпадает с количеством, ценой и скидкой',
          );
        if (!product)
          issues.push(
            matches.length
              ? 'Несколько совпадений: выберите товар вручную'
              : 'Товар не найден: создайте его в каталоге или выберите вручную',
          );
        if (product && seen.has(product.id))
          issues.push('Товар повторяется: объедините строки в файле');
        if (product) seen.add(product.id);
      }
      return {
        ...row,
        ...amounts,
        product: product
          ? { id: product.id, name: product.name, sku: product.sku }
          : null,
        issues,
      };
    });
    const included = rows.filter((row) => !row.excluded);
    const totalMinor = included.reduce(
      (sum, row) => sum.plus(row.totalMinor),
      new Prisma.Decimal(0),
    );
    if (totalMinor.gt('999999999999999999'))
      throw new BadRequestException('Сумма накладной слишком велика');
    return {
      rows,
      totalMinor: totalMinor.toFixed(0),
      canConfirm:
        included.length > 0 && rows.every((row) => row.issues.length === 0),
    };
  }

  async confirm(storeId: string, input: InvoiceInput, actorId: string) {
    // Revalidate on the server. Preview itself never writes stock or catalogue data.
    const preview = await this.preview(input);
    if (!preview.canConfirm)
      throw new BadRequestException('Исправьте ошибки предпросмотра накладной');
    const sourceDocument = JSON.parse(
      JSON.stringify({ ...input, rows: preview.rows }),
    ) as Prisma.InputJsonObject;
    return this.purchases.createPurchase(
      storeId,
      {
        number: input.number,
        supplierId: input.supplierId,
        items: preview.rows
          .filter((row) => !row.excluded)
          .map((row) => ({
            productId: row.product!.id,
            quantityOrdered: row.quantity,
            purchasePriceMinor: row.purchasePriceMinor,
          })),
      },
      actorId,
      sourceDocument,
    );
  }
}
