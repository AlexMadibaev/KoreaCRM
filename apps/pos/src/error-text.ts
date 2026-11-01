// Russian wording for server rejections a cashier can fix on the spot.
const knownErrors: Record<string, string> = {
  'Comment is required for opening cash discrepancy': 'Сумма отличается от остатка прошлой смены. Укажите причину.',
  'Comment is required for closing cash discrepancy': 'Есть расхождение. Укажите причину перед закрытием.',
  'Cash balance would be outside allowed range': 'В кассе недостаточно наличных для этой операции.',
  'Cash shift is closed': 'Смена уже закрыта. Откройте новую смену.',
  'Cash shift is already closed': 'Смена уже закрыта.',
  'Cash shift is not open': 'Смена закрыта. Откройте новую смену.',
  'Device already has an open cash shift': 'На этой кассе уже открыта смена.',
  'Device has no matching open cash shift': 'На этой кассе нет открытой смены.',
  'Payment exceeds customer debt': 'Сумма больше долга клиента.',
  'Payment method is unavailable for debt repayment': 'Этим способом нельзя принять оплату долга.',
  'Sale has already been fully returned': 'Этот чек уже возвращён полностью.',
  'Return quantity exceeds unreturned sale quantity': 'Количество больше, чем доступно к возврату.',
  'Refund exceeds current product price': 'Сумма возврата больше текущей цены товара.',
  'Product has no price in this store': 'У товара нет цены в этом магазине.',
  'Product not found': 'Товар не найден.',
  'Cash payment method is required for this refund': 'Для возврата нужен способ оплаты «Наличные». Включите его в настройках.',
};

export function translateError(text: string): string {
  return knownErrors[text] ?? text;
}
