import { fetchParsedTransaction } from "./heliusClient.js";

/**
 * Parse sebuah transaksi aktivitas token jadi info buy/sell yang jelas.
 *
 * PENTING: nama field di bawah (fromUserAccount, toUserAccount, tokenAmount, mint)
 * mengikuti skema Enhanced Transactions API Helius. Kalau di respons asli
 * nama field berbeda, sesuaikan mapping di sini — cek dulu hasil mentah
 * (console.log(parsed)) saat testing pertama kali.
 *
 * Logika penentuan buy/sell:
 * - feePayer = wallet yang menginisiasi transaksi
 * - Kalau feePayer MENERIMA token mint ini (toUserAccount === feePayer) → BUY
 * - Kalau feePayer MENGIRIM token mint ini (fromUserAccount === feePayer) → SELL
 *
 * @returns {object|null} { signature, wallet, action, amount, tokenMint } atau null kalau bukan trade token ini
 */
export async function parseTradeActivity(signature, tokenMint, apiKey) {
  const parsed = await fetchParsedTransaction(signature, apiKey);
  if (!parsed) return null;

  const wallet = parsed.feePayer;
  if (!wallet) return null;

  const relevantTransfers = (parsed.tokenTransfers ?? []).filter((t) => t.mint === tokenMint);
  if (relevantTransfers.length === 0) return null; // transaksi mention token ini tapi bukan transfer mint-nya

  let action = null;
  let amount = 0;

  for (const transfer of relevantTransfers) {
    if (transfer.toUserAccount === wallet) {
      action = "buy";
      amount += Number(transfer.tokenAmount ?? 0);
    } else if (transfer.fromUserAccount === wallet) {
      action = "sell";
      amount += Number(transfer.tokenAmount ?? 0);
    }
  }

  if (!action || amount === 0) return null;

  return { signature, wallet, action, amount, tokenMint };
}
