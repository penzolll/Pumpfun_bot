// Free plan Helius: DAS API dibatasi 2 request/detik.
// Delay ini menjaga kita tetap di bawah limit saat pagination banyak halaman.
const DAS_RATE_LIMIT_DELAY_MS = 550;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ambil seluruh token account (holder) untuk sebuah mint via Helius DAS API,
 * lalu susun jadi Map<walletAddress, balance>.
 *
 * DAS getTokenAccounts dipaginasi lewat "cursor". Kita loop sampai cursor
 * habis, dengan delay antar-request untuk menjaga rate limit Free plan.
 */
export async function getHolderSnapshot(mint, apiKey) {
  const holders = new Map();
  let cursor = undefined;
  let page = 0;
  const MAX_PAGES = 20; // pengaman, cukup untuk token baru migrasi (belum banyak holder)

  while (page < MAX_PAGES) {
    const body = {
      jsonrpc: "2.0",
      id: "holder-snapshot",
      method: "getTokenAccounts",
      params: {
        mint,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      },
    };

    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`DAS getTokenAccounts gagal: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    if (data.error) {
      throw new Error(`DAS getTokenAccounts error: ${data.error.message}`);
    }

    const accounts = data.result?.token_accounts ?? [];

    for (const acc of accounts) {
      const owner = acc.owner;
      const amount = Number(acc.amount ?? 0);
      if (owner && amount > 0) {
        // Kalau owner sama punya beberapa token account, jumlahkan
        holders.set(owner, (holders.get(owner) ?? 0) + amount);
      }
    }

    cursor = data.result?.cursor;
    page++;

    if (!cursor || accounts.length === 0) break;

    await sleep(DAS_RATE_LIMIT_DELAY_MS);
  }

  return holders;
}

/**
 * Ambil ticker/simbol token via DAS getAsset. Dipakai supaya di Sheets/Telegram
 * tampil "$DOGE2" bukan cuma alamat mint yang panjang.
 */
export async function getTokenMetadata(mint, apiKey) {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "token-metadata",
      method: "getAsset",
      params: { id: mint },
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (data.error) return null;

  const metadata = data.result?.content?.metadata;
  return metadata?.symbol || metadata?.name || null;
}
