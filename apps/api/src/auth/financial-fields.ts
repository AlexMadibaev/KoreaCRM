import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import type { AccessContext } from './policy';

const costField = /cost|purchasePrice|cogs/i;
const profitField = /profit|margin|markup/i;
/** A response boundary, so nested receipts/customer histories cannot bypass field restrictions. */
export function redactFinancialFields(value: unknown, access?: Pick<AccessContext, 'permissions'>): unknown {
  const permissions = access?.permissions ?? [];
  const profit = permissions.includes('finance.view');
  const cost = profit || permissions.includes('purchases.view');
  if (cost && profit) return value;
  function visit(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return item;
    return Object.fromEntries(Object.entries(item).filter(([key]) => !(!cost && costField.test(key)) && !(!profit && profitField.test(key))).map(([key, child]) => [key, visit(child)]));
  }
  return visit(value);
}
@Injectable()
export class FinancialFieldsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{ access?: AccessContext }>();
    return next.handle().pipe(map((value: unknown) => redactFinancialFields(value, request.access)));
  }
}