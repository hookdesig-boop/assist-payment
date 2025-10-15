export function formatOrderSummary(order) {
  return `
📋 *Детали заказа:*

🔢 Номер заказа: ${order.orderNumber}
🎬 Количество адаптаций: ${order.adaptationsCount}
🌍 Локализации: ${order.localizations.join(', ')}
🏦 Банк: ${order.bank}
💰 Сумма выигрыша: ${order.winningAmount} ${order.currency}
📝 Доп. информация: ${order.additionalInfo}
  `.trim();
}

export function validateOrderNumber(orderNumber) {
  return /^\d+$/.test(orderNumber);
}

export function calculateTotalAmount(adaptationsCount, pricePerAdaptation = 10) {
  return adaptationsCount * pricePerAdaptation;
}