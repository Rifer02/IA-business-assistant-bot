import cron from 'node-cron';
import { config } from './config.js';
import business from './business.js';
import { getOrders, appendSummary } from './sheets.js';
import { computeStats, dayKey } from './stats.js';
import { writeDailySummary } from './ai.js';

/** Reads today's orders from Google Sheets and asks the AI to write the owner's report. */
export async function buildDailySummary(date = dayKey(new Date(), config.timezone)) {
  const orders = await getOrders();
  const stats = computeStats(orders, date, config.timezone);
  const text =
    stats.orderCount === 0 ? `No orders were placed on ${date}.` : await writeDailySummary(stats);
  return { stats, text };
}

/** Builds the summary, logs it in the "Daily Summaries" tab and sends it to every admin. */
export async function sendDailySummary(bot) {
  const { stats, text } = await buildDailySummary();
  await appendSummary(stats, text);

  for (const adminId of config.adminIds) {
    try {
      await bot.api.sendMessage(adminId, `📊 Daily summary - ${business.name}\n${stats.date}\n\n${text}`);
    } catch (error) {
      console.error(`[report] Could not message admin ${adminId}:`, error.message);
    }
  }
}

export function startScheduler(bot) {
  if (!cron.validate(config.dailySummaryCron)) {
    throw new Error(`Invalid DAILY_SUMMARY_CRON: "${config.dailySummaryCron}"`);
  }
  cron.schedule(
    config.dailySummaryCron,
    () => sendDailySummary(bot).catch((e) => console.error('[report] Daily summary failed:', e)),
    { timezone: config.timezone },
  );
  console.log(`[report] Daily summary scheduled: "${config.dailySummaryCron}" (${config.timezone})`);
}
