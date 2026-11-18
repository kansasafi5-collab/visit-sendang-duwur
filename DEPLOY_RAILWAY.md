# Memasang Visit Sendang Duwur ke Railway

Panduan ini ditulis dari pengetahuan umum tentang Railway (tidak bisa mengakses Railway langsung), jadi nama menu di dashboard bisa sedikit berbeda. Urutannya yang penting.

## 0. Sebelum apa pun
- **Ganti password admin dan semua kunci** yang pernah Anda kirim lewat chat atau simpan di berkas yang dibagikan (`ADMIN_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`). Anggap sudah terbuka.
- `.env` **tidak boleh** ikut ke GitHub. `.gitignore` Anda sudah memuatnya. Cek: `git check-ignore -v .env` harus menampilkan aturannya.
- **Cadangkan** `data/sendangduwur.db` dan folder `data/uploads` bila sudah berisi data penting.

## 1. Uji di komputer sendiri dulu (wajib)
1. Ekstrak zip ke akar repo. Isinya hanya berkas **baru** (folder `server/panel`, `public/panel`, `public/assets/panel`, `railway.json`, `.node-version`), kecuali bila Anda sudah memasang tahap sebelumnya, maka berkasnya ditimpa dengan versi final ini.
2. Jalankan sekali dari akar repo: `node terapkan-tahap8.js`. Skrip ini menyisipkan 1 baris ke `server/index.js` dan 3 potongan kecil ke `public/index.html` (tombol "Lihat produk & promo"), membuat cadangan `*.bak-tahap8`, aman dijalankan ulang, dan berhenti tanpa mengubah apa pun bila titik sisipnya tidak cocok. Hapus berkas `*.bak-tahap8` setelah yakin hasilnya benar, atau tambahkan `*.bak-tahap8` ke `.gitignore`.
3. `npm install` lalu `npm start`, buka http://localhost:3000.
4. Daftar cek (±10 menit):
   - [ ] Beranda dan marketplace tampil seperti biasa.
   - [ ] Masuk admin di `/login/admin` → `/panel/admin` terbuka (sidebar 11 menu).
   - [ ] Daftar akun UMKM di `/login/umkm`; di `/panel/admin` → Verifikasi → verifikasi usaha itu.
   - [ ] Masuk sebagai UMKM → `/panel/umkm` → Produk → tambah produk + 1 foto.
   - [ ] Sebagai admin → Persetujuan Produk → setujui.
   - [ ] UMKM → Promo & Diskon → buat promo 20%.
   - [ ] Beranda → kartu usaha itu punya tombol **Lihat produk & promo** → `/toko/ID` menampilkan harga diskon.
   - [ ] Pesan dari halaman toko → pesanan muncul di `/panel/umkm` → Pesanan; ubah status; stok berkurang.
   - [ ] Akun warga mencoba membuka `/panel/admin` → ditolak (403).
5. Bila ada yang gagal, hentikan di sini dan kirim pesan galat dari konsol.

## 2. Kirim ke GitHub (pakai cabang, bukan langsung ke main)
```
git checkout -b dashboard-umkm-admin
git add -A
git status          # pastikan tidak ada .env, data/, atau node_modules
git commit -m "Dashboard UMKM & Admin Desa, promo, AI, etalase toko"
git push -u origin dashboard-umkm-admin
```
Setelah semua uji lolos, gabungkan ke `main` lewat Pull Request.

## 3. Railway
1. **New Project → Deploy from GitHub repo** → pilih repo, lalu cabang (`dashboard-umkm-admin` untuk uji, `main` untuk produksi).
2. **Settings → Networking → Generate Domain**. Catat alamat `https://xxxx.up.railway.app`.
3. **Volume** (wajib, SQLite dan foto disimpan di disk): tambahkan Volume, mount path `/data`.
4. **Variables**:

| Variabel | Isi |
|---|---|
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `true` |
| `BASE_URL` | alamat domain di langkah 2 (https, tanpa garis miring akhir) |
| `DATA_DIR` | `/data` |
| `ADMIN_EMAIL` | email admin |
| `ADMIN_PASSWORD` | password kuat, baru |
| `ANTHROPIC_API_KEY` | opsional; kosong = fitur AI menampilkan "belum tersedia" |
| `ANTHROPIC_MODEL` | opsional |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | opsional, lihat `GOOGLE_SETUP.md` |

   `PORT` diisi otomatis oleh Railway; jangan diatur.
5. Berkas `railway.json` sudah mengatur perintah mulai dan pemeriksaan kesehatan (`/healthz`). `.node-version` meminta Node 22 (situs butuh Node ≥ 22.5 karena memakai `node:sqlite`).
6. **Jumlah replika harus 1.** SQLite tidak untuk dipakai oleh beberapa instans sekaligus.
7. Deploy, lalu buka **Logs**. Harus ada `Visit Sendang Duwur berjalan ...`. Pada database baru, akun admin dibuat sekali dari `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
8. Bila memakai Google: tambahkan `https://DOMAIN-ANDA/api/auth/google/callback` ke Authorized redirect URIs.
9. Ulangi daftar cek bagian 1 di alamat produksi.

## 4. Bila situs Railway sudah ada ("seperti kemarin")
Cukup push ke cabang yang dipantau Railway. Volume dan data tetap. Migrasi database bersifat menambah tabel baru saja dan berjalan otomatis saat server mulai. Tetap cadangkan database dulu.

## 5. Masalah umum
| Gejala | Penyebab / solusi |
|---|---|
| Deploy gagal, `Cannot find module 'express'` | Dependensi belum terpasang: pastikan `package.json` dan `package-lock.json` ada di repo. |
| `node:sqlite` tidak ditemukan | Node terlalu lama. Pastikan `.node-version` terbaca, atau atur variabel `NIXPACKS_NODE_VERSION=22` / sesuaikan di Settings. |
| Healthcheck gagal / 502 | Lihat Logs. Biasanya galat saat mulai (variabel salah, volume tidak bisa ditulis). |
| Login berputar / langsung keluar | `NODE_ENV=production` butuh HTTPS dan `TRUST_PROXY=true`. |
| Data hilang setelah deploy ulang | Volume belum terpasang di `/data`, atau `DATA_DIR` tidak sama dengan mount path. |
| Foto produk hilang | Sama: folder `uploads` ada di dalam `DATA_DIR`. |
| Tombol Google: redirect_uri_mismatch | `BASE_URL` + `/api/auth/google/callback` harus persis sama dengan yang didaftarkan. |
| Fitur AI "belum tersedia" | `ANTHROPIC_API_KEY` belum diisi, atau layanan sedang tidak dapat dihubungi. |
