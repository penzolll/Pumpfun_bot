/**
 * Subscribe ke aktivitas sebuah token mint di koneksi WebSocket yang sama
 * (multiplexed — tidak buka koneksi baru).
 *
 * Kita subscribe pakai `mentions: [tokenMint]`, bukan pool address, karena:
 * - Setiap transaksi buy/sell di PumpSwap pool pasti menyertakan akun token
 *   mint sebagai bagian dari instruksinya.
 * - Ini menghindari kebutuhan decode struktur akun instruksi migrasi secara
 *   manual untuk mengekstrak pool address secara presisi.
 *
 * @param {HeliusConnection} connection
 * @param {string} tokenMint
 * @param {function} handler - dipanggil setiap ada log yang mention token ini
 */
export function subscribeToTokenActivity(connection, tokenMint, handler) {
  const localKey = `token-activity-${tokenMint}`;

  connection.subscribe(
    localKey,
    [{ mentions: [tokenMint] }, { commitment: "confirmed" }],
    handler
  );

  console.log(`[pool-listener] Subscribe ke aktivitas token ${tokenMint}`);
  return localKey;
}
