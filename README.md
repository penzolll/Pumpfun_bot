# Pump.fun Migration & Holder Alert Bot

## Status: Step 6 — Alert Telegram + Logging Google Sheets ✅ (Lengkap)

Bot ini sekarang jalan penuh dari ujung ke ujung:
1. Mendeteksi event migrasi token pump.fun → PumpSwap secara real-time lewat WebSocket
2. Memverifikasi & ekstrak token mint + ticker lewat Helius Enhanced Transactions API & DAS `getAsset`
3. Mengambil snapshot holder awal via DAS API, disimpan di state in-memory
4. Subscribe ke aktivitas token di koneksi WebSocket yang sama
5. Parse tiap aktivitas jadi BUY/SELL, update holder map secara incremental (real-time, tanpa API call tambahan)
6. **Kirim alert ke Telegram** (real-time) + **catat ke Google Sheets** (histori permanen, 2 tab yang saling nyambung)

### Struktur Google Sheets

Bikin 1 Google Sheet baru dengan 2 tab (nama harus PERSIS sama):

**Tab "Tokens"** — header di baris 1:
```
token_mint | ticker | migrated_at | total_holder_awal
```

**Tab "Trades"** — header di baris 1:
```
timestamp | token_mint | ticker | wallet | action | amount | holder_count_after
```

Kolom `token_mint` di kedua tab itu yang jadi penghubung — kamu bisa `VLOOKUP`/filter/pivot table
berdasarkan itu buat lihat histori per token, tanpa data ticker dan trade "kececer" satu sama lain.

### Setup Google Sheets API (sekali di awal)

1. Buka [Google Cloud Console](https://console.cloud.google.com) → buat project baru (atau pakai yang sudah ada)
2. Aktifkan **Google Sheets API** (APIs & Services → Library → cari "Google Sheets API" → Enable)
3. Buat **Service Account** (APIs & Services → Credentials → Create Credentials → Service Account)
4. Setelah service account dibuat, buka tab **Keys** → Add Key → Create New Key → pilih **JSON** → download
5. Dari file JSON itu, ambil dua nilai:
   - `client_email` → ini nilai untuk `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → ini nilai untuk `GOOGLE_PRIVATE_KEY` (copy apa adanya, termasuk `\n` di dalamnya)
6. Buka Google Sheet yang sudah kamu buat → klik **Share** → paste `client_email` tadi → kasih akses **Editor**
7. Ambil `GOOGLE_SHEET_ID` dari URL sheet: `https://docs.google.com/spreadsheets/d/`**`INI_SHEET_ID`**`/edit`

### Setup Telegram (sekali di awal)

1. Chat [@BotFather](https://t.me/botfather) di Telegram → `/newbot` → ikuti instruksi → dapat `TELEGRAM_BOT_TOKEN`
2. Tambahkan bot itu ke grup/channel tujuan alert, atau chat langsung ke bot
3. Buka `https://api.telegram.org/bot<TOKEN>/getUpdates` setelah kirim 1 pesan ke bot, cari `chat.id` di respons JSON → itu `TELEGRAM_CHAT_ID`

### Environment Variables Lengkap

Isi semua di `.env` (lokal) atau Railway Variables (production):

```
HELIUS_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SHEET_ID=
```

Telegram dan Google Sheets **opsional** — kalau salah satu env var-nya kosong, fitur itu otomatis di-skip
tanpa bikin bot crash (cek log console buat lihat mana yang aktif).

⚠️ **Catatan Railway khusus `GOOGLE_PRIVATE_KEY`**: private key dari file JSON biasanya multi-baris.
Kalau di Railway Variables jadi satu baris dengan `\n` literal (bukan newline beneran), itu sudah
ditangani otomatis di kode (`sheetsClient.js` unescape `\n` jadi newline asli) — jadi tinggal paste
apa adanya dari file JSON.

## Jalanin di Lokal

```bash
npm install
cp .env.example .env
# isi HELIUS_API_KEY di file .env
npm start
```

## Deploy ke Railway

1. Push project ini ke GitHub repo
2. Di Railway: New Project → Deploy from GitHub repo
3. Pilih repo ini
4. Di tab **Variables**, tambahkan:
   - `HELIUS_API_KEY`
5. Railway otomatis detect `npm start` dari `package.json` dan jalankan sebagai worker

## Struktur File

```
src/
  config.js            - Konstanta (program ID, interval)
  connection.js         - WebSocket manager (reconnect, ping, subscription registry)
  migrationListener.js  - Deteksi & verifikasi event migrasi
  index.js               - Entrypoint, menyambungkan semua komponen
```
