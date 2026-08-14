/**
 * Menyimpan semua token yang sedang dipantau setelah migrasi terdeteksi.
 *
 * Struktur:
 * activeTokens: Map<tokenMint, {
 *   poolAddress: string | null,
 *   holders: Map<walletAddress, balance>,
 *   subscriptionId: number | null,
 *   createdAt: number,
 *   lastActivityAt: number
 * }>
 */
class StateManager {
  constructor() {
    this.activeTokens = new Map();
  }

  registerToken(tokenMint, holders, ticker = null) {
    this.activeTokens.set(tokenMint, {
      poolAddress: null,
      ticker,
      holders,
      subscriptionId: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });
  }

  touchActivity(tokenMint) {
    const token = this.activeTokens.get(tokenMint);
    if (token) token.lastActivityAt = Date.now();
  }

  unregisterToken(tokenMint) {
    this.activeTokens.delete(tokenMint);
  }

  /**
   * Urutan tokenMint dari yang paling lama didaftarkan ke paling baru.
   * Dipakai buat FIFO drop saat cap token aktif tercapai.
   */
  getOldestTokenMint() {
    const first = this.activeTokens.keys().next();
    return first.done ? null : first.value;
  }

  size() {
    return this.activeTokens.size;
  }

  /**
   * Ambil daftar tokenMint yang sudah tidak ada aktivitas trading
   * selama lebih dari `maxIdleMs`.
   */
  getIdleTokens(maxIdleMs) {
    const now = Date.now();
    const idle = [];
    for (const [tokenMint, token] of this.activeTokens) {
      if (now - token.lastActivityAt > maxIdleMs) idle.push(tokenMint);
    }
    return idle;
  }

  getTicker(tokenMint) {
    return this.activeTokens.get(tokenMint)?.ticker ?? null;
  }

  getToken(tokenMint) {
    return this.activeTokens.get(tokenMint) ?? null;
  }

  setPoolAddress(tokenMint, poolAddress) {
    const token = this.activeTokens.get(tokenMint);
    if (token) token.poolAddress = poolAddress;
  }

  isHolder(tokenMint, wallet) {
    const token = this.activeTokens.get(tokenMint);
    return token ? token.holders.has(wallet) : false;
  }

  updateHolderBalance(tokenMint, wallet, newBalance) {
    const token = this.activeTokens.get(tokenMint);
    if (!token) return;

    if (newBalance <= 0) {
      token.holders.delete(wallet);
    } else {
      token.holders.set(wallet, newBalance);
    }
  }

  /**
   * Update balance holder secara incremental berdasarkan delta (bisa positif/negatif),
   * bukan nilai absolut. Dipakai setiap ada trade masuk — supaya holder map selalu
   * real-time tanpa perlu panggil API lagi.
   */
  adjustHolderBalance(tokenMint, wallet, delta) {
    const token = this.activeTokens.get(tokenMint);
    if (!token) return;

    const current = token.holders.get(wallet) ?? 0;
    const newBalance = current + delta;
    this.updateHolderBalance(tokenMint, wallet, newBalance);
  }

  getHolderCount(tokenMint) {
    const token = this.activeTokens.get(tokenMint);
    return token ? token.holders.size : 0;
  }
}

export const state = new StateManager();
