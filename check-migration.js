// check-migration.js
//
// Cek riwayat on-chain sebuah token mint pump.fun:
// - Kapan token ini pertama & terakhir kali ada aktivitas
// - Apakah PERNAH ada transaksi yang menyentuh program migrasi pump.fun
//   (39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg)
//
// Kalau ketemu → token ini memang migrasi, tapi bot-nya kelewat (bug beneran).
// Kalau nggak ketemu sama sekali → token ini belum/nggak pernah migrasi
// (masih di bonding curve, atau migrasi lewat jalur/program lain).
//
// CARA PAKAI:
//   1. export HELIUS_API_KEY=xxxxx   (atau taruh di file .env di folder yang sama)
//   2. node check-migration.js <TOKEN_MINT_ADDRESS>
//
// Contoh:
//   node check-migration.js J7CExbBZE3W6fqDiMWvq6dMcwYRVufaaGRqG93ycpump

import "dotenv/config";

const MIGRATION_PROGRAM_ID = "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg";
const PUMPSWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const PUMP_BONDING_CURVE_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const RPC_DELAY_MS = 350; // jaga-jaga rate limit Free plan Helius

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpcCall(apiKey, method, params) {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!res.ok) {
    throw new Error(`RPC ${method} gagal: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`RPC ${method} error: ${data.error.message}`);
  }
  return data.result;
}

/**
 * Ambil SEMUA signature yang menyentuh sebuah address, dengan pagination
 * (getSignaturesForAddress dibatasi 1000/request, pakai `before` buat lanjut).
 */
async function getAllSignatures(apiKey, address, maxSignatures = 5000) {
  const all = [];
  let before = undefined;

  while (all.length < maxSignatures) {
    const batch = await rpcCall(apiKey, "getSignaturesForAddress", [
      address,
      { limit: 1000, ...(before ? { before } : {}) },
    ]);

    if (!batch || batch.length === 0) break;

    all.push(...batch);
    before = batch[batch.length - 1].signature;

    if (batch.length < 1000) break; // sudah habis
    await sleep(RPC_DELAY_MS);
  }

  return all;
}

/**
 * Cek apakah sebuah transaksi (by signature) menyentuh salah satu program ID target.
 * Pakai getTransaction raw (bukan Enhanced API) supaya nggak perlu request terpisah/berbayar.
 */
async function txTouchesPrograms(apiKey, signature, programIds) {
  const tx = await rpcCall(apiKey, "getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);

  if (!tx) return { found: false, blockTime: null };

  const accountKeys = (tx.transaction?.message?.accountKeys ?? []).map((k) =>
    typeof k === "string" ? k : k.pubkey
  );

  const found = programIds.some((id) => accountKeys.includes(id));
  return { found, blockTime: tx.blockTime ?? null };
}

function fmtTime(unixSeconds) {
  if (!unixSeconds) return "(tidak diketahui)";
  return new Date(unixSeconds * 1000).toISOString();
}

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  const mint = process.argv[2];

  if (!apiKey) {
    console.error("HELIUS_API_KEY belum diset. Export env var atau taruh di file .env.");
    process.exit(1);
  }

  if (!mint) {
    console.error("Pakai: node check-migration.js <TOKEN_MINT_ADDRESS>");
    process.exit(1);
  }

  console.log(`\n=== Cek riwayat on-chain untuk mint: ${mint} ===\n`);

  console.log("[1/3] Mengambil semua signature transaksi yang menyentuh mint ini...");
  const signatures = await getAllSignatures(apiKey, mint);
  console.log(`      Ditemukan ${signatures.length} transaksi total.\n`);

  if (signatures.length === 0) {
    console.log("Tidak ada transaksi sama sekali untuk mint ini. Cek lagi alamatnya benar atau tidak.");
    return;
  }

  // Signature dari getSignaturesForAddress terurut dari TERBARU ke TERLAMA
  const newest = signatures[0];
  const oldest = signatures[signatures.length - 1];

  console.log("[2/3] Rentang waktu aktivitas:");
  console.log(`      Transaksi PALING LAMA (kemungkinan token dibuat) : ${fmtTime(oldest.blockTime)}`);
  console.log(`      Transaksi PALING BARU                            : ${fmtTime(newest.blockTime)}\n`);

  console.log("[3/3] Mengecek satu per satu apakah ada transaksi yang menyentuh program migrasi/PumpSwap...");
  console.log("      (bisa agak lama kalau jumlah transaksi banyak — sabar ya)\n");

  let migrationTx = null;
  let pumpswapTx = null;
  let checked = 0;

  for (const sig of signatures) {
    checked++;
    process.stdout.write(`\r      Progress: ${checked}/${signatures.length}`);

    try {
      const { found, blockTime } = await txTouchesPrograms(apiKey, sig.signature, [
        MIGRATION_PROGRAM_ID,
        PUMPSWAP_PROGRAM_ID,
      ]);

      if (found) {
        // Cek lebih spesifik program mana yang match
        const detail = await txTouchesPrograms(apiKey, sig.signature, [MIGRATION_PROGRAM_ID]);
        if (detail.found && !migrationTx) {
          migrationTx = { signature: sig.signature, blockTime };
        } else if (!pumpswapTx) {
          pumpswapTx = { signature: sig.signature, blockTime };
        }
      }
    } catch (err) {
      // lewati transaksi yang gagal di-fetch, jangan hentikan seluruh scan
    }

    await sleep(RPC_DELAY_MS);

    // Optimisasi: kalau sudah ketemu migration tx, nggak perlu scan semua —
    // cukup buat konfirmasi bahwa migrasi PERNAH terjadi.
    if (migrationTx) break;
  }

  console.log("\n");
  console.log("=== HASIL ===");

  if (migrationTx) {
    console.log(`✅ Migrasi TERDETEKSI di chain.`);
    console.log(`   Signature : ${migrationTx.signature}`);
    console.log(`   Waktu     : ${fmtTime(migrationTx.blockTime)}`);
    console.log(`   Link      : https://solscan.io/tx/${migrationTx.signature}`);
    console.log(`\n   → Token ini MEMANG migrasi. Kalau bot kamu nggak sempat kirim notif,`);
    console.log(`     cek Railway deploy log persis di jam ${fmtTime(migrationTx.blockTime)} —`);
    console.log(`     kemungkinan bot lagi restart/reconnect di waktu itu.`);
  } else {
    console.log(`❌ TIDAK ditemukan transaksi yang menyentuh program migrasi pump.fun`);
    console.log(`   (${MIGRATION_PROGRAM_ID}) dalam ${checked} transaksi yang dicek.`);
    console.log(`\n   → Token ini kemungkinan besar BELUM migrasi (masih di bonding curve),`);
    console.log(`     atau migrasi lewat mekanisme/program lain yang berbeda dari yang`);
    console.log(`     bot ini dengarkan. Cek langsung https://pump.fun/coin/${mint}`);
    console.log(`     untuk lihat status pastinya.`);
  }

  console.log("");
}

main().catch((err) => {
  console.error("\nGagal menjalankan pengecekan:", err.message);
  process.exit(1);
});
