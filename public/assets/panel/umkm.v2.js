'use strict';
/* Halaman Panel UMKM: Ringkasan, Produk, Pesanan. Memakai komponen bersama SD.* (shared.v2.js). */
(function () {
  const { el, api, rp, tgl, toast, confirm } = SD, P = SD.pages.umkm;
  const ST = { baru: ['Baru', 'warn'], proses: ['Diproses', 'warn'], siap: ['Siap dikirim', 'ok'], selesai: ['Selesai', 'ok'], batal: ['Dibatalkan', 'bad'] };
  const AP = { pending: ['Menunggu persetujuan', 'warn'], approved: ['Disetujui', 'ok'], rejected: ['Ditolak', 'bad'], disabled: ['Dinonaktifkan', 'bad'] };
  const VR = { verified: ['Terverifikasi', 'ok'], pending: ['Menunggu verifikasi', 'warn'], rejected: ['Ditolak', 'bad'] };
  const badge = (m, k) => SD.StatusBadge((m[k] || [k, 'mut'])[0], (m[k] || [k, 'mut'])[1]);
  const hari = (d) => d.slice(8) + '/' + d.slice(5, 7);

  /* ---------- Ringkasan ---------- */
  P.ringkasan = async () => {
    const s = await api('/umkm/summary');
    const warn = s.toko.verifikasi !== 'verified' && el('div', { class: 'card', style: 'margin-bottom:18px;border-left:4px solid var(--warn)' },
      el('b', { text: 'Usaha Anda belum terverifikasi. ' }), 'Produk baru dapat ditambahkan setelah admin desa memverifikasi usaha Anda. Pantau statusnya di sini.');
    return el('div', {},
      SD.PageHeader({ title: 'Ringkasan', desc: s.toko.nama, actions: [el('span', { text: 'Status toko: ' }), badge(VR, s.toko.verifikasi)] }), warn,
      el('div', { class: 'grid' },
        SD.StatCard({ label: 'Total produk', value: s.produk.total }),
        SD.StatCard({ label: 'Produk aktif', value: s.produk.aktif, note: 'Disetujui & tersedia' }),
        SD.StatCard({ label: 'Menunggu persetujuan', value: s.produk.pending }),
        SD.StatCard({ label: 'Pesanan baru', value: s.pesanan.baru, note: s.pesanan.total + ' pesanan seluruhnya' }),
        SD.StatCard({ label: 'Total penjualan', value: rp(s.penjualan), note: 'Tanpa pesanan batal' }),
        SD.StatCard({ label: 'Pendapatan', value: rp(s.pendapatan), note: 'Pesanan selesai' }),
        SD.StatCard({ label: 'Stok menipis', value: s.produk.menipis })),
      s.pesanan.total && !s.pesanan.bernilai ? el('p', { class: 'hint', style: 'margin:-8px 0 18px;color:var(--mt);font-size:13px', text: 'Nominal penjualan dihitung dari pesanan yang memuat produk. Pesanan lama berupa teks bebas belum memiliki nilai rupiah.' }) : null,
      el('div', { class: 'row2' },
        SD.ChartCard('Penjualan 7 hari terakhir', SD.BarChart(s.harian.map((x) => ({ label: hari(x.d), value: x.v })), rp)),
        SD.ChartCard('Produk terlaris', s.terlaris.length ? el('ol', { style: 'margin:0;padding-left:20px' }, s.terlaris.map((t) => el('li', { text: `${t.nama} — ${t.qty} terjual` }))) : SD.EmptyState({ title: 'Belum ada penjualan', text: 'Produk terlaris muncul setelah ada pesanan.' }))),
      SD.ChartCard('Aktivitas terbaru', s.terbaru.length ? el('ul', { style: 'margin:0;padding-left:18px' }, s.terbaru.map((o) => el('li', {}, `Pesanan #${o.id} dari ${o.pemesan} · ${tgl(o.created_at)} · `, badge(ST, o.status)))) : SD.EmptyState({ title: 'Belum ada aktivitas' })));
  };

  /* ---------- util form: tampilkan galat per kolom dari server ---------- */
  const showErr = (root, e) => {
    root.querySelectorAll('.err').forEach((n) => (n.textContent = ''));
    for (const [k, m] of Object.entries(e.fields || {})) { const i = root.querySelector('#' + k); i && (i.parentNode.querySelector('.err').textContent = m); }
    toast(e.message, true);
  };
  const val = (root, id) => root.querySelector('#' + id).value;

  /* ---------- Produk ---------- */
  P.produk = async () => {
    const box = el('div'); let close = () => {};
    const load = async () => {
      const { items } = await api('/umkm/products'); box.replaceChildren();
      const lowOf = (p) => p.stok <= p.stok_min;
      box.append(SD.DataTable({
        rows: items.map((p) => ({ ...p, status: AP[p.persetujuan][0] })),
        empty: { title: 'Belum ada produk', text: 'Tambahkan produk pertama Anda. Produk baru ditinjau admin desa sebelum tampil di halaman publik.' },
        cols: [
          { key: 'nama', label: 'Produk', render: (p) => el('div', { style: 'display:flex;gap:10px;align-items:center' }, p.fotos[0] ? el('img', { src: '/uploads/' + p.fotos[0].file, alt: 'Foto ' + p.nama, width: 44, height: 44, style: 'object-fit:cover;border-radius:6px' }) : null, el('div', {}, el('b', { text: p.nama }), el('div', { style: 'font-size:12.5px;color:var(--mt)', text: p.kategori || 'Tanpa kategori' }))) },
          { key: 'harga', label: 'Harga', render: (p) => rp(p.harga) },
          { key: 'stok', label: 'Stok', render: (p) => el('span', {}, String(p.stok), ' ', lowOf(p) ? SD.StatusBadge('Menipis', 'warn') : null) },
          { key: 'status', label: 'Status', render: (p) => el('div', {}, badge(AP, p.persetujuan), !p.tersedia ? el('div', { style: 'font-size:12px;color:var(--mt)', text: 'Ditandai tidak tersedia' }) : null, p.catatan ? el('div', { style: 'font-size:12px;color:var(--bad)', text: 'Alasan admin: ' + p.catatan }) : null) },
          { key: 'id', label: '', sort: false, render: (p) => el('span', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
            el('button', { class: 'btn o', onclick: () => form(p), text: 'Ubah' }), el('button', { class: 'btn o', onclick: () => stok(p), text: 'Stok' }),
            el('button', { class: 'btn o', onclick: () => hapus(p), text: 'Hapus' })) },
        ] }));
    };

    // Pengelola foto: maks. 5 foto, JPG/PNG/WebP, 3 MB. Berkas dikirim apa adanya (bukan JSON); server memeriksa isi berkas.
    function fotoBox(p) {
      const strip = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0' });
      const hapus = async (x) => { try { await api(`/umkm/products/${p.id}/foto/${x.id}`, { method: 'DELETE' }); p.fotos = p.fotos.filter((y) => y.id !== x.id); draw(); load(); } catch (e) { toast(e.message, true); } };
      const tile = (x) => el('div', { style: 'position:relative' },
        el('img', { src: '/uploads/' + x.file, alt: 'Foto ' + p.nama, width: 76, height: 76, style: 'object-fit:cover;border-radius:6px;display:block' }),
        el('button', { class: 'ib', 'aria-label': 'Hapus foto', style: 'position:absolute;top:2px;right:2px;width:24px;height:24px;background:var(--sf)', text: '×', onclick: () => hapus(x) }));
      const draw = () => strip.replaceChildren(...(p.fotos.length ? p.fotos.map(tile) : [el('span', { style: 'color:var(--mt);font-size:13px', text: 'Belum ada foto.' })]));
      const inp = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Pilih foto produk', onchange: async () => {
        const file = inp.files[0]; inp.value = ''; if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast('Gunakan foto JPG, PNG, atau WebP.', true);
        if (file.size > 3 * 1024 * 1024) return toast('Ukuran foto maksimal 3 MB.', true);
        try {
          const r = await fetch(`/api/panel/umkm/products/${p.id}/foto`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin' });
          const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Gagal mengunggah foto.');
          p.fotos.push({ id: j.id, file: j.file }); draw(); load();
          toast(j.ditinjauUlang ? 'Foto ditambahkan. Produk menunggu peninjauan ulang admin.' : 'Foto ditambahkan.');
        } catch (e) { toast(e.message, true); }
      } });
      draw();
      return el('div', { class: 'fld' }, el('label', { text: 'Foto produk (maks. 5)' }), strip, inp, el('span', { class: 'hint', text: 'Foto baru pada produk yang sudah disetujui meminta peninjauan ulang admin.' }));
    }
    function form(p) {
      const f = el('div', {}, SD.Field({ id: 'nama', label: 'Nama produk', value: p ? p.nama : '', maxlength: 100 }), SD.Field({ id: 'kategori', label: 'Kategori', value: p ? p.kategori : '', maxlength: 60 }),
        SD.Field({ id: 'harga', label: 'Harga (Rp)', type: 'number', min: 0, step: 1, value: p ? p.harga : '' }),
        p ? null : SD.Field({ id: 'stok', label: 'Stok awal', type: 'number', min: 0, step: 1, value: 0 }),
        SD.Field({ id: 'stok_min', label: 'Batas stok menipis', type: 'number', min: 0, step: 1, value: p ? p.stok_min : 5 }),
        SD.Field({ id: 'deskripsi', label: 'Deskripsi', type: 'textarea', rows: 4, maxlength: 1000 }),
        p ? SD.Field({ id: 'tersedia', label: 'Ketersediaan', type: 'select' }) : null);
      if (p) { f.querySelector('#deskripsi').value = p.deskripsi; const s = f.querySelector('#tersedia'); s.append(el('option', { value: '1', text: 'Tersedia' }), el('option', { value: '0', text: 'Kosong / tidak dijual' })); s.value = p.tersedia ? '1' : '0';
        f.append(el('p', { style: 'color:var(--mt);font-size:13px', text: 'Mengubah nama, kategori, atau deskripsi produk yang sudah disetujui akan meminta peninjauan ulang admin. Mengubah harga tidak.' })); }
      f.append(p ? fotoBox(p) : el('p', { style: 'color:var(--mt);font-size:13px', text: 'Foto produk dapat ditambahkan setelah produk disimpan (buka lagi lewat tombol Ubah).' }));
      const save = el('button', { class: 'btn', text: p ? 'Simpan perubahan' : 'Simpan produk' });
      save.onclick = async () => {
        save.disabled = true;
        const body = { nama: val(f, 'nama'), kategori: val(f, 'kategori'), harga: val(f, 'harga'), stok_min: val(f, 'stok_min'), deskripsi: val(f, 'deskripsi') };
        if (!p) body.stok = val(f, 'stok'); else body.tersedia = val(f, 'tersedia') === '1';
        try { const r = p ? await api('/umkm/products/' + p.id, { method: 'PUT', body }) : await api('/umkm/products', { method: 'POST', body });
          close(); toast(p ? (r.ditinjauUlang ? 'Tersimpan. Produk menunggu peninjauan ulang admin.' : 'Perubahan disimpan.') : 'Produk ditambahkan dan menunggu persetujuan admin.'); load();
        } catch (e) { showErr(f, e); } finally { save.disabled = false; }
      };
      f.append(save); close = SD.drawer(p ? 'Ubah produk' : 'Tambah produk', f);
    }
    function stok(p) {
      const f = el('div', {}, el('p', { style: 'margin-bottom:12px', text: `${p.nama} — stok sekarang ${p.stok}` }),
        SD.Field({ id: 'delta', label: 'Perubahan stok', type: 'number', step: 1, hint: 'Positif menambah, negatif mengurangi. Contoh: 10 atau -2.' }), SD.Field({ id: 'alasan', label: 'Alasan', type: 'select' }));
      f.querySelector('#alasan').append(el('option', { value: 'manual', text: 'Tambah / kurangi stok' }), el('option', { value: 'koreksi', text: 'Koreksi hasil hitung' }));
      const b = el('button', { class: 'btn', text: 'Simpan stok', onclick: async () => { try { const r = await api(`/umkm/products/${p.id}/stok`, { method: 'POST', body: { delta: val(f, 'delta'), alasan: val(f, 'alasan') } }); close(); toast('Stok sekarang ' + r.stok + '.'); load(); } catch (e) { showErr(f, e); } } });
      f.append(b); close = SD.drawer('Atur stok', f);
    }
    async function hapus(p) {
      if (!(await confirm({ title: 'Hapus produk?', text: `"${p.nama}" akan dihapus. Produk yang pernah dipesan hanya diarsipkan agar riwayat transaksi tetap utuh.`, ok: 'Hapus', danger: true }))) return;
      try { const r = await api('/umkm/products/' + p.id, { method: 'DELETE' }); toast(r.diarsipkan ? 'Produk pernah dipesan, jadi diarsipkan (ditandai tidak tersedia).' : 'Produk dihapus.'); load(); } catch (e) { toast(e.message, true); }
    }
    await load();
    return el('div', {}, SD.PageHeader({ title: 'Produk', desc: 'Kelola produk, harga, dan stok. Produk baru tampil di halaman publik setelah disetujui admin desa.', actions: [el('button', { class: 'btn', onclick: () => form(null), text: '+ Tambah produk' })] }), box);
  };

  /* ---------- Pesanan ---------- */
  P.pesanan = async () => {
    const box = el('div'); let close = () => {};
    const load = async () => {
      const { items } = await api('/umkm/orders'); box.replaceChildren();
      box.append(SD.DataTable({
        rows: items.map((o) => ({ ...o, ringkas: o.items.length ? o.items.map((i) => `${i.qty}× ${i.nama}`).join(', ') : `${o.jumlah}× ${o.pesanan}`, totalTeks: o.total == null ? '—' : rp(o.total) })), onRow: detail,
        empty: { title: 'Belum ada pesanan', text: 'Pesanan dari pembeli akan muncul di sini.' },
        cols: [{ key: 'id', label: 'No.', render: (o) => '#' + o.id }, { key: 'pemesan', label: 'Pemesan' }, { key: 'ringkas', label: 'Pesanan' }, { key: 'totalTeks', label: 'Total' }, { key: 'status', label: 'Status', render: (o) => badge(ST, o.status) }, { key: 'created_at', label: 'Tanggal', render: (o) => tgl(o.created_at) }] }));
    };
    function detail(o) {
      const acts = o.next.map((to) => el('button', { class: 'btn' + (to === 'batal' ? ' danger' : ''), text: { proses: 'Proses pesanan', siap: 'Tandai siap dikirim', selesai: 'Tandai selesai', batal: 'Batalkan' }[to], onclick: async () => {
        if (to === 'batal' && !(await confirm({ title: 'Batalkan pesanan?', text: 'Stok produk dalam pesanan ini akan dikembalikan.', ok: 'Batalkan pesanan', danger: true }))) return;
        try { await api('/umkm/orders/' + o.id, { method: 'PATCH', body: { status: to } }); close(); toast('Status diperbarui.'); load(); } catch (e) { toast(e.message, true); } } }));
      close = SD.drawer('Pesanan #' + o.id, el('div', {}, el('p', {}, el('b', { text: o.pemesan }), ' · ', tgl(o.created_at)), el('p', { style: 'margin:8px 0' }, badge(ST, o.status)),
        o.items.length ? el('ul', { style: 'padding-left:18px' }, o.items.map((i) => el('li', { text: `${i.qty}× ${i.nama} @ ${rp(i.harga_satuan)}${i.potongan ? ' (potongan ' + rp(i.potongan) + ')' : ''}` }))) : el('p', { text: `${o.jumlah}× ${o.pesanan}` }),
        o.total != null && el('p', { style: 'margin-top:10px' }, el('b', { text: 'Total: ' + rp(o.total) })),
        el('p', { style: 'color:var(--mt);font-size:13px;margin:10px 0', text: 'Pembayaran belum terintegrasi payment gateway: konfirmasi pembayaran dilakukan langsung dengan pembeli.' }),
        o.wa ? el('p', {}, el('a', { class: 'btn o', href: 'https://wa.me/' + o.wa, target: '_blank', rel: 'noopener', text: 'Hubungi via WhatsApp' })) : el('p', { style: 'color:var(--mt)', text: 'Pembeli tidak mencantumkan WhatsApp.' }),
        el('div', { class: 'fb', style: 'margin-top:16px' }, acts)));
    }
    await load();
    return el('div', {}, SD.PageHeader({ title: 'Pesanan', desc: 'Pesanan masuk dari pembeli. Klik baris untuk melihat detail dan memperbarui status.' }), box);
  };

  /* ---------- Promo & Diskon ---------- */
  const PS = { aktif: ['Aktif', 'ok'], terjadwal: ['Terjadwal', 'warn'], berakhir: ['Berakhir', 'mut'], nonaktif: ['Nonaktif', 'mut'], habis: ['Kuota habis', 'warn'], dinonaktifkan_admin: ['Dinonaktifkan admin', 'bad'] };
  const label = (p) => (p.tipe === 'persen' ? `PROMO ${p.nilai}%` : `POTONGAN ${rp(p.nilai)}`);
  P.promo = async () => {
    const box = el('div'); let close = () => {};
    const load = async () => {
      const { items } = await api('/umkm/promos'); box.replaceChildren();
      box.append(SD.DataTable({ empty: { title: 'Belum ada promo', text: 'Buat promo atau kode voucher untuk menarik pembeli. Diskon dihitung otomatis oleh server saat pesanan dibuat.' },
        rows: items.map((p) => ({ ...p, slabel: PS[p.status][0], nm: p.nama })),
        cols: [{ key: 'nm', label: 'Promo', render: (p) => el('div', {}, el('b', { text: p.nama }), sub(label(p) + (p.min_belanja ? ' · min. belanja ' + rp(p.min_belanja) : '')), sub('Produk: ' + p.produk.join(', '))) },
          { key: 'mulai', label: 'Periode', render: (p) => `${p.mulai} s/d ${p.selesai}` }, { key: 'kode', label: 'Voucher', render: (p) => p.kode || 'Otomatis' },
          { key: 'dipakai', label: 'Dipakai', render: (p) => el('div', {}, p.dipakai + (p.batas_pakai ? ' / ' + p.batas_pakai : ''), sub(p.dipakai ? `Potongan ${rp(p.total_potongan)} · penjualan ${rp(p.omzet)}` : ''))},
          { key: 'slabel', label: 'Status', render: (p) => el('div', {}, badge(PS, p.status), p.catatan_admin ? sub('Alasan admin: ' + p.catatan_admin) : null) },
          { key: 'id', label: '', sort: false, render: (p) => p.dinonaktifkan_admin ? null : btn(p.aktif ? 'Nonaktifkan' : 'Aktifkan', async () => { try { await api(`/umkm/promos/${p.id}/aktif`, { method: 'PATCH', body: { aktif: !p.aktif } }); toast('Promo diperbarui.'); load(); } catch (e) { toast(e.message, true); } }) }] }));
    };
    const sub = (t) => el('div', { style: 'font-size:12.5px;color:var(--mt)', text: t });
    const btn = (t, fn) => el('button', { class: 'btn o', text: t, onclick: fn });
    async function form() {
      const { items } = await api('/umkm/products');
      const prods = items.filter((x) => x.persetujuan !== 'disabled');
      if (!prods.length) return toast('Tambahkan produk terlebih dahulu sebelum membuat promo.', true);
      const f = el('div', {}, SD.Field({ id: 'nama', label: 'Nama promo', maxlength: 80, placeholder: 'Mis. Diskon Akhir Pekan' }), SD.Field({ id: 'tipe', label: 'Jenis diskon', type: 'select' }),
        SD.Field({ id: 'nilai', label: 'Nilai', type: 'number', min: 1, step: 1, hint: 'Persen (1–90) atau rupiah, sesuai jenis.' }), SD.Field({ id: 'mulai', label: 'Mulai', type: 'date' }), SD.Field({ id: 'selesai', label: 'Berakhir', type: 'date' }),
        SD.Field({ id: 'min_belanja', label: 'Minimum belanja (Rp)', type: 'number', min: 0, step: 1, value: 0 }), SD.Field({ id: 'batas_pakai', label: 'Batas pemakaian', type: 'number', min: 1, step: 1, hint: 'Kosongkan bila tidak dibatasi.' }),
        SD.Field({ id: 'kode', label: 'Kode voucher (opsional)', maxlength: 20, hint: 'Kosong = promo otomatis. Berisi = pembeli harus memasukkan kode. Maksimal satu promo per pesanan.' }),
        el('div', { class: 'fld' }, el('label', { text: 'Produk yang didiskon' }), el('div', { id: 'productIds' }, prods.map((x) => el('label', { style: 'display:flex;gap:8px;font-weight:400;margin:4px 0' }, el('input', { type: 'checkbox', value: x.id }), `${x.nama} (${rp(x.harga)})`))), el('span', { class: 'err' })));
      f.querySelector('#tipe').append(el('option', { value: 'persen', text: 'Persentase (%)' }), el('option', { value: 'nominal', text: 'Potongan nominal (Rp)' }));
      const save = el('button', { class: 'btn', text: 'Simpan promo' });
      save.onclick = async () => {
        save.disabled = true;
        const body = { nama: val(f, 'nama'), tipe: val(f, 'tipe'), nilai: val(f, 'nilai'), mulai: val(f, 'mulai'), selesai: val(f, 'selesai'), min_belanja: val(f, 'min_belanja'), batas_pakai: val(f, 'batas_pakai'), kode: val(f, 'kode'), productIds: [...f.querySelectorAll('#productIds input:checked')].map((i) => i.value) };
        try { await api('/umkm/promos', { method: 'POST', body }); close(); toast('Promo disimpan.'); load(); } catch (e) { showErr(f, e); } finally { save.disabled = false; }
      };
      f.append(save); close = SD.drawer('Buat promo', f);
    }
    await load();
    return el('div', {}, SD.PageHeader({ title: 'Promo & Diskon', desc: 'Promo hanya berlaku pada periodenya, dan harga setelah diskon dihitung server saat pesanan dibuat.', actions: [el('button', { class: 'btn', onclick: form, text: '+ Buat promo' })] }), box);
  };

  /* ---------- AI Business Intelligence ---------- */
  const pct = (v) => (v == null ? 'tidak ada pembanding' : (v >= 0 ? '+' : '') + v.toFixed(0) + '%');
  const aiBlock = (a) => el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', { text: 'Penjelasan AI' }),
    a.tersedia ? el('div', {}, a.teks.split(/\n{1,}/).filter(Boolean).map((t) => el('p', { style: 'margin:0 0 8px', text: t })), el('p', { style: 'color:var(--mt);font-size:12.5px', text: 'Penjelasan ini dibuat AI dari angka di atas. Periksa kembali sebelum dipakai mengambil keputusan.' }))
      : el('p', { style: 'color:var(--mt)', role: 'status', text: a.alasan }));
  const list = (items, empty) => (items.length ? el('ul', { style: 'margin:0;padding-left:18px' }, items) : el('p', { style: 'color:var(--mt)', text: empty }));

  function hargaTab() {
    const rows = el('div', { id: 'bahan' }), out = el('div'), hist = el('div');
    const addRow = () => { const r = el('div', { style: 'display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;margin-bottom:8px' },
      el('input', { class: 'sel', placeholder: 'Nama bahan', 'aria-label': 'Nama bahan', maxlength: 60 }), el('input', { class: 'sel', type: 'number', min: 0, step: 'any', placeholder: 'Harga satuan', 'aria-label': 'Harga satuan' }),
      el('input', { class: 'sel', type: 'number', min: 0, step: 'any', placeholder: 'Jumlah', 'aria-label': 'Jumlah' }), el('button', { class: 'btn o', 'aria-label': 'Hapus bahan', text: '×', onclick: () => r.remove() })); rows.append(r); };
    addRow();
    const f = el('div', { class: 'card' }, el('h3', { text: 'Hitung biaya & harga jual' }),
      el('div', { class: 'fld' }, el('label', { text: 'Bahan baku (harga per satuan × jumlah dipakai)' }), rows, el('button', { class: 'btn o', style: 'align-self:flex-start', text: '+ Tambah bahan', onclick: addRow }), el('span', { class: 'err' })),
      SD.Field({ id: 'tenaga_kerja', label: 'Biaya tenaga kerja (Rp)', type: 'number', min: 0, step: 'any', value: 0 }), SD.Field({ id: 'operasional', label: 'Biaya operasional (Rp)', type: 'number', min: 0, step: 'any', value: 0, hint: 'Listrik, air, sewa, dan sejenisnya untuk batch ini.' }),
      SD.Field({ id: 'tambahan', label: 'Biaya tambahan (Rp)', type: 'number', min: 0, step: 'any', value: 0, hint: 'Kemasan, ongkos kirim bahan, dan lain-lain.' }),
      SD.Field({ id: 'jumlah_produk', label: 'Jumlah produk yang dihasilkan', type: 'number', min: 1, step: 1 }), SD.Field({ id: 'harga_jual', label: 'Harga jual rencana (Rp, opsional)', type: 'number', min: 0, step: 'any', hint: 'Isi bila ingin tahu untung dari harga yang sudah Anda pikirkan.' }));
    const go = el('button', { class: 'btn', text: 'Hitung' });
    go.onclick = async () => {
      go.disabled = true;
      const body = { bahan: [...rows.children].map((r) => { const i = r.querySelectorAll('input'); return { nama: i[0].value, harga: i[1].value, jumlah: i[2].value }; }), tenaga_kerja: val(f, 'tenaga_kerja'), operasional: val(f, 'operasional'), tambahan: val(f, 'tambahan'), jumlah_produk: val(f, 'jumlah_produk'), harga_jual: val(f, 'harga_jual') };
      try { const r = await api('/umkm/ai/harga', { method: 'POST', body }); show(r); riwayat(); } catch (e) { showErr(f, e); } finally { go.disabled = false; }
    };
    f.append(go);
    function show({ hasil: h, ai }) {
      out.replaceChildren(el('div', {}, el('div', { class: 'grid', style: 'margin-top:14px' }, SD.StatCard({ label: 'Total biaya produksi', value: rp(h.totalBiaya), note: `Bahan ${rp(h.totalBahan)}` }), SD.StatCard({ label: 'HPP per produk', value: rp(h.hpp), note: `${h.jumlah} produk` }), SD.StatCard({ label: 'Harga minimum (tidak rugi)', value: rp(h.hargaMinimum), note: 'Dibulatkan ke atas Rp500' })),
        h.rencana ? el('div', { class: 'card', style: 'margin-bottom:14px' }, el('b', { text: `Harga rencana ${rp(h.rencana.harga)}: ` }), `untung ${rp(h.rencana.untung)} per produk (${h.rencana.margin == null ? '-' : h.rencana.margin.toFixed(1) + '%'}), ${rp(h.rencana.untungTotal)} bila seluruh ${h.jumlah} produk terjual.`) : null,
        el('h3', { text: 'Simulasi harga jual', style: 'margin:6px 0 10px' }), SD.DataTable({ pageSize: 10, rows: h.simulasi, cols: [{ key: 'target', label: 'Target margin', render: (x) => x.target + '%' }, { key: 'harga', label: 'Harga jual', render: (x) => rp(x.harga) }, { key: 'untung', label: 'Untung / produk', render: (x) => rp(x.untung) }, { key: 'margin', label: 'Margin aktual', render: (x) => x.margin.toFixed(1) + '%' }, { key: 'untungTotal', label: 'Untung bila semua terjual', render: (x) => rp(x.untungTotal) }] }),
        el('p', { style: 'color:var(--mt);font-size:13px;margin-top:8px', text: 'Ini simulasi dari biaya yang Anda isi. Harga terbaik juga bergantung pada pembeli dan pesaing, yang tidak ada dalam data ini.' }), aiBlock(ai)));
    }
    async function riwayat() { try { const { items } = await api('/umkm/ai/harga/riwayat'); hist.replaceChildren(el('h3', { text: 'Riwayat perhitungan', style: 'margin:22px 0 10px' }), items.length ? SD.DataTable({ pageSize: 5, rows: items.map((x) => ({ ...x, hppT: x.hasil.hpp, jml: x.hasil.jumlah, tgl: x.created_at })), onRow: (x) => show({ hasil: x.hasil, ai: { tersedia: false, alasan: 'Penjelasan AI hanya ditampilkan saat perhitungan baru dibuat.' } }), cols: [{ key: 'tgl', label: 'Tanggal', render: (x) => tgl(x.created_at) }, { key: 'jml', label: 'Jumlah' }, { key: 'hppT', label: 'HPP / produk', render: (x) => rp(x.hppT) }] }) : SD.EmptyState({ title: 'Belum ada riwayat' })); } catch { /* riwayat opsional */ } }
    riwayat(); return el('div', {}, f, out, hist);
  }

  function analitikTab() {
    const out = el('div'), sel = el('select', { class: 'sel', 'aria-label': 'Periode' }, [7, 30, 90].map((n) => el('option', { value: n, text: n + ' hari terakhir' })));
    const go = el('button', { class: 'btn', text: 'Analisis' });
    go.onclick = async () => {
      go.disabled = true; out.replaceChildren(SD.Skeleton(3));
      try {
        const { data: d, cukup, ai } = await api('/umkm/ai/analitik', { method: 'POST', body: { hari: sel.value } });
        out.replaceChildren(el('div', {}, el('div', { class: 'grid', style: 'margin-top:14px' }, SD.StatCard({ label: 'Pendapatan', value: rp(d.sekarang.pendapatan), note: `${pct(d.perubahanPersen)} vs ${d.periodeHari} hari sebelumnya (${rp(d.sebelumnya.pendapatan)})` }), SD.StatCard({ label: 'Pesanan bernilai', value: d.sekarang.pesanan, note: `Sebelumnya ${d.sebelumnya.pesanan}` }), SD.StatCard({ label: 'Unit terjual', value: d.sekarang.unit })),
          cukup ? null : el('div', { class: 'card', style: 'margin-bottom:14px;border-left:4px solid var(--warn)', role: 'status' }, 'Data belum cukup untuk menyimpulkan tren. Analisis lengkap muncul setelah ada minimal 3 pesanan bernilai pada periode ini.'),
          el('div', { class: 'row2' }, SD.ChartCard('Tren penjualan', SD.BarChart(d.seri, rp)), SD.ChartCard('Produk terlaris', list(d.terlaris.map((t) => el('li', { text: `${t.nama}: ${t.qty} terjual (${rp(t.omzet)})` })), 'Belum ada penjualan pada periode ini.'))),
          el('div', { class: 'row2' }, SD.ChartCard('Kurang diminati (belum terjual, stok masih ada)', list(d.kurangDiminati.map((t) => el('li', { text: `${t.nama} (stok ${t.stok})` })), 'Semua produk aktif sudah terjual.')),
            SD.ChartCard('Rekomendasi stok', list(d.stok.map((t) => el('li', { text: t.hariHabis == null ? `${t.nama}: stok ${t.stok}, di bawah batas minimum` : `${t.nama}: stok ${t.stok}, diperkirakan habis ±${t.hariHabis} hari` })), 'Tidak ada produk yang perlu segera ditambah stoknya.'))),
          SD.ChartCard('Efektivitas promo', d.promo.length ? el('div', {}, list(d.promo.map((p) => el('li', { text: `${p.nama}: dipakai ${p.dipakai}×, total potongan ${rp(p.potongan)}, penjualan ${rp(p.omzet)}` })), ''), d.rataPesananPromo && d.rataPesananTanpaPromo ? el('p', { style: 'margin-top:8px', text: `Rata-rata nilai pesanan: dengan promo ${rp(d.rataPesananPromo.rata)} (${d.rataPesananPromo.n} pesanan), tanpa promo ${rp(d.rataPesananTanpaPromo.rata)} (${d.rataPesananTanpaPromo.n} pesanan).` }) : el('p', { style: 'margin-top:8px;color:var(--mt)', text: 'Perbandingan dengan/tanpa promo belum bisa dibuat karena salah satu kelompoknya belum ada pesanan.' })) : el('p', { style: 'color:var(--mt)', text: 'Belum ada pesanan yang memakai promo pada periode ini.' })),
          el('div', { style: 'margin-top:14px' }, SD.ChartCard('Prediksi penjualan', d.prediksi.tersedia ? el('p', { text: `Perkiraan pendapatan 7 hari ke depan: ${rp(d.prediksi.tujuhHari)}. ${d.prediksi.dasar}` }) : el('p', { style: 'color:var(--mt)', text: d.prediksi.alasan }))), aiBlock(ai)));
      } catch (e) { out.replaceChildren(SD.ErrorState(e, go.onclick)); } finally { go.disabled = false; }
    };
    return el('div', {}, el('div', { class: 'card' }, el('h3', { text: 'Analisis penjualan' }), el('p', { style: 'color:var(--mt);margin-bottom:12px', text: 'Dihitung dari pesanan tersimpan yang memuat produk. Pesanan dibatalkan tidak dihitung.' }), el('div', { class: 'fb', style: 'margin:0' }, sel, go)), out);
  }

  P.ai = async () => {
    const body = el('div'), bar = el('div', { class: 'fb', role: 'tablist' }), tabs = [['Profit & Pricing', hargaTab], ['Analitik Bisnis', analitikTab], ['Asisten Pelanggan', () => el('div', { class: 'card' }, el('h3', { text: 'AI Customer Assistant' }),
      el('p', { style: 'margin:8px 0', text: 'Asisten ini menjawab pertanyaan calon pembeli di halaman toko Anda, hanya dari data produk yang disetujui: harga, stok, dan promo otomatis yang sedang aktif. Jika datanya tidak ada, asisten mengatakan informasinya belum tersedia dan mengarahkan ke WhatsApp Anda.' }),
      el('p', { style: 'color:var(--mt);margin-bottom:12px', text: 'Kode voucher tidak pernah dibagikan oleh asisten. Jam operasional belum disimpan di sistem, jadi asisten tidak akan menjawabnya.' }),
      SD.me.business ? el('a', { class: 'btn', href: '/toko/' + SD.me.business.id, target: '_blank', rel: 'noopener', text: 'Buka halaman toko untuk mencoba' }) : null)]];
    const pick = (i) => { bar.querySelectorAll('button').forEach((b, k) => { b.className = 'btn' + (k === i ? '' : ' o'); b.setAttribute('aria-selected', k === i); }); body.replaceChildren(tabs[i][1]()); };
    tabs.forEach(([t], i) => bar.append(el('button', { role: 'tab', text: t, onclick: () => pick(i) }))); pick(0);
    return el('div', {}, SD.PageHeader({ title: 'AI Business Intelligence', desc: 'Angka dihitung dari data Anda; AI hanya membantu menjelaskannya.' }), bar, body);
  };
})();
