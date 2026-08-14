import { google } from "googleapis";

let sheetsClient = null;

/**
 * Lazy-init Google Sheets client pakai service account.
 * Kalau env var belum diset, return null (logging Sheets di-skip diam-diam).
 */
function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) return null;

  // Railway/env var biasanya nyimpen newline sebagai "\n" literal, perlu di-unescape
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

/**
 * Tambah baris baru di tab "Tokens" — satu baris per token yang migrasi.
 * Kolom: token_mint | ticker | migrated_at | total_holder_awal
 */
export async function appendTokenRow({ tokenMint, ticker, migratedAt, holderCount }) {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheets || !sheetId) return; // Sheets belum dikonfigurasi, skip

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Tokens!A:D",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[tokenMint, ticker ?? "UNKNOWN", migratedAt, holderCount]],
    },
  });
}

/**
 * Tambah baris baru di tab "Trades" — satu baris per buy/sell.
 * token_mint di sini adalah kunci penghubung ke tab "Tokens", sehingga
 * tiap trade selalu jelas milik token yang mana meski banyak token dipantau
 * sekaligus.
 * Kolom: timestamp | token_mint | ticker | wallet | action | amount | holder_count_after
 */
export async function appendTradeRow({
  timestamp,
  tokenMint,
  ticker,
  wallet,
  action,
  amount,
  holderCountAfter,
}) {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheets || !sheetId) return; // Sheets belum dikonfigurasi, skip

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Trades!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [timestamp, tokenMint, ticker ?? "UNKNOWN", wallet, action.toUpperCase(), amount, holderCountAfter],
      ],
    },
  });
}
