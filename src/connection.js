import WebSocket from "ws";
import { PING_INTERVAL_MS, RECONNECT_DELAY_MS } from "./config.js";

/**
 * Mengelola satu koneksi WebSocket ke Helius, termasuk:
 * - Ping berkala biar tidak idle-disconnect
 * - Reconnect otomatis + re-subscribe semua subscription aktif kalau putus
 * - Registry subscription: id -> handler function
 */
export class HeliusConnection {
  constructor(apiKey) {
    this.url = `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    this.ws = null;
    this.pingTimer = null;
    // Simpan request subscribe supaya bisa di-replay saat reconnect
    // Map<localSubKey, { request, handler, subscriptionId }>
    this.subscriptions = new Map();
    this.nextRequestId = 1;
  }

  connect() {
    console.log("[connection] Menghubungkan ke Helius WebSocket...");
    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      console.log("[connection] Terhubung.");
      this._startPing();
      this._resubscribeAll();
    });

    this.ws.on("message", (raw) => this._handleMessage(raw));

    this.ws.on("close", () => {
      console.warn("[connection] Koneksi putus. Reconnect dalam beberapa detik...");
      this._stopPing();
      setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    });

    this.ws.on("error", (err) => {
      console.error("[connection] Error:", err.message);
    });
  }

  /**
   * Daftarkan subscription baru.
   * @param {string} localKey - Nama unik lokal untuk subscription ini (mis. "migration-listener")
   * @param {object} params - params logsSubscribe (sesuai format Solana RPC)
   * @param {function} handler - dipanggil setiap ada log notification masuk untuk subscription ini
   */
  subscribe(localKey, params, handler) {
    const requestId = this.nextRequestId++;
    const request = {
      jsonrpc: "2.0",
      id: requestId,
      method: "logsSubscribe",
      params,
    };

    this.subscriptions.set(localKey, { request, handler, subscriptionId: null, requestId });

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(request));
    }
    // Kalau belum open, akan otomatis dikirim saat _resubscribeAll() dipanggil di event "open"
  }

  /**
   * Batalkan subscription yang sudah tidak dibutuhkan (mis. token yang sudah
   * lama tidak ada aktivitas trading). Mengirim logsUnsubscribe ke server dan
   * membuang entry-nya dari registry lokal.
   * @param {string} localKey - key yang dipakai saat subscribe()
   */
  unsubscribe(localKey) {
    const sub = this.subscriptions.get(localKey);
    if (!sub) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN && sub.subscriptionId != null) {
      const requestId = this.nextRequestId++;
      this.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method: "logsUnsubscribe",
          params: [sub.subscriptionId],
        })
      );
    }

    this.subscriptions.delete(localKey);
    console.log(`[connection] Unsubscribe: ${localKey}`);
  }

  _resubscribeAll() {
    for (const [localKey, sub] of this.subscriptions) {
      console.log(`[connection] Subscribe ulang: ${localKey}`);
      this.ws.send(JSON.stringify(sub.request));
    }
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.error("[connection] Gagal parse pesan:", err.message);
      return;
    }

    // Respons konfirmasi subscribe: { id, result: subscriptionId }
    if (msg.id && msg.result !== undefined) {
      for (const [localKey, sub] of this.subscriptions) {
        if (sub.requestId === msg.id) {
          sub.subscriptionId = msg.result;
          console.log(`[connection] "${localKey}" aktif (subscription id: ${msg.result})`);
        }
      }
      return;
    }

    // Notifikasi log masuk: { method: "logsNotification", params: { subscription, result } }
    if (msg.method === "logsNotification") {
      const subId = msg.params.subscription;
      for (const [, sub] of this.subscriptions) {
        if (sub.subscriptionId === subId) {
          sub.handler(msg.params.result);
        }
      }
    }
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
