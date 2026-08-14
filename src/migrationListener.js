import { MIGRATION_PROGRAM_ID, KNOWN_BASE_MINTS } from "./config.js";
import { fetchParsedTransaction } from "./heliusClient.js";

/**
 * Cek apakah kumpulan log dari sebuah transaksi mengandung sinyal event migrasi.
 * pump.fun mengeluarkan log instruksi "Migrate" saat sebuah token graduate.
 */
function looksLikeMigration(logs) {
  return logs.some((line) => line.includes("Migrate") || line.includes("migrate"));
}

/**
 * Mendaftarkan migration listener ke koneksi Helius yang diberikan.
 * @param {HeliusConnection} connection
 * @param {string} apiKey
 * @param {function} onMigrationDetected - dipanggil dengan { signature, tokenMint, poolAddress, raw }
 */
export function startMigrationListener(connection, apiKey, onMigrationDetected) {
  connection.subscribe(
    "migration-listener",
    [{ mentions: [MIGRATION_PROGRAM_ID] }, { commitment: "confirmed" }],
    async (result) => {
      const { signature, err, logs } = result.value;

      if (err) return; // abaikan transaksi yang gagal on-chain
      if (!looksLikeMigration(logs)) return;

      console.log(`[migration] Kandidat migrasi terdeteksi: ${signature}`);

      try {
        const parsed = await fetchParsedTransaction(signature, apiKey);
        if (!parsed) {
          console.warn(`[migration] Tidak ada data parsed untuk ${signature}, lewati.`);
          return;
        }

        // tokenTransfers berisi daftar transfer token dalam transaksi ini.
        // PENTING: transaksi migrasi juga menyertakan transfer WSOL (liquidity/fee),
        // jadi tokenTransfers[0] BUKAN selalu token yang migrasi — harus skip base mint
        // (SOL/USDC/dst) dan ambil mint pertama yang bukan base mint.
        const tokenTransfers = parsed.tokenTransfers ?? [];
        const tokenMint =
          tokenTransfers.find((t) => t.mint && !KNOWN_BASE_MINTS.has(t.mint))?.mint ?? null;

        if (!tokenMint) {
          console.warn(`[migration] Tidak bisa ekstrak token mint dari ${signature}, lewati.`);
          return;
        }

        // Pengaman tambahan: kalau somehow tetap kepilih base mint, jangan lanjut.
        // Subscribe ke SOL/USDC bisa membanjiri koneksi karena mint ini nyaris ada
        // di hampir semua transaksi Solana.
        if (KNOWN_BASE_MINTS.has(tokenMint)) {
          console.warn(`[migration] Terdeteksi base mint (${tokenMint}) di ${signature}, lewati — bukan token migrasi.`);
          return;
        }

        onMigrationDetected({
          signature,
          tokenMint,
          description: parsed.description ?? null,
          raw: parsed,
        });
      } catch (err) {
        console.error(`[migration] Gagal verifikasi ${signature}:`, err.message);
      }
    }
  );

  console.log("[migration] Listener didaftarkan, menunggu event migrasi...");
}
