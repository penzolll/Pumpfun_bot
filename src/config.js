// Program ID yang emit event "Migrate" saat token pump.fun graduate ke PumpSwap
export const MIGRATION_PROGRAM_ID = "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg";

// Program ID PumpSwap (dipakai nanti di step trade monitor)
export const PUMPSWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

// Interval ping supaya koneksi tidak idle-disconnect (Helius timeout idle = 10 menit)
export const PING_INTERVAL_MS = 60_000; // 1 menit

// Delay sebelum reconnect setelah koneksi putus
export const RECONNECT_DELAY_MS = 3_000;

// Mint yang BUKAN token hasil migrasi pump.fun — selalu muncul di tokenTransfers
// sebagai base/quote (liquidity, fee, dll), jadi harus di-skip saat ekstrak tokenMint.
export const KNOWN_BASE_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // Wrapped SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

// Batas jumlah token yang boleh di-track bersamaan. Token baru yang melebihi
// cap ini akan menggantikan token paling lama (FIFO) — cukup buat manual
// trading, nggak butuh mantau lebih dari ini sekaligus.
export const MAX_ACTIVE_TOKENS = 8;

// Kalau sebuah token sudah tidak ada trade sama sekali selama ini, otomatis
// unsubscribe biar tidak numpuk bandwidth.
export const TOKEN_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit

// Seberapa sering cek token yang idle untuk di-cleanup.
export const IDLE_CHECK_INTERVAL_MS = 60 * 1000; // 1 menit

// Minimum liquidity (USD) sebuah token setelah migrasi supaya dianggap layak
// ditrack & di-alert. Token dengan liquidity di bawah ini kemungkinan besar
// "junk" — langsung dump abis migrasi (rug/insider dump), bukan worth-it.
export const MIN_LIQUIDITY_USD = 1000;

// Berapa kali coba cek liquidity ke DexScreener setelah migrasi terdeteksi.
// Pool baru butuh beberapa detik buat ke-index, jadi kita retry beberapa kali
// dengan jeda, bukan langsung nge-skip di percobaan pertama.
export const LIQUIDITY_CHECK_RETRIES = 5;
export const LIQUIDITY_CHECK_DELAY_MS = 5_000; // 5 detik antar percobaan
