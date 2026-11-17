import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItems, computeStats, dayKey, formatStats } from '../src/stats.js';

const TZ = 'America/Argentina/Buenos_Aires'; // UTC-3

test('parseItems reads the "2x Name; 1x Name" format', () => {
  assert.deepEqual(parseItems('2x Margherita; 1x Cola'), [
    { qty: 2, name: 'Margherita' },
    { qty: 1, name: 'Cola' },
  ]);
  assert.deepEqual(parseItems(''), []);
  assert.deepEqual(parseItems('garbage'), []);
});

test('dayKey respects the time zone', () => {
  // 01:30 UTC on Nov 14 is still Nov 13 in Buenos Aires
  assert.equal(dayKey('2026-11-14T01:30:00.000Z', TZ), '2026-11-13');
  assert.equal(dayKey('not a date', TZ), null);
});

const orders = [
  { timestamp: '2026-11-13T22:10:00.000Z', total: 24, type: 'Delivery', items: '2x Margherita; 1x Cola', status: 'New' },
  { timestamp: '2026-11-13T22:40:00.000Z', total: 11, type: 'Pickup', items: '1x Pepperoni', status: 'New' },
  { timestamp: '2026-11-13T23:05:00.000Z', total: 9.5, type: 'Pickup', items: '1x Margherita', status: 'Cancelled' },
  { timestamp: '2026-11-12T20:00:00.000Z', total: 50, type: 'Pickup', items: '4x Pepperoni', status: 'New' },
];

test('computeStats aggregates one day and ignores cancelled/other days', () => {
  const stats = computeStats(orders, '2026-11-13', TZ);
  assert.equal(stats.orderCount, 2);
  assert.equal(stats.revenue, 35);
  assert.equal(stats.averageOrder, 17.5);
  assert.equal(stats.deliveryCount, 1);
  assert.equal(stats.pickupCount, 1);
  assert.equal(stats.topItems[0].name, 'Margherita');
  assert.equal(stats.topItems[0].qty, 2);
  assert.equal(stats.peakHour, '19:00');
});

test('computeStats handles an empty day', () => {
  const stats = computeStats([], '2026-11-13', TZ);
  assert.equal(stats.orderCount, 0);
  assert.equal(stats.averageOrder, 0);
  assert.equal(stats.peakHour, null);
  assert.match(formatStats(stats), /No orders yet/);
});
