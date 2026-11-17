import business, { findItem } from './business.js';
import { dayKey } from './stats.js';

/** cart = { [itemId]: quantity } */
export function cartLines(cart) {
  return Object.entries(cart)
    .map(([id, qty]) => ({ item: findItem(id), qty }))
    .filter((line) => line.item && line.qty > 0)
    .map((line) => ({ ...line, subtotal: line.item.price * line.qty }));
}

export function cartCount(cart) {
  return cartLines(cart).reduce((sum, line) => sum + line.qty, 0);
}

export function cartTotals(cart, orderType) {
  const subtotal = cartLines(cart).reduce((sum, line) => sum + line.subtotal, 0);
  const deliveryFee = orderType === 'Delivery' ? business.delivery.fee : 0;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

/** Human readable and machine parsable: "2x Margherita; 1x Cola" */
export function cartToItemsString(cart) {
  return cartLines(cart)
    .map((line) => `${line.qty}x ${line.item.name}`)
    .join('; ');
}

/** e.g. BN-261113-4821 (date in the business time zone, not UTC) */
export function newOrderId(now = new Date(), timeZone = 'UTC') {
  const day = dayKey(now, timeZone).slice(2).replace(/-/g, '');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `BN-${day}-${random}`;
}
