import { LIQUIDITY_CHECK_RETRIES, LIQUIDITY_CHECK_DELAY_MS } from "./config.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ambil data liquidity (USD) & market cap untuk sebuah token mint via
 * DexScreener public API. Gratis, tanpa API key.
 *
 * Kalau token punya beberapa pair/pool, ambil yang liquidity-nya paling besar
 * (biasanya pool PumpSwap utamanya).
 *
 * @returns {Promise<{ liquidityUsd: number, marketCapUsd: number|null } | null>}
 */
export async function getLiquidityInfo(tokenMint) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);

  if (!res.ok) {
    console.warn(`[liquidity] DexScreener gagal untuk ${tokenMint}: ${res.status} ${res.statusText}`);
    return null;
  }

  const data = await res.json();
  const pairs = data?.pairs ?? [];

  if (pairs.length === 0) return null;

  const best = pairs.reduce((max, p) => {
    const liq = p.liquidity?.usd ?? 0;
    const maxLiq = max.liquidity?.usd ?? 0;
    return liq > maxLiq ? p : max;
  }, pairs[0]);

  const liquidityUsd = best.liquidity?.usd ?? null;
  if (liquidityUsd == null) return null;

  return {
    liquidityUsd,
    marketCapUsd: best.fdv ?? best.marketCap ?? null,
  };
}

/**
 * Tunggu sampai pool token baru ke-index di DexScreener (biasanya butuh
 * beberapa detik setelah migrasi), lalu return info liquidity-nya.
 * Kalau sampai retry habis tetap belum ke-index, return null.
 *
 * @param {string} tokenMint
 * @returns {Promise<{ liquidityUsd: number, marketCapUsd: number|null } | null>}
 */
export async function waitForLiquidityInfo(tokenMint) {
  for (let attempt = 1; attempt <= LIQUIDITY_CHECK_RETRIES; attempt++) {
    const info = await getLiquidityInfo(tokenMint);
    if (info) return info;

    if (attempt < LIQUIDITY_CHECK_RETRIES) {
      await sleep(LIQUIDITY_CHECK_DELAY_MS);
    }
  }
  return null;
}
