'use strict';
/* Modul tambahan Panel: UMKM (Inventaris, Laporan, Profil Toko, Pengaturan) dan Admin (Laporan, Konten Website, Pengaturan).
   Semua angka berasal dari API; teks server dimasukkan lewat textContent (el). */
(function () {
  const { el, api, rp, tgl, toast, confirm } = SD, U = SD.pages.umkm, A = SD.pages.admin;
  const hari = (d) => d.slice(8) + '/' + d.slice(5, 7);
  const num = (n) => Number(n || 0).toLocaleString('id-ID');

  /* ---------- util bersama ---------- */
  const seg = (val, opts, on) => {
    const box = el('div', { class: 'seg', role: 'group', 'aria-label': 'Periode' });
    opts.forEach(([v, t]) => box.append(el('button', { type: 'button', 'aria-pressed': String(v === val), text: t, onclick: () => on(v) })));
    return box;
  };
  const hbars = (rows, fmt) => {
    if (!rows.length) return SD.EmptyState({ title: 'Belum ada data', text: 'Muncul setelah ada pesanan pada periode ini.' });
    const max = Math.max(...rows.map((r) => r.v), 1);
    return el('div', {}, rows.map((r) => el('div', { class: 'hbar' }, el('span', { class: 't', title: r.t, text: r.t }), el('div', { class: 'meter' }, el('i', { style: 'width:' + Math.max(3, (r.v / max) * 100) + '%' })), el('b', { text: fmt(r.v) }))));
  };
  const showErr = (root, e) => {
    root.querySelectorAll('.err').forEach((n) => (n.textContent = ''));
    for (const [k, m] of Object.entries(e.fields || {})) { const i = root.querySelector('#' + k); i && i.parentNode.querySelector('.err') && (i.parentNode.querySelector('.err').textContent = m); }
    toast(e.message, true);
  };
  const val = (root, id) => root.querySelector('#' + id).value;

  /* Kartu Pengaturan yang sama untuk kedua role: tampilan + ganti kata sandi */
  const THEMES = [['auto', 'Ikuti perangkat'], ['light', 'Terang'], ['dark', 'Gelap']];
  const applyTheme = (t) => { try { t === 'auto' ? localStorage.removeItem('sd_theme') : localStorage.setItem('sd_theme', t); } catch {} t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t); };
  const curTheme = () => { try { return localStorage.getItem('sd_theme') || 'auto'; } catch { return 'auto'; } };
  const themeCard = () => {
    const box = el('div', { class: 'seg', role: 'group', 'aria-label': 'Tema tampilan' });
    const draw = () => { box.replaceChildren(...THEMES.map(([v, t]) => el('button', { type: 'button', 'aria-pressed': String(curTheme() === v), text: t, onclick: () => { applyTheme(v); draw(); } }))); };
    draw();
    return el('div', { class: 'card' }, el('h3', { text: 'Tampilan' }), el('p', { text: 'Pilih tema terang atau gelap. Pilihan disimpan di perangkat ini.', style: 'color:var(--mt);margin-bottom:14px' }), box);
  };
  const passwordCard = () => {
    const f = el('form', { novalidate: true }, SD.Field({ id: 'lama', label: 'Kata sandi lama', type: 'password', autocomplete: 'current-password' }),
      SD.Field({ id: 'baru', label: 'Kata sandi baru', type: 'password', autocomplete: 'new-password', hint: 'Minimal 8 karakter.' }),
      SD.Field({ id: 'ulang', label: 'Ulangi kata sandi baru', type: 'password', autocomplete: 'new-password' }),
      el('button', { class: 'btn', type: 'submit', text: 'Simpan kata sandi' }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (val(f, 'baru') !== val(f, 'ulang')) return showErr(f, Object.assign(new Error('Ulangi kata sandi dengan benar.'), { fields: { ulang: 'Kata sandi tidak sama.' } }));
      try { await api('/' + SD.me.user.role + '/password', { method: 'POST', body: { lama: val(f, 'lama'), baru: val(f, 'baru') } }); toast('Kata sandi diperbarui.'); f.reset(); f.querySelectorAll('.err').forEach((n) => (n.textContent = '')); } catch (er) { showErr(f, er); }
    });
    return el('div', { class: 'card' }, el('h3', { text: 'Ganti kata sandi' }), f);
  };
  const accountCard = (extra) => el('div', { class: 'card' }, el('h3', { text: 'Akun' }), el('dl', { class: 'kv' },
    el('dt', { text: 'Nama' }), el('dd', { text: SD.me.user.name }), el('dt', { text: 'Email' }), el('dd', { text: SD.me.user.email }), el('dt', { text: 'Peran' }), el('dd', { text: SD.me.label }), ...(extra || [])));

  /* =========================== UMKM =========================== */

  /* ---------- Inventaris ---------- */
  U.inventaris = async () => {
    const box = el('div');
    const adjust = (p, reload) => {
      const f = el('form', { novalidate: true }, el('p', { text: `${p.nama} · stok sekarang ${p.stok}`, style: 'color:var(--mt);margin-bottom:12px' }),
        SD.Field({ id: 'delta', label: 'Perubahan stok', type: 'number', step: '1', placeholder: 'mis. 10 menambah, -3 mengurangi', hint: 'Angka positif menambah, negatif mengurangi.' }),
        SD.Field({ id: 'alasan', label: 'Jenis perubahan', type: 'select', value: 'manual' }),
        el('button', { class: 'btn', type: 'submit', text: 'Simpan' }));
      f.querySelector('#alasan').append(el('option', { value: 'manual', text: 'Barang masuk / keluar' }), el('option', { value: 'koreksi', text: 'Koreksi hasil hitung fisik' }));
      let close;
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { const r = await api('/umkm/products/' + p.id + '/stok', { method: 'POST', body: { delta: Number(val(f, 'delta')), alasan: val(f, 'alasan') } }); toast('Stok sekarang ' + r.stok + '.'); close(); reload(); } catch (er) { showErr(f, er); }
      });
      close = SD.drawer('Ubah stok', f);
    };
    const load = async () => {
      const d = await api('/umkm/inventory'), r = d.ringkas;
      box.replaceChildren(
        el('div', { class: 'grid' }, SD.StatCard({ label: 'Jenis produk', value: num(r.jenis) }), SD.StatCard({ label: 'Total unit di gudang', value: num(r.unit) }),
          SD.StatCard({ label: 'Nilai persediaan', value: rp(r.nilai), note: 'Stok × harga jual' }), SD.StatCard({ label: 'Stok menipis', value: num(r.menipis), note: r.habis + ' produk habis' })),
        el('div', { class: 'row2' },
          SD.ChartCard('Kondisi stok', d.items.length ? el('div', {}, d.items.map((p) => {
            const pct = Math.min(100, Math.round((p.stok / Math.max(p.stok_min * 3, 1)) * 100)), low = p.stok <= p.stok_min;
            return el('div', { style: 'margin-bottom:14px' }, el('div', { style: 'display:flex;justify-content:space-between;gap:10px;font-size:14px;margin-bottom:5px' }, el('b', { text: p.nama }),
              el('span', {}, num(p.stok) + ' unit ', p.stok === 0 ? SD.StatusBadge('Habis', 'bad') : low ? SD.StatusBadge('Menipis', 'warn') : SD.StatusBadge('Aman', 'ok'), ' ', el('button', { class: 'btn o', style: 'padding:4px 12px', onclick: () => adjust(p, load), text: 'Ubah' }))),
              el('div', { class: 'meter ' + (low ? 'low' : 'ok'), role: 'img', 'aria-label': `Stok ${p.nama}: ${p.stok}, batas minimum ${p.stok_min}` }, el('i', { style: 'width:' + Math.max(2, pct) + '%' })),
              el('small', { style: 'color:var(--mt)', text: 'Batas minimum ' + p.stok_min + ' unit' }));
          })) : SD.EmptyState({ title: 'Belum ada produk', text: 'Tambahkan produk di menu Produk, lalu stoknya tampil di sini.' })),
          SD.ChartCard('Riwayat pergerakan stok', d.gerak.length ? el('ul', { class: 'tl' }, d.gerak.slice(0, 14).map((g) => el('li', { class: g.delta < 0 ? 'minus' : '' },
            el('b', { text: (g.delta > 0 ? '+' : '') + g.delta + ' · ' + g.nama }), el('small', { text: ({ manual: 'Barang masuk/keluar', koreksi: 'Koreksi stok', pesanan: 'Pesanan #' + g.order_id, batal: 'Pesanan #' + g.order_id + ' dibatalkan' }[g.alasan] || g.alasan) + ' · ' + tgl(g.created_at) })))) : SD.EmptyState({ title: 'Belum ada pergerakan', text: 'Perubahan stok dan pesanan akan tercatat di sini.' }))));
    };
    await load();
    return el('div', {}, SD.PageHeader({ title: 'Inventaris', desc: 'Pantau persediaan, peringatan stok menipis, dan riwayat keluar-masuk barang.' }), box);
  };

  /* ---------- Laporan UMKM ---------- */
  U.laporan = async () => {
    let h = 30; const box = el('div'), head = el('div');
    const SL = { baru: 'Baru', proses: 'Diproses', siap: 'Siap', selesai: 'Selesai', batal: 'Dibatalkan' };
    const load = async () => {
      const d = await api('/umkm/report?hari=' + h), t = d.tot;
      head.replaceChildren(seg(h, [[7, '7 hari'], [30, '30 hari'], [90, '90 hari']], (v) => { h = v; load(); }), el('a', { class: 'btn o', href: '/api/panel/umkm/report.csv?hari=' + h, text: 'Unduh CSV' }));
      box.replaceChildren(
        el('div', { class: 'grid' }, SD.StatCard({ label: 'Penjualan bersih', value: rp(t.bersih), note: 'Setelah diskon · tanpa pesanan batal' }), SD.StatCard({ label: 'Jumlah pesanan', value: num(t.pesanan) }),
          SD.StatCard({ label: 'Unit terjual', value: num(t.unit) }), SD.StatCard({ label: 'Rata-rata per pesanan', value: rp(t.rata) }), SD.StatCard({ label: 'Total diskon diberikan', value: rp(t.potongan) })),
        el('div', { class: 'row2' },
          SD.ChartCard(`Penjualan harian (${h} hari)`, SD.BarChart(d.harian.slice(-14).map((x) => ({ label: hari(x.d), value: x.v })), rp)),
          SD.ChartCard('Status pesanan', d.status.length ? hbars(d.status.map((s) => ({ t: SL[s.status] || s.status, v: s.n })), num) : SD.EmptyState({ title: 'Belum ada pesanan' }))),
        SD.ChartCard('Omzet per produk', SD.DataTable({ rows: d.produk, pageSize: 8, empty: { title: 'Belum ada penjualan', text: 'Laporan terisi setelah ada pesanan yang tidak dibatalkan.' },
          cols: [{ key: 'nama', label: 'Produk' }, { key: 'qty', label: 'Terjual', render: (p) => num(p.qty) }, { key: 'omzet', label: 'Omzet', render: (p) => rp(p.omzet) }] })));
    };
    await load();
    return el('div', {}, SD.PageHeader({ title: 'Laporan', desc: 'Ringkasan penjualan usaha Anda. Dihitung dari pesanan sesungguhnya.' }), el('div', { class: 'fb' }, head), box);
  };

  /* ---------- Profil toko ---------- */
  U.profil = async () => {
    const p = await api('/umkm/profile');
    const f = el('form', { novalidate: true },
      SD.Field({ id: 'nama', label: 'Nama usaha', value: p.nama, maxlength: 100 }), SD.Field({ id: 'pemilik', label: 'Nama pemilik', value: p.pemilik, maxlength: 100 }),
      SD.Field({ id: 'whatsapp', label: 'Nomor WhatsApp', value: p.whatsapp, inputmode: 'tel', hint: 'Pembeli menghubungi Anda lewat nomor ini.' }),
      SD.Field({ id: 'alamat', label: 'Alamat', value: p.alamat, maxlength: 150 }),
      SD.Field({ id: 'deskripsi', label: 'Tentang usaha', type: 'textarea', rows: 4, maxlength: 600, hint: 'Ceritakan keunikan usaha Anda (maks. 600 huruf).' }),
      el('button', { class: 'btn', type: 'submit', text: 'Simpan profil' }));
    f.querySelector('#deskripsi').value = p.deskripsi || '';
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/umkm/profile', { method: 'PUT', body: { nama: val(f, 'nama'), pemilik: val(f, 'pemilik'), whatsapp: val(f, 'whatsapp'), alamat: val(f, 'alamat'), deskripsi: val(f, 'deskripsi') } }); toast('Profil toko diperbarui.'); } catch (er) { showErr(f, er); }
    });
    const VR = { verified: ['Terverifikasi', 'ok'], pending: ['Menunggu verifikasi', 'warn'], rejected: ['Ditolak', 'bad'] };
    return el('div', {}, SD.PageHeader({ title: 'Profil Toko', desc: 'Informasi ini tampil di marketplace dan halaman toko Anda.' }),
      el('div', { class: 'row2' }, el('div', { class: 'card' }, el('h3', { text: 'Data usaha' }), f),
        el('div', {}, el('div', { class: 'card', style: 'margin-bottom:16px' }, el('h3', { text: 'Status toko' }), el('dl', { class: 'kv' },
          el('dt', { text: 'Verifikasi' }), el('dd', {}, SD.StatusBadge((VR[p.verifikasi] || [p.verifikasi])[0], (VR[p.verifikasi] || [0, 'mut'])[1])), el('dt', { text: 'Kategori' }), el('dd', { text: p.kategori }),
          el('dt', { text: 'Tampil di marketplace' }), el('dd', { text: p.aktif && p.verifikasi === 'verified' ? 'Ya' : 'Tidak' })),
          p.verifikasi === 'verified' ? el('a', { class: 'btn o', style: 'margin-top:16px', href: '/toko/' + p.id, target: '_blank', rel: 'noopener', text: 'Lihat halaman toko ↗' }) : null),
        el('div', { class: 'card' }, el('h3', { text: 'Tips' }), el('ul', { style: 'margin:0;padding-left:18px;color:var(--mt)' }, el('li', { text: 'Tambahkan foto jelas pada setiap produk.' }), el('li', { text: 'Pastikan nomor WhatsApp aktif.' }), el('li', { text: 'Buat promo agar toko tampil lebih menarik.' }))))));
  };

  /* ---------- Pengaturan UMKM ---------- */
  U.pengaturan = async () => el('div', {}, SD.PageHeader({ title: 'Pengaturan', desc: 'Tampilan dan keamanan akun Anda.' }),
    el('div', { class: 'row2' }, el('div', {}, themeCard(), el('div', { style: 'height:16px' }), accountCard(SD.me.business ? [el('dt', { text: 'Usaha' }), el('dd', { text: SD.me.business.nama })] : [])), passwordCard()));

  /* =========================== ADMIN =========================== */

  /* ---------- Laporan desa ---------- */
  A.laporan = async () => {
    let h = 30; const box = el('div'), head = el('div');
    const load = async () => {
      const d = await api('/admin/report?hari=' + h), t = d.tot;
      head.replaceChildren(seg(h, [[7, '7 hari'], [30, '30 hari'], [90, '90 hari']], (v) => { h = v; load(); }), el('a', { class: 'btn o', href: '/api/panel/admin/report.csv?hari=' + h, text: 'Unduh CSV' }));
      box.replaceChildren(
        el('div', { class: 'grid' }, SD.StatCard({ label: 'Omzet desa', value: rp(t.omzet), note: 'Tanpa pesanan batal' }), SD.StatCard({ label: 'Jumlah pesanan', value: num(t.pesanan) }),
          SD.StatCard({ label: 'Usaha bertransaksi', value: num(t.usaha) }), SD.StatCard({ label: 'Rata-rata per pesanan', value: rp(t.rata) }), SD.StatCard({ label: 'UMKM baru bergabung', value: num(t.baru) })),
        el('div', { class: 'row2' },
          SD.ChartCard('Omzet harian', SD.BarChart(d.harian.slice(-14).map((x) => ({ label: hari(x.d), value: x.v })), rp)),
          SD.ChartCard('Omzet per kategori', hbars(d.kategori.map((k) => ({ t: k.kategori, v: k.omzet })), rp))),
        el('div', { class: 'row2' },
          SD.ChartCard('Produk terlaris', hbars(d.produk.map((p) => ({ t: p.nama, v: p.qty })), (v) => num(v) + ' unit')),
          SD.ChartCard('Peringkat usaha', SD.DataTable({ rows: d.usaha, pageSize: 6, empty: { title: 'Belum ada transaksi', text: 'Peringkat terisi setelah ada pesanan.' },
            cols: [{ key: 'nama', label: 'Usaha', render: (u) => el('div', {}, el('b', { text: u.nama }), el('div', { style: 'font-size:12px;color:var(--mt)', text: u.kategori })) }, { key: 'pesanan', label: 'Pesanan', render: (u) => num(u.pesanan) }, { key: 'omzet', label: 'Omzet', render: (u) => rp(u.omzet) }] }))));
    };
    await load();
    return el('div', {}, SD.PageHeader({ title: 'Laporan', desc: 'Gambaran ekonomi lokal Desa Sendang Duwur dari seluruh UMKM.' }), el('div', { class: 'fb' }, head), box);
  };

  /* ---------- Konten website: pengumuman ---------- */
  A.konten = async () => {
    const box = el('div'), JN = { info: ['Info', 'info'], penting: ['Penting', 'bad'], acara: ['Acara', 'ok'] };
    const form = (a, reload) => {
      const f = el('form', { novalidate: true }, SD.Field({ id: 'judul', label: 'Judul', value: a ? a.judul : '', maxlength: 90 }),
        SD.Field({ id: 'isi', label: 'Isi pengumuman', type: 'textarea', rows: 4, maxlength: 600 }), SD.Field({ id: 'jenis', label: 'Jenis', type: 'select' }),
        el('label', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:14px' }, el('input', { id: 'tampil', type: 'checkbox', checked: !a || a.tampil ? true : null }), 'Tampilkan di website publik'),
        el('button', { class: 'btn', type: 'submit', text: a ? 'Simpan perubahan' : 'Terbitkan' }));
      f.querySelector('#isi').value = a ? a.isi : '';
      Object.entries(JN).forEach(([k, v]) => f.querySelector('#jenis').append(el('option', { value: k, text: v[0], selected: a && a.jenis === k ? true : null })));
      let close;
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = { judul: val(f, 'judul'), isi: val(f, 'isi'), jenis: val(f, 'jenis'), tampil: f.querySelector('#tampil').checked };
        try { await (a ? api('/admin/content/' + a.id, { method: 'PUT', body }) : api('/admin/content', { method: 'POST', body })); toast('Pengumuman disimpan.'); close(); reload(); } catch (er) { showErr(f, er); }
      });
      close = SD.drawer(a ? 'Ubah pengumuman' : 'Pengumuman baru', f);
    };
    const load = async () => {
      const { items } = await api('/admin/content');
      box.replaceChildren(items.length ? el('div', { style: 'display:grid;gap:12px' }, items.map((a) => el('div', { class: 'ann ' + a.jenis },
        el('div', { style: 'flex:1;min-width:0' }, el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, el('b', { text: a.judul }), SD.StatusBadge(JN[a.jenis][0], JN[a.jenis][1]), a.tampil ? SD.StatusBadge('Tampil', 'ok') : SD.StatusBadge('Disembunyikan', 'mut')),
          el('p', { style: 'color:var(--mt);margin-top:6px;white-space:pre-line', text: a.isi }), el('small', { style: 'color:var(--mt)', text: 'Diperbarui ' + tgl(a.updated_at) })),
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, el('button', { class: 'btn o', onclick: () => form(a, load), text: 'Ubah' }),
          el('button', { class: 'btn o', onclick: async () => { const c = await confirm({ title: 'Hapus pengumuman?', text: a.judul, ok: 'Hapus', danger: true }); if (!c) return; try { await api('/admin/content/' + a.id, { method: 'DELETE' }); toast('Pengumuman dihapus.'); load(); } catch (e) { toast(e.message, true); } }, text: 'Hapus' }))))) :
        SD.EmptyState({ title: 'Belum ada pengumuman', text: 'Pengumuman yang diterbitkan tampil sebagai banner di website publik Visit Sendang Duwur.', action: el('button', { class: 'btn', onclick: () => form(null, load), text: 'Buat pengumuman' }) }));
    };
    await load();
    return el('div', {}, SD.PageHeader({ title: 'Konten Website', desc: 'Kelola pengumuman dan kabar desa yang tampil di website publik.', actions: [el('button', { class: 'btn', onclick: () => form(null, load), text: 'Pengumuman baru' })] }), box);
  };

  /* ---------- Pengaturan admin ---------- */
  A.pengaturan = async () => {
    const s = await api('/admin/system');
    return el('div', {}, SD.PageHeader({ title: 'Pengaturan', desc: 'Tampilan, keamanan akun, dan status layanan situs.' }),
      el('div', { class: 'row2' }, el('div', {}, themeCard(), el('div', { style: 'height:16px' }), accountCard()), passwordCard()),
      el('div', { class: 'row2' },
        el('div', { class: 'card' }, el('h3', { text: 'Status layanan' }), el('ul', { style: 'list-style:none;margin:0;padding:0;display:grid;gap:12px' }, s.layanan.map(([n, on]) => el('li', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center' }, el('span', { text: n }), SD.StatusBadge(on ? 'Aktif' : 'Belum diatur', on ? 'ok' : 'warn')))),
          el('p', { style: 'color:var(--mt);font-size:13px;margin-top:14px', text: 'Layanan diatur lewat Variables di hosting. Nilai rahasia tidak pernah ditampilkan di sini.' })),
        el('div', { class: 'card' }, el('h3', { text: 'Data situs' }), el('dl', { class: 'kv' }, ['Pengguna', 'Usaha', 'Produk', 'Pesanan', 'Pengumuman'].flatMap((k) => [el('dt', { text: k }), el('dd', { text: num(s.data[k.toLowerCase()]) })]),
          el('dt', { text: 'Alamat situs' }), el('dd', { text: s.baseUrl || '(belum diatur)' }), el('dt', { text: 'Versi Node' }), el('dd', { text: s.node })))));
  };
})();
