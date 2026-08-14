/**
 * Ambil detail transaksi yang sudah diparsing (human-readable) dari Helius
 * Enhanced Transactions API. Dipakai bareng oleh migration listener dan trade parser
 * biar tidak decode raw instruction data manual.
 */
export async function fetchParsedTransaction(signature, apiKey) {
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
}
