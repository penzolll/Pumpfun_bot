import "dotenv/config";
import { HeliusConnection } from "./connection.js";
import { startMigrationListener } from "./migrationListener.js";
import { getHolderSnapshot, getTokenMetadata } from "./dasClient.js";
import { subscribeToTokenActivity } from "./poolListener.js";
import { parseTradeActivity } from "./tradeParser.js";
import { sendTelegramAlert } from "./telegramClient.js";
import { appendTokenRow, appendTradeRow } from "./sheetsClient.js";
import { state } from "./stateManager.js";

const API_KEY = process.env.HELIUS_API_KEY;

if (!API_KEY) {
  console.error("HELIUS_API_KEY belum diset. Cek file .env atau Railway Variables.");
  process.exit(1);
}

const connection = new HeliusConnection(API_KEY);
connection.connect();

startMigrationListener(connection, API_KEY, async (migration) => {
  console.log("==============================");
  console.log("🚀 MIGRASI TERDETEKSI");
  console.log("Token mint :", migration.tokenMint);
  console.log("Signature  :", migration.signature);
  console.log("Deskripsi  :", migration.description);
  console.log("==============================");

  let ticker = null;

  try {
    console.log(`[holder-snapshot] Mengambil holder awal untuk ${migration.tokenMint}...`);
    const holders = await getHolderSnapshot(migration.tokenMint, API_KEY);
    ticker = await getTokenMetadata(migration.tokenMint, API_KEY);

    state.registerToken(migration.tokenMint, holders, ticker);

    console.log(
      `[holder-snapshot] Selesai. ${holders.size} holder tercatat untuk ${ticker ?? migration.tokenMint}.`
    );

    appendTokenRow({
      tokenMint: migration.tokenMint,
      ticker,
      migratedAt: new Date().toISOString(),
      holderCount: holders.size,
    }).catch((err) => console.error("[sheets] Gagal catat token:", err.message));
  } catch (err) {
    console.error(`[holder-snapshot] Gagal ambil snapshot untuk ${migration.tokenMint}:`, err.message);
    return; // tidak lanjut subscribe kalau snapshot gagal
  }

  // Subscribe ke aktivitas token ini di koneksi yang sama (instan, tidak buka koneksi baru)
  subscribeToTokenActivity(connection, migration.tokenMint, async (logResult) => {
    const { signature, err } = logResult;
    if (err) return; // abaikan transaksi yang gagal on-chain

    try {
      const trade = await parseTradeActivity(signature, migration.tokenMint, API_KEY);
      if (!trade) return; // bukan trade (mis. cuma mention token tanpa transfer)

      const wasHolder = state.isHolder(migration.tokenMint, trade.wallet);
      const delta = trade.action === "buy" ? trade.amount : -trade.amount;
      state.adjustHolderBalance(migration.tokenMint, trade.wallet, delta);
      const holderCountAfter = state.getHolderCount(migration.tokenMint);

      const icon = trade.action === "buy" ? "🟢 BUY" : "🔴 SELL";
      const holderTag = trade.action === "buy" && !wasHolder ? " (holder baru)" : "";
      const displayName = ticker ?? migration.tokenMint;

      console.log(
        `[trade] ${icon}${holderTag} | token=${displayName} | wallet=${trade.wallet} | amount=${trade.amount} | tx=${trade.signature}`
      );
      console.log(`[holder-map] Total holder saat ini untuk ${displayName}: ${holderCountAfter}`);

      const alertMessage =
        `${icon}${holderTag}\n` +
        `Token: ${displayName}\n` +
        `Wallet: \`${trade.wallet}\`\n` +
        `Jumlah: ${trade.amount}\n` +
        `Tx: https://solscan.io/tx/${trade.signature}`;

      sendTelegramAlert(alertMessage).catch((err) =>
        console.error("[telegram] Gagal kirim alert:", err.message)
      );

      appendTradeRow({
        timestamp: new Date().toISOString(),
        tokenMint: migration.tokenMint,
        ticker,
        wallet: trade.wallet,
        action: trade.action,
        amount: trade.amount,
        holderCountAfter,
      }).catch((err) => console.error("[sheets] Gagal catat trade:", err.message));
    } catch (err) {
      console.error(`[trade] Gagal parse ${signature}:`, err.message);
    }
  });
});
