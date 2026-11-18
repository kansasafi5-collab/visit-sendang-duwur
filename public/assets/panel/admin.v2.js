'use strict';
/* Halaman Panel Admin Desa: Ringkasan, Manajemen UMKM, Verifikasi, Persetujuan Produk, Pengguna, Audit Log. */
(function () {
  const { el, api, rp, tgl, toast, confirm } = SD, P = SD.pages.admin;
  const VR = { verified: ['Terverifikasi', 'ok'], pending: ['Menunggu', 'warn'], rejected: ['Ditolak', 'bad'] };
  const AP = { pending: ['Menunggu', 'warn'], approved: ['Disetujui', 'ok'], rejected: ['Ditolak', 'bad'], disabled: ['Dinonaktifkan', 'bad'] };
  const badge = (m, k) => SD.StatusBadge((m[k] || [k, 'mut'])[0], (m[k] || [k, 'mut'])[1]);
  const sub = (t) => el('div', { style: 'font-size:12.5px;color:var(--mt)', text: t });
  const btn = (text, fn, cls = 'o') => el('button', { class: 'btn ' + cls, text, onclick: fn });
  // Jalankan aksi admin: konfirmasi (+ alasan bila perlu) → API → toast → muat ulang.
  const act = async (cfg, path, body, reload) => {
    const c = await confirm(cfg); if (!c) return;
    try { await api(path, { method: 'PATCH', body: { ...body, alasan: c.reason || '' } }); toast('Tersimpan dan tercatat di audit log.'); reload(); } catch (e) { toast(e.message, true); }
  };
  const listPage = (title, desc, load) => async () => { const box = el('div'); const reload = async () => { box.replaceChildren(await load(reload)); }; await reload(); return el('div', {}, SD.PageHeader({ title, desc }), box); };
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  /* ---------- Ringkasan ---------- */
  P.ringkasan = async () => {
    const s = await api('/admin/summary');
    return el('div', {}, SD.PageHeader({ title: 'Ringkasan', desc: 'Kondisi UMKM Desa Sendang Duwur berdasarkan data yang tersimpan.' }),
      el('div', { class: 'grid' },
        SD.StatCard({ label: 'UMKM terdaftar', value: s.umkm.total }), SD.StatCard({ label: 'UMKM aktif', value: s.umkm.aktif, note: 'Terverifikasi & aktif' }),
        SD.StatCard({ label: 'Menunggu verifikasi', value: s.umkm.menunggu }), SD.StatCard({ label: 'Total produk', value: s.produk.total }),
        SD.StatCard({ label: 'Produk menunggu persetujuan', value: s.produk.menunggu }), SD.StatCard({ label: 'Total pesanan', value: s.pesanan.total, note: s.pesanan.sah + ' tidak dibatalkan' }),
        SD.StatCard({ label: 'Promo aktif', value: s.promoAktif }), SD.StatCard({ label: 'Omzet agregat', value: rp(s.omzet), note: 'Dari pesanan bernilai, tanpa batal' })),
      el('div', { class: 'row2' },
        SD.ChartCard('Pertumbuhan UMKM (pendaftar per bulan)', SD.BarChart(s.tumbuh.map((x) => ({ label: BULAN[+x.bln.slice(5) - 1], value: x.n })))),
        SD.ChartCard('Kategori usaha (aktif)', s.kategori.length ? el('ul', { style: 'margin:0;padding-left:18px' }, s.kategori.map((k) => el('li', { text: `${k.kategori}: ${k.n} usaha` }))) : SD.EmptyState({ title: 'Belum ada usaha aktif' }))),
      SD.ChartCard('Aktivitas terbaru', s.terbaru.length ? el('ul', { style: 'margin:0;padding-left:18px' }, s.terbaru.map((a) => el('li', { text: `${a.name || 'Sistem'} · ${a.aksi} · ${a.objek} · ${tgl(a.created_at)}` }))) : SD.EmptyState({ title: 'Belum ada aktivitas tercatat' })));
  };

  /* ---------- Manajemen UMKM & Verifikasi (satu sumber data, dua tampilan) ---------- */
  const bizRows = (items) => items.map((b) => ({ ...b, vlabel: VR[b.verifikasi][0] }));
  function bizDetail(b, reload) {
    let close;
    const rl = () => { close(); reload(); };
    const acts = [];
    if (b.verifikasi !== 'verified') acts.push(btn('Verifikasi usaha', () => act({ title: 'Verifikasi usaha?', text: `"${b.nama}" akan tampil di marketplace.`, ok: 'Verifikasi' }, `/admin/businesses/${b.id}/verifikasi`, { status: 'verified' }, rl), ''));
    if (b.verifikasi !== 'rejected') acts.push(btn('Tolak', () => act({ title: 'Tolak pendaftaran?', text: 'Alasan akan terlihat oleh pemilik usaha.', ok: 'Tolak', danger: true, reason: true }, `/admin/businesses/${b.id}/verifikasi`, { status: 'rejected' }, rl)));
    acts.push(b.aktif ? btn('Nonaktifkan', () => act({ title: 'Nonaktifkan usaha?', text: 'Usaha tidak tampil di marketplace dan tidak menerima pesanan.', ok: 'Nonaktifkan', danger: true, reason: true }, `/admin/businesses/${b.id}/aktif`, { aktif: false }, rl))
      : btn('Aktifkan kembali', () => act({ title: 'Aktifkan kembali?', ok: 'Aktifkan' }, `/admin/businesses/${b.id}/aktif`, { aktif: true }, rl)));
    const line = (k, v) => el('p', { style: 'margin:4px 0' }, el('b', { text: k + ': ' }), v || '—');
    close = SD.drawer(b.nama, el('div', {}, el('p', { style: 'margin-bottom:10px' }, badge(VR, b.verifikasi), ' ', b.aktif ? null : SD.StatusBadge('Nonaktif', 'bad')),
      line('Pemilik', b.pemilik), line('Kategori', b.kategori), line('Alamat', b.alamat), line('WhatsApp', b.whatsapp), line('Akun', b.email), line('Produk', String(b.produk)), line('Pesanan', String(b.pesanan)), line('Terdaftar', tgl(b.created_at)),
      b.catatan ? line('Alasan penolakan', b.catatan) : null, el('div', { class: 'fb', style: 'margin-top:16px' }, acts)));
  }
  const bizTable = (rows, reload, empty) => SD.DataTable({ rows, onRow: (b) => bizDetail(b, reload), empty,
    cols: [{ key: 'nama', label: 'Usaha', render: (b) => el('div', {}, el('b', { text: b.nama }), sub(b.pemilik)) }, { key: 'kategori', label: 'Kategori' }, { key: 'produk', label: 'Produk' }, { key: 'pesanan', label: 'Pesanan' },
      { key: 'vlabel', label: 'Status', render: (b) => el('span', {}, badge(VR, b.verifikasi), ' ', b.aktif ? null : SD.StatusBadge('Nonaktif', 'bad')) }, { key: 'created_at', label: 'Daftar', render: (b) => tgl(b.created_at) }] });
  P.umkm = listPage('Manajemen UMKM', 'Seluruh usaha terdaftar. Klik baris untuk detail dan tindakan.', async (reload) => bizTable(bizRows((await api('/admin/businesses')).items), reload, { title: 'Belum ada usaha terdaftar' }));
  P.verifikasi = listPage('Verifikasi', 'Antrean pendaftaran usaha yang menunggu keputusan.', async (reload) => bizTable(bizRows((await api('/admin/businesses')).items.filter((b) => b.verifikasi === 'pending')), reload, { title: 'Antrean kosong', text: 'Tidak ada pendaftaran yang menunggu verifikasi.' }));

  /* ---------- Persetujuan produk ---------- */
  P.produk = listPage('Persetujuan Produk', 'Periksa produk UMKM. Menolak atau menonaktifkan wajib disertai alasan.', async (reload) => {
    const { items } = await api('/admin/products');
    return SD.DataTable({ empty: { title: 'Belum ada produk', text: 'Produk muncul setelah UMKM menambahkannya.' }, rows: items.map((p) => ({ ...p, status: AP[p.persetujuan][0] })),
      cols: [{ key: 'nama', label: 'Produk', render: (p) => el('div', {}, el('b', { text: p.nama }), sub(p.usaha + (p.kategori ? ' · ' + p.kategori : '')), p.deskripsi ? sub(p.deskripsi.slice(0, 90)) : null, p.fotos.length ? el('div', { style: 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap' }, p.fotos.map((f) => el('a', { href: '/uploads/' + f, target: '_blank', rel: 'noopener', 'aria-label': 'Buka foto ' + p.nama }, el('img', { src: '/uploads/' + f, alt: 'Foto ' + p.nama, width: 52, height: 52, style: 'object-fit:cover;border-radius:6px;display:block' })))) : sub('Belum ada foto')) },
        { key: 'harga', label: 'Harga', render: (p) => rp(p.harga) }, { key: 'stok', label: 'Stok' },
        { key: 'status', label: 'Status', render: (p) => el('div', {}, badge(AP, p.persetujuan), p.catatan ? sub('Alasan: ' + p.catatan) : null) },
        { key: 'id', label: '', sort: false, render: (p) => el('span', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
          p.persetujuan !== 'approved' ? btn('Setujui', () => act({ title: 'Setujui produk?', text: `"${p.nama}" akan tampil sebagai produk resmi.`, ok: 'Setujui' }, `/admin/products/${p.id}/persetujuan`, { status: 'approved' }, reload), '') : null,
          p.persetujuan === 'pending' ? btn('Tolak', () => act({ title: 'Tolak produk?', text: 'Alasan akan terlihat oleh pemilik.', ok: 'Tolak', danger: true, reason: true }, `/admin/products/${p.id}/persetujuan`, { status: 'rejected' }, reload)) : null,
          p.persetujuan === 'approved' ? btn('Nonaktifkan', () => act({ title: 'Nonaktifkan produk?', text: 'Produk akan disembunyikan dari halaman publik.', ok: 'Nonaktifkan', danger: true, reason: true }, `/admin/products/${p.id}/persetujuan`, { status: 'disabled' }, reload)) : null) }] });
  });

  /* ---------- Pengguna ---------- */
  const ROLE = { user: 'Pengunjung / Warga', umkm: 'Pelaku UMKM', admin: 'Admin Desa' };
  P.pengguna = listPage('Pengguna', 'Akun terdaftar. Menonaktifkan akun langsung mencabut sesi masuknya.', async (reload) => {
    const { items } = await api('/admin/users');
    return SD.DataTable({ empty: { title: 'Belum ada pengguna' }, rows: items.map((u) => ({ ...u, peran: ROLE[u.role], usaha: u.usaha || '' })),
      cols: [{ key: 'name', label: 'Nama', render: (u) => el('div', {}, el('b', { text: u.name }), sub(u.email)) }, { key: 'peran', label: 'Jenis akun' }, { key: 'usaha', label: 'Usaha', render: (u) => u.usaha || '—' },
        { key: 'aktif', label: 'Status', render: (u) => SD.StatusBadge(u.aktif ? 'Aktif' : 'Nonaktif', u.aktif ? 'ok' : 'bad') }, { key: 'created_at', label: 'Daftar', render: (u) => tgl(u.created_at) },
        { key: 'id', label: '', sort: false, render: (u) => u.role === 'admin' || u.id === SD.me.user.id ? null : u.aktif
          ? btn('Nonaktifkan', () => act({ title: 'Nonaktifkan akun?', text: `${u.email} tidak dapat masuk lagi.`, ok: 'Nonaktifkan', danger: true, reason: true }, `/admin/users/${u.id}/aktif`, { aktif: false }, reload))
          : btn('Aktifkan', () => act({ title: 'Aktifkan akun?', ok: 'Aktifkan' }, `/admin/users/${u.id}/aktif`, { aktif: true }, reload)) }] });
  });

  /* ---------- Audit log ---------- */
  P.audit = listPage('Audit Log', 'Jejak perubahan penting: siapa, apa, kapan, dan alasannya.', async () => {
    const { items } = await api('/admin/audit');
    return SD.DataTable({ pageSize: 15, empty: { title: 'Belum ada aktivitas tercatat', text: 'Persetujuan, penolakan, dan perubahan data akan tercatat di sini.' }, rows: items.map((a) => ({ ...a, pelaku: a.name || 'Sistem' })),
      cols: [{ key: 'created_at', label: 'Waktu', render: (a) => tgl(a.created_at) }, { key: 'pelaku', label: 'Pelaku' }, { key: 'aksi', label: 'Aksi' }, { key: 'objek', label: 'Objek' }, { key: 'alasan', label: 'Alasan', render: (a) => a.alasan || '—' }] });
  });

  /* ---------- Monitoring promo ---------- */
  const PS = { aktif: ['Aktif', 'ok'], terjadwal: ['Terjadwal', 'warn'], berakhir: ['Berakhir', 'mut'], nonaktif: ['Nonaktif', 'mut'], habis: ['Kuota habis', 'warn'], dinonaktifkan_admin: ['Dinonaktifkan admin', 'bad'] };
  P.promo = listPage('Monitoring Promo', 'Seluruh promo UMKM. Admin hanya dapat menonaktifkan promo yang melanggar ketentuan (wajib beralasan); harga dan isi promo tidak diubah.', async (reload) => {
    const { items } = await api('/admin/promos');
    return SD.DataTable({ empty: { title: 'Belum ada promo', text: 'Promo muncul setelah UMKM membuatnya.' }, rows: items.map((p) => ({ ...p, slabel: PS[p.status][0], label: p.tipe === 'persen' ? p.nilai + '%' : rp(p.nilai) })),
      cols: [{ key: 'nama', label: 'Promo', render: (p) => el('div', {}, el('b', { text: p.nama }), sub(p.usaha + ' · diskon ' + p.label + (p.min_belanja ? ' · min. ' + rp(p.min_belanja) : ''))) },
        { key: 'mulai', label: 'Periode', render: (p) => `${p.mulai} s/d ${p.selesai}` }, { key: 'kode', label: 'Voucher', render: (p) => p.kode || 'Otomatis' }, { key: 'dipakai', label: 'Dipakai', render: (p) => p.dipakai + (p.batas_pakai ? ' / ' + p.batas_pakai : '') },
        { key: 'slabel', label: 'Status', render: (p) => el('div', {}, badge(PS, p.status), p.catatan_admin ? sub('Alasan: ' + p.catatan_admin) : null) },
        { key: 'id', label: '', sort: false, render: (p) => p.dinonaktifkan_admin
          ? btn('Pulihkan', () => act({ title: 'Pulihkan promo?', ok: 'Pulihkan' }, `/admin/promos/${p.id}/aktif`, { aktif: true }, reload))
          : btn('Nonaktifkan', () => act({ title: 'Nonaktifkan promo?', text: 'Promo berhenti berlaku dan tidak dapat diaktifkan UMKM sampai dipulihkan.', ok: 'Nonaktifkan', danger: true, reason: true }, `/admin/promos/${p.id}/aktif`, { aktif: false }, reload)) }] });
  });

  /* ---------- AI Village Analytics ---------- */
  const arrow = (v) => (v == null ? 'belum ada pembanding' : (v > 0 ? '▲ +' : v < 0 ? '▼ ' : '● ') + v.toFixed(0) + '%');
  const hbar = (rows, fmt, empty) => (rows.length ? el('div', {}, rows.map((r) => el('div', { style: 'margin:8px 0' },
    el('div', { style: 'display:flex;justify-content:space-between;gap:10px;font-size:13.5px' }, el('span', { text: r.label }), el('span', { text: fmt(r) })),
    el('div', { style: 'height:8px;background:var(--ln);border-radius:4px;margin-top:3px' }, el('div', { style: `height:8px;border-radius:4px;background:var(--role);width:${Math.max(2, Math.round((r.v / Math.max(...rows.map((x) => x.v), 1)) * 100))}%` }))))) : el('p', { style: 'color:var(--mt)', text: empty }));
  const ul = (items, empty) => (items.length ? el('ul', { style: 'margin:0;padding-left:18px' }, items) : el('p', { style: 'color:var(--mt)', text: empty }));
  const aiCard = (a) => el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', { text: 'Ringkasan & rekomendasi AI' }),
    a.tersedia ? el('div', {}, a.teks.split(/\n+/).filter(Boolean).map((t) => el('p', { style: 'margin:0 0 8px', text: t })), el('p', { style: 'color:var(--mt);font-size:12.5px', text: 'Rekomendasi AI adalah masukan untuk dipertimbangkan, bukan keputusan. Periksa kembali dengan data dan kondisi lapangan.' })) : el('p', { style: 'color:var(--mt)', role: 'status', text: a.alasan }));

  P.ai = async () => {
    const out = el('div'), sel = el('select', { class: 'sel', 'aria-label': 'Periode analisis' }, [30, 90, 180].map((n) => el('option', { value: n, text: n + ' hari terakhir' })));
    const go = el('button', { class: 'btn', text: 'Analisis' });
    const show = ({ data: d, ai }) => {
      const o = d.omzet, L = d.lokasi;
      out.replaceChildren(el('div', {},
        el('p', { style: 'color:var(--mt);font-size:13px;margin:14px 0', text: `Periode ${d.periode.dari} s/d ${d.periode.sampai}. Sumber: ${d.sumber}` }),
        d.penjualanCukup ? null : el('div', { class: 'card', role: 'status', style: 'margin-bottom:14px;border-left:4px solid var(--warn)', text: 'Data penjualan pada periode ini belum cukup (kurang dari 5 pesanan bernilai), sehingga tren penjualan tidak disimpulkan. Gambaran jumlah dan sebaran UMKM tetap ditampilkan.' }),
        el('div', { class: 'grid' }, SD.StatCard({ label: 'UMKM aktif', value: d.umkm.aktif, note: `${d.umkm.awalImporAdmin} data awal/admin · ${d.umkm.aktif - d.umkm.awalImporAdmin} mendaftar mandiri` }), SD.StatCard({ label: 'Menunggu verifikasi', value: d.umkm.menungguVerifikasi }),
          SD.StatCard({ label: 'Omzet agregat', value: rp(o.sekarang.omzet), note: d.pembandingCukup ? `${arrow(o.perubahanPersen)} vs periode sebelumnya (${rp(o.sebelumnya.omzet)})` : 'Pembanding belum cukup' }), SD.StatCard({ label: 'Pesanan bernilai', value: o.sekarang.pesanan, note: `Sebelumnya ${o.sebelumnya.pesanan}` }), SD.StatCard({ label: 'UMKM yang berjualan', value: o.sekarang.usaha })),
        el('div', { class: 'row2' }, SD.ChartCard('Perkembangan omzet agregat', SD.BarChart(o.seri, rp)),
          SD.ChartCard('Pertumbuhan UMKM (pendaftar mandiri per bulan)', el('div', {}, SD.BarChart(d.umkm.pendaftarMandiriPerBulan.map((x) => ({ label: BULAN[+x.bln.slice(5) - 1], value: x.n }))), el('p', { style: 'color:var(--mt);font-size:12.5px;margin-top:8px', text: `Usaha awal hasil impor/admin (${d.umkm.awalImporAdmin}) tercatat pada tanggal impor, jadi tidak dimasukkan ke grafik pertumbuhan.` })))),
        el('div', { class: 'row2' }, SD.ChartCard('Kategori usaha dominan', hbar(d.kategori.map((k) => ({ label: k.kategori, v: k.usaha, omzet: k.omzet })), (r) => `${r.v} usaha · omzet ${rp(r.omzet)}`, 'Belum ada usaha aktif.')),
          SD.ChartCard('Produk unggulan', ul(d.produkUnggulan.map((x) => el('li', { text: `${x.nama}: ${x.qty} terjual (${x.usaha} usaha)` })), 'Belum ada penjualan pada periode ini.'))),
        el('div', { class: 'row2' }, SD.ChartCard('Penjualan tumbuh tertinggi', ul(d.umkmNaik.map((x) => el('li', { text: `${x.nama} (${x.kategori}): ${arrow(x.persen)}, ${x.pesananSekarang} pesanan vs ${x.pesananSebelumnya}` })), 'Belum ada UMKM yang memenuhi syarat (punya pembanding dan minimal 3 pesanan).')),
          SD.ChartCard('Penjualan menurun', ul(d.umkmTurun.map((x) => el('li', { text: `${x.nama} (${x.kategori}): ${arrow(x.persen)}, ${x.pesananSekarang} pesanan vs ${x.pesananSebelumnya}` })), 'Belum ada UMKM yang memenuhi syarat atau yang menurun.'))),
        el('div', { class: 'row2' }, SD.ChartCard('Efektivitas promo', el('div', {}, d.promo.pemakaian ? el('p', { text: `${d.promo.promo} promo dipakai ${d.promo.pemakaian}× dengan total potongan ${rp(d.promo.potongan)}.` }) : el('p', { style: 'color:var(--mt)', text: 'Belum ada pesanan yang memakai promo pada periode ini.' }),
            d.promo.bisaDibandingkan ? el('p', { style: 'margin-top:6px', text: `Rata-rata nilai pesanan: dengan promo ${rp(d.promo.rataDenganPromo.rata)} (${d.promo.rataDenganPromo.n} pesanan), tanpa promo ${rp(d.promo.rataTanpaPromo.rata)} (${d.promo.rataTanpaPromo.n} pesanan). Ini perbandingan, bukan bukti sebab-akibat.` }) : el('p', { style: 'margin-top:6px;color:var(--mt)', text: 'Dampak promo belum dapat dinilai: perlu minimal 3 pesanan dengan promo dan 3 tanpa promo.' }))),
          SD.ChartCard('Persebaran UMKM per RW', el('div', {}, hbar(L.perRw.map((x) => ({ label: x.label, v: x.n })), (r) => r.v + ' usaha', 'Belum ada alamat yang memuat RW.'), el('p', { style: 'color:var(--mt);font-size:12.5px;margin-top:8px', text: `${L.total - L.tanpaRw} dari ${L.total} usaha aktif memiliki alamat dengan RW. Sisanya belum dapat dipetakan.` })))),
        aiCard(ai)));
    };
    go.onclick = async () => { go.disabled = true; out.replaceChildren(SD.Skeleton(3)); try { show(await api('/admin/ai/analisis', { method: 'POST', body: { hari: sel.value } })); } catch (e) { out.replaceChildren(SD.ErrorState(e, go.onclick)); } finally { go.disabled = false; } };

    // Panel tanya AI: jawaban hanya dari data agregat; periode dan sumber ikut ditampilkan.
    const log = el('div', { 'aria-live': 'polite', style: 'display:flex;flex-direction:column;gap:8px;margin:10px 0' });
    const q = el('input', { class: 'sel', style: 'flex:1;min-width:0', maxlength: 400, 'aria-label': 'Pertanyaan untuk AI', placeholder: 'Mis. kategori usaha apa yang paling dominan?' });
    const say = (who, t, meta) => log.append(el('div', { style: 'padding:8px 12px;border-radius:8px;max-width:92%;' + (who === 'u' ? 'align-self:flex-end;background:var(--gd);color:#151515' : 'align-self:flex-start;background:var(--bg);border:1px solid var(--ln)') }, t, meta ? el('div', { style: 'color:var(--mt);font-size:12px;margin-top:4px', text: meta }) : null));
    const ask = el('button', { class: 'btn', text: 'Tanya' });
    const kirim = async () => {
      const t = q.value.trim(); if (t.length < 3) return; q.value = ''; say('u', t); ask.disabled = true;
      try { const r = await api('/admin/ai/tanya', { method: 'POST', body: { pertanyaan: t, hari: sel.value } }); say('b', r.jawaban, `Periode ${r.periode.dari} s/d ${r.periode.sampai} · data agregat dari database desa`); }
      catch (e) { say('b', e.message); } finally { ask.disabled = false; q.focus(); }
    };
    ask.onclick = kirim; q.onkeydown = (e) => e.key === 'Enter' && kirim();
    return el('div', {}, SD.PageHeader({ title: 'AI Village Analytics', desc: 'Analisis perkembangan ekonomi UMKM Desa Sendang Duwur dari data agregat. Rekomendasi AI hanya masukan, bukan keputusan.' }),
      el('div', { class: 'card' }, el('div', { class: 'fb', style: 'margin:0' }, sel, go)), out,
      el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', { text: 'Tanya AI' }), el('p', { style: 'color:var(--mt);font-size:13px', text: 'Contoh: "Apakah omzet UMKM meningkat dibanding periode sebelumnya?", "UMKM mana yang menurun?", "Program apa yang sebaiknya diprioritaskan?". Memakai periode yang dipilih di atas.' }), log, el('div', { style: 'display:flex;gap:8px' }, q, ask)));
  };
})();
