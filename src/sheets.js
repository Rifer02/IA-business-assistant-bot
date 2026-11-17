import { readFileSync } from 'node:fs';
import { google } from 'googleapis';
import { config } from './config.js';

const ORDERS_TAB = 'Orders';
const SUMMARY_TAB = 'Daily Summaries';

const ORDER_HEADERS = [
  'Order ID',
  'Timestamp',
  'Customer',
  'Telegram ID',
  'Items',
  'Type',
  'Address',
  'Notes',
  'Total',
  'Status',
];
const SUMMARY_HEADERS = ['Date', 'Orders', 'Revenue', 'AI Summary'];

let api;
function sheetsApi() {
  if (!api) {
    const credentials = JSON.parse(readFileSync(config.googleCredentialsPath, 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    api = google.sheets({ version: 'v4', auth });
  }
  return api;
}

/** Creates the "Orders" and "Daily Summaries" tabs (with styled headers) if they don't exist. */
export async function initSheets() {
  const spreadsheetId = config.sheetId;
  const { data } = await sheetsApi().spreadsheets.get({ spreadsheetId });
  const existing = new Set(data.sheets.map((s) => s.properties.title));

  const tabs = [
    { title: ORDERS_TAB, headers: ORDER_HEADERS },
    { title: SUMMARY_TAB, headers: SUMMARY_HEADERS },
  ].filter((tab) => !existing.has(tab.title));

  if (tabs.length === 0) return;

  const created = await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: tabs.map((tab) => ({
        addSheet: { properties: { title: tab.title, gridProperties: { frozenRowCount: 1 } } },
      })),
    },
  });

  for (const [index, tab] of tabs.entries()) {
    await sheetsApi().spreadsheets.values.update({
      spreadsheetId,
      range: `${tab.title}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [tab.headers] },
    });

    const sheetId = created.data.replies[index].addSheet.properties.sheetId;
    await sheetsApi().spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  backgroundColor: { red: 0.8, green: 0.2, blue: 0.15 },
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          },
        ],
      },
    });
  }
  console.log(`[sheets] Created tabs: ${tabs.map((t) => t.title).join(', ')}`);
}

/** order = { id, timestamp, customer, telegramId, items, type, address, notes, total, status } */
export async function appendOrder(order) {
  // RAW (not USER_ENTERED) so customer text starting with "=" can never run as a spreadsheet formula.
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${ORDERS_TAB}!A:J`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          order.id,
          order.timestamp,
          order.customer,
          String(order.telegramId),
          order.items,
          order.type,
          order.address || '-',
          order.notes || '-',
          Number(order.total.toFixed(2)),
          order.status,
        ],
      ],
    },
  });
}

export async function getOrders() {
  const { data } = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${ORDERS_TAB}!A2:J`,
  });
  return (data.values || []).map((row) => ({
    id: row[0],
    timestamp: row[1],
    customer: row[2],
    telegramId: row[3],
    items: row[4],
    type: row[5],
    address: row[6],
    notes: row[7],
    total: Number(row[8]) || 0,
    status: row[9] || 'New',
  }));
}

export async function appendSummary(stats, text) {
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${SUMMARY_TAB}!A:D`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[stats.date, stats.orderCount, stats.revenue, text]] },
  });
}
