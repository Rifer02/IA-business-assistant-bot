import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

export const config = {
  telegramToken: required('TELEGRAM_BOT_TOKEN'),
  geminiKey: required('GEMINI_API_KEY'),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  sheetId: required('GOOGLE_SHEET_ID'),
  googleCredentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || './credentials.json',
  adminIds: (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isInteger(id) && id > 0),
  timezone: process.env.TIMEZONE || 'America/Argentina/Buenos_Aires',
  dailySummaryCron: process.env.DAILY_SUMMARY_CRON || '0 21 * * *',
};
