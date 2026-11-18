'use strict';
// Migrasi ADITIF untuk dashboard baru. Hanya CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
// Tidak mengubah atau menghapus tabel lama (users, businesses, orders, dst.).
module.exports = function migratePanel(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  deskripsi TEXT NOT NULL DEFAULT '',
  kategori TEXT NOT NULL DEFAULT '',
  harga INTEGER NOT NULL CHECK (harga >= 0),          -- rupiah, bilangan bulat
  stok INTEGER NOT NULL DEFAULT 0 CHECK (stok >= 0),
  stok_min INTEGER NOT NULL DEFAULT 5,
  tersedia INTEGER NOT NULL DEFAULT 1,                -- diatur pemilik
  persetujuan TEXT NOT NULL DEFAULT 'pending' CHECK (persetujuan IN ('pending','approved','rejected','disabled')),
  catatan TEXT NOT NULL DEFAULT '',                   -- alasan tolak/nonaktif (wajib dari admin)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_biz ON products(business_id, persetujuan);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file TEXT NOT NULL,                                 -- nama berkas di DATA_DIR/uploads
  urutan INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  harga INTEGER CHECK (harga IS NULL OR harga >= 0),  -- NULL = ikut harga produk
  stok INTEGER NOT NULL DEFAULT 0 CHECK (stok >= 0)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  alasan TEXT NOT NULL,                               -- 'manual','pesanan','batal','koreksi'
  order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  tipe TEXT NOT NULL CHECK (tipe IN ('persen','nominal')),
  nilai INTEGER NOT NULL CHECK (nilai > 0),           -- persen 1-90, atau rupiah
  mulai TEXT NOT NULL,                                -- tanggal WIB (YYYY-MM-DD), inklusif
  selesai TEXT NOT NULL,
  min_belanja INTEGER NOT NULL DEFAULT 0,
  batas_pakai INTEGER,                                -- NULL = tak terbatas
  aktif INTEGER NOT NULL DEFAULT 1,
  dinonaktifkan_admin INTEGER NOT NULL DEFAULT 0,
  catatan_admin TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (selesai >= mulai)
);
CREATE TABLE IF NOT EXISTS promotion_products (
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, product_id)
);
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  kode TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS promo_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  potongan INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (order_id)
);

-- Pesanan baru lewat /api/checkout: harga di-snapshot agar laporan tidak berubah bila harga diubah.
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  nama TEXT NOT NULL,
  harga_satuan INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  potongan INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  aksi TEXT NOT NULL,                                 -- mis. 'produk.setujui'
  objek TEXT NOT NULL DEFAULT '',                     -- mis. 'products:12'
  alasan TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS cost_calculations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  input_json TEXT NOT NULL,
  hasil_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  fitur TEXT NOT NULL,                                -- 'business','village','customer'
  pertanyaan TEXT NOT NULL,
  jawaban TEXT NOT NULL,
  periode TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
};
