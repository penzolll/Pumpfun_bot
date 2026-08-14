import "dotenv/config";
import { HeliusConnection } from "./connection.js";
import { startMigrationListener } from "./migrationListener.js";
import { getHolderSnapshot, getTokenMetadata } from "./dasClient.js";
import { subscribeToTokenActivity } from "./poolListener.js";
import { parseTradeActivity } from "./tradeParser.js";
import { sendTelegramAlert } from "./telegramClient.js";
import { appendTokenRow, appendTradeRow } from "./sheetsClient.js";
import { state } from "./stateManager.js";
import { waitForLiquidityInfo } from "./liquidityClient.js";
import {
  MAX_ACTIVE_TOKENS,
  TOKEN_IDLE_TIMEOUT_MS,
  IDLE_CHECK_INTERVAL_MS,
  MIN_LIQUIDITY_USD,
} from "./config.js";

const API_KEY = process.env.HELIUS_API_KEY;

if (!API_KEY) {
  console.error("HELIUS_API_KEY belum diset. Cek file .env atau Railway Variables.");
  process.exit(1);
}

const connection = new HeliusConnection(API_KEY);
connection.connect();

// Map<tokenMint, localSubKey> — buat bisa unsubscribe pool-listener saat token
// idle atau kena cap, tanpa perlu nebak-nebak localKey lagi.
const tokenSubKeys = new Map();

function stopTrackingToken(tokenMint, reason) {
  const localKey = tokenSubKeys.get(tokenMint);
  if (localKey) {
    connection.unsubscribe(localKey);
    tokenSubKeys.delete(tokenMint);
  }
  state.unregisterToken(tokenMint);
  console.log(`[cleanup] Stop tracking ${tokenMint} (${reason})`);
}

// Cleanup berkala: token yang sudah lama tanpa trade otomatis di-unsubscribe
// biar tidak numpuk bandwidth WebSocket.
setInterval(() => {
  const idleTokens = state.getIdleTokens(TOKEN_IDLE_TIMEOUT_MS);
  for (const tokenMint of idleTokens) {
    stopTrackingToken(tokenMint, "idle, tidak ada trade");
  }
}, IDLE_CHECK_INTERVAL_MS);

startMigrationListener(connection, API_KEY, async (migration) => {
  console.log("==============================");
  console.log("🚀 MIGRASI TERDETEKSI");
  console.log("Token mint :", migration.tokenMint);
  console.log("Signature  :", migration.signature);
  console.log("Deskripsi  :", migration.description);
  console.log("==============================");

  let ticker = null;

  // Cek liquidity dulu SEBELUM ambil holder snapshot — kalau token junk
  // (liquidity kelewat kecil), skip di sini biar hemat API call juga.
  console.log(`[liquidity] Mengecek liquidity untuk ${migration.tokenMint}...`);
  const liquidityInfo = await waitForLiquidityInfo(migration.tokenMint);

  if (!liquidityInfo) {
    console.warn(
      `[liquidity] Pool ${migration.tokenMint} belum ke-index / tidak ditemukan di DexScreener, lewati.`
    );
    return;
  }

  if (liquidityInfo.liquidityUsd < MIN_LIQUIDITY_USD) {
    console.warn(
      `[liquidity] ${migration.tokenMint} liquidity $${liquidityInfo.liquidityUsd.toFixed(2)} ` +
        `di bawah minimum $${MIN_LIQUIDITY_USD}, lewati (kemungkinan junk/dump).`
    );
    return;
  }

  console.log(
    `[liquidity] OK — $${liquidityInfo.liquidityUsd.toFixed(2)} liquidity` +
      (liquidityInfo.marketCapUsd ? `, MC $${liquidityInfo.marketCapUsd.toFixed(2)}` : "")
  );

  try {
    console.log(`[holder-snapshot] Mengambil holder awal untuk ${migration.tokenMint}...`);
    const holders = await getHolderSnapshot(migration.tokenMint, API_KEY);
    ticker = await getTokenMetadata(migration.tokenMint, API_KEY);

    // Cap jumlah token aktif — kalau sudah penuh, drop token paling lama (FIFO)
    // dulu sebelum daftarin yang baru. Manual trading nggak butuh mantau lebih
    // dari MAX_ACTIVE_TOKENS token sekaligus.
    while (state.size() >= MAX_ACTIVE_TOKENS) {
      const oldest = state.getOldestTokenMint();
      if (!oldest) break;
      stopTrackingToken(oldest, "digantikan token baru (cap tercapai)");
    }

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
  const localKey = subscribeToTokenActivity(connection, migration.tokenMint, async (logResult) => {
    const { signature, err } = logResult.value;
    if (err) return; // abaikan transaksi yang gagal on-chain

    try {
      const trade = await parseTradeActivity(signature, migration.tokenMint, API_KEY);
      if (!trade) return; // bukan trade (mis. cuma mention token tanpa transfer)

      state.touchActivity(migration.tokenMint);

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

  tokenSubKeys.set(migration.tokenMint, localKey);
});
