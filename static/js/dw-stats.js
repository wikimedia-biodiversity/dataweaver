/*!
 * Commons Data Weaver — statistics page (?stats&category=Name, or the ▤ Statistics button).
 * Copyright (C) 2026 Manoj Karingamadathil. License: GPL-3.0-or-later.
 *
 * Works on the files already loaded by the tool (DW.core.S.recs): no extra requests except map tiles.
 * Charts are plain SVG (no library); every chart can be downloaded as PNG or SVG with its title and
 * details, as CSV data, or viewed as a table.
 */
(function () {
  'use strict';
  const DW = window.DW = window.DW || {};

  /* ------------------------------------------------------------------ colours (single hue; values validated against the white chart surface) */
  const C = { bar: '#2a78d6', barHi: '#256abf', wash: 'rgba(42,120,214,0.10)', grid: '#e6e5e1', axis: '#c9c8c2', text: '#0b0b0b', text2: '#52514e', muted: '#6b6a65', surface: '#ffffff' };
  /* categorical slots in fixed order (validated); "Other" is neutral grey. Slices also get a surface gap and legend labels (relief rule). */
  const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'], OTHER = '#9a9893', RAMP = ['#e6f0fc', '#104281'];
  const NS = 'http://www.w3.org/2000/svg';
  const FONT = '"Segoe UI",system-ui,-apple-system,sans-serif';
  const pad = n => String(n).padStart(2, '0');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const NF = new Intl.NumberFormat();
  const fmtN = n => NF.format(Math.round(n));
  const fmtK = n => n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K' : fmtN(n);
  const fmtBytes = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : Math.round(b) + ' B';

  /* ------------------------------------------------------------------ calculation (pure: easy to test) */
  const H1 = 3600e3, D1 = 24 * H1;
  const shifted = (ts, off) => new Date(ts + off * 60000);
  const dateStr = (ts, off) => { const d = shifted(ts, off); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };

  function floorTo(sh, unit) {
    const d = new Date(sh), y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
    if (unit === 'hour') return Date.UTC(y, m, dd, d.getUTCHours());
    if (unit === 'day') return Date.UTC(y, m, dd);
    if (unit === 'week') return Date.UTC(y, m, dd) - ((d.getUTCDay() + 6) % 7) * D1; // Monday
    if (unit === 'month') return Date.UTC(y, m, 1);
    return Date.UTC(y, 0, 1);
  }
  function nextOf(start, unit) {
    const d = new Date(start);
    if (unit === 'hour') return start + H1;
    if (unit === 'day') return start + D1;
    if (unit === 'week') return start + 7 * D1;
    if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  }
  function bucketLabel(start, unit) {
    const d = new Date(start), dd = pad(d.getUTCDate()), mon = MON[d.getUTCMonth()], y = d.getUTCFullYear();
    return unit === 'hour' ? dd + ' ' + mon + ' ' + pad(d.getUTCHours()) + ':00' : unit === 'day' ? dd + ' ' + mon + ' ' + y
      : unit === 'week' ? 'week of ' + dd + ' ' + mon + ' ' + y : unit === 'month' ? mon + ' ' + y : String(y);
  }
  /** Upload activity: the unit (hour, day, week, month, year) is the finest one that fits in maxBuckets bars. */
  function activity(times, off, maxBuckets) {
    if (!times.length) return { unit: 'day', buckets: [] };
    const lo = Math.min.apply(null, times), hi = Math.max.apply(null, times), span = hi - lo;
    const need = { hour: span / H1 + 1, day: span / D1 + 1, week: span / (7 * D1) + 1, month: span / (30.44 * D1) + 1, year: span / (365.25 * D1) + 1 };
    const unit = ['hour', 'day', 'week', 'month'].find(u => need[u] <= maxBuckets) || 'year';
    const counts = new Map();
    times.forEach(t => { const k = floorTo(t + off * 60000, unit); counts.set(k, (counts.get(k) || 0) + 1); });
    const buckets = [], end = floorTo(hi + off * 60000, unit);
    for (let k = floorTo(lo + off * 60000, unit), guard = 0; k <= end && guard < 5000; k = nextOf(k, unit), guard++) buckets.push({ start: k, label: bucketLabel(k, unit), value: counts.get(k) || 0 });
    return { unit, buckets };
  }
  function binned(values, edges, labels) {
    const out = labels.map(l => ({ label: l, value: 0 }));
    values.forEach(v => { let i = edges.findIndex(e => v < e); if (i < 0) i = edges.length; out[i].value++; });
    let a = 0, b = out.length - 1; while (a < b && !out[a].value) a++; while (b > a && !out[b].value) b--;
    return out.slice(a, b + 1);
  }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);

  function compute(recs, off, maxBuckets) {
    const users = new Map(), cams = new Map(), days = new Map(), exts = new Map(), hours = new Array(24).fill(0), weekdays = new Array(7).fill(0), heat = Array.from({ length: 7 }, () => new Array(24).fill(0)), times = [];
    let bytes = 0, geo = 0, depStmts = 0, depFiles = 0, noCam = 0, big = null, small = null;
    recs.forEach(r => {
      const u = r.uploader || '(unknown)', t = Date.parse(r.upload);
      let e = users.get(u); if (!e) users.set(u, e = { user: u, files: 0, bytes: 0, first: null, last: null, geo: 0, depFiles: 0, depStmts: 0 });
      e.files++; e.bytes += r.bytes || 0; bytes += r.bytes || 0;
      if (r.lat != null) { geo++; e.geo++; }
      const nd = (r.depicts || []).length; if (nd) { depFiles++; e.depFiles++; } depStmts += nd; e.depStmts += nd;
      if (!isNaN(t)) {
        times.push(t); if (e.first == null || t < e.first) e.first = t; if (e.last == null || t > e.last) e.last = t;
        const d = dateStr(t, off); days.set(d, (days.get(d) || 0) + 1); const sd = shifted(t, off), wd = (sd.getUTCDay() + 6) % 7, hr = sd.getUTCHours(); hours[hr]++; weekdays[wd]++; heat[wd][hr]++;
      }
      const xm = /\.([A-Za-z0-9]+)$/.exec(r.name || ''), xe = xm ? ({ JPG: 'JPEG', TIF: 'TIFF' }[xm[1].toUpperCase()] || xm[1].toUpperCase()) : 'Unknown'; exts.set(xe, (exts.get(xe) || 0) + 1);
      if (r.camera) cams.set(r.camera, (cams.get(r.camera) || 0) + 1); else noCam++;
      if (r.bytes) { if (!big || r.bytes > big.bytes) big = r; if (!small || r.bytes < small.bytes) small = r; }
    });
    const perUser = [...users.values()].sort((a, b) => b.files - a.files || a.user.localeCompare(b.user));
    const n = recs.length, mb = recs.map(r => (r.bytes || 0) / 1048576);
    return {
      n, contributors: users.size, bytes, avg: n ? bytes / n : 0, big, small, geo, depStmts, depFiles, noCam, perUser,
      first: times.length ? Math.min.apply(null, times) : null, last: times.length ? Math.max.apply(null, times) : null,
      activity: activity(times, off, maxBuckets),
      topUsers: perUser.slice(0, 10).map(u => [u.user, u.files]), topCams: top(cams, 10), topDays: top(days, 10),
      usersAll: perUser.map(u => [u.user, u.files]), camsAll: top(cams, Infinity), daysAll: top(days, Infinity), extsAll: top(exts, Infinity), weekdays, heat, camFiles: n - noCam,
      contribBins: binned(perUser.map(u => u.files), [2, 6, 11, 26, 51, 101], ['1 file', '2–5', '6–10', '11–25', '26–50', '51–100', '101+']),
      sizeBins: binned(mb, [0.5, 1, 2, 5, 10, 20, 50, 100], ['<0.5 MB', '0.5–1', '1–2', '2–5', '5–10', '10–20', '20–50', '50–100', '100+ MB']),
      hours
    };
  }

  /* ------------------------------------------------------------------ svg helpers */
  function s(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    for (let i = 2; i < arguments.length; i++) [].concat(arguments[i]).forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  }
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  function niceTicks(max, want) {
    const raw = Math.max(max, 1) / want, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p, out = [];
    for (let v = 0; v < max + step - 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  const topRound = (x, y, w, h, r) => { r = Math.min(r, w / 2, h); return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z'; };
  const rightRound = (x, y, w, h, r) => { r = Math.min(r, h / 2, w); return 'M' + x + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) + 'H' + x + 'Z'; };

  /* every plot gets: svg, hover handler hooks (tip) and data rows for csv/table */
  function frame(W, H, label) { return s('svg', { xmlns: NS, width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': label, 'font-family': FONT, 'font-size': 11 }); }

  function hbars(items, o, tip) {
    const W = o.width, rowH = 26, labW = Math.min(150, Math.round(W * 0.4)), m = { l: labW + 8, r: 46, t: 4, b: 4 }, H = m.t + m.b + Math.max(1, items.length) * rowH;
    const svg = frame(W, H, o.label), max = o.max || Math.max(1, ...items.map(i => i.value)), iw = W - m.l - m.r, vf = o.fmt || fmtN;
    items.forEach((it, i) => {
      const y = m.t + i * rowH + 4, bh = 18, bw = Math.max(2, it.value / max * iw), g = s('g', { 'data-i': i });
      g.append(s('text', { x: m.l - 8, y: y + 13, 'text-anchor': 'end', fill: C.text2 }, clip(it.label, Math.floor(labW / 6)), s('title', {}, it.label)));
      g.append(s('path', { d: rightRound(m.l, y, bw, bh, 4), fill: C.bar, class: 'dws-bar' }));
      g.append(s('text', { x: m.l + bw + 6, y: y + 13, fill: C.text, 'font-weight': 600 }, vf(it.value)));
      g.append(s('rect', { x: 0, y: y - 4, width: W, height: rowH, fill: 'transparent', class: 'dws-hit' }));
      tip(g, () => it.tip || (it.label + ': ' + fmtN(it.value)));
      svg.append(g);
    });
    if (!items.length) svg.append(s('text', { x: 8, y: 20, fill: C.muted }, 'No data'));
    return svg;
  }

  function columns(items, o, tip) {
    const W = o.width, H = o.height || 190, m = { l: 38, r: 8, t: 16, b: o.rotate ? 84 : 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = frame(W, H, o.label), max = Math.max(1, ...items.map(i => i.value)), ticks = niceTicks(max, 4), tmax = ticks[ticks.length - 1] || 1;
    ticks.forEach(v => {
      const y = m.t + ih - v / tmax * ih;
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: v === 0 ? C.axis : C.grid, 'stroke-width': 1 }), s('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end', fill: C.muted }, fmtK(v)));
    });
    const slot = iw / Math.max(1, items.length), bw = Math.max(3, Math.min(24, slot - 2)), every = Math.max(1, Math.ceil((o.rotate ? 15 : 40) / slot)), peak = items.findIndex(i => i.value === max);
    items.forEach((it, i) => {
      const h = it.value / tmax * ih, x = m.l + i * slot + (slot - bw) / 2, y = m.t + ih - h, g = s('g', { 'data-i': i });
      if (it.value > 0) g.append(s('path', { d: topRound(x, y, bw, Math.max(h, 1), 4), fill: C.bar, class: 'dws-bar' }));
      if (it.value > 0 && (items.length <= 12 || i === peak)) g.append(s('text', { x: x + bw / 2, y: y - 4, 'text-anchor': 'middle', fill: C.text, 'font-weight': 600 }, fmtN(it.value)));
      if (i % every === 0) { if (o.rotate) { const lx = x + bw / 2, ly = m.t + ih + 14; g.append(s('text', { x: lx, y: ly, 'text-anchor': 'end', fill: C.text2, transform: 'rotate(-40 ' + lx + ' ' + ly + ')' }, clip(it.label, 17))); } else g.append(s('text', { x: x + bw / 2, y: H - 12, 'text-anchor': 'middle', fill: C.text2 }, o.xlabel ? o.xlabel(it, i) : it.label)); }
      g.append(s('rect', { x: m.l + i * slot, y: m.t, width: slot, height: ih + m.b, fill: 'transparent', class: 'dws-hit' }));
      tip(g, () => it.tip || (it.label + ': ' + fmtN(it.value)));
      svg.append(g);
    });
    if (!items.length) svg.append(s('text', { x: m.l + 8, y: m.t + 20, fill: C.muted }, 'No data'));
    return svg;
  }

  function area(items, o, tip) {
    const W = o.width, H = o.height || 230, m = { l: 40, r: 16, t: 18, b: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = items.length;
    const svg = frame(W, H, o.label), max = Math.max(1, ...items.map(i => i.value)), ticks = niceTicks(max, 4), tmax = ticks[ticks.length - 1] || 1;
    const X = i => m.l + (n > 1 ? i * iw / (n - 1) : iw / 2), Y = v => m.t + ih - v / tmax * ih;
    ticks.forEach(v => svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: v === 0 ? C.axis : C.grid, 'stroke-width': 1 }), s('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', fill: C.muted }, fmtK(v))));
    const want = Math.max(2, Math.floor(iw / 110)), every = Math.max(1, Math.ceil(n / want));
    items.forEach((it, i) => { if (i % every === 0) svg.append(s('text', { x: Math.min(W - 30, Math.max(m.l, X(i))), y: H - 10, 'text-anchor': n > 1 && i === 0 ? 'start' : 'middle', fill: C.text2 }, it.short || it.label)); });
    if (n > 1) {
      const pts = items.map((it, i) => X(i) + ',' + Y(it.value));
      if (!o.line) svg.append(s('path', { d: 'M' + X(0) + ',' + Y(0) + 'L' + pts.join('L') + 'L' + X(n - 1) + ',' + Y(0) + 'Z', fill: C.wash }));
      svg.append(s('path', { d: 'M' + pts.join('L'), fill: 'none', stroke: C.bar, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (n <= 40) items.forEach((it, i) => svg.append(s('circle', { cx: X(i), cy: Y(it.value), r: 3, fill: C.bar, stroke: C.surface, 'stroke-width': 1.5 })));
    }
    const pk = items.findIndex(i => i.value === max);
    if (n) {
      svg.append(s('circle', { cx: X(pk), cy: Y(items[pk].value), r: 4, fill: C.bar, stroke: C.surface, 'stroke-width': 2 }),
        s('text', { x: Math.min(W - 24, Math.max(m.l + 10, X(pk))), y: Y(items[pk].value) - 9, 'text-anchor': 'middle', fill: C.text, 'font-weight': 600 }, fmtN(items[pk].value)));
    } else svg.append(s('text', { x: m.l + 8, y: m.t + 20, fill: C.muted }, 'No data'));
    const hover = s('g', { class: 'dws-hover', style: 'display:none' }, s('line', { y1: m.t, y2: m.t + ih, stroke: C.axis, 'stroke-width': 1 }), s('circle', { r: 4, fill: C.bar, stroke: C.surface, 'stroke-width': 2 }));
    const hit = s('rect', { x: m.l, y: m.t, width: iw, height: ih + 6, fill: 'transparent', class: 'dws-hit' });
    svg.append(hover, hit);
    hit.addEventListener('pointermove', ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * (W / r.width), i = n > 1 ? Math.max(0, Math.min(n - 1, Math.round((x - m.l) / (iw / (n - 1))))) : 0;
      if (!n) return;
      hover.style.display = ''; hover.querySelector('line').setAttribute('x1', X(i)); hover.querySelector('line').setAttribute('x2', X(i));
      const c = hover.querySelector('circle'); c.setAttribute('cx', X(i)); c.setAttribute('cy', Y(items[i].value));
      tip.at(ev, items[i].tip || (items[i].label + ': ' + fmtN(items[i].value) + ' file' + (items[i].value === 1 ? '' : 's')));
    });
    hit.addEventListener('pointerleave', () => { hover.style.display = 'none'; tip.hide(); });
    return svg;
  }


  /* ------------------------------------------------------------------ more chart forms: pie / donut, radial, rings, heatmap */
  function sector(cx, cy, ri, ro, a0, a1) {
    const sw = a1 - a0, P = (r, a) => (cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2);
    if (sw >= Math.PI * 2 - 1e-4) { const c = r => 'M' + (cx - r) + ',' + cy + 'a' + r + ',' + r + ' 0 1,0 ' + 2 * r + ',0a' + r + ',' + r + ' 0 1,0 ' + (-2 * r) + ',0Z'; return c(ro) + (ri > 0 ? c(ri) : ''); }
    const L = sw > Math.PI ? 1 : 0;
    return 'M' + P(ro, a0) + 'A' + ro + ',' + ro + ' 0 ' + L + ' 1 ' + P(ro, a1) + (ri > 0 ? 'L' + P(ri, a1) + 'A' + ri + ',' + ri + ' 0 ' + L + ' 0 ' + P(ri, a0) + 'Z' : 'L' + cx + ',' + cy + 'Z');
  }
  /* largest 6 shown, the rest folded into one grey "Other" slice, so a slice never needs a generated colour */
  function fold(items, max) {
    const list = items.filter(i => i.value > 0), head = list.slice(0, max), rest = list.slice(max);
    if (list.some(i => i.other)) return list;   /* already folded by the caller */
    if (rest.length) head.push({ label: 'Other · ' + fmtN(rest.length) + ' more', value: rest.reduce((a, i) => a + i.value, 0), other: true });
    return head;
  }
  const pctOf = (v, t) => { const p = t ? v / t * 100 : 0; return (p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)) + '%'; };

  function pie(items, o, tip) {
    const W = o.width, list = fold(items, 6), total = list.reduce((a, i) => a + i.value, 0) || 1, side = W >= 400;
    const R = side ? Math.min(100, Math.round(W * 0.23)) : Math.min(90, Math.round(W * 0.3)), cx = side ? R + 12 : W / 2, cy = R + 10, rows = list.length;
    const lx = side ? cx + R + 26 : 8, ly = side ? Math.max(10, cy - rows * 11) : cy + R + 18, lw = W - lx - 6;
    const H = Math.max(side ? 2 * R + 20 : 0, ly + rows * 22 + 4), svg = frame(W, H, o.label);
    let a = -Math.PI / 2;
    list.forEach((it, i) => {
      const sweep = it.value / total * Math.PI * 2, col = it.other ? OTHER : SERIES[i], g = s('g', { 'data-i': i }), y = ly + i * 22;
      g.append(s('path', { d: sector(cx, cy, o.donut ? Math.round(R * 0.58) : 0, R, a, a + sweep), fill: col, stroke: C.surface, 'stroke-width': 2, 'fill-rule': 'evenodd', class: 'dws-slice' }));
      a += sweep;
      g.append(s('rect', { x: lx, y: y + 2, width: 11, height: 11, rx: 2, fill: col, class: 'dws-slice' }),
        s('text', { x: lx + 18, y: y + 12, fill: C.text2 }, clip(it.label, Math.max(8, Math.floor((lw - 18 - 78) / 6))), s('title', {}, it.label)),
        s('text', { x: lx + lw, y: y + 12, 'text-anchor': 'end', fill: C.text, 'font-weight': 600 }, fmtN(it.value) + ' · ' + pctOf(it.value, total)));
      g.append(s('rect', { x: lx - 4, y: y - 2, width: lw + 8, height: 20, fill: 'transparent', class: 'dws-hit' }));
      tip(g, () => it.label + ': ' + fmtN(it.value) + (o.unit ? ' ' + o.unit : '') + ' (' + pctOf(it.value, total) + ')');
      svg.append(g);
    });
    if (o.donut) svg.append(s('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 600, fill: C.text, 'pointer-events': 'none' }, fmtN(total)),
      s('text', { x: cx, y: cy + 20, 'text-anchor': 'middle', fill: C.muted, 'pointer-events': 'none' }, o.unit || ''));
    if (!list.length) svg.append(s('text', { x: 8, y: 20, fill: C.muted }, 'No data'));
    return svg;
  }

  /* polar bars: the length of each wedge is the count (a 24-hour clock, or the days of the week) */
  function radial(items, o, tip) {
    const W = o.width, R = Math.max(60, Math.min(Math.floor(W / 2) - 28, 110)), cx = W / 2, cy = R + 24, H = 2 * R + 48, r0 = Math.round(R * 0.22), n = Math.max(1, items.length);
    const svg = frame(W, H, o.label), max = Math.max(1, ...items.map(i => i.value)), step = Math.PI * 2 / n, every = o.every || 1;
    [0.5, 1].forEach(f => svg.append(s('circle', { cx, cy, r: r0 + (R - r0) * f, fill: 'none', stroke: C.grid, 'stroke-width': 1 })));
    const sc = { 'text-anchor': 'middle', fill: C.muted, 'font-size': 10, stroke: C.surface, 'stroke-width': 3, 'paint-order': 'stroke' };
    svg.append(s('text', Object.assign({ x: cx, y: cy - (r0 + (R - r0) * 0.5) + 12 }, sc), fmtK(max / 2)), s('text', Object.assign({ x: cx, y: cy - R + 12 }, sc), fmtK(max)));
    items.forEach((it, i) => {
      const a0 = -Math.PI / 2 + i * step + 0.02, a1 = -Math.PI / 2 + (i + 1) * step - 0.02, rr = r0 + it.value / max * (R - r0), g = s('g', { 'data-i': i });
      if (it.value > 0) g.append(s('path', { d: sector(cx, cy, r0, rr, a0, a1), fill: C.bar, stroke: C.surface, 'stroke-width': 1, class: 'dws-bar' }));
      if (i % every === 0) { const am = (a0 + a1) / 2; g.append(s('text', { x: cx + (R + 13) * Math.cos(am), y: cy + (R + 13) * Math.sin(am) + 4, 'text-anchor': 'middle', fill: C.text2 }, o.xlabel ? o.xlabel(it, i) : it.label)); }
      g.append(s('path', { d: sector(cx, cy, r0, R, a0, a1), fill: 'transparent', class: 'dws-hit' }));
      tip(g, () => it.tip || (it.label + ': ' + fmtN(it.value)));
      svg.append(g);
    });
    return svg;
  }

  /* share-of-files as three rings (e.g. geotagged / with depicts / with camera data) */
  function rings(items, o, tip) {
    const W = o.width, n = Math.max(1, items.length), cell = W / n, R = Math.max(26, Math.min(52, Math.floor(cell / 2) - 10)), cy = R + 10, H = 2 * R + 46, svg = frame(W, H, o.label);
    items.forEach((it, i) => {
      const cx = cell * i + cell / 2, f = o.total ? it.value / o.total : 0, g = s('g', { 'data-i': i });
      g.append(s('path', { d: sector(cx, cy, R * 0.74, R, -Math.PI / 2, Math.PI * 1.5), fill: C.grid, 'fill-rule': 'evenodd' }));
      if (f > 0) g.append(s('path', { d: sector(cx, cy, R * 0.74, R, -Math.PI / 2, -Math.PI / 2 + Math.min(f, 0.9999) * Math.PI * 2), fill: C.bar, 'fill-rule': 'evenodd', class: 'dws-bar' }));
      g.append(s('text', { x: cx, y: cy + 6, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 600, fill: C.text }, pctOf(it.value, o.total)),
        s('text', { x: cx, y: cy + R + 20, 'text-anchor': 'middle', fill: C.text2 }, clip(it.label, Math.max(8, Math.floor(cell / 6.2)))),
        s('rect', { x: cell * i, y: 0, width: cell, height: H, fill: 'transparent', class: 'dws-hit' }));
      tip(g, () => it.label + ': ' + fmtN(it.value) + ' of ' + fmtN(o.total) + ' files (' + pctOf(it.value, o.total) + ')');
      svg.append(g);
    });
    return svg;
  }

  /* weekday x hour grid: one hue, light to dark = fewer to more files */
  const mix = (a, b, t) => { const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)), A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function heatmap(grid, o, tip) {
    const W = o.width, lw = 36, top = 16, cw = Math.max(8, (W - lw - 6) / 24), ch = 22, H = top + 7 * ch + 30, svg = frame(W, H, o.label), max = Math.max(1, ...grid.map(r => Math.max.apply(null, r)));
    for (let hr = 0; hr < 24; hr += (cw < 17 ? 3 : 1)) svg.append(s('text', { x: lw + hr * cw + cw / 2, y: 11, 'text-anchor': 'middle', fill: C.muted }, pad(hr)));
    grid.forEach((row, d) => {
      svg.append(s('text', { x: lw - 6, y: top + d * ch + 15, 'text-anchor': 'end', fill: C.text2 }, DAYS[d]));
      row.forEach((v, hr) => {
        const g = s('g', {}, s('rect', { x: lw + hr * cw + 1, y: top + d * ch + 1, width: cw - 2, height: ch - 2, rx: 3, fill: v ? mix(RAMP[0], RAMP[1], 0.12 + 0.88 * v / max) : '#f0efec', class: 'dws-cell' }));
        tip(g, () => DAYS[d] + ' ' + pad(hr) + ':00–' + pad(hr) + ':59: ' + fmtN(v) + ' file' + (v === 1 ? '' : 's')); svg.append(g);
      });
    });
    const y = top + 7 * ch + 10; svg.append(s('text', { x: lw, y: y + 10, fill: C.muted }, 'fewer'));
    for (let i = 0; i < 6; i++) svg.append(s('rect', { x: lw + 40 + i * 18, y: y, width: 16, height: 12, rx: 2, fill: mix(RAMP[0], RAMP[1], 0.12 + 0.88 * i / 5) }));
    svg.append(s('text', { x: lw + 40 + 6 * 18 + 4, y: y + 10, fill: C.muted }, 'more  (busiest cell: ' + fmtN(max) + ')'));
    return svg;
  }

  /* ------------------------------------------------------------------ chart cards */
  function download(name, mime, data) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime })); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const csvText = rows => '﻿' + rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');

  let ST = null; // { el, calc, tz, cards, map }
  const core = () => DW.core;
  const meta = () => {
    const c = core(), S = c.S, d = new Date();
    return (S.srcCat ? 'Category: ' + S.srcCat : 'Source: ' + S.source) + ' · ' + ST.calc.n + ' files'
      + ' · generated ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + (ST.tz === 'utc' ? ' (times in UTC)' : ' (times in your local time zone)');
  };

  /* wrap on " · " so the footer of a narrow chart is never cut off (the sample-data marker must stay visible) */
  function wrapInfo(text, max) {
    const out = []; let line = '';
    text.split(' ').forEach(w => {
      const next = line ? line + ' ' + w : w;
      if (next.length > max && line) { out.push(line); line = w; } else line = next;
    });
    if (line) out.push(line);
    return out.map(l => clip(l, Math.max(20, max)));
  }
  function composeSvg(card, plot) {
    const W = +plot.getAttribute('width'), H = +plot.getAttribute('height'), px = 16, hh = 56, clone = plot.cloneNode(true);
    clone.querySelectorAll('.dws-hover,.dws-hit').forEach(e => e.remove());
    const max = Math.floor((W + 2 * px - 2 * px) / 5.9);
    const lines = wrapInfo(meta(), max), credit = wrapInfo('Commons Data Weaver · dataweaver.toolforge.org · data: Wikimedia Commons', max), fh = 14 + (lines.length + credit.length) * 16;
    const out = s('svg', { xmlns: NS, width: W + px * 2, height: H + hh + fh, viewBox: '0 0 ' + (W + px * 2) + ' ' + (H + hh + fh), 'font-family': FONT },
      s('rect', { width: '100%', height: '100%', fill: C.surface }),
      s('text', { x: px, y: 26, 'font-size': 16, 'font-weight': 600, fill: C.text }, card.title),
      s('text', { x: px, y: 45, 'font-size': 12, fill: C.text2 }, clip(card.subtitle, Math.floor((W + 2 * px) / 6.2))));
    /* the plot's own root attributes (font) do not travel with its children, so set them here */
    const g = s('g', { transform: 'translate(' + px + ',' + hh + ')', 'font-family': FONT, 'font-size': 11 }); while (clone.firstChild) g.append(clone.firstChild); out.append(g);
    lines.forEach((l, i) => out.append(s('text', { x: px, y: H + hh + 18 + i * 16, 'font-size': 11, fill: C.text2 }, l)));
    credit.forEach((l, i) => out.append(s('text', { x: px, y: H + hh + 18 + (lines.length + i) * 16, 'font-size': 11, fill: C.muted }, l)));
    return out;
  }
  const svgString = el => '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(el);
  function toPng(svgEl, cb) {
    const w = +svgEl.getAttribute('width'), h = +svgEl.getAttribute('height'), img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = h * 2;
      const cx = cv.getContext('2d'); cx.fillStyle = C.surface; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(b => cb(b), 'image/png');
    };
    img.onerror = () => core().setStatus('Could not draw the chart as PNG in this browser. Use SVG instead.');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString(svgEl));
  }

  function mkCard(spec) {
    const { h } = core(), card = { title: spec.title, subtitle: spec.subtitle, slug: spec.slug, spec };
    const tipEl = h('div', { class: 'dws-tip' }), plot = h('div', { class: 'dws-plot' }, tipEl), tableBox = h('div', { class: 'dws-tablebox', style: 'display:none' });
    let showTable = false;
    const store = { get() { try { return JSON.parse(localStorage.getItem('dataweaver-stats-types') || '{}'); } catch (e) { return {}; } }, set(k, v) { try { const o = store.get(); o[k] = v; localStorage.setItem('dataweaver-stats-types', JSON.stringify(o)); } catch (e) {} } };
    const ids = (spec.types || []).map(t => t[0]); card.type = ids.includes(store.get()[spec.slug]) ? store.get()[spec.slug] : ids[0];
    const tip = (g, text) => {
      g.addEventListener('pointerenter', () => g.classList.add('hot')); g.addEventListener('pointerleave', () => { g.classList.remove('hot'); tip.hide(); });
      g.addEventListener('pointermove', ev => tip.at(ev, text()));
    };
    tip.at = (ev, text) => {
      const r = plot.getBoundingClientRect(); tipEl.textContent = text; tipEl.style.display = 'block';
      tipEl.style.left = Math.max(0, Math.min(r.width - tipEl.offsetWidth, ev.clientX - r.left + 12)) + 'px'; tipEl.style.top = Math.max(0, ev.clientY - r.top - 34) + 'px';
    };
    tip.hide = () => { tipEl.style.display = 'none'; };
    const btn = (label, title, fn) => h('button', { type: 'button', class: 'dws-mini', title, onclick: fn }, label);
    const filename = ext => core().outName(ext, 'stats-' + spec.slug + (spec.types ? '-' + card.type : ''));
    card.draw = () => {
      const W = Math.max(240, Math.floor(plot.clientWidth || card.el.clientWidth - 24 || 320));
      const built = spec.build(W, tip, card.type); card.rows = built.rows; card.svg = built.svg;
      plot.querySelectorAll('svg').forEach(e => e.remove()); plot.prepend(built.svg);
      tableBox.innerHTML = '';
      tableBox.append(h('table', { class: 'dws-table' }, card.rows.map((r, i) => h('tr', {}, r.map(c => h(i ? 'td' : 'th', {}, String(c)))))));
    };
    card.el = h('section', { class: 'dws-card ' + (spec.cls || '') },
      h('div', { class: 'dws-ch' }, h('div', {}, h('h3', {}, spec.title), h('small', {}, spec.subtitle)),
        h('div', { class: 'dws-tools' },
          spec.types && spec.types.length > 1 ? h('select', { class: 'dws-type', title: 'Change the chart type', 'aria-label': 'Chart type: ' + spec.title, onchange: e => { card.type = e.target.value; store.set(spec.slug, card.type); card.draw(); } }, spec.types.map(t => h('option', Object.assign({ value: t[0] }, t[0] === card.type ? { selected: true } : {}), t[1]))) : null,
          btn('Table', 'Show the numbers as a table', () => { showTable = !showTable; tableBox.style.display = showTable ? '' : 'none'; plot.style.display = showTable ? 'none' : ''; }),
          btn('PNG', 'Download the chart as an image with its title and details', () => toPng(composeSvg(card, card.svg), b => download(filename('png'), 'image/png', b))),
          btn('SVG', 'Download the chart as a scalable vector image with its title and details', () => download(filename('svg'), 'image/svg+xml', svgString(composeSvg(card, card.svg)))),
          btn('CSV', 'Download the numbers behind the chart', () => download(filename('csv'), 'text/csv', csvText(card.rows))))),
      plot, tableBox);
    return card;
  }

  /* ------------------------------------------------------------------ map */
  const T = 256, LIM = 85.05;
  const Xp = (lon, z) => (lon + 180) / 360 * Math.pow(2, z) * T;
  const Yp = (lat, z) => { const q = Math.sin(Math.max(-LIM, Math.min(LIM, lat)) * Math.PI / 180); return (0.5 - Math.log((1 + q) / (1 - q)) / (4 * Math.PI)) * Math.pow(2, z) * T; };
  const Lon = (x, z) => x / (Math.pow(2, z) * T) * 360 - 180;
  const Lat = (y, z) => { const a = Math.PI - 2 * Math.PI * y / (Math.pow(2, z) * T); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(a) - Math.exp(-a))); };

  function MapView(el, points) {
    const { h, labelOf } = core(); let z = 3, c = { lat: 10, lon: 76 }, cluster = true, popup = null, raf = 0;
    const tiles = new Map(), tileL = h('div', { class: 'dws-tiles-l' }), markL = h('div', { class: 'dws-marks' }), popL = h('div', { class: 'dws-pop', style: 'display:none' });
    const zoomBy = d => setZoom(z + d);
    el.append(tileL, markL, popL,
      h('div', { class: 'dws-mapctl' }, h('button', { type: 'button', title: 'Zoom in', onclick: () => zoomBy(1) }, '+'), h('button', { type: 'button', title: 'Zoom out', onclick: () => zoomBy(-1) }, '−'),
        h('button', { type: 'button', title: 'Show all photos', onclick: () => fit(points) }, '⤢')),
      h('div', { class: 'dws-attr' }, '© OpenStreetMap contributors'));
    const size = () => ({ w: el.clientWidth || 600, h: el.clientHeight || 400 });
    function setZoom(nz, mx, my) {
      nz = Math.max(2, Math.min(18, nz)); if (nz === z) return;
      const { w, h: hh } = size(); mx = mx == null ? w / 2 : mx; my = my == null ? hh / 2 : my;
      const wx = Xp(c.lon, z) + (mx - w / 2), wy = Yp(c.lat, z) + (my - hh / 2), f = Math.pow(2, nz - z);
      z = nz; c = { lon: Lon(wx * f - (mx - w / 2), z), lat: Lat(wy * f - (my - hh / 2), z) }; schedule();
    }
    function fit(list, padPx) {
      if (!list.length) return;
      const la = list.map(p => p.lat), lo = list.map(p => p.lon), b = { s: Math.min.apply(null, la), n: Math.max.apply(null, la), w: Math.min.apply(null, lo), e: Math.max.apply(null, lo) };
      const { w, h: hh } = size(), pd = padPx == null ? 40 : padPx; let nz = 18;
      for (; nz > 2; nz--) if (Xp(b.e, nz) - Xp(b.w, nz) <= w - 2 * pd && Yp(b.s, nz) - Yp(b.n, nz) <= hh - 2 * pd) break;
      z = nz; c = { lon: Lon((Xp(b.w, z) + Xp(b.e, z)) / 2, z), lat: Lat((Yp(b.n, z) + Yp(b.s, z)) / 2, z) }; schedule();
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
    function popupFor(node, lat, lon) { popup = { lat, lon }; popL.innerHTML = ''; popL.append(h('button', { type: 'button', class: 'dws-popx', title: 'Close', onclick: closePop }, '✕'), node); popL.style.display = 'block'; placePop(); }
    function closePop() { popup = null; popL.style.display = 'none'; }
    function placePop() {
      if (!popup) return; const { w, h: hh } = size(), x0 = Xp(c.lon, z) - w / 2, y0 = Yp(c.lat, z) - hh / 2;
      const x = Xp(popup.lon, z) - x0, y = Yp(popup.lat, z) - y0, pw = popL.offsetWidth, ph = popL.offsetHeight;
      popL.style.left = Math.max(4, Math.min(w - pw - 4, x - pw / 2)) + 'px'; popL.style.top = Math.max(4, Math.min(hh - ph - 4, y - ph - 14)) + 'px';
    }
    function photoPopup(r) {
      const deps = (r.depicts || []).map(d => labelOf(d.id));
      return h('div', { class: 'dws-photo' }, h('img', { src: r.thumb, alt: r.name }),
        h('div', {}, h('b', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.name)),
          h('div', { class: 'dws-dim' }, [r.uploader && 'Uploaded by ' + r.uploader, r.upload && r.upload.slice(0, 10)].filter(Boolean).join(' · ')),
          r.author ? h('div', { class: 'dws-dim' }, 'Author: ' + r.author) : '', r.dateObs ? h('div', { class: 'dws-dim' }, 'Taken: ' + r.dateObs) : '',
          deps.length ? h('div', {}, 'Depicts: ' + deps.join(', ')) : h('div', { class: 'dws-dim' }, 'No depicts yet'),
          h('button', { type: 'button', onclick: () => core().openSingle(r) }, 'Inspect in the tool')));
    }
    function listPopup(members) {
      return h('div', { class: 'dws-list' }, h('b', {}, members.length + ' photos at this spot'),
        h('div', { class: 'dws-listbody' }, members.slice(0, 40).map(p => h('div', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); popupFor(photoPopup(p.rec), p.lat, p.lon); } }, p.rec.name)))),
        members.length > 40 ? h('div', { class: 'dws-dim' }, '… and ' + (members.length - 40) + ' more') : '');
    }
    function render() {
      const { w, h: hh } = size(), x0 = Xp(c.lon, z) - w / 2, y0 = Yp(c.lat, z) - hh / 2, N = Math.pow(2, z), used = new Set();
      for (let tx = Math.floor(x0 / T); tx <= Math.floor((x0 + w) / T); tx++) for (let ty = Math.floor(y0 / T); ty <= Math.floor((y0 + hh) / T); ty++) {
        if (ty < 0 || ty >= N) continue; const key = z + '/' + tx + '/' + ty; used.add(key);
        let im = tiles.get(key); if (!im) { im = h('img', { src: DW.tile(z, ((tx % N) + N) % N, ty), draggable: 'false', alt: '' }); tiles.set(key, im); tileL.append(im); }
        im.style.left = Math.round(tx * T - x0) + 'px'; im.style.top = Math.round(ty * T - y0) + 'px';
      }
      tiles.forEach((im, k) => { if (!used.has(k)) { im.remove(); tiles.delete(k); } });
      markL.innerHTML = '';
      const vis = []; points.forEach(p => { const px = Xp(p.lon, z) - x0, py = Yp(p.lat, z) - y0; if (px > -40 && px < w + 40 && py > -40 && py < hh + 40) vis.push({ p, px, py }); });
      if (cluster) {
        const cells = new Map();
        vis.forEach(v => { const k = Math.floor((v.px + x0) / 52) + ',' + Math.floor((v.py + y0) / 52); let g = cells.get(k); if (!g) cells.set(k, g = { n: 0, sx: 0, sy: 0, m: [] }); g.n++; g.sx += v.px; g.sy += v.py; g.m.push(v.p); });
        cells.forEach(g => g.n === 1 ? pin(g.m[0], g.sx, g.sy) : bubble(g));
      } else vis.slice(0, 1500).forEach(v => pin(v.p, v.px, v.py));
      placePop();
    }
    function pin(p, x, y) {
      const e = h('button', { type: 'button', class: 'dws-pin', title: p.rec.name, 'aria-label': p.rec.name, onclick: ev => { ev.stopPropagation(); popupFor(photoPopup(p.rec), p.lat, p.lon); } });
      e.style.left = x + 'px'; e.style.top = y + 'px'; markL.append(e);
    }
    function bubble(g) {
      const n = g.n, d = 26 + Math.min(22, Math.round(Math.log2(n) * 5)), cls = n < 10 ? 's1' : n < 50 ? 's2' : n < 200 ? 's3' : 's4';
      const e = h('button', { type: 'button', class: 'dws-cl ' + cls, title: n + ' photos', onclick: ev => {
        ev.stopPropagation();
        const la = g.m.map(p => p.lat), lo = g.m.map(p => p.lon), same = Math.max.apply(null, la) - Math.min.apply(null, la) < 1e-5 && Math.max.apply(null, lo) - Math.min.apply(null, lo) < 1e-5;
        if (same || z >= 17) popupFor(listPopup(g.m), la[0], lo[0]); else { closePop(); fit(g.m, 60); }
      } }, String(n));
      e.style.width = e.style.height = d + 'px'; e.style.zIndex = String(1000 - n); e.style.left = (g.sx / g.n) + 'px'; e.style.top = (g.sy / g.n) + 'px'; e.style.lineHeight = (d - 4) + 'px'; markL.append(e);
    }
    let drag = null;
    el.addEventListener('pointerdown', e => { if (e.target.closest('.dws-pin,.dws-cl,.dws-mapctl,.dws-pop')) return; drag = { x: e.clientX, y: e.clientY, moved: 0 }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      c = { lon: Lon(Xp(c.lon, z) - dx, z), lat: Lat(Yp(c.lat, z) - dy, z) }; schedule();
    });
    el.addEventListener('pointerup', () => { if (drag && drag.moved < 4) closePop(); drag = null; });
    el.addEventListener('wheel', e => { e.preventDefault(); const r = el.getBoundingClientRect(); setZoom(z + (e.deltaY < 0 ? 1 : -1), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(el);
    return { fit: () => fit(points), render: schedule, setCluster(on) { cluster = !!on; closePop(); schedule(); }, state: () => ({ z, cluster }) };
  }

  /* ------------------------------------------------------------------ the page */
  function build() {
    const c = core(), { h, S } = c, calc = ST.calc, off = ST.tz === 'utc' ? 0 : -new Date().getTimezoneOffset();
    ST.cards = [];
    const wide = Math.max(300, (ST.body.clientWidth || 1000) - 40);
    const tile = (label, value, sub, title) => h('div', { class: 'dws-tile', title: title || '' }, h('div', { class: 'dws-tl' }, label), h('div', { class: 'dws-tv' }, value), h('div', { class: 'dws-ts' }, sub || ' '));
    const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '0%';
    const tiles = h('div', { class: 'dws-tiles' },
      tile('Contributors', fmtN(calc.contributors), 'uploaders'), tile('Total files', fmtN(calc.n), calc.first != null ? dateStr(calc.first, off) + ' → ' + dateStr(calc.last, off) : ''),
      tile('Total size', fmtBytes(calc.bytes), ''),
      tile('Average file size', fmtBytes(calc.avg), calc.big ? 'max ' + fmtBytes(calc.big.bytes) + ' · min ' + fmtBytes(calc.small.bytes) : '', calc.big ? 'Largest: ' + calc.big.name + '\nSmallest: ' + calc.small.name : ''),
      tile('Geotagged', fmtN(calc.geo), pct(calc.geo, calc.n) + ' of files'), tile('Depicts added', fmtN(calc.depStmts), 'on ' + fmtN(calc.depFiles) + ' files (' + pct(calc.depFiles, calc.n) + ')'));

    const act = calc.activity, unitName = { hour: 'hour', day: 'day', week: 'week', month: 'month', year: 'year' }[act.unit];
    const CAT = [['bar', 'Bars'], ['column', 'Columns'], ['pie', 'Pie'], ['donut', 'Donut']], BIN = [['column', 'Columns'], ['bar', 'Bars'], ['line', 'Line'], ['donut', 'Donut'], ['pie', 'Pie']];
    /* top-10 lists: bars/columns show the ten largest, pie/donut show 6 slices plus the folded rest */
    const catBuild = (all, label, head, unit) => (W, tip, type) => {
      const items = a => a.map(u => ({ label: u[0], value: u[1] })), o = { width: W, label, unit };
      if (type === 'pie' || type === 'donut') { const f = fold(items(all), 6), t = f.reduce((a, i) => a + i.value, 0); return { svg: pie(f, Object.assign(o, { donut: type === 'donut' }), tip), rows: [[head, unit, 'share %']].concat(f.map(i => [i.label, i.value, (i.value / t * 100).toFixed(1)])) }; }
      const t10 = all.slice(0, 10);
      return { svg: type === 'column' ? columns(items(t10), Object.assign(o, { height: 250, rotate: true }), tip) : hbars(items(t10), o, tip), rows: [[head, unit]].concat(t10) };
    };
    const binBuild = (bins, label, head, unit) => (W, tip, type) => {
      const o = { width: W, label, unit };
      const svg = type === 'pie' || type === 'donut' ? pie(bins, Object.assign(o, { donut: type === 'donut' }), tip) : type === 'bar' ? hbars(bins, o, tip) : type === 'line' ? area(bins.map(b => Object.assign({ short: b.label }, b)), Object.assign(o, { line: true, height: 190 }), tip) : columns(bins, o, tip);
      return { svg, rows: [[head, unit]].concat(bins.map(b => [b.label, b.value])) };
    };
    const cards = {
      activity: { title: 'Upload activity', slug: 'upload-activity', cls: 'wide', subtitle: 'Files uploaded per ' + unitName + ' (the unit follows the date range and the screen width)',
        types: [['area', 'Area'], ['line', 'Line'], ['column', 'Columns'], ['cum', 'Cumulative']],
        build: (W, tip, type) => {
          const o = { width: W, height: 230, label: 'Files uploaded per ' + unitName };
          let items = act.buckets, head = [unitName + ' starting', 'files'];
          if (type === 'cum') { let t = 0; items = act.buckets.map(b => { t += b.value; return { label: b.label, short: b.short, value: t, tip: 'Up to ' + b.label + ': ' + fmtN(t) + ' files in total (' + fmtN(b.value) + ' that ' + unitName + ')' }; }); head = [unitName + ' starting', 'files in total']; }
          const svg = type === 'column' ? columns(items, o, tip) : area(items, Object.assign(o, { line: type === 'line' }), tip);
          return { svg, rows: [head].concat(items.map(b => [b.label, b.value])) };
        } },
      users: { title: 'Top contributors (files)', slug: 'top-contributors', subtitle: 'Uploaders with the most files', types: CAT, build: catBuild(calc.usersAll, 'Top contributors', 'contributor', 'files') },
      cams: { title: 'Top camera models', slug: 'top-cameras', subtitle: calc.noCam ? fmtN(calc.noCam) + ' file(s) have no camera data' : 'Make and model from the file metadata', types: CAT, build: catBuild(calc.camsAll, 'Top camera models', 'camera', 'files') },
      days: { title: 'Top upload days', slug: 'top-upload-days', subtitle: 'Days with the most uploads', types: CAT, build: catBuild(calc.daysAll, 'Top upload days', 'day', 'files') },
      dist: { title: 'Contribution distribution', slug: 'contribution-distribution', subtitle: 'How many contributors uploaded 1, 2–5, 6–10… files', types: BIN,
        build: binBuild(calc.contribBins.map(b => Object.assign({ tip: fmtN(b.value) + ' contributor(s) with ' + b.label }, b)), 'Contribution distribution', 'files per contributor', 'contributors') },
      sizes: { title: 'File size distribution', slug: 'file-size-distribution', subtitle: 'Number of files by size', types: BIN,
        build: binBuild(calc.sizeBins.map(b => Object.assign({ tip: fmtN(b.value) + ' file(s), ' + b.label }, b)), 'File size distribution', 'size', 'files') },
      hours: { title: 'Upload hours distribution', slug: 'upload-hours', subtitle: 'Files by hour of day (' + (ST.tz === 'utc' ? 'UTC' : 'your local time') + ')', types: [['column', 'Columns'], ['radial', 'Clock (radial)'], ['line', 'Line'], ['bar', 'Bars']],
        build: (W, tip, type) => {
          const items = calc.hours.map((v, i) => ({ label: pad(i) + ':00', value: v, tip: fmtN(v) + ' file(s) uploaded between ' + pad(i) + ':00 and ' + pad(i) + ':59' })), o = { width: W, label: 'Upload hours', xlabel: (it, i) => String(i) };
          const svg = type === 'radial' ? radial(items, Object.assign(o, { every: 3, xlabel: (it, i) => String(i) }), tip) : type === 'line' ? area(items.map(i => Object.assign({ short: i.label.slice(0, 2) }, i)), Object.assign(o, { line: true }), tip)
            : type === 'bar' ? hbars(items, o, tip) : columns(items, o, tip);
          return { svg, rows: [['hour', 'files']].concat(calc.hours.map((v, i) => [pad(i) + ':00', v])) };
        } },
      weekdays: { title: 'Uploads by weekday', slug: 'upload-weekdays', subtitle: 'Which days of the week files were uploaded on', types: [['column', 'Columns'], ['bar', 'Bars'], ['donut', 'Donut'], ['pie', 'Pie'], ['radial', 'Radial']],
        build: (W, tip, type) => {
          const items = calc.weekdays.map((v, i) => ({ label: DAYS[i], value: v, tip: DAYS[i] + ': ' + fmtN(v) + ' file(s)' })), o = { width: W, label: 'Uploads by weekday', unit: 'files' };
          const svg = type === 'pie' || type === 'donut' ? pie(items, Object.assign(o, { donut: type === 'donut' }), tip) : type === 'radial' ? radial(items, o, tip) : type === 'bar' ? hbars(items, o, tip) : columns(items, o, tip);
          return { svg, rows: [['weekday', 'files']].concat(items.map(i => [i.label, i.value])) };
        } },
      formats: { title: 'File formats', slug: 'file-formats', subtitle: 'Share of files by file extension', types: [['donut', 'Donut'], ['pie', 'Pie'], ['bar', 'Bars'], ['column', 'Columns']],
        build: (W, tip, type) => {
          const items = calc.extsAll.map(u => ({ label: u[0], value: u[1] })), o = { width: W, label: 'File formats', unit: 'files' };
          const svg = type === 'pie' || type === 'donut' ? pie(items, Object.assign(o, { donut: type === 'donut' }), tip) : type === 'column' ? columns(items.slice(0, 10), o, tip) : hbars(items.slice(0, 10), o, tip);
          return { svg, rows: [['format', 'files']].concat(calc.extsAll) };
        } },
      coverage: { title: 'Data coverage', slug: 'data-coverage', subtitle: 'How many files already have a location, depicts or camera data', types: [['rings', 'Rings'], ['meters', 'Meters']],
        build: (W, tip, type) => {
          const items = [{ label: 'Geotagged', value: calc.geo }, { label: 'With depicts', value: calc.depFiles }, { label: 'Camera data', value: calc.camFiles }];
          const svg = type === 'meters' ? hbars(items.map(i => ({ label: i.label, value: calc.n ? Math.round(i.value / calc.n * 100) : 0, tip: i.label + ': ' + fmtN(i.value) + ' of ' + fmtN(calc.n) + ' files (' + pctOf(i.value, calc.n) + ')' })), { width: W, label: 'Data coverage', max: 100, fmt: v => v + '%' }, tip)
            : rings(items, { width: W, label: 'Data coverage', total: calc.n }, tip);
          return { svg, rows: [['has', 'files', 'share %']].concat(items.map(i => [i.label, i.value, calc.n ? (i.value / calc.n * 100).toFixed(1) : 0])) };
        } },
      rhythm: { title: 'Upload rhythm', slug: 'upload-rhythm', cls: 'wide', subtitle: 'Files by weekday and hour of day (' + (ST.tz === 'utc' ? 'UTC' : 'your local time') + ')',
        build: (W, tip) => ({ svg: heatmap(calc.heat, { width: W, label: 'Upload rhythm' }, tip), rows: [['weekday'].concat(Array.from({ length: 24 }, (_, i) => pad(i) + ':00'))].concat(calc.heat.map((r, d) => [DAYS[d]].concat(r))) }) }
    };
    const mk = k => { const cd = mkCard(cards[k]); ST.cards.push(cd); return cd.el; };
    const geoPts = S.recs.filter(r => r.lat != null).map(r => ({ lat: r.lat, lon: r.lon, rec: r }));

    // map
    const mapEl = h('div', { class: 'dws-map' }), clus = h('input', { type: 'checkbox', checked: true, id: 'dws-clus' });
    const mapCard = h('section', { class: 'dws-card wide' },
      h('div', { class: 'dws-ch' }, h('div', {}, h('h3', {}, 'Photo locations map'), h('small', {}, geoPts.length ? fmtN(geoPts.length) + ' geotagged photos. Click a marker to see the photo.' : 'None of the loaded files has coordinates yet.')),
        h('div', { class: 'dws-tools' }, h('label', { for: 'dws-clus', class: 'dws-chk' }, clus, ' Clustering'),
          h('button', { type: 'button', class: 'dws-mini', title: 'Download file names and coordinates', onclick: () => c.download(c.outName('csv', 'stats-locations'), 'text/csv',
            csvText([['file', 'latitude', 'longitude', 'uploader', 'upload_date']].concat(geoPts.map(p => [p.rec.name, p.lat, p.lon, p.rec.uploader, (p.rec.upload || '').slice(0, 10)])))) }, 'CSV'))),
      geoPts.length ? mapEl : h('div', { class: 'dws-empty' }, 'Add locations in the tool and they appear here.'));

    // users table
    let sortK = 'files', sortDir = -1, all = false;
    const tbl = h('div', { class: 'dws-usertab' });
    const cols = [['user', 'Contributor'], ['files', 'Files'], ['share', 'Share'], ['bytes', 'Total size'], ['avg', 'Average'], ['first', 'First upload'], ['last', 'Last upload'], ['geo', 'Geotagged'], ['depFiles', 'With depicts']];
    const val = (u, k) => k === 'share' ? u.files : k === 'avg' ? u.bytes / u.files : u[k];
    function drawUsers() {
      const rows = calc.perUser.slice().sort((a, b) => { const x = val(a, sortK), y = val(b, sortK); return (typeof x === 'string' ? x.localeCompare(y) : (x == null ? -1 : x) - (y == null ? -1 : y)) * sortDir; });
      const shown = all ? rows : rows.slice(0, 25), maxF = calc.perUser.length ? calc.perUser[0].files : 1;
      tbl.innerHTML = '';
      tbl.append(h('table', { class: 'dws-table users' },
        h('tr', {}, cols.map(k => h('th', { class: sortK === k[0] ? 'on' : '', title: 'Sort', onclick: () => { sortDir = sortK === k[0] ? -sortDir : (k[0] === 'user' ? 1 : -1); sortK = k[0]; drawUsers(); } }, k[1] + (sortK === k[0] ? (sortDir > 0 ? ' ▲' : ' ▼') : '')))),
        shown.map(u => h('tr', {}, h('td', {}, h('a', { href: 'https://commons.wikimedia.org/wiki/User:' + encodeURIComponent(u.user.replace(/ /g, '_')), target: '_blank', rel: 'noopener' }, u.user)), h('td', {}, fmtN(u.files)),
          h('td', {}, h('div', { class: 'dws-share' }, h('div', { style: 'width:' + Math.round(u.files / maxF * 100) + '%' }), h('span', {}, pct(u.files, calc.n)))),
          h('td', {}, fmtBytes(u.bytes)), h('td', {}, fmtBytes(u.bytes / u.files)), h('td', {}, u.first != null ? dateStr(u.first, off) : '—'), h('td', {}, u.last != null ? dateStr(u.last, off) : '—'),
          h('td', {}, fmtN(u.geo)), h('td', {}, fmtN(u.depFiles))))));
      if (rows.length > 25) tbl.append(h('button', { type: 'button', class: 'dws-mini', onclick: () => { all = !all; drawUsers(); } }, all ? 'Show top 25' : 'Show all ' + rows.length + ' contributors'));
    }
    drawUsers();
    const userCard = h('section', { class: 'dws-card wide' },
      h('div', { class: 'dws-ch' }, h('div', {}, h('h3', {}, 'Detailed user contributions'), h('small', {}, 'Click a column to sort')),
        h('div', { class: 'dws-tools' }, h('button', { type: 'button', class: 'dws-mini', title: 'Download the whole table', onclick: () => c.download(c.outName('csv', 'stats-contributors'), 'text/csv',
          csvText([['contributor', 'files', 'share_percent', 'total_bytes', 'average_bytes', 'first_upload', 'last_upload', 'geotagged', 'files_with_depicts', 'depicts_statements']].concat(
            calc.perUser.map(u => [u.user, u.files, (u.files / calc.n * 100).toFixed(1), u.bytes, Math.round(u.bytes / u.files), u.first != null ? dateStr(u.first, off) : '', u.last != null ? dateStr(u.last, off) : '', u.geo, u.depFiles, u.depStmts])))) }, 'CSV'))),
      tbl);

    ST.body.innerHTML = '';
    ST.body.append(tiles, mk('activity'), h('div', { class: 'dws-row3' }, mk('users'), mk('cams'), mk('days')), h('div', { class: 'dws-row3' }, mk('dist'), mk('sizes'), mk('hours')), h('div', { class: 'dws-row3' }, mk('weekdays'), mk('formats'), mk('coverage')), mk('rhythm'), mapCard, userCard);
    ST.cards.forEach(cd => cd.draw());
    ST.map = null;
    if (geoPts.length) { ST.map = MapView(mapEl, geoPts); setTimeout(() => ST.map.fit(), 30); clus.addEventListener('change', () => ST.map.setCluster(clus.checked)); }
  }

  function maxBuckets() { return Math.max(24, Math.min(120, Math.floor(((ST && ST.body && ST.body.clientWidth) || 1000) / 10))); }
  function refresh() {
    const S = core().S, off = ST.tz === 'utc' ? 0 : -new Date().getTimezoneOffset();
    ST.calc = compute(S.recs, off, maxBuckets());
    ST.sub.textContent = (S.srcCat ? 'Category:' + S.srcCat : 'Source: ' + S.source) + ' · ' + fmtN(ST.calc.n) + ' loaded files · saved data on Commons (unsaved changes are not counted)';
    build();
  }
  const pageUrl = () => location.origin + '/?stats&category=' + encodeURIComponent((core().S.srcCat || '').replace(/ /g, '_'));

  function open() {
    const c = core(); if (!c) return;
    if (!c.S.recs.length) return c.setStatus('Load a category or a file list first, then open the statistics.');
    if (!ST) {
      const { h } = c;
      const tz = h('select', { title: 'Time zone for dates and hours', onchange: e => { ST.tz = e.target.value; refresh(); } }, h('option', { value: 'utc' }, 'Times in UTC'), h('option', { value: 'local' }, 'Times in my local time'));
      const sub = h('span', { class: 'dws-hsub' }), body = h('div', { class: 'dws-body' });
      const link = h('button', { type: 'button', title: 'Copy a link that opens these statistics', onclick: () => {
        const u = pageUrl(); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => c.setStatus('Link copied: ' + u), () => c.setStatus('Copy this link: ' + u));
      } }, 'Copy link');
      const el = h('div', { class: 'dws', role: 'dialog', 'aria-label': 'Statistics' }, h('div', { class: 'dws-head' }, h('h2', {}, '▤ Statistics'), sub, tz, link, h('button', { type: 'button', class: 'dws-close', onclick: close, title: 'Close (Esc)' }, '✕ Close')), body);
      ST = { el, body, sub, tz: 'utc', cards: [] }; ST.tzSel = tz; c.root.append(el);
      let t = 0; if (window.ResizeObserver) new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (ST.el.classList.contains('open')) ST.cards.forEach(cd => cd.draw()); }, 150); }).observe(body);
    }
    ST.el.classList.add('open'); ST.el.style.display = 'flex';
    refresh();
    try { if (c.S.srcCat) history.replaceState(null, '', '?stats&category=' + encodeURIComponent(c.S.srcCat.replace(/ /g, '_'))); } catch (e) {}
  }
  function close() {
    if (!ST) return;
    ST.el.classList.remove('open'); ST.el.style.display = 'none';
    try { const S = core().S; history.replaceState(null, '', S.srcCat ? '?category=' + encodeURIComponent(S.srcCat.replace(/ /g, '_')) : location.pathname); } catch (e) {}
  }

  DW.stats = { open, close, isOpen: () => !!(ST && ST.el.classList.contains('open')), _calc: compute, _activity: activity, _state: () => ST };
})();
