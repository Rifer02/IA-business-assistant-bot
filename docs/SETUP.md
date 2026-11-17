# Setup guide

Estimated time: 15 minutes. Everything used here has a free tier.

## 1. Create the Telegram bot

1. Open Telegram and talk to [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, choose a name and a username ending in `bot`.
3. Copy the token into `.env` as `TELEGRAM_BOT_TOKEN`.

## 2. Get a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey) and create an API key.
2. Paste it into `.env` as `GEMINI_API_KEY`.
3. `GEMINI_MODEL` is configurable. If Google retires the default model, set any current Gemini model name.

## 3. Connect Google Sheets

1. Create an empty spreadsheet at [sheets.new](https://sheets.new). Copy its ID from the URL
   (`https://docs.google.com/spreadsheets/d/<ID>/edit`) into `.env` as `GOOGLE_SHEET_ID`.
2. In [Google Cloud Console](https://console.cloud.google.com/) create a project (or reuse one).
3. Enable the **Google Sheets API** (APIs & Services → Library).
4. Create a **service account** (IAM & Admin → Service Accounts), then open it → Keys → Add key → JSON.
5. Save the downloaded file in the project folder as `credentials.json` (it is git-ignored).
6. Open `credentials.json`, copy the `client_email` value and **share your spreadsheet with that email as Editor**.

On first run the bot creates the `Orders` and `Daily Summaries` tabs by itself.

## 4. Set the owner (admin) account

1. Start the bot and send `/myid` to it.
2. Put the number in `.env` as `ADMIN_TELEGRAM_IDS` (several IDs separated by commas) and restart.

Admins can use `/admin`, `/summary`, receive new-order alerts and the daily report.

## 5. Run

```bash
npm install
npm start
```

Open your bot in Telegram, send `/start`, and place a test order. It should appear in your sheet within a second.

## Deploying (optional)

Any host that can run a long-lived Node.js process works (Railway, Render, Fly.io, a VPS with `pm2`).
Set the same variables from `.env` in the host's dashboard and provide the service account JSON as a secret file.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Missing environment variable ...` | Check that `.env` exists and has every required value. |
| `ENOENT ... credentials.json` | Put the service account JSON in the project folder or fix `GOOGLE_APPLICATION_CREDENTIALS`. |
| `The caller does not have permission` | Share the spreadsheet with the service account `client_email` as Editor. |
| `Google Sheets API has not been used...` | Enable the Sheets API in your Google Cloud project. |
| AI replies "I'm having trouble" | Check `GEMINI_API_KEY` and `GEMINI_MODEL` in the logs (`[ai]` lines show the API error). |
| `/admin` says owner only | Your Telegram ID is not in `ADMIN_TELEGRAM_IDS`. |
