// Pure functions (no network, no config) so they are easy to unit test.

/** Returns "YYYY-MM-DD" for a date in the given IANA time zone. */
export function dayKey(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function hourOf(value, timeZone) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** "2x Margherita; 1x Cola" -> [{ qty: 2, name: "Margherita" }, { qty: 1, name: "Cola" }] */
export function parseItems(text = '') {
  return String(text)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(\d+)\s*x\s+(.+)$/i);
      return match ? { qty: Number(match[1]), name: match[2].trim() } : null;
    })
    .filter(Boolean);
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Aggregates the orders of a single day. Cancelled orders are ignored. */
export function computeStats(orders, date, timeZone) {
  const dayOrders = orders.filter(
    (o) => o.status !== 'Cancelled' && dayKey(o.timestamp, timeZone) === date,
  );

  const itemTotals = new Map();
  const hourTotals = new Map();
  let revenue = 0;
  let delivery = 0;

  for (const order of dayOrders) {
    revenue += Number(order.total) || 0;
    if (order.type === 'Delivery') delivery += 1;
    for (const { name, qty } of parseItems(order.items)) {
      itemTotals.set(name, (itemTotals.get(name) || 0) + qty);
    }
    const hour = hourOf(order.timestamp, timeZone);
    hourTotals.set(hour, (hourTotals.get(hour) || 0) + 1);
  }

  const topItems = [...itemTotals.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
    .slice(0, 3);

  const peak = [...hourTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  return {
    date,
    orderCount: dayOrders.length,
    revenue: round2(revenue),
    averageOrder: dayOrders.length ? round2(revenue / dayOrders.length) : 0,
    deliveryCount: delivery,
    pickupCount: dayOrders.length - delivery,
    topItems,
    peakHour: peak ? `${peak[0]}:00` : null,
  };
}

/** Plain-text version of the stats (also used as a fallback if the AI is unavailable). */
export function formatStats(stats, currency = '$') {
  if (stats.orderCount === 0) return `No orders yet on ${stats.date}.`;
  const top = stats.topItems.map((i) => `${i.name} (${i.qty})`).join(', ');
  return [
    `Orders: ${stats.orderCount} (${stats.pickupCount} pickup, ${stats.deliveryCount} delivery)`,
    `Revenue: ${currency}${stats.revenue.toFixed(2)}`,
    `Average order: ${currency}${stats.averageOrder.toFixed(2)}`,
    `Top items: ${top || '-'}`,
    `Busiest hour: ${stats.peakHour ?? '-'}`,
  ].join('\n');
}
