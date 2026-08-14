// Program ID yang emit event "Migrate" saat token pump.fun graduate ke PumpSwap
export const MIGRATION_PROGRAM_ID = "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg";

// Program ID PumpSwap (dipakai nanti di step trade monitor)
export const PUMPSWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

// Interval ping supaya koneksi tidak idle-disconnect (Helius timeout idle = 10 menit)
export const PING_INTERVAL_MS = 60_000; // 1 menit

// Delay sebelum reconnect setelah koneksi putus
export const RECONNECT_DELAY_MS = 3_000;
