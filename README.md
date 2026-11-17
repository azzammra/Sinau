# PocketLedger v3.0 — Offline-First Personal Finance PWA (`Pockets`)

PocketLedger v3.0 adalah aplikasi web progresif (*Progressive Web App* / PWA) manajemen keuangan pribadi berbasis lokal (`IndexedDB` v3) yang dirancang untuk smartphone dan tablet Android serta siap di-deploy ke **GitHub Pages** pada repositori `Pockets`.

## 1. Struktur Proyek Modular
```text
Pockets/
├── index.html
├── manifest.json
├── service-worker.js
├── offline.html
├── README.md
├── assets/
│   ├── icons/
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   └── maskable-512.png
│   └── images/
├── css/
│   ├── style.css
│   └── responsive.css
└── js/
    ├── calculations.js     # Mesin perhitungan finansial & kalender dinamis terpusat
    ├── budgets.js          # Sistem anggaran 3 tipe (Bulanan, Rentang Bulan, Permanen)
    ├── rollover.js         # Mesin rollover kumulatif & isolasi defisit bulanan
    ├── receipt-scanner.js  # Preprocessing kanvas & ekstraksi OCR lokal Tesseract.js
    ├── database.js         # IndexedDB v3 (9 object stores) & migrasi aman v1/v2 -> v3
    ├── accounts.js         # Manajemen akun kas, bank, e-wallet & tabungan
    ├── categories.js       # Kategori kustom & migrasi transaksi saat kategori dihapus
    ├── transactions.js     # Filter, pencarian & pengurutan transaksi
    ├── analytics.js        # Laporan harian, mingguan, bulanan, tahunan & kesimpulan otomatis
    ├── backup.js           # Cadangan JSON ber-versi dengan pratinjau Merge vs Replace
    ├── settings.js         # Ikon SVG inline & pengaturan tema/aplikasi
    └── app.js              # Orkestrator UI 5 menu utama & sub-menu Lainnya (More)
```

## 2. Panduan Deployment ke GitHub Pages (Repositori `Pockets`)
1. Ekstrak seluruh isi `Pockets_GitHub_Repo.zip` ke repositori GitHub Anda (`Pockets`).
2. Commit dan push ke branch `main`.
3. Buka **Settings → Pages** pada repositori GitHub Anda, pilih **Source: Deploy from a branch (`main` / `/root`)**, lalu klik **Save**.
4. Seluruh path aset menggunakan path relatif (`./`), sehingga aplikasi berjalan normal di subdirektori `https://<username>.github.io/Pockets/` tanpa konfigurasi tambahan.

## 3. Dokumentasi Migrasi Database & Format Cadangan JSON (`v3.0.0-PWA`)
- Database `PocketLedgerDB_v1` dinaikkan ke `DB_VERSION = 3` dengan 9 *object store*: `transactions`, `accounts`, `categories`, `budgets`, `receipts`, `savings`, `investments`, `settings`, dan `rollover_records`.
- Saat pengguna versi v1/v2 membuka aplikasi v3.0, fungsi `migrateToV3Schema` otomatis memindahkan `settings.startingBalance` ke akun `bank` dan mempertahankan seluruh transaksi serta struk lama tanpa kehilangan data.
- Saat mengimpor berkas cadangan JSON, sistem menampilkan pratinjau jumlah catatan dan menyediakan dua mode:
  1. **Gabungkan Tanpa Duplikat (Safe Merge)**: Mempertahankan data yang ada dan menambahkan/memperbarui catatan berdasarkan `id`.
  2. **Ganti Seluruh Data (Full Replace)**: Mengganti isi database setelah pengguna menekan tombol konfirmasi.
