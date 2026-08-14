// Free plan Helius: Enhanced Transactions API dibatasi ketat. Antrikan semua
// pemanggilan lewat queue sederhana biar nggak nembak beruntun dan kena 429,
// sekaligus dedupe biar signature yang sama nggak diproses dobel (bisa terjadi
// kalau ada notifikasi duplikat dari WebSocket).
const REQUEST_DELAY_MS = 550;

let queue = Promise.resolve();
const recentSignatures = new Map(); // signature -> timestamp, buat dedupe
const DEDUPE_WINDOW_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupRecentSignatures() {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  for (const [sig, ts] of recentSignatures) {
    if (ts < cutoff) recentSignatures.delete(sig);
  }
}

/**
 * Ambil detail transaksi yang sudah diparsing (human-readable) dari Helius
 * Enhanced Transactions API. Dipakai bareng oleh migration listener dan trade parser
 * biar tidak decode raw instruction data manual.
 *
 * Semua panggilan diantrikan (rate-limited) supaya nggak membanjiri API dan
 * kena 429, terutama saat token yang ditrack lagi rame ditransaksikan.
 */
export function fetchParsedTransaction(signature, apiKey) {
  if (!signature) return Promise.resolve(null);

  cleanupRecentSignatures();
  if (recentSignatures.has(signature)) {
    return Promise.resolve(null); // sudah diproses baru-baru ini, skip
  }
  recentSignatures.set(signature, Date.now());

  const result = queue.then(async () => {
    const res = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: [signature] }),
    });

    if (!res.ok) {
      throw new Error(`Enhanced Transactions API gagal: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data?.[0] ?? null;
  });

  // Pastikan request BERIKUTNYA di antrian nunggu delay ini, terlepas dari
  // request sekarang sukses/gagal (biar 1 error nggak bikin queue jalan cepat lagi)
  queue = result.catch(() => {}).then(() => sleep(REQUEST_DELAY_MS));

  return result;
}
