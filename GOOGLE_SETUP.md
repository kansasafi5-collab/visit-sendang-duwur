# Mengaktifkan Login Google

Kode login Google sudah lengkap dan aman (Authorization Code Flow, validasi `state`, email Google wajib terverifikasi, Client Secret hanya di server).
Yang belum ada hanyalah **kredensial dari Google**, karena itu harus dibuat di akun Google milik pengelola situs. Selama belum diisi, tombol
"Masuk dengan Google" menampilkan status *belum dikonfigurasi* (bukan simulasi).

## Langkah (±10 menit, gratis)

1. Buka <https://console.cloud.google.com/> lalu buat proyek baru, misalnya `visit-sendang-duwur`.
2. Menu **APIs & Services → OAuth consent screen**
   - User type: **External**, isi nama aplikasi (Visit Sendang Duwur), email dukungan, dan email kontak developer.
   - Scope cukup `openid`, `email`, `profile` (bawaan, tidak perlu verifikasi Google).
   - Selama status *Testing*, tambahkan email yang boleh mencoba di **Test users**. Klik **Publish app** bila ingin dibuka untuk umum.
3. Menu **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized redirect URIs** (harus persis sama, termasuk http/https dan tanpa garis miring di akhir):
     - Lokal: `http://localhost:3000/api/auth/google/callback`
     - Produksi: `https://DOMAIN-ANDA/api/auth/google/callback`
4. Salin **Client ID** dan **Client secret** ke file `.env`:

   ```
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
   BASE_URL=http://localhost:3000        # produksi: https://DOMAIN-ANDA (wajib sama dengan redirect URI)
   ```

5. Jalankan ulang server. Konsol akan menulis `Login Google: AKTIF` beserta redirect URI yang harus terdaftar.
6. Coba di `/login`, `/login/umkm`, lalu `/login/admin`.

## Perilaku per jenis akun

| Halaman | Akun Google baru | Akun yang sudah ada |
|---|---|---|
| `/login` (pengunjung/warga) | dibuat sebagai `user` | masuk bila role-nya `user` |
| `/login/umkm` | dibuat sebagai `umkm` dengan usaha berstatus *pending*; pemilik melengkapi profil & WhatsApp di `/umkm` | masuk bila role-nya `umkm` |
| `/login/admin` | **ditolak** (admin tidak bisa dibuat lewat Google) | masuk hanya bila email Google sama dengan akun admin yang sudah ada |

Bila email sudah terdaftar dengan jenis akun lain, pengguna diarahkan ke halaman masuk yang sesuai dengan pesan penjelasan.

## Masalah umum

| Pesan Google | Penyebab |
|---|---|
| `redirect_uri_mismatch` | Redirect URI di Google Cloud tidak sama persis dengan `BASE_URL` + `/api/auth/google/callback` |
| `access_denied` / "app not verified" | Status consent screen masih *Testing* dan email belum ada di Test users |
| Kembali ke login dengan "Login Google gagal" | Client Secret salah, atau jam server tidak sinkron. Lihat pesan `Google OAuth gagal:` di konsol server |
