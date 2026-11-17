import { readFileSync } from 'node:fs';

// All business-specific data lives in src/data/business.json.
// To adapt the bot to a different business, edit that file only.
const business = JSON.parse(
  readFileSync(new URL('./data/business.json', import.meta.url), 'utf8'),
);

export default business;

export const money = (amount) => `${business.currency}${Number(amount).toFixed(2)}`;

export const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const findItem = (id) => business.menu.find((item) => item.id === id);

export function categories() {
  return [...new Set(business.menu.map((item) => item.category))];
}

export function menuAsText() {
  return categories()
    .map((category) => {
      const lines = business.menu
        .filter((item) => item.category === category)
        .map(
          (i) =>
            `- ${i.name} (${money(i.price)}): ${i.description}${i.vegetarian ? ' [vegetarian]' : ''}`,
        );
      return `${category}:\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

export function infoAsText() {
  const hours = Object.entries(business.hours)
    .map(([days, time]) => `${days}: ${time}`)
    .join('; ');
  return [
    `Name: ${business.name} (${business.type})`,
    `Address: ${business.address}`,
    `Phone: ${business.phone}`,
    `Opening hours: ${hours}`,
    `Delivery: ${business.delivery.time}, ${business.delivery.area}, fee ${money(business.delivery.fee)}`,
    `Pickup ready in: ${business.pickupTime}`,
    `Payment: ${business.payment}`,
  ].join('\n');
}

export function faqsAsText() {
  return business.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
}
