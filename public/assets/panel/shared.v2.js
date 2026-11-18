'use strict';
/* Fondasi frontend bersama Panel UMKM & Panel Admin Desa.
   Semua teks dari server dimasukkan lewat textContent (tidak ada innerHTML dari data pengguna).
   Akses data sebenarnya divalidasi di server; menu di sini hanya navigasi. */
(function () {
  const SD = (window.SD = { pages: { umkm: {}, admin: {} } });

  /* ---------- util ---------- */
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  SD.el = el;
  SD.rp = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  SD.tgl = (s) => { const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('T') ? '' : 'Z')); return isNaN(d) ? '' : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }); };

  SD.api = async (path, opt = {}) => {
    const o = { method: opt.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opt.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
    let r;
    try { r = await fetch('/api/panel' + path, o); } catch { throw Object.assign(new Error('Tidak dapat terhubung ke server.'), { net: true }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Terjadi kesalahan.'), { status: r.status, fields: j.fields });
    return j;
  };

  /* ---------- komponen bersama ---------- */
  let toasts;
  SD.toast = (msg, bad) => {
    toasts = toasts || document.body.appendChild(el('div', { class: 'toasts', role: 'status' }));
    const t = toasts.appendChild(el('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg }));
    setTimeout(() => t.remove(), 4500);
  };
  SD.StatCard = ({ label, value, note }) => el('div', { class: 'card stat' }, el('div', { class: 'v', text: value }), el('div', { class: 'l', text: label }), note && el('div', { class: 'd', text: note }));
  /* Ikon garis (statis, bukan data pengguna). Kunci = kunci menu. */
  const IC = {
    ringkasan: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    produk: '<path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    pesanan: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    promo: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor"/>',
    inventaris: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    laporan: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    ai: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>',
    profil: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9M9 20v-6h6v6M3 9h18"/>',
    umkm: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9M9 20v-6h6v6M3 9h18"/>',
    verifikasi: '<circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    pengguna: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    konten: '<path d="m3 11 18-5v12L3 14z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    audit: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    pengaturan: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  };
  SD.icon = (k) => { const n = el('span', { class: 'ic', 'aria-hidden': 'true' }); n.innerHTML = '<svg viewBox="0 0 24 24">' + (IC[k] || IC.ringkasan) + '</svg>'; return n; };

  SD.StatusBadge = (text, tone = 'mut') => el('span', { class: 'sb ' + tone, text });
  SD.EmptyState = ({ title, text, action }) => el('div', { class: 'empty' }, el('h3', { text: title }), text && el('p', { text }), action && el('button', { class: 'btn', onclick: action.onClick, text: action.label }));
  SD.ErrorState = (err, retry) => el('div', { class: 'empty', role: 'alert' }, el('h3', { text: 'Data belum dapat dimuat' }), el('p', { text: err.message }), retry && el('button', { class: 'btn o', onclick: retry, text: 'Coba lagi' }));
  SD.Skeleton = (n = 3) => el('div', { class: 'grid' }, Array.from({ length: n }, () => el('div', { class: 'sk', style: 'height:96px' })));
  SD.PageHeader = ({ title, desc, actions }) => el('div', { class: 'ph' }, el('div', {}, el('h1', { text: title }), desc && el('p', { text: desc })), el('div', { class: 'fb', style: 'margin:0' }, actions || []));
  SD.ChartCard = (title, body) => el('div', { class: 'card ch' }, el('h3', { text: title }), body);

  // Grafik batang SVG sederhana. data: [{label, value}]. Tidak ada data → EmptyState (tidak pernah angka contoh).
  SD.BarChart = (data, fmt = (v) => String(v)) => {
    if (!data || !data.length || data.every((d) => !d.value)) return SD.EmptyState({ title: 'Belum ada data', text: 'Grafik muncul setelah ada data nyata pada periode ini.' });
    const W = 520, H = 200, P = 28, max = Math.max(...data.map((d) => d.value)), bw = (W - P * 2) / data.length;
    const ns = 'http://www.w3.org/2000/svg', mk = (t, a) => { const n = document.createElementNS(ns, t); for (const k in a) n.setAttribute(k, a[k]); return n; };
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bc', role: 'img', 'aria-label': 'Grafik batang: ' + data.map((d) => d.label + ' ' + fmt(d.value)).join(', ') });
    const defs = mk('defs', {}), lg = mk('linearGradient', { id: 'gbar', x1: 0, y1: 0, x2: 0, y2: 1 });
    [['0', '#d9a73a'], ['1', 'currentColor']].forEach(([o, c]) => lg.append(mk('stop', { offset: o, 'stop-color': c, style: c === 'currentColor' ? 'stop-color:var(--role)' : null })));
    defs.append(lg); svg.append(defs);
    svg.append(mk('line', { x1: P, x2: W - P, y1: H - P, y2: H - P, class: 'gl' }));
    data.forEach((d, i) => {
      const h = (d.value / max) * (H - P * 2), w = Math.min(bw * 0.7, 56), x = P + i * bw + (bw - w) / 2;
      svg.append(mk('rect', { x, y: H - P - h, width: w, height: h, class: 'bar', rx: 5 }));
      const t = mk('text', { x: x + w / 2, y: H - 10, 'text-anchor': 'middle', class: 'ax' }); t.textContent = d.label; svg.append(t);
      const v = mk('text', { x: x + w / 2, y: H - P - h - 5, 'text-anchor': 'middle', class: 'ax' }); v.textContent = fmt(d.value); svg.append(v);
    });
    return svg;
  };

  // DataTable: cari, urut, paginasi. cols: [{key,label,render?,sort?}]
  SD.DataTable = ({ cols, rows, pageSize = 10, empty, onRow }) => {
    const wrap = el('div'); let q = '', sortKey = null, dir = 1, page = 0;
    const search = el('input', { class: 'sel', type: 'search', placeholder: 'Cari…', 'aria-label': 'Cari di tabel', oninput: (e) => { q = e.target.value.toLowerCase(); page = 0; draw(); } });
    const body = el('div');
    wrap.append(el('div', { class: 'fb' }, search), body);
    function draw() {
      let r = rows.filter((x) => !q || cols.some((c) => String(x[c.key] ?? '').toLowerCase().includes(q)));
      if (sortKey) r = [...r].sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * dir);
      const pages = Math.max(1, Math.ceil(r.length / pageSize)); page = Math.min(page, pages - 1);
      body.replaceChildren();
      if (!r.length) return body.append(SD.EmptyState(empty || { title: q ? 'Tidak ada hasil' : 'Belum ada data' }));
      const head = el('tr', {}, cols.map((c) => el('th', { 'data-s': c.sort === false ? null : 1, 'aria-sort': sortKey === c.key ? (dir > 0 ? 'ascending' : 'descending') : null, onclick: c.sort === false ? null : () => { dir = sortKey === c.key ? -dir : 1; sortKey = c.key; draw(); }, text: c.label })));
      const trs = r.slice(page * pageSize, page * pageSize + pageSize).map((x) => el('tr', { style: onRow ? 'cursor:pointer' : null, onclick: onRow ? () => onRow(x) : null }, cols.map((c) => el('td', {}, c.render ? c.render(x) : String(x[c.key] ?? '')))));
      body.append(el('div', { class: 'tw' }, el('table', {}, el('thead', {}, head), el('tbody', {}, trs))),
        el('div', { class: 'pgn' }, el('span', { text: `${r.length} data · halaman ${page + 1}/${pages}` }), el('span', {},
          el('button', { class: 'btn o', disabled: page === 0, onclick: () => { page--; draw(); }, text: '‹' }), ' ',
          el('button', { class: 'btn o', disabled: page >= pages - 1, onclick: () => { page++; draw(); }, text: '›' }))));
    }
    draw(); return wrap;
  };

  // Modal konfirmasi. reason:true → alasan wajib (dipakai Admin untuk tolak/nonaktifkan).
  SD.confirm = ({ title, text, ok = 'Ya, lanjutkan', danger, reason }) => new Promise((resolve) => {
    const ta = reason ? el('textarea', { rows: 3, 'aria-label': 'Alasan', placeholder: 'Tulis alasan (wajib)' }) : null;
    const err = el('div', { class: 'fld' }, el('span', { class: 'err' }));
    const done = (v) => { ov.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = (e) => e.key === 'Escape' && done(null);
    const okBtn = el('button', { class: 'btn' + (danger ? ' danger' : ''), text: ok, onclick: () => {
      if (reason && ta.value.trim().length < 5) { err.firstChild.textContent = 'Alasan minimal 5 karakter.'; return ta.focus(); }
      done(reason ? { reason: ta.value.trim() } : {});
    } });
    const ov = el('div', { class: 'ov', onclick: (e) => e.target === ov && done(null) }, el('div', { class: 'md', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('h3', { text: title }), text && el('p', { text, style: 'color:var(--mt)' }), ta && el('div', { class: 'fld', style: 'margin-top:12px' }, ta), ta && err,
      el('div', { class: 'act' }, el('button', { class: 'btn o', onclick: () => done(null), text: 'Batal' }), okBtn)));
    document.addEventListener('keydown', esc); document.body.append(ov); (ta || okBtn).focus();
  });
  SD.drawer = (title, content) => {
    const close = () => { ov.remove(); dr.remove(); };
    const ov = el('div', { class: 'ov', style: 'place-items:stretch', onclick: close });
    const dr = el('aside', { class: 'dr', role: 'dialog', 'aria-label': title }, el('div', { class: 'ph' }, el('h2', { text: title }), el('button', { class: 'btn o', onclick: close, text: 'Tutup' })), content);
    document.body.append(ov, dr); return close;
  };
  // Field form dengan label, hint, dan pesan galat per kolom (cocok dengan {fields} dari server).
  SD.Field = ({ id, label, type = 'text', hint, error, ...rest }) => el('div', { class: 'fld' },
    el('label', { for: id, text: label }),
    el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input', { id, name: id, type: ['textarea', 'select'].includes(type) ? null : type, ...rest }),
    hint && el('span', { class: 'hint', text: hint }), el('span', { class: 'err', text: error || '' }));

  /* ---------- konfigurasi menu per role (satu DashboardLayout, bukan dua salinan) ---------- */
  SD.MENU = {
    umkm: [['ringkasan', 'Ringkasan', '◧'], ['produk', 'Produk', '▤'], ['pesanan', 'Pesanan', '✉'], ['promo', 'Promo & Diskon', '％'], ['inventaris', 'Inventaris', '▦'], ['laporan', 'Laporan', '▥'], ['ai', 'AI Business Intelligence', '✦'], ['profil', 'Profil Toko', '⌂'], ['pengaturan', 'Pengaturan', '⚙']],
    admin: [['ringkasan', 'Ringkasan', '◧'], ['umkm', 'Manajemen UMKM', '▤'], ['verifikasi', 'Verifikasi', '✓'], ['produk', 'Persetujuan Produk', '▦'], ['promo', 'Monitoring Promo', '％'], ['pengguna', 'Pengguna', '☺'], ['konten', 'Konten Website', '✎'], ['laporan', 'Laporan', '▥'], ['ai', 'AI Village Analytics', '✦'], ['audit', 'Audit Log', '☰'], ['pengaturan', 'Pengaturan', '⚙']],
  };

  /* ---------- DashboardLayout ---------- */
  SD.boot = async (root, role) => {
    if (!SD.MENU[role]) return root.append(SD.EmptyState({ title: 'Panel tidak dikenal' }));
    root.append(SD.Skeleton(3));
    let me;
    try { me = await SD.api('/me'); } catch (e) {
      if (e.status === 401) return (location.href = '/login/' + role + '?next=' + encodeURIComponent(location.pathname));
      return root.replaceChildren(SD.ErrorState(e, () => location.reload()));
    }
    if (me.user.role !== role) return root.replaceChildren(SD.EmptyState({ title: 'Akses ditolak', text: 'Akun ini tidak berhak membuka panel tersebut.' }));
    SD.me = me; document.documentElement.classList.add('role-' + role); document.body.classList.add('role-' + role);
    const base = '/panel/' + role, menu = SD.MENU[role];
    const keyOf = () => location.pathname.slice(base.length).replace(/^\/|\/$/g, '') || 'ringkasan';
    const nav = el('nav', { class: 'nav', 'aria-label': 'Menu ' + me.label });
    const title = el('span', { class: 'sr' }); const content = el('div', { class: 'pg', id: 'konten', tabindex: '-1' });
    const shell = el('div', { class: 'shell' });
    const toggle = () => (matchMedia('(max-width:860px)').matches ? shell.classList.toggle('open') : shell.classList.toggle('mini'));
    const ini = (me.user.name || '?').trim().charAt(0).toUpperCase();
    const out = async (e) => { e.preventDefault(); await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/'; };
    const side = el('aside', { class: 'side' }, el('a', { class: 'brand', href: '/', 'aria-label': 'Visit Sendang Duwur, ke situs publik' }, el('img', { src: '/assets/logo.png', alt: 'Visit Sendang Duwur', width: 240, height: 172 }), el('img', { class: 'em', src: '/assets/favicon.png', alt: '' }), el('small', { text: me.label })), nav,
      el('div', { class: 'who' }, el('span', { class: 'av', 'aria-hidden': 'true', text: ini }), el('b', { text: me.business ? me.business.nama : me.user.name }), el('span', { class: 'em2', text: me.user.email }),
        el('div', { class: 'ln' }, el('span', { class: 'badge-role', text: me.badge }), el('a', { href: '/', text: 'Situs publik' }), el('a', { href: '#', text: 'Keluar', onclick: out }))));
    const top = el('header', { class: 'top' }, el('button', { class: 'ib', 'aria-label': 'Buka/tutup menu', onclick: toggle, text: '☰' }), el('span', { class: 'ctx', text: me.label }), el('div', { class: 'sp' }),
      el('input', { class: 'search', type: 'search', 'aria-label': 'Cari menu', placeholder: 'Cari menu…', oninput: (e) => { const q = e.target.value.toLowerCase(); nav.querySelectorAll('a').forEach((a) => (a.style.display = a.textContent.toLowerCase().includes(q) ? '' : 'none')); } }), title);
    shell.append(side, el('div', { class: 'scrim', onclick: toggle }), el('div', { class: 'main' }, top, content));
    root.replaceChildren(shell);

    const jump = (k) => (e) => { e.preventDefault(); history.pushState(null, '', base + (k === 'ringkasan' ? '' : '/' + k)); go(k); };
    const hero = () => {
      const h = new Date().getHours(), sapa = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
      const nm = (me.user.name || '').split(' ')[0], tg = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const act = role === 'umkm' ? [['produk', 'Tambah produk', 1], ['pesanan', 'Lihat pesanan'], ['promo', 'Buat promo']] : [['verifikasi', 'Verifikasi usaha', 1], ['produk', 'Persetujuan produk'], ['konten', 'Kelola pengumuman']];
      return el('div', { class: 'greet' }, el('div', {}, el('div', { class: 'k', text: tg }), el('div', { class: 'sapa', text: sapa + ', ' + nm })),
        el('div', { class: 'qa' }, act.map(([k, t, main]) => el('a', { class: 'btn' + (main ? '' : ' o'), href: base + '/' + k, onclick: jump(k), text: t }))));
    };

    async function go(k) {
      const m = menu.find((x) => x[0] === k) || menu[0];
      nav.querySelectorAll('a').forEach((a) => (a.dataset.k === m[0] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
      document.title = m[1] + ' · ' + me.label; shell.classList.remove('open');
      content.replaceChildren(SD.Skeleton(3));
      const page = SD.pages[role][m[0]];
      try {
        const node = page ? await page({ me, role }) : SD.EmptyState({ title: m[1], text: 'Modul ini belum dibangun. Akan tersedia pada tahap pengerjaan berikutnya, dan tidak menampilkan data contoh.' });
        content.replaceChildren(m[0] === 'ringkasan' ? hero() : '', node);
      } catch (e) { content.replaceChildren(SD.ErrorState(e, () => go(m[0]))); }
      content.focus({ preventScroll: true });
    }
    menu.forEach(([k, label, ic]) => nav.append(el('a', { href: base + (k === 'ringkasan' ? '' : '/' + k), 'data-k': k, onclick: (e) => { e.preventDefault(); history.pushState(null, '', e.currentTarget.getAttribute('href')); go(k); } }, SD.icon(k), el('span', { class: 'lb', text: label }))));
    addEventListener('popstate', () => go(keyOf()));
    go(keyOf());
  };
})();
