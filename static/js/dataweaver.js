/**
 * Commons Data Weaver — web application interface (https://dataweaver.toolforge.org/)
 * Source: https://github.com/wikimedia-biodiversity/dataweaver
 * Copyright (C) 2026 Manoj Karingamadathil (https://meta.wikimedia.org/wiki/User:Manojk, ORCID 0000-0003-3885-6595)
 * DOI: 10.5281/zenodo.23680559
 * License: GPL-3.0-or-later (see LICENSE)
 *
 * Version 1.1.0. Started as the Commons Data Weaver user script and runs on the MediaWiki helpers
 * provided by static/js/dw-shim.js. From 1.1.0 this file is the source of truth: edit it directly
 * (tools/port_userscript.py only reproduces the 1.0.0 baseline and is no longer part of the workflow).
 */
(function () {
'use strict';
if (window.DataWeaverLoaded || window.BioregisterLoaded) return;
window.DataWeaverLoaded = window.BioregisterLoaded = true;

mw.loader.using(['mediawiki.api', 'mediawiki.ForeignApi', 'mediawiki.util', 'user']).then(function () {

/* ---------- helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
function h(tag, attrs) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (let i = 2; i < arguments.length; i++) {
    [].concat(arguments[i]).forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
  }
  return e;
}
const api = new mw.Api();
const wd = new mw.ForeignApi('https://www.wikidata.org/w/api.php', { anonymous: true });
const normCat = n => { n = String(n || '').replace(/^\s*Category\s*:/i, '').replace(/_/g, ' ').trim(); return n.charAt(0).toUpperCase() + n.slice(1); };
const txt = html => html ? new DOMParser().parseFromString(html, 'text/html').body.textContent.trim() : '';
const WD = {}; // wikidata label cache {id:{label,desc}}
const labelOf = id => (WD[id] && WD[id].label) || id;
/* Wikidata item image (P18), fetched in small batches and cached: id -> file name | null */
const IMG = {};
let imgQ = new Set(), imgW = [], imgT = null;
function ensureImg(ids) {
  ids = [...new Set(ids)].filter(i => /^Q\d+$/.test(i || '') && IMG[i] === undefined);
  if (!ids.length) return Promise.resolve();
  return new Promise(res => {
    ids.forEach(i => imgQ.add(i)); imgW.push(res); clearTimeout(imgT);
    imgT = setTimeout(async () => {
      const q = [...imgQ], w = imgW; imgQ = new Set(); imgW = [];
      for (let i = 0; i < q.length; i += 20) {
        const part = q.slice(i, i + 20);
        try {
          const d = await wd.get({ action: 'wbgetentities', ids: part.join('|'), props: 'claims' });
          part.forEach(id => {
            const cl = (((d.entities || {})[id] || {}).claims || {}).P18 || [];
            const c = cl.find(x => x.rank !== 'deprecated' && x.mainsnak && x.mainsnak.datavalue && typeof x.mainsnak.datavalue.value === 'string');
            IMG[id] = c ? c.mainsnak.datavalue.value : null;
          });
        } catch (e) { part.forEach(id => { IMG[id] = null; }); }
      }
      w.forEach(f => f());
    }, 40);
  });
}
const imgUrl = (f, w) => 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(f) + '?width=' + w;
function wdThumb(id, w, cls) {
  const box = h('span', { class: 'jv-wdt' + (cls ? ' ' + cls : '') });
  const fill = () => { if (IMG[id]) { box.append(h('img', { src: imgUrl(IMG[id], w || 80), alt: '', loading: 'lazy', title: IMG[id] })); box.classList.add('on'); } };
  IMG[id] !== undefined ? fill() : ensureImg([id]).then(fill);
  return box;
}
const S = { recs: [], view: [], sel: new Set(), last: null, sort: 'name', dir: 1, groupStar: false,
  fText: '', fStar: false, fDep: 'all', bDep: [], bCat: [], cur: null, stars: new Set(), log: [], hideMap: false, annOn: false, activeNote: null, groups: {}, gmode: 'manual', gsec: 60, gMsg: null, project: '',
  fLoc: 'all', fCat: 'all', hidCats: false, gAct: null };
/* Projects and their "help needed" categories are maintained in static/config/projects.json (loaded below).
   These names are only the fallback if that file cannot be read. */
let PROJ = [['Bioregister', ''], ['Folkland', ''], ['Heritage', ''], ['Wiki Village', 'WikiVillage']].map(a => ({ name: a[0], tag: a[1] || a[0], helpCategory: a[0] + ' (Maintenance)' }));
const PROJ_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;
try { let p = localStorage.getItem('dataweaver-project'); if (p === 'Wikivoyage') p = 'Wiki Village'; /* renamed in 1.1.0 */ if (PROJ_NAME_RE.test(p || '')) S.project = p; } catch (e) {}
Object.assign(S, { imgSize: '1280', imgFit: 'fit', source: 'list', srcCat: '' });
try {
  const v = JSON.parse(localStorage.getItem('dataweaver-img') || '{}');
  if (v.size === 'orig' || /^\d{3,4}$/.test(v.size || '')) S.imgSize = v.size;
  if (v.fit === 'width') S.imgFit = 'width';
} catch (e) {}
const projCfg = () => PROJ.find(p => p.name === S.project);
const helpCat = () => { const p = projCfg(); return p && p.helpCategory ? normCat(p.helpCategory) : ''; };
try { JSON.parse(sessionStorage.getItem('dataweaver-stars') || '[]').forEach(t => S.stars.add(t)); } catch (e) {}
const isStar = r => S.stars.has(r.title);
function toggleStar(r) {
  isStar(r) ? S.stars.delete(r.title) : S.stars.add(r.title);
  try { sessionStorage.setItem('dataweaver-stars', JSON.stringify([...S.stars])); } catch (e) {}
  refreshCard(r); updateStats();
}
/* Help needed / problematic file: stages the project's "help" category (undoable, saved with the other changes). */
const isHelp = r => { const c = helpCat(); return !!c && effCats(r).some(x => x.n === c); };
function toggleHelp(r) {
  if (!S.project) return setStatus('Choose a project first: the Help button adds that project’s “help needed” category.');
  const c = helpCat();
  if (!c) return setStatus('Project ' + S.project + ' has no help category yet. Add it to static/config/projects.json.');
  isHelp(r) ? removeCat(r, c) : addCat(r, c);
  refreshCard(r); updateStats();
  setStatus((isHelp(r) ? 'Flagged ' : 'Un-flagged ') + r.name + ' (' + c + ') — not saved yet.');
}
const helpTip = r => !S.project ? '' : !helpCat() ? 'No help category is set for ' + S.project + ' yet (static/config/projects.json)'
  : isHelp(r) ? 'Flagged: in Category:' + helpCat() + '. Click to remove (H)' : 'Needs help / problematic file: adds Category:' + helpCat() + ' (H)';
function paintHelp(b, r) { b.className = 'jv-help' + (isHelp(r) ? ' on' : '') + (helpCat() ? '' : ' off'); b.title = helpTip(r); }
function mkHelp(r, after) {
  const b = h('div', { onclick: e => { e.stopPropagation(); toggleHelp(r); if (after) after(); } }, '⚑');
  paintHelp(b, r); return b;
}
function post(p, r) {
  return new Promise((res, rej) => api.postWithEditToken(p).then(d => { logEdit(r, p.summary, true, null, d); res(d); },
    (c, d) => { const m = (d && d.error && d.error.info) || c; logEdit(r, p.summary, false, m); rej(new Error(m)); }));
}

/* ---------- Personality rights ({{Personality rights}} above the license header) ---------- */
const PR_TPL = '{{Personality rights}}', PR_PAGE = 'Template:Personality rights';
const PR_ICON = 'https://commons.wikimedia.org/wiki/Special:FilePath/PersonalityRightsHelper.png?width=48';
const PR_TEMPLATE_RE = /\{\{\s*(?:template\s*:\s*)?personality(?:[ _-]?rights?)?\s*(?:\||\}\})/i;
const PR_LICENSE_RE = /^[ \t]*==[ \t]*\{\{[ \t]*int:license-header[ \t]*\}\}[ \t]*==[ \t]*$/im;
const prTip = r => r.prBusy ? 'Adding {{Personality rights}}…' : r.pr === true ? '{{Personality rights}} is present' : r.pr === false ? 'Missing — click to add {{Personality rights}} above the license header' : 'Personality rights (checking…)';
function paintPR(b, r) { b.className = 'jv-pr' + (r.pr === true ? ' ok' : r.pr === false ? ' no' : '') + (r.prBusy ? ' busy' : ''); b.title = prTip(r); }
function mkPR(r, after) {
  const b = h('div', { onclick: async e => { e.stopPropagation(); await addPR(r); if (after) after(); } }, h('img', { src: PR_ICON, alt: 'Personality rights' }));
  paintPR(b, r); return b;
}
async function checkPR(recs) {
  for (let i = 0; i < recs.length; i += 50) {
    const part = recs.slice(i, i + 50);
    try {
      const d = await api.get({ action: 'query', prop: 'templates', titles: part.map(r => r.title).join('|'), tltemplates: PR_PAGE, tllimit: 'max', formatversion: 2 });
      const has = new Set(); (d.query.pages || []).forEach(p => { if (p.templates && p.templates.length) has.add(p.pageid); });
      part.forEach(r => { r.pr = has.has(r.id); refreshCard(r); });
    } catch (e) {}
  }
}
async function addPR(r) {
  if (r.pr === true) return setStatus('{{Personality rights}} is already on ' + r.name + '.');
  if (r.prBusy) return;
  r.prBusy = true; refreshCard(r);
  const summary = 'Adding ' + PR_TPL + ' using [[User:Manojk/PersonalityRightsHelper.js|PersonalityRightsHelper]] via Commons Data Weaver #DataWeaver' + projTag();
  try {
    const t = await getText(r);
    if (PR_TEMPLATE_RE.test(t)) r.pr = true;
    else {
      let nt;
      if (PR_LICENSE_RE.test(t)) nt = t.replace(PR_LICENSE_RE, hd => PR_TPL + '\n\n' + hd);
      else {
        if (!window.confirm('No =={{int:license-header}}== found in ' + r.name + '.\nAdd the template before the categories instead?')) return;
        const i = t.search(/^\s*\[\[\s*Category\s*:/im);
        nt = i === -1 ? t.replace(/\s*$/, '') + '\n\n' + PR_TPL + '\n' : t.slice(0, i).replace(/\s*$/, '') + '\n\n' + PR_TPL + '\n\n' + t.slice(i).replace(/^\s*/, '');
      }
      await post({ action: 'edit', pageid: r.id, text: nt, summary, nocreate: 1 }, r);
      r.pr = true; setStatus('Added ' + PR_TPL + ' to ' + r.name + '.');
    }
  } catch (e) { setStatus('Personality rights edit failed: ' + ((e && e.message) || e)); }
  finally { r.prBusy = false; refreshCard(r); }
}

/* ---------- my list: User:<you>/DataWeaver (one File: name per line) ---------- */
const ME = mw.config.get('wgUserName'), MYLIST = ME ? 'User:' + ME + '/DataWeaver' : null;
function parseWikiList(text) {
  const out = [], seen = new Set();
  String(text || '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).forEach(line => (line.match(/(?:File|Image)\s*:[^\]|\n<>{}]+/gi) || []).forEach(m => {
    try { m = decodeURIComponent(m); } catch (e) {}
    const t = 'File:' + m.replace(/^(?:File|Image)\s*:/i, '').replace(/_/g, ' ').trim();
    if (t.length > 5 && !seen.has(t)) { seen.add(t); out.push(t); }
  }));
  return out;
}
async function loadMyList() {
  if (!MYLIST) return setStatus('Log in to use your file list (User:<you>/DataWeaver).');
  setStatus('Reading ' + MYLIST + '…');
  let text = null;
  try {
    const d = await api.get({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: MYLIST, formatversion: 2 });
    const p = d.query.pages[0]; text = p.missing || !p.revisions ? null : p.revisions[0].slots.main.content;
  } catch (e) { return setStatus('Could not read ' + MYLIST + ': ' + ((e && e.message) || e)); }
  if (text == null) return setStatus('Tip: create ' + MYLIST + ' with one file per line (File:Example.jpg) and it will load here automatically.');
  const titles = parseWikiList(text);
  if (!titles.length) return setStatus(MYLIST + ' has no File: names yet.');
  await loadTitles(titles, 'mylist');
}

/* ---------- pending-change model ---------- */
const newPend = () => ({ addC: new Set(), remC: new Set(), addD: new Set(), remD: new Set(), loc: null });
const capDiff = r => Object.keys(Object.assign({}, r.capsOrig, r.caps)).filter(l => (r.caps[l] || '').trim() !== (r.capsOrig[l] || ''));
const ovDirty = r => !!r.ov && JSON.stringify(r.ov) !== r.ovOrig;
const ovEntryDirty = (r, o) => !JSON.parse(r.ovOrig || '[]').some(x => x.file === o.file && x.cap === o.cap);
const notesDirty = r => !!r.notes && JSON.stringify(r.notes) !== r.notesOrig;
const noteDirty = (r, n) => !JSON.parse(r.notesOrig || '[]').some(x => JSON.stringify(x) === JSON.stringify(n));
const pendCount = r => { const p = r.pend; return p.addC.size + p.remC.size + p.addD.size + p.remD.size + (p.loc ? 1 : 0) + capDiff(r).length + (notesDirty(r) ? 1 : 0) + (ovDirty(r) ? 1 : 0); };
const effDepicts = r => r.depicts.map(d => d.id).filter(id => !r.pend.remD.has(id)).concat([...r.pend.addD]);
const effCats = r => r.cats.filter(c => !r.pend.remC.has(c.n)).concat([...r.pend.addC].map(n => ({ n, hidden: false, added: true })));
const effLoc = r => r.pend.loc || (r.lat != null ? { lat: r.lat, lon: r.lon } : null);
function addDepicts(r, id) { r.depicts.some(d => d.id === id) ? r.pend.remD.delete(id) : r.pend.addD.add(id); }
function removeDepicts(r, id) { r.pend.addD.has(id) ? r.pend.addD.delete(id) : r.pend.remD.add(id); }
function addCat(r, n) { n = normCat(n); r.cats.some(c => c.n === n) ? r.pend.remC.delete(n) : r.pend.addC.add(n); }
function removeCat(r, n) { r.pend.addC.has(n) ? r.pend.addC.delete(n) : r.pend.remC.add(n); }

/* ---------- Wikidata / Commons lookups ---------- */
async function ensureWd(ids) {
  ids = [...new Set(ids)].filter(i => i && !WD[i]);
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const d = await wd.get({ action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props: 'labels|descriptions', languages: 'en', languagefallback: 1 });
      for (const id in d.entities) {
        const e = d.entities[id], f = o => (o && Object.values(o)[0] || {}).value;
        WD[id] = { label: f(e.labels) || id, desc: f(e.descriptions) || '' };
      }
    } catch (e) {}
  }
}
const fWD = async q => {
  const d = await wd.get({ action: 'wbsearchentities', search: q, language: 'en', uselang: 'en', type: 'item', limit: 10 });
  return (d.search || []).map(x => { WD[x.id] = { label: x.label || x.id, desc: x.description || '' }; return { id: x.id, label: x.label || x.id, sub: x.description || '' }; });
};
async function nsSearch(q, ns) {
  const prefix = ns === 14 ? 'Category:' : 'File:', bare = q.replace(new RegExp('^' + prefix, 'i'), '').replace(/_/g, ' ').trim(), up = bare.charAt(0).toUpperCase() + bare.slice(1);
  const strip = t => String(t).replace(/^[^:]+:/, '').replace(/_/g, ' ');
  const calls = [
    api.get({ action: 'opensearch', search: bare, namespace: ns, limit: 10 }).then(d => (d[1] || []).map(strip)),
    api.get({ action: 'query', list: 'prefixsearch', pssearch: bare, psnamespace: ns, pslimit: 10 }).then(d => d.query.prefixsearch.map(x => strip(x.title))),
    ns === 14 ? api.get({ action: 'query', list: 'allcategories', acprefix: up, aclimit: 10 }).then(d => d.query.allcategories.map(x => String(x['*'] || x.category).replace(/_/g, ' ')))
              : api.get({ action: 'query', list: 'allimages', aiprefix: up, ailimit: 10 }).then(d => d.query.allimages.map(x => String(x.name).replace(/_/g, ' ')))
  ].map(p => Promise.resolve(p).catch(() => []));
  const out = []; (await Promise.all(calls)).flat().forEach(n => { if (n && !out.includes(n)) out.push(n); });
  return out.slice(0, 12);
}
const fCat = async q => (await nsSearch(q, 14)).map(n => ({ label: n }));
const fFile = async q => (await nsSearch(q, 6)).map(n => ({ label: n }));
function warnCat(n) {
  n = normCat(n);
  catExists([n]).then(ex => { if (!ex[n]) setStatus('⚠ Category:' + n + ' does not exist on Commons yet (red link).'); }).catch(() => {});
}
const fPlaceWD = async q => {
  const d = await wd.get({ action: 'wbsearchentities', search: q, language: 'en', uselang: 'en', type: 'item', limit: 8 });
  const ids = (d.search || []).map(x => x.id); if (!ids.length) return [];
  const e = await wd.get({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims' });
  return d.search.map(x => {
    const c = (((e.entities[x.id] || {}).claims || {}).P625 || [])[0], v = c && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
    return v ? { id: x.id, label: x.label || x.id, sub: 'Wikidata · ' + (x.description || ''), lat: v.latitude, lon: v.longitude } : null;
  }).filter(Boolean);
};
const fPlaceOSM = async q => {
  const r = await fetch(DW.config.nominatimUrl + '?format=jsonv2&limit=6&accept-language=en&q=' + encodeURIComponent(q));
  return (await r.json()).map(x => ({ label: x.name || String(x.display_name).split(',')[0], sub: 'OpenStreetMap · ' + x.display_name, lat: +x.lat, lon: +x.lon }));
};
const fPlace = async q => {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
  if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return [{ label: m[1] + ', ' + m[2], sub: 'Coordinates', lat: +m[1], lon: +m[2] }];
  const [a, b] = await Promise.all([fPlaceWD(q).catch(() => []), (window.DW && DW.osmEnabled() ? fPlaceOSM(q) : Promise.resolve([])).catch(() => [])]);
  return a.concat(b);
};
async function catExists(names) {
  const out = {}; if (!names.length) return out;
  const d = await api.get({ action: 'query', titles: names.map(n => 'Category:' + n).join('|') });
  Object.values(d.query.pages).forEach(p => { out[normCat(p.title)] = p.missing === undefined; });
  return out;
}
async function taxonSuggest(id) {
  const d = await wd.get({ action: 'wbgetentities', ids: id, props: 'claims|labels', languages: 'en', languagefallback: 1 });
  const e = d.entities[id], cl = e.claims || {};
  const val = p => (cl[p] || []).map(c => c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter(v => typeof v === 'string');
  const lab = Object.values(e.labels || {})[0];
  const names = [...new Set([...val('P373'), ...val('P225'), lab && lab.value].filter(Boolean).map(normCat))];
  const ex = await catExists(names);
  return names.map(n => ({ n, exists: !!ex[n] }));
}
/* Commons category -> Wikidata subject. Uses the category's Wikidata link (sitelink); if there is none, the item whose
   "Commons category" (P373) equals the category name. A "Wikimedia category" item is followed to its main topic (P301). */
const CATWD = {}; // normalised category name -> { id, label, desc } | null
const catSig = r => effCats(r).map(c => c.n).join('|');
async function resolveCatWD(names) {
  names = [...new Set(names.map(normCat))].filter(n => CATWD[n] === undefined);
  if (!names.length) return;
  const qid = {};
  for (let i = 0; i < names.length; i += 40) {
    try {
      const d = await api.get({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: names.slice(i, i + 40).map(n => 'Category:' + n).join('|') });
      Object.values(d.query.pages || {}).forEach(p => { if (p.pageprops && p.pageprops.wikibase_item) qid[normCat(p.title)] = p.pageprops.wikibase_item; });
    } catch (e) {}
  }
  const rest = names.filter(n => !qid[n]);
  for (let i = 0; i < rest.length; i += 5) {
    await Promise.all(rest.slice(i, i + 5).map(async n => {
      try {
        const d = await wd.get({ action: 'query', list: 'search', srsearch: 'haswbstatement:P373="' + n.replace(/"/g, '') + '"', srnamespace: 0, srlimit: 1 });
        const hit = ((d.query || {}).search || [])[0]; if (hit) qid[n] = hit.title;
      } catch (e) {}
    }));
  }
  const ids = [...new Set(Object.values(qid))], ent = {};
  for (let i = 0; i < ids.length; i += 30) {
    try { Object.assign(ent, (await wd.get({ action: 'wbgetentities', ids: ids.slice(i, i + 30).join('|'), props: 'claims' })).entities || {}); } catch (e) {}
  }
  const SKIP = ['Q4167410', 'Q11266439', 'Q13406463'], subj = {}; // disambiguation, template, list
  names.forEach(n => {
    const e = ent[qid[n]]; if (!e) return;
    const vals = p => ((e.claims || {})[p] || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean), inst = vals('P31');
    if (inst.includes('Q4167836')) subj[n] = vals('P301')[0] || null; // Wikimedia category item -> its main topic
    else if (!inst.some(i => SKIP.includes(i))) subj[n] = qid[n];
  });
  await ensureWd(Object.values(subj).filter(Boolean));
  names.forEach(n => { CATWD[n] = subj[n] ? { id: subj[n], label: labelOf(subj[n]), desc: (WD[subj[n]] || {}).desc || '' } : null; });
}
async function catSubjects(recs) {
  const cnt = {};
  recs.forEach(r => effCats(r).filter(c => !c.hidden).forEach(c => { cnt[c.n] = (cnt[c.n] || 0) + 1; }));
  const names = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, 25);
  await resolveCatWD(names);
  const out = [];
  names.forEach(n => {
    const w = CATWD[n];
    if (w && !out.some(o => o.id === w.id)) out.push({ id: w.id, label: w.label, cat: n, fromCat: true,
      sub: (w.desc ? w.desc + ' · ' : '') + 'from category “' + n + '”' + (recs.length > 1 ? ' (' + cnt[n] + '/' + recs.length + ' files)' : '') });
  });
  return out;
}
async function detectFromCats(r) { return catSubjects([r]); }

/* ---------- loading ---------- */
async function listCategory(cat) {
  const titles = []; let cont = {};
  do {
    const d = await api.get(Object.assign({ action: 'query', list: 'categorymembers', cmtitle: 'Category:' + normCat(cat), cmtype: 'file', cmlimit: 'max' }, cont));
    titles.push(...d.query.categorymembers.map(m => m.title));
    cont = d.continue || null; setStatus('Listing category… ' + titles.length + ' files');
  } while (cont);
  return titles;
}
function parseList(text) {
  const rows = text.split(/\r?\n/).filter(l => l.trim()).map(l => {
    const o = []; let cur = '', q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; }
    o.push(cur); return o.map(s => s.trim());
  });
  if (!rows.length) return [];
  let col = 0, start = 0;
  const hi = rows[0].findIndex(x => /^(file|filename|file name|title|name)$/i.test(x));
  if (hi >= 0) { col = hi; start = 1; }
  return rows.slice(start).map(r => r[col]).filter(Boolean).map(s => {
    s = s.replace(/^https?:\/\/commons\.wikimedia\.org\/wiki\//, '');
    try { s = decodeURIComponent(s); } catch (e) {}
    s = s.replace(/_/g, ' ').trim();
    return 'File:' + s.replace(/^File:/i, '').trim();
  });
}
async function fetchBatch(titles) {
  const pages = {}; let cont = {};
  do {
    const d = await api.get(Object.assign({
      action: 'query', titles: titles.join('|'), prop: 'imageinfo|categories',
      iiprop: 'url|size|timestamp|user|mime|commonmetadata|extmetadata', iiurlwidth: 360,
      iiextmetadatafilter: 'Artist|LicenseShortName|DateTimeOriginal|DateTime|ImageDescription|GPSLatitude|GPSLongitude',
      cllimit: 'max', clprop: 'hidden'
    }, cont));
    Object.values(d.query.pages).forEach(p => {
      const k = p.pageid || p.title, q = pages[k] || (pages[k] = { pageid: p.pageid, title: p.title, categories: [] });
      if (p.missing !== undefined) q.missing = true;
      if (p.imageinfo) q.ii = p.imageinfo[0];
      (p.categories || []).forEach(c => q.categories.push(c));
    });
    cont = d.continue || null;
  } while (cont);
  return Object.values(pages);
}
function parseDescs(html) {
  const out = {}; if (!html) return out;
  const d = new DOMParser().parseFromString(html, 'text/html'), l = d.querySelectorAll('[lang]');
  if (l.length) l.forEach(e => { const k = e.getAttribute('lang'); if (!out[k]) out[k] = e.textContent.trim(); });
  else out.und = d.body.textContent.trim();
  return out;
}
function mkRec(p) {
  const ii = p.ii || {}, em = ii.extmetadata || {}, ev = k => em[k] ? em[k].value : '', cm = {};
  (ii.commonmetadata || []).forEach(x => { cm[x.name] = x.value; });
  const lat = parseFloat(ev('GPSLatitude')), lon = parseFloat(ev('GPSLongitude'));
  return {
    id: p.pageid, title: p.title, name: p.title.replace(/^File:/, ''), url: ii.descriptionurl, full: ii.url,
    thumb: ii.thumburl || ii.url, mime: ii.mime, w: ii.width || 0, h: ii.height || 0, bytes: ii.size || 0,
    upload: ii.timestamp || '', uploader: ii.user || '', author: txt(ev('Artist')), license: ev('LicenseShortName'),
    dateObs: txt(ev('DateTimeOriginal') || ev('DateTime')), camera: [cm.Make, cm.Model].filter(Boolean).join(' ').trim(),
    lat: isNaN(lat) ? null : lat, lon: isNaN(lon) ? null : lon, descs: parseDescs(ev('ImageDescription')),
    caps: {}, capsOrig: {}, depicts: [], mi: false,
    cats: p.categories.map(c => ({ n: normCat(c.title), hidden: c.hidden !== undefined })), pend: newPend(), status: ''
  };
}
async function loadMediainfo(recs) {
  for (let i = 0; i < recs.length; i += 40) {
    const part = recs.slice(i, i + 40);
    try {
      const d = await api.get({ action: 'wbgetentities', ids: part.map(r => 'M' + r.id).join('|'), props: 'labels|claims' });
      part.forEach(r => {
        const e = (d.entities || {})['M' + r.id] || {};
        r.caps = {}; for (const l in e.labels || {}) r.caps[l] = e.labels[l].value;
        r.capsOrig = Object.assign({}, r.caps);
        r.depicts = ((e.statements || e.claims || {}).P180 || []).filter(c => c.mainsnak && c.mainsnak.datavalue)
          .map(c => ({ id: c.mainsnak.datavalue.value.id, claim: c.id }));
        r.mi = true;
      });
    } catch (e) { part.forEach(r => { r.mi = true; }); }
    setStatus('Reading captions and depicts… ' + Math.min(i + 40, recs.length) + '/' + recs.length, (i + 40) / recs.length);
  }
  await ensureWd(recs.flatMap(r => r.depicts.map(d => d.id)));
  recs.forEach(refreshCard);
}
async function loadTitles(titles, source, isCategory) {
  titles = [...new Set(titles)];
  if (!titles.length) return setStatus('Nothing to load.');
  if (source) { S.source = source; S.srcCat = isCategory ? source : ''; }
  S.recs = []; S.sel.clear(); S.last = null; grid.innerHTML = '';
  for (let i = 0; i < titles.length; i += 50) {
    try {
      (await fetchBatch(titles.slice(i, i + 50))).filter(p => !p.missing && p.ii).forEach(p => S.recs.push(mkRec(p)));
    } catch (e) { setStatus('Load error: ' + e); }
    setStatus('Loading file details… ' + Math.min(i + 50, titles.length) + '/' + titles.length, (i + 50) / titles.length);
  }
  renderGrid();
  await loadMediainfo(S.recs);
  setStatus('Loaded ' + S.recs.length + ' files. Click images to select, ⤢ to inspect one by one.', 1);
  updateStats();
  checkPR(S.recs);
}

/* ---------- grid ---------- */
const SORT = {
  name: r => r.name.toLowerCase(), author: r => r.author.toLowerCase(), license: r => r.license.toLowerCase(),
  dateObs: r => r.dateObs, upload: r => r.upload, camera: r => r.camera.toLowerCase(),
  resolution: r => r.w * r.h, size: r => r.bytes, starred: r => isStar(r) ? 1 : 0
};
const depFilter = r => {
  const e = effDepicts(r), f = S.fDep;
  return f === 'all' || (f === 'missing' ? !e.length : f === 'has' ? e.length > 0 : f === 'unsaved' ? (r.pend.addD.size || r.pend.remD.size) > 0 : e.includes(f));
};
const visCats = r => effCats(r).filter(c => S.hidCats || !c.hidden);
const locFilter = r => S.fLoc === 'all' || (S.fLoc === 'missing' ? !effLoc(r) : !!effLoc(r));
const catFilter = r => S.fCat === 'all' || (S.fCat === 'missing' ? !visCats(r).length : visCats(r).length > 0);
function getView() {
  const t = S.fText.toLowerCase(), f = SORT[S.sort];
  return S.recs.filter(r => (!t || (r.name + ' ' + r.author + ' ' + r.license + ' ' + r.camera + ' ' + Object.values(r.caps).join(' ')).toLowerCase().includes(t))
    && (!S.fStar || (S.fStar === 'not' ? !isStar(r) : isStar(r))) && depFilter(r) && locFilter(r) && catFilter(r))
    .sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * S.dir; });
}
/* Thumbnails come from Wikimedia's thumbnail service, which makes a size when it is first asked for and can answer
   429 or 5xx while busy. A failed thumbnail is retried with growing pauses (then through Special:FilePath), and only
   then replaced by a grey tile with a ↻ button, so a busy moment never leaves a permanent blank. */
const NO_THUMB = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="100%" height="100%" fill="#e3e8e5"/><text x="120" y="86" font-family="sans-serif" font-size="13" fill="#6a7a73" text-anchor="middle">Preview not loaded</text></svg>');
function thumbImg(r, onFail) {
  const img = h('img', { src: r.thumb, alt: r.name, loading: 'lazy' }), bust = (u, n) => u + (u.includes('?') ? '&' : '?') + 'dwr=' + n;
  let tries = 0, retry = null;
  img.addEventListener('error', () => {
    if (img.src === NO_THUMB) return;
    tries++;
    if (tries <= 3) return void setTimeout(() => { img.src = tries === 2 && r.name ? imgUrl(r.name, 360) : bust(r.thumb, tries); }, 800 * tries * tries);
    img.src = NO_THUMB; img.classList.add('jv-nothumb');
    if (!retry && img.parentNode) {
      retry = h('div', { class: 'jv-retry', title: 'Try loading this preview again', onclick: e => { e.stopPropagation(); tries = 0; img.classList.remove('jv-nothumb'); img.src = bust(r.thumb, Date.now()); retry.remove(); retry = null; } }, '↻');
      img.parentNode.append(retry);
    }
  });
  return img;
}
function mkCard(r) {
  const el = h('div', { class: 'jv-card' },
    thumbImg(r),
    h('div', { class: 'jv-star', title: 'Star (session only)', onclick: e => { e.stopPropagation(); toggleStar(r); } }, '★'),
    mkPR(r), mkHelp(r),
    h('div', { class: 'jv-open', title: 'Inspect one by one', onclick: e => { e.stopPropagation(); openSingle(r); } }, '⤢'),
    h('div', { class: 'jv-tick' }, '✓'),
    h('div', { class: 'jv-badges' }),
    h('div', { class: 'jv-cap', title: r.name }, r.name));
  el.addEventListener('click', e => clickSelect(r, e));
  r.el = el; refreshCard(r); return el;
}
function refreshCard(r) {
  const sg = r.gid && S.groups[r.gid]; if (sg && sg.el) refreshGroupCard(sg);
  const el = r.el; if (!el) return;
  el.classList.toggle('sel', S.sel.has(r.id)); el.classList.toggle('starred', isStar(r));
  const prb = $('.jv-pr', el); if (prb) paintPR(prb, r);
  const hlb = $('.jv-help', el); if (hlb) paintHelp(hlb, r);
  const dn = effDepicts(r).length, pc = pendCount(r), b = $('.jv-badges', el); b.innerHTML = '';
  if (!r.mi) b.append(h('span', {}, '…'));
  else if (!dn) { b.title = ''; b.append(h('span', { class: r.pend.remD.size ? 'unsaved' : 'bad' }, 'no depicts')); }
  else {
    const ids = effDepicts(r), st = id => r.pend.addD.has(id) ? 'unsaved' : 'ok';
    b.title = ids.map(labelOf).join(', ');
    b.append(h('span', { class: (r.pend.addD.size || r.pend.remD.size) ? 'unsaved' : 'ok' }, '◈ ' + dn));
    ids.slice(0, 2).forEach(id => b.append(h('span', { class: 'dl ' + st(id) }, labelOf(id))));
    if (ids.length > 2) b.append(h('span', { class: 'ok' }, '+' + (ids.length - 2)));
  }
  if (effLoc(r)) b.append(h('span', { class: r.pend.loc ? 'unsaved' : 'ok' }, '⌖'));
  el.classList.toggle('dirty', pc > 0);
  if (pc) b.append(h('span', { class: 'pend' }, '● ' + pc));
  if (r.status === 'saved') b.append(h('span', { class: 'ok' }, 'saved'));
  if (r.status === 'error') b.append(h('span', { class: 'bad', title: r.err }, 'error'));
}
function clickSelect(r, e) {
  const i = S.view.indexOf(r);
  if (e.shiftKey && S.last != null) {
    const [a, b] = [Math.min(i, S.last), Math.max(i, S.last)];
    S.view.slice(a, b + 1).forEach(x => { S.sel.add(x.id); refreshCard(x); });
  } else { S.sel.has(r.id) ? S.sel.delete(r.id) : S.sel.add(r.id); refreshCard(r); }
  S.last = i; updateStats();
}
const ts = r => { const m = /(\d{4})[:\-](\d\d)[:\-](\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(r.dateObs || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : null; };
const stemOf = n => n.replace(/\.[^.]+$/, '').replace(/[\s_\-]*\(?\d+\)?\s*$/, '').trim().toLowerCase();
const GENERIC = /^(img|dsc|dscn|dscf|dsf|pxl|mvimg|photo|image|picture|screenshot|file|untitled|[a-z]{0,3})$/;
const repOf = g => g.members.find(r => r.isRep) || g.members[0];
function buildGroups() {
  S.groups = {}; S.recs.forEach(r => { r.gid = null; });
  if (S.gmode === 'none') return; // Ungrouped: all files shown individually
  const mk = (id, list, manual) => {
    if (list.length < 2) return;
    list.sort((a, b) => (a.dateObs || '').localeCompare(b.dateObs || '') || a.name.localeCompare(b.name));
    S.groups[id] = { id, members: list, manual }; list.forEach(r => { r.gid = id; });
  };
  const man = {}; S.recs.forEach(r => { if (r.mgid) (man[r.mgid] = man[r.mgid] || []).push(r); });
  Object.keys(man).forEach(id => mk(id, man[id], true));
  const free = S.recs.filter(r => !r.gid && !r.nogroup);
  if (S.gmode === 'time') {
    const part = {};
    free.forEach(r => { const t = ts(r); if (t == null) return; const k = r.camera || ('A:' + r.author); (part[k] = part[k] || []).push({ r, t }); });
    Object.values(part).forEach(a => {
      a.sort((x, y) => x.t - y.t); let cur = [a[0]];
      for (let i = 1; i <= a.length; i++) {
        if (i < a.length && a[i].t - a[i - 1].t <= S.gsec) cur.push(a[i]);
        else { mk('a' + cur[0].r.id, cur.map(x => x.r)); cur = i < a.length ? [a[i]] : []; }
      }
    });
  } else if (S.gmode === 'name') {
    const b = {}; free.forEach(r => { const k = stemOf(r.name); if (k.length < 4 || GENERIC.test(k)) return; (b[k] = b[k] || []).push(r); });
    Object.keys(b).forEach(k => mk('a' + b[k][0].id, b[k]));
  }
}
function entries() {
  const out = [], seen = new Set();
  S.view.forEach(r => { const g = r.gid && S.groups[r.gid]; if (!g) return out.push(r); if (!seen.has(g.id)) { seen.add(g.id); out.push(g); } });
  return out;
}
function mkGroupCard(g) {
  const rep = repOf(g);
  const el = h('div', { class: 'jv-card jv-gcard' },
    thumbImg(rep),
    h('div', { class: 'jv-open', title: 'Expand series (collage)', onclick: e => { e.stopPropagation(); openGroup(g); } }, '⤢'),
    h('div', { class: 'jv-tick' }, '✓'), h('div', { class: 'jv-badges' }),
    h('div', { class: 'jv-cap', title: g.members.map(r => r.name).join('\n') }, g.members.length + ' photos · ' + rep.name));
  el.addEventListener('click', () => {
    const all = g.members.every(r => S.sel.has(r.id));
    g.members.forEach(r => { all ? S.sel.delete(r.id) : S.sel.add(r.id); refreshCard(r); }); updateStats();
  });
  g.el = el; refreshGroupCard(g); return el;
}
function refreshGroupCard(g) {
  const el = g.el, ms = g.members, n = ms.length, sel = ms.filter(r => S.sel.has(r.id)).length;
  el.classList.toggle('sel', sel === n); el.classList.toggle('partsel', sel > 0 && sel < n); el.classList.toggle('starred', ms.some(isStar));
  const tagged = ms.filter(r => effDepicts(r).length).length, pc = ms.reduce((a, r) => a + pendCount(r), 0);
  const up = [...new Set(ms.map(r => r.uploader))], au = [...new Set(ms.map(r => r.author))], b = $('.jv-badges', el);
  el.classList.toggle('dirty', pc > 0); b.innerHTML = '';
  b.append(h('span', { class: 'ok' }, '▣ ' + n));
  b.append(h('span', { class: tagged === n ? 'ok' : tagged ? 'part' : 'bad', title: tagged + ' of ' + n + ' have depicts' }, '◈ ' + tagged + '/' + n));
  if (up.length > 1) b.append(h('span', { class: 'bad', title: 'Different uploaders: ' + up.join(', ') }, '⚠ ' + up.length + ' uploaders'));
  else if (au.length > 1) b.append(h('span', { class: 'part', title: 'Different authors: ' + au.join(', ') }, '⚠ authors differ'));
  if (pc) b.append(h('span', { class: 'pend' }, '● ' + pc));
}
let mgc = 0;
function groupSelected() {
  if (S.gmode === 'none') { S.gmode = 'manual'; serSel.value = 'manual'; secBox.style.display = 'none'; }
  const l = need(); if (l.length < 2) return setStatus('Select at least two photos to group them as a series.');
  const up = [...new Set(l.map(r => r.uploader))];
  if (up.length > 1 && !confirm('These photos were uploaded by ' + up.length + ' different users (' + up.join(', ') + '). Group them anyway?')) return;
  const id = 'm' + (++mgc); l.forEach(r => { r.mgid = id; r.nogroup = false; }); renderGrid(); setStatus('Grouped ' + l.length + ' photos as a series.'); return true;
}
function ungroupSelected() { const l = need(); if (!l.length) return false; l.forEach(r => { r.mgid = null; r.nogroup = true; }); renderGrid(); setStatus('Removed ' + l.length + ' photo(s) from their series.'); return true; }
function openGroup(g) {
  const box = h('div'), gm = h('div', { class: 'jv-dim' }, ''), body = h('div', { class: 'jv-modal-c' }, box, gm);
  S.gMsg = gm;
  const ms = () => g.members, targets = () => { const s = ms().filter(r => S.sel.has(r.id)); return s.length ? s : ms(); };
  const touchAll = l => { l.forEach(refreshCard); updateStats(); render(); };
  const setSel = on => { ms().forEach(r => { on ? S.sel.add(r.id) : S.sel.delete(r.id); refreshCard(r); }); updateStats(); render(); };
  async function linkAll() {
    setStatus('Reading file pages…'); await Promise.all(ms().map(loadNotes));
    ms().forEach(r => { if (!r.ov) return; ms().forEach(o => { if (o !== r) addOv(r, o.title, capOf(o)); }); refreshCard(r); });
    updateStats(); render(); setStatus('Other versions staged for ' + ms().length + ' photos (not saved yet).');
  }
  function render() {
    box.innerHTML = '';
    const up = {}; ms().forEach(r => { up[r.uploader] = (up[r.uploader] || 0) + 1; });
    const ul = Object.keys(up), au = [...new Set(ms().map(r => r.author))], nsel = ms().filter(r => S.sel.has(r.id)).length, who = nsel ? nsel + ' selected' : 'all ' + ms().length;
    if (ul.length > 1) box.append(h('div', { class: 'jv-gwarn' }, '⚠ These photos were uploaded by different users: ' + ul.map(u => u + ' (' + up[u] + ')').join(', ') + '. Check authorship and licence before tagging them together.'));
    else if (au.length > 1) box.append(h('div', { class: 'jv-gwarn soft' }, '⚠ Different authors: ' + au.join(', ')));
    box.append(h('div', { class: 'jv-gctl' },
      sugInput('Subject → depicts for ' + who + '…', fWD, async it => {
        await ensureWd([it.id]); const t = targets(); t.forEach(r => addDepicts(r, it.id));
        try { g.sugg = await taxonSuggest(it.id); } catch (e) { g.sugg = []; }
        touchAll(t);
      }, { pre: () => catSubjects(targets()), preHead: 'From the categories of these photos (linked to Wikidata)' }),
      sugInput('Category for ' + who + '…', fCat, it => { const t = targets(); t.forEach(r => addCat(r, it.label)); if (it.free) warnCat(it.label); touchAll(t); }, { free: true })));
    if (g.sugg && g.sugg.length) box.append(h('div', { class: 'jv-sugg' }, h('b', {}, 'Suggested categories: '),
      g.sugg.map(x => x.exists ? h('button', { class: 'jv-chipb', onclick: () => { const t = targets(); t.forEach(r => addCat(r, x.n)); touchAll(t); } }, '+ ' + x.n) : h('span', { class: 'jv-chipb off' }, x.n + ' (not found)'))));
    const fq = {}; ms().forEach(r => effDepicts(r).forEach(id => { fq[id] = (fq[id] || 0) + 1; }));
    box.append(h('div', { class: 'jv-chips' }, Object.keys(fq).length
      ? Object.keys(fq).map(id => h('span', { class: 'jv-chip' + (ms().some(r => r.pend.addD.has(id)) ? ' new' : '') }, labelOf(id) + ' ×' + fq[id] + '/' + ms().length))
      : h('span', { class: 'jv-warn' }, 'No depicts on any photo yet')));
    const col = h('div', { class: 'jv-collage' });
    ms().forEach(r => {
      const ar = r.w && r.h ? r.w / r.h : 1.5, ids = effDepicts(r);
      col.append(h('div', { class: 'jv-tile' + (S.sel.has(r.id) ? ' sel' : '') + (pendCount(r) ? ' dirty' : '') + (isStar(r) ? ' starred' : '') + (repOf(g) === r ? ' isrep' : ''),
        style: 'flex-grow:' + ar + ';width:' + Math.round(ar * 170) + 'px', title: r.name + '\n' + r.uploader + (r.dateObs ? ' · ' + r.dateObs : ''),
        onclick: () => { S.sel.has(r.id) ? S.sel.delete(r.id) : S.sel.add(r.id); refreshCard(r); updateStats(); render(); } },
        thumbImg(r),
        h('div', { class: 'jv-star', title: 'Star (session only)', onclick: e => { e.stopPropagation(); toggleStar(r); render(); } }, '★'),
        mkPR(r, render), mkHelp(r, render),
        h('div', { class: 'jv-rep', title: 'Use as series thumbnail', onclick: e => { e.stopPropagation(); ms().forEach(x => { x.isRep = false; }); r.isRep = true; renderGrid(); render(); } }, '⌂'),
        h('div', { class: 'jv-open', title: 'Inspect one by one', onclick: e => { e.stopPropagation(); m.remove(); openSingle(r); } }, '⤢'),
        h('div', { class: 'jv-tick' }, '✓'),
        h('div', { class: 'jv-tn' }, ids.length ? ids.map(id => h('span', { class: r.pend.addD.has(id) ? 'r' : '' }, labelOf(id) + ' ')) : h('span', { class: 'r' }, 'no depicts'), pendCount(r) ? ' ●' : '')));
    });
    box.append(col);
  }
  const m = modal('Photo series · ' + g.members.length + ' photos', body, [
    h('button', { onclick: () => setSel(true) }, 'Select all'), h('button', { onclick: () => setSel(false) }, 'Select none'),
    h('button', { onclick: linkAll, title: 'Each photo lists all the others under Other versions' }, 'Link all as Other versions'),
    h('button', { class: 'jv-primary', onclick: async () => { await saveMany(ms()); render(); } }, 'Save series'),
    h('button', { onclick: () => { ms().forEach(r => { r.mgid = null; r.nogroup = true; }); m.remove(); renderGrid(); } }, 'Ungroup'),
    h('button', { onclick: () => m.remove() }, 'Close')], true);
  render();
  S.gAct = { m, setSel, members: ms };
}
function renderGrid() {
  buildGroups(); S.view = getView(); grid.innerHTML = '';
  const ents = entries(), star = e => e.members ? e.members.some(isStar) : isStar(e);
  const add = (arr, title) => { if (title) grid.append(h('div', { class: 'jv-group' }, title)); arr.forEach(e => grid.append(e.members ? mkGroupCard(e) : (e.el || mkCard(e)))); };
  if (S.groupStar) {
    const a = ents.filter(star), b = ents.filter(e => !star(e));
    if (a.length) add(a, '★ Starred (' + a.length + ')');
    add(b, a.length ? 'Not starred (' + b.length + ')' : null);
  } else add(ents);
  if (!S.view.length) grid.append(h('div', { class: 'jv-empty' }, S.recs.length ? 'No files match the filter.' : 'Enter a category or paste a file list, then press Load.'));
  updateStats();
}
const selected = () => S.recs.filter(r => S.sel.has(r.id));

/* ---------- autocomplete ---------- */
function sugInput(ph, fetcher, onPick, o) {
  o = o || {};
  const thumbs = o.thumbs != null ? o.thumbs : fetcher === fWD; // Wikidata subject search shows the item's image on the right
  const input = h('input', { type: 'text', placeholder: ph, autocomplete: 'off' }), box = h('div', { class: 'jv-sug' });
  const wrap = h('div', { class: 'jv-sw' }, input, box); let t, seq = 0, pre = [], preTried = false;
  const pick = it => { box.style.display = 'none'; input.value = ''; onPick(it); };
  const row = it => h('div', { class: 'jv-sug-i', onmousedown: ev => { ev.preventDefault(); pick(it); } },
    h('div', { class: 'jv-sug-t' }, h('b', {}, it.label), it.id ? h('i', {}, ' ' + it.id) : '', it.sub ? h('div', {}, it.sub) : ''),
    thumbs && it.id ? wdThumb(it.id, 88) : '');
  const show = (items, head) => {
    box.innerHTML = '';
    if (!items.length) box.append(h('div', { class: 'jv-sug-n' }, 'No matches'));
    else { if (head) box.append(h('div', { class: 'jv-sug-h' }, head)); items.forEach(it => box.append(row(it))); }
    box.style.display = 'block';
    /* fixed position: boxes with their own scrollbars (one-by-one view, dialogs) never clip the list; it opens upwards near the screen bottom */
    const b = input.getBoundingClientRect(), below = innerHeight - b.bottom, up = below < 170 && b.top > below;
    box.style.position = 'fixed'; box.style.left = b.left + 'px'; box.style.right = 'auto'; box.style.width = Math.max(b.width, 240) + 'px';
    box.style.maxHeight = Math.max(120, Math.min(280, (up ? b.top : below) - 12)) + 'px';
    if (up) { box.style.top = 'auto'; box.style.bottom = (innerHeight - b.top) + 'px'; } else { box.style.bottom = 'auto'; box.style.top = b.bottom + 'px'; }
  };
  input.addEventListener('focus', async () => {
    if (!o.pre || input.value.trim()) return;
    try { pre = await o.pre(); } catch (e) { pre = []; }
    preTried = true;
    if (pre.length && document.activeElement === input && !input.value.trim()) show(pre, o.preHead || 'Suggested from categories (Wikidata)');
  });
  input.addEventListener('input', () => {
    clearTimeout(t); const q = input.value.trim(), my = ++seq;
    if (q.length < 2) { box.style.display = 'none'; return; }
    t = setTimeout(async () => {
      let items = [];
      if (o.pre && !preTried) { try { pre = await o.pre(); } catch (e) { pre = []; } preTried = true; }
      try { items = await fetcher(q); } catch (e) { setStatus('Search failed: ' + ((e && e.message) || e)); }
      if (my !== seq) return;
      const ql = q.toLowerCase(), m = pre.filter(p => p.label.toLowerCase().includes(ql) || (p.id || '').toLowerCase() === ql);
      items = m.concat(items.filter(x => !m.some(p => p.id && p.id === x.id)));
      if (!items.length && o.free) items = [{ label: q, sub: 'No match found. Press Enter to use as typed.', free: true }];
      show(items);
    }, o.delay || 250);
  });
  input.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; }, 150));
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const first = box.querySelector('.jv-sug-i');
    if (box.style.display === 'block' && first) first.dispatchEvent(new MouseEvent('mousedown'));
    else if (o.free && input.value.trim()) pick({ label: input.value.trim(), free: true });
  });
  return wrap;
}

/* ---------- minimal slippy map (Wikimedia tiles) ---------- */
function SlippyMap(el, o) {
  o = o || {}; let z = o.z || 5, c = { lat: o.lat == null ? 10.5 : o.lat, lon: o.lon == null ? 76.5 : o.lon }, mk = o.marker || null;
  const T = 256, n = () => Math.pow(2, z);
  const X = lon => (lon + 180) / 360 * n() * T;
  const Y = lat => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n() * T; };
  const LON = x => x / (n() * T) * 360 - 180;
  const LAT = y => { const a = Math.PI - 2 * Math.PI * y / (n() * T); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(a) - Math.exp(-a))); };
  el.classList.add('jv-map');
  const layer = h('div', { class: 'jv-map-l' }), pin = h('div', { class: 'jv-pin' }, '📍');
  const ctl = h('div', { class: 'jv-map-c' }, h('button', { type: 'button', onclick: () => zoom(1) }, '+'), h('button', { type: 'button', onclick: () => zoom(-1) }, '−'));
  el.append(layer, pin, ctl);
  function render() {
    const w = el.clientWidth || 400, hh = el.clientHeight || 300, x0 = X(c.lon) - w / 2, y0 = Y(c.lat) - hh / 2, N = n();
    layer.innerHTML = '';
    for (let tx = Math.floor(x0 / T); tx <= Math.floor((x0 + w) / T); tx++) for (let ty = Math.floor(y0 / T); ty <= Math.floor((y0 + hh) / T); ty++) {
      if (ty < 0 || ty >= N) continue;
      const im = h('img', { src: DW.tile(z, ((tx % N) + N) % N, ty), draggable: 'false' });
      im.style.cssText = 'left:' + Math.round(tx * T - x0) + 'px;top:' + Math.round(ty * T - y0) + 'px'; layer.append(im);
    }
    if (mk) { pin.style.display = 'block'; pin.style.left = (X(mk.lon) - x0) + 'px'; pin.style.top = (Y(mk.lat) - y0) + 'px'; } else pin.style.display = 'none';
  }
  function zoom(d) { z = Math.max(2, Math.min(18, z + d)); render(); }
  let drag = null;
  el.addEventListener('pointerdown', e => { if (e.target.closest('.jv-map-c')) return; drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    c = { lon: LON(X(c.lon) - dx), lat: LAT(Y(c.lat) - dy) }; render();
  });
  el.addEventListener('pointerup', e => {
    if (!drag) return;
    const moved = Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy); drag = null;
    if (moved < 5 && !o.readonly) {
      const r = el.getBoundingClientRect(), x0 = X(c.lon) - r.width / 2, y0 = Y(c.lat) - r.height / 2;
      mk = { lat: LAT(y0 + e.clientY - r.top), lon: LON(x0 + e.clientX - r.left) }; render(); if (o.onPick) o.onPick(mk);
    }
  });
  el.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  setTimeout(render, 30);
  return {
    set(lat, lon, zz, marker) { c = { lat, lon }; if (zz) z = zz; if (marker) mk = { lat, lon }; render(); },
    marker(m) { mk = m; render(); }, render
  };
}
function modal(title, body, buttons, wide) {
  const m = h('div', { class: 'jv-modal' }, h('div', { class: 'jv-modal-b' + (wide ? ' wide' : '') },
    h('div', { class: 'jv-modal-h' }, h('b', {}, title), h('button', { onclick: () => m.remove() }, '✕')), body,
    h('div', { class: 'jv-modal-f' }, buttons || [])));
  root.append(m); return m;
}
function openMapPicker(init, cb) {
  let pick = init ? { lat: init.lat, lon: init.lon } : null;
  const mapEl = h('div', { style: 'height:360px' });
  const latI = h('input', { type: 'number', step: 'any', placeholder: 'Latitude' }), lonI = h('input', { type: 'number', step: 'any', placeholder: 'Longitude' });
  const sync = () => { latI.value = pick ? pick.lat.toFixed(6) : ''; lonI.value = pick ? pick.lon.toFixed(6) : ''; };
  const M = SlippyMap(mapEl, { lat: pick && pick.lat, lon: pick && pick.lon, z: pick ? 13 : 5, marker: pick, onPick: p => { pick = p; sync(); } });
  const manual = () => { const a = parseFloat(latI.value), b = parseFloat(lonI.value); if (!isNaN(a) && !isNaN(b)) { pick = { lat: a, lon: b }; M.set(a, b, 13, true); } };
  latI.addEventListener('change', manual); lonI.addEventListener('change', manual); sync();
  const search = sugInput('Search places: Wikidata + OpenStreetMap, or type “lat, lon”', fPlace, it => { pick = { lat: it.lat, lon: it.lon }; M.set(it.lat, it.lon, 13, true); sync(); }, { delay: 500 });
  const m = modal('Pin location', h('div', { class: 'jv-modal-c' }, search, mapEl, h('div', { class: 'jv-row' }, latI, lonI), h('small', {}, 'Click the map to drop the pin, drag to pan, scroll to zoom. Place search uses Wikidata and OpenStreetMap (Nominatim); map © OpenStreetMap contributors.')), [
    h('button', { onclick: () => m.remove() }, 'Cancel'),
    h('button', { class: 'jv-primary', onclick: () => { if (pick) { cb(pick); m.remove(); } } }, 'Use this location')]);
}

/* ---------- saving ---------- */
async function getText(r) {
  const d = await api.get({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', pageids: r.id, formatversion: 2 });
  return d.query.pages[0].revisions[0].slots.main.content;
}
/* otherversions:start */
const INFO_RE = /\{\{\s*(?:Information|Photograph|Art Photo|Artwork|Book|Map|Specimen)\s*(?=[|\n}])/i;
const normFile = n => 'File:' + String(n || '').replace(/^\s*(?:File|Image)\s*:/i, '').replace(/_/g, ' ').trim();
function scanTemplate(t, s) {
  const tag = /<(gallery|nowiki|pre|source|syntaxhighlight)\b[^>]*>[\s\S]*?<\/\1\s*>/iy, com = /<!--[\s\S]*?-->/y;
  let i = s + 2, depth = 1, br = 0; const bars = [];
  while (i < t.length) {
    tag.lastIndex = i; com.lastIndex = i;
    const c = t[i] === '<' && (com.exec(t) || tag.exec(t));
    if (c) { i += c[0].length; continue; }
    const two = t.substr(i, 2);
    if (two === '{{') { depth++; i += 2; }
    else if (two === '}}') { depth--; if (!depth) return { closeAt: i, bars }; i += 2; }
    else if (two === '[[') { br++; i += 2; }
    else if (two === ']]') { br = Math.max(0, br - 1); i += 2; }
    else { if (t[i] === '|' && depth === 1 && !br) bars.push(i); i++; }
  }
  return null;
}
function infoParams(t) {
  const m = INFO_RE.exec(t); if (!m) return null;
  const tp = scanTemplate(t, m.index); if (!tp) return null;
  const segs = tp.bars.map((b, k) => {
    const to = k + 1 < tp.bars.length ? tp.bars[k + 1] : tp.closeAt, body = t.slice(b + 1, to), eq = body.indexOf('=');
    return { from: b, to, body, eq, name: eq > 0 ? body.slice(0, eq).trim().toLowerCase().replace(/[_\s]+/g, ' ') : '' };
  });
  return { tp, segs };
}
function parseOV(t) {
  const P = infoParams(t); if (!P) return [];
  const own = P.segs.find(x => x.name === 'other versions'); if (!own) return [];
  const gm = /<gallery\b[^>]*>([\s\S]*?)<\/gallery\s*>/i.exec(own.body.slice(own.eq + 1)); if (!gm) return [];
  return gm[1].split('\n').map(l => l.trim()).filter(l => l && !/^<!--/.test(l)).map(l => {
    const i = l.indexOf('|'); return { file: normFile(i < 0 ? l : l.slice(0, i)), cap: i < 0 ? '' : l.slice(i + 1).trim() };
  });
}
function setOtherVersions(t, ov) {
  const P = infoParams(t); if (!P) throw new Error('No {{Information}} template found. Add Other versions manually.');
  const gal = ov.length ? '<gallery>\n' + ov.map(o => o.file + (o.cap ? '|' + o.cap.replace(/\s*\n\s*/g, ' ') : '')).join('\n') + '\n</gallery>' : '';
  const own = P.segs.find(x => x.name === 'other versions');
  if (own) {
    const val = own.body.slice(own.eq + 1), galRe = /<gallery\b[^>]*>[\s\S]*?<\/gallery\s*>/i; let nv;
    if (galRe.test(val)) nv = val.replace(galRe, () => gal);
    else nv = gal ? (val.trim() ? val.replace(/\s*$/, '') + '\n' + gal + '\n' : ' ' + gal + '\n') : val;
    if (!gal && !nv.trim()) return t.slice(0, own.from) + t.slice(own.to);
    return t.slice(0, own.from) + '|' + own.body.slice(0, own.eq + 1) + nv + t.slice(own.to);
  }
  if (!gal) return t;
  const perm = P.segs.find(x => x.name === 'permission'), at = perm ? perm.to : P.tp.closeAt, before = t.slice(0, at);
  return before + (/\n$/.test(before) ? '' : '\n') + '| Other versions = ' + gal + '\n' + t.slice(at);
}
/* otherversions:end */
const ME_URL = 'https://meta.wikimedia.org/wiki/User:Manojk';
const LOGO = 'https://commons.wikimedia.org/wiki/Special:FilePath/DataWeaver.png?width=96';
/* Edit summary tag (MediaWiki summaries are single-line) */
const projTag = () => { const p = projCfg(); return S.project ? ' #' + ((p && p.tag) || S.project.replace(/[^A-Za-z0-9_-]/g, '')) : ''; };
const sumTail = () => 'Metadata updated with Commons Data Weaver via #DataWeaver' + projTag();
const plural = (n, w) => n + ' ' + w + (n > 1 ? 's' : '');
function noteStats(r) {
  const o = JSON.parse(r.notesOrig || '[]'), c = r.notes || [], oid = new Set(o.map(n => n.id)), cid = new Set(c.map(n => n.id));
  return { add: c.filter(n => !oid.has(n.id)).length, rem: o.filter(n => !cid.has(n.id)).length,
    chg: c.filter(n => oid.has(n.id) && JSON.stringify(n) !== JSON.stringify(o.find(x => x.id === n.id))).length };
}
function wikitextSummary(r) {
  const p = r.pend, parts = [], cl = a => [...a].map(n => '[[Category:' + n + ']]').join(', '), hc = helpCat();
  const addC = [...p.addC].filter(n => n !== hc), remC = [...p.remC].filter(n => n !== hc);
  if (addC.length) parts.push('Added ' + cl(addC));
  if (remC.length) parts.push('Removed ' + cl(remC));
  if (hc && p.addC.has(hc)) parts.push('Flagged as needing help (project ' + S.project + '): [[Category:' + hc + ']]');
  if (hc && p.remC.has(hc)) parts.push('Removed help-needed flag (project ' + S.project + '): [[Category:' + hc + ']]');
  if (p.loc) parts.push((r.lat == null ? 'Added' : 'Updated') + ' Geolocation');
  if (notesDirty(r)) { const k = noteStats(r); if (k.add) parts.push('Added ' + plural(k.add, 'image note')); if (k.chg) parts.push('Updated ' + plural(k.chg, 'image note')); if (k.rem) parts.push('Removed ' + plural(k.rem, 'image note')); }
  if (ovDirty(r)) { const had = JSON.parse(r.ovOrig || '[]').length; parts.push(r.ov.length ? (had ? 'Updated Other Versions' : 'Added Other Versions') : 'Removed Other Versions'); }
  const tail = sumTail(), max = Math.max(80, 480 - tail.length - 2); let t = parts.join(', '); if (t.length > max) t = t.slice(0, max) + '…';
  return t + ', ' + tail;
}
function parseNotes(t) {
  const out = [], re = /\{\{\s*ImageNote\s*\|([^{}]*)\}\}([\s\S]*?)\{\{\s*ImageNoteEnd\s*\|[^{}]*\}\}/gi; let m;
  while ((m = re.exec(t))) {
    const o = {}; m[1].split('|').forEach(kv => { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); });
    out.push({ id: o.id || String(out.length + 1), x: +o.x || 0, y: +o.y || 0, w: +o.w || 0, h: +o.h || 0, dimx: +o.dimx || 0, dimy: +o.dimy || 0, style: o.style || '2', text: m[2].trim() });
  }
  return out;
}
const serNote = n => '{{ImageNote|id=' + n.id + '|x=' + n.x + '|y=' + n.y + '|w=' + n.w + '|h=' + n.h + '|dimx=' + n.dimx + '|dimy=' + n.dimy + '|style=' + (n.style || '2') + '}}\n' + n.text.trim() + '\n{{ImageNoteEnd|id=' + n.id + '}}';
function editText(t, p, r) {
  if (r && ovDirty(r)) t = setOtherVersions(t, r.ov);
  const catRe = /\[\[\s*Category\s*:\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]\]/gi, rem = new Set([...p.remC].map(normCat));
  if (rem.size) t = t.replace(/\[\[\s*Category\s*:\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]\][ \t]*\n?/gi, (m, n) => rem.has(normCat(n)) ? '' : m);
  if (p.addC.size) {
    const ex = new Set(); t.replace(catRe, (m, n) => { ex.add(normCat(n)); return m; });
    const add = [...p.addC].filter(c => !ex.has(normCat(c))).map(c => '[[Category:' + c + ']]').join('\n');
    if (add) t = t.replace(/\s*$/, '') + '\n' + add + '\n';
  }
  const lic = /^(==\s*\{\{\s*int:license-header\s*\}\}\s*==)/mi;
  if (p.loc) {
    const tpl = '{{Location|' + p.loc.lat.toFixed(6) + '|' + p.loc.lon.toFixed(6) + '}}';
    const re = /\{\{\s*(?:Location|Location dec|Object location|Object location dec)\s*\|[^{}]*\}\}/i;
    if (re.test(t)) t = t.replace(re, () => tpl); else if (lic.test(t)) t = t.replace(lic, m => tpl + '\n\n' + m); else t = t.replace(/\s*$/, '') + '\n' + tpl + '\n';
  }
  if (r && notesDirty(r)) {
    const blocks = r.notes.filter(n => n.text.trim()).map(serNote).join('\n');
    if (/\{\{\s*ImageNote\s*\|/i.test(t)) {
      let first = true;
      t = t.replace(/\{\{\s*ImageNote\s*\|[^{}]*\}\}[\s\S]*?\{\{\s*ImageNoteEnd\s*\|[^{}]*\}\}[ \t]*\n?/gi, () => { if (first && blocks) { first = false; return blocks + '\n'; } return ''; });
    } else if (blocks) t = lic.test(t) ? t.replace(lic, m => blocks + '\n\n' + m) : t.replace(/\s*$/, '') + '\n' + blocks + '\n';
  }
  return t;
}
async function saveRec(r) {
  const p = r.pend;
  try {
    r.status = 'saving'; refreshCard(r);
    if (p.addD.size || p.remD.size) {
      const rem = [...p.remD].map(id => { const d = r.depicts.find(x => x.id === id); return d && { id: d.claim, remove: '' }; }).filter(Boolean);
      const claims = [...p.addD].map(id => ({ mainsnak: { snaktype: 'value', property: 'P180', datavalue: { value: { 'entity-type': 'item', 'numeric-id': +id.slice(1) }, type: 'wikibase-entityid' } }, type: 'statement', rank: 'normal' })).concat(rem);
      /* Wikibase already writes "Created claim: depicts (P180): …" in front of this text, so only the tool's tail is added */
      if (claims.length) await post({ action: 'wbeditentity', id: 'M' + r.id, data: JSON.stringify({ claims }), summary: sumTail() }, r);
    }
    for (const l of capDiff(r)) {
      const nv = (r.caps[l] || '').trim(), ov = r.capsOrig[l] || '';
      await post({ action: 'wbsetlabel', id: 'M' + r.id, language: l, value: nv, summary: (!ov ? 'Added' : !nv ? 'Removed' : 'Changed') + ' caption (' + l + '), ' + sumTail() }, r);
    }
    if (p.addC.size || p.remC.size || p.loc || notesDirty(r) || ovDirty(r)) {
      const t = await getText(r), nt = editText(t, p, r);
      if (nt !== t) await post({ action: 'edit', pageid: r.id, text: nt, summary: wikitextSummary(r), nocreate: 1 }, r);
    }
    r.cats = r.cats.filter(c => !p.remC.has(c.n)).concat([...p.addC].map(n => ({ n, hidden: false })));
    if (p.loc) { r.lat = p.loc.lat; r.lon = p.loc.lon; }
    if (r.notes) r.notesOrig = JSON.stringify(r.notes);
    if (r.ov) r.ovOrig = JSON.stringify(r.ov);
    r.pend = newPend(); r.status = 'saved';
    await loadMediainfo([r]);
  } catch (e) { r.status = 'error'; r.err = e.message || String(e); }
  refreshCard(r);
}
async function saveMany(list) {
  list = list.filter(r => pendCount(r)); if (!list.length) return setStatus('No unsaved changes.');
  for (let i = 0; i < list.length; i++) {
    setStatus('Saving ' + (i + 1) + '/' + list.length + ': ' + list[i].name, i / list.length);
    await saveRec(list[i]); updateStats();
  }
  const bad = list.filter(r => r.status === 'error').length;
  setStatus('Saved ' + (list.length - bad) + ' file(s)' + (bad ? ', ' + bad + ' failed (hover the red badge)' : '') + '.', 1);
}

/* ---------- save confirmation: counts and a quick overview before anything is written ---------- */
function confirmSave(list) {
  list = list.filter(r => pendCount(r));
  if (!list.length) return setStatus('No unsaved changes.');
  const t = { addD: 0, remD: 0, cap: 0, addC: 0, remC: 0, loc: 0, notes: 0, ov: 0, edits: 0 };
  const parts = r => {
    const p = r.pend, o = [];
    if (p.addD.size) o.push('+' + p.addD.size + ' depicts'); if (p.remD.size) o.push('−' + p.remD.size + ' depicts');
    if (capDiff(r).length) o.push(capDiff(r).length + ' caption(s)');
    if (p.addC.size) o.push('+' + p.addC.size + ' category'); if (p.remC.size) o.push('−' + p.remC.size + ' category');
    if (p.loc) o.push('location'); if (notesDirty(r)) o.push('image notes'); if (ovDirty(r)) o.push('other versions');
    return o.join(', ');
  };
  list.forEach(r => {
    const p = r.pend, cd = capDiff(r).length, wt = !!(p.addC.size || p.remC.size || p.loc || notesDirty(r) || ovDirty(r));
    t.addD += p.addD.size; t.remD += p.remD.size; t.cap += cd; t.addC += p.addC.size; t.remC += p.remC.size;
    t.loc += p.loc ? 1 : 0; t.notes += notesDirty(r) ? 1 : 0; t.ov += ovDirty(r) ? 1 : 0;
    t.edits += (p.addD.size || p.remD.size ? 1 : 0) + cd + (wt ? 1 : 0);
  });
  const rows = [['Depicts to add', t.addD], ['Depicts to remove', t.remD], ['Captions to change', t.cap], ['Categories to add', t.addC], ['Categories to remove', t.remC],
    ['Locations to set', t.loc], ['Files with image notes', t.notes], ['Files with other versions', t.ov]].filter(x => x[1] > 0);
  const m = modal('Save changes', h('div', { class: 'jv-modal-c' },
    h('div', {}, h('b', {}, list.length + ' file(s)'), ' with changes · about ' + t.edits + ' edit(s) on Commons'),
    h('table', { class: 'jv-meta' }, rows.map(x => h('tr', {}, h('th', {}, x[0]), h('td', {}, String(x[1]))))),
    h('div', { class: 'jv-dim' }, 'Edit summaries end with: ' + sumTail()),
    h('h4', {}, 'Files'),
    h('div', { style: 'max-height:180px;overflow:auto;font-size:13px' }, list.slice(0, 12).map(r => h('div', {}, h('b', {}, r.name), ' — ' + parts(r))),
      list.length > 12 ? h('div', { class: 'jv-dim' }, '… and ' + (list.length - 12) + ' more') : '')), [
    h('button', { onclick: () => m.remove() }, 'Cancel'),
    h('button', { class: 'jv-primary', onclick: () => { m.remove(); saveMany(list); } }, 'Save ' + list.length + ' file(s)')]);
}

/* ---------- export ---------- */
function exportList(scope) {
  const l = scope === 'selected' ? selected() : scope === 'starred' ? S.recs.filter(isStar) : scope === 'filtered' ? S.view : S.recs;
  return l.map(r => ({
    title: r.title, filename: r.name, page_url: r.url, file_url: r.full, author: r.author, license: r.license,
    observation_date: r.dateObs, upload_date: r.upload, uploader: r.uploader, camera: r.camera, width: r.w, height: r.h,
    megapixels: +(r.w * r.h / 1e6).toFixed(2), size_bytes: r.bytes, mime: r.mime, latitude: effLoc(r) && effLoc(r).lat, longitude: effLoc(r) && effLoc(r).lon,
    starred: isStar(r), captions: Object.assign({}, r.caps), descriptions: r.descs, categories: effCats(r).map(c => c.n),
    depicts: effDepicts(r).map(id => ({ id, label: (WD[id] || {}).label || '' })), annotations: (r.notes || []).map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, dimx: n.dimx, dimy: n.dimy, text: n.text })), series: r.gid || '', other_versions: (r.ov || []).map(o => ({ file: o.file, caption: o.cap })), unsaved_changes: pendCount(r)
  }));
}
const stampNow = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };
const safeName = x => String(x || 'list').normalize('NFC').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'list';
/* dataweaver-<category or source file>[-part]-<date>-<time>.<ext> (local time) */
const outName = (ext, part) => 'dataweaver-' + safeName(S.source) + (part ? '-' + part : '') + '-' + stampNow() + '.' + ext;
function download(name, mime, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name }); document.body.append(a); a.click(); a.remove();
}
function doExport(kind, scope) {
  const data = exportList(scope || 'all'); if (!data.length) return setStatus('Nothing to export for this scope.');
  const part = scope && scope !== 'all' ? scope : '';
  if (kind === 'json') return download(outName('json', part), 'application/json', JSON.stringify(data, null, 2));
  const cols = ['title', 'filename', 'page_url', 'file_url', 'author', 'license', 'observation_date', 'upload_date', 'uploader', 'camera', 'width', 'height', 'megapixels', 'size_bytes', 'mime', 'latitude', 'longitude', 'starred', 'captions', 'descriptions', 'categories', 'depicts', 'series', 'other_versions', 'annotations', 'unsaved_changes'];
  const cell = (k, v) => {
    if (v == null) v = '';
    else if (k === 'captions' || k === 'descriptions') v = Object.keys(v).map(l => l + ': ' + v[l]).join(' | ');
    else if (k === 'categories') v = v.join(' | ');
    else if (k === 'other_versions') v = v.map(o => o.file + (o.caption ? '|' + o.caption : '')).join(' || ');
    else if (k === 'annotations') v = v.map(n => n.text + ' @' + n.x + ',' + n.y + ',' + n.w + 'x' + n.h).join(' | ');
    else if (k === 'depicts') v = v.map(d => d.id + (d.label ? ' (' + d.label + ')' : '')).join(' | ');
    return '"' + String(v).replace(/"/g, '""') + '"';
  };
  download(outName('csv', part), 'text/csv', '\ufeff' + cols.join(',') + '\n' + data.map(r => cols.map(k => cell(k, r[k])).join(',')).join('\n'));
}

/* ---------- one-by-one view ---------- */
let SV = null;
function openSingle(r) {
  S.cur = r; if (!SV) { SV = h('div', { class: 'jv-single' }); root.append(SV); } SV.style.display = 'flex';
  renderSingle(); startDetect(r); loadNotes(r); preloadNeighbours();
}
function closeSingle() { if (SV) SV.style.display = 'none'; S.recs.forEach(refreshCard); updateStats(); }
/* warm the browser cache with the next and previous image at the chosen size, so ← / → feels instant */
function preloadNeighbours() {
  const i = S.view.indexOf(S.cur); if (i < 0) return;
  [i - 1, i + 1].forEach(k => { const x = S.view[k]; if (x) { const im = new Image(); im.src = imgSrc(x); } });
}
function step(d) {
  const i = S.view.indexOf(S.cur) + d; if (i < 0 || i >= S.view.length) return;
  S.cur = S.view[i]; renderSingle(); startDetect(S.cur); loadNotes(S.cur); preloadNeighbours();
}
const startDetectP = async r => { await startDetect(r); return (r._det || []).filter(d => !effDepicts(r).includes(d.id)); };
async function startDetect(r) {
  const sig = catSig(r); if (r._detSig === sig) return; r._detSig = sig;
  try { r._det = await detectFromCats(r); } catch (e) { r._det = []; }
  if (S.cur === r && SV.style.display !== 'none') renderSingle(true);
}
async function pickSpecies(r, it) {
  addDepicts(r, it.id); await ensureWd([it.id]);
  try { r._sugg = await taxonSuggest(it.id); } catch (e) { r._sugg = []; }
  renderSingle();
}
function loadNotes(r) {
  if (!r._np) r._np = (async () => {
    try { const t = await getText(r); r.notes = parseNotes(t); r.notesOrig = JSON.stringify(r.notes); r.ov = parseOV(t); r.ovOrig = JSON.stringify(r.ov); }
    catch (e) { r.notes = null; r.ov = null; r.notesErr = e.message || String(e); }
    if (S.cur === r && SV && SV.style.display !== 'none') renderSingle(true);
  })();
  return r._np;
}
const capOf = o => (o.caps && (o.caps.en || Object.values(o.caps)[0])) || '';
function addOv(r, title, cap) {
  const f = normFile(title);
  if (f === normFile(r.title)) return false;
  if (!r.ov.some(o => o.file === f)) r.ov.push({ file: f, cap: cap || '' });
  return true;
}
function ovSection(r) {
  const g = r.gid && S.groups[r.gid];
  if (!g && !(r.ov && r.ov.length)) return null;
  const sec = h('section', {}, h('h4', {}, 'Other versions'));
  if (r.ov === undefined) return sec.append(h('div', { class: 'jv-dim' }, 'Loading…')), sec;
  if (r.ov === null) return sec.append(h('div', { class: 'jv-bad' }, 'Could not read the file page: ' + r.notesErr)), sec;
  if (g) {
    const others = g.members.filter(o => o !== r), up = new Set(g.members.map(x => x.uploader));
    sec.append(h('div', { class: 'jv-row' }, h('span', {}, 'Series of ' + g.members.length + ' photos'),
      up.size > 1 ? h('span', { class: 'jv-bad' }, '⚠ ' + up.size + ' uploaders') : '', h('button', { onclick: () => openGroup(g) }, 'Open collage')));
    sec.append(h('div', { class: 'jv-row' },
      h('button', { class: 'jv-primary', onclick: () => { others.forEach(o => addOv(r, o.title, capOf(o))); renderSingle(true); } }, '+ Add other versions'),
      h('span', { class: 'jv-dim' }, 'lists the ' + others.length + ' other photo(s) of this series')));
  }
  r.ov.forEach((o, i) => sec.append(h('div', { class: 'jv-row' },
    h('a', { class: 'jv-ovn', href: mw.util.getUrl(o.file), target: '_blank', title: o.file }, o.file.replace(/^File:/, '')),
    h('input', { type: 'text', placeholder: 'caption', value: o.cap, class: ovEntryDirty(r, o) ? 'dirty' : '', oninput: e => { o.cap = e.target.value; e.target.classList.toggle('dirty', ovEntryDirty(r, o)); } }),
    h('button', { title: 'Remove', onclick: () => { r.ov.splice(i, 1); renderSingle(true); } }, '×'))));
  sec.append(sugInput('Add another Commons file…', fFile, it => { if (!addOv(r, 'File:' + it.label)) setStatus('A file cannot list itself as another version.'); renderSingle(true); }));
  sec.append(h('div', { class: 'jv-dim', style: 'font-size:12px' }, 'Saved in the Information template, after Permission.'));
  return sec;
}
const canAnnotate = () => /confirmed/.test((mw.config.get('wgUserGroups') || []).join(' ')); // same rule as the ImageAnnotator gadget config
function annotWrap(r) {
  const img = h('img', { src: imgSrc(r), alt: r.name, draggable: 'false' }), wrap = h('div', { class: 'jv-annwrap' + (S.annOn ? ' draw' : '') }, img);
  /* a size that Wikimedia cannot make (or is busy making) falls back to the preview that is already loaded in the grid */
  let big = 0; img.addEventListener('error', () => { big++; if (big === 1) setTimeout(() => { img.src = imgSrc(r) + (imgSrc(r).includes('?') ? '&' : '?') + 'dwr=1'; }, 1200); else if (big === 2 && r.thumb && img.src !== r.thumb) img.src = r.thumb; });
  (r.notes || []).forEach(n => {
    const dx = n.dimx || r.w, dy = n.dimy || r.h;
    wrap.append(h('div', { class: 'jv-note' + (noteDirty(r, n) ? ' dirty' : '') + (S.activeNote === n.id ? ' act' : ''), title: n.text,
      style: 'left:' + n.x / dx * 100 + '%;top:' + n.y / dy * 100 + '%;width:' + n.w / dx * 100 + '%;height:' + n.h / dy * 100 + '%',
      onclick: e => { e.stopPropagation(); S.activeNote = n.id; renderSingle(true); } }, h('span', {}, n.text || '(empty note)')));
  });
  wrap.addEventListener('mousedown', e => {
    if (!S.annOn || !r.notes || e.target.closest('.jv-note')) return; e.preventDefault();
    const b = img.getBoundingClientRect(), sx = e.clientX - b.left, sy = e.clientY - b.top, tmp = h('div', { class: 'jv-note tmp' }); let box = null;
    wrap.append(tmp);
    const cl = (v, m) => Math.max(0, Math.min(m, v));
    const mv = ev => {
      const x = cl(ev.clientX - b.left, b.width), y = cl(ev.clientY - b.top, b.height);
      box = { l: Math.min(sx, x), t: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) };
      tmp.style.cssText = 'left:' + box.l + 'px;top:' + box.t + 'px;width:' + box.w + 'px;height:' + box.h + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); tmp.remove();
      if (box && box.w > 8 && box.h > 8) {
        const fx = r.w / b.width, fy = r.h / b.height, id = String(Math.max(0, ...r.notes.map(n => +n.id || 0)) + 1);
        r.notes.push({ id, x: Math.round(box.l * fx), y: Math.round(box.t * fy), w: Math.round(box.w * fx), h: Math.round(box.h * fy), dimx: r.w, dimy: r.h, style: '2', text: '' });
        S.activeNote = id; renderSingle(true);
      }
    };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });
  return wrap;
}
/* one click: link a depicts item that is already on the file (saved or staged) into the note as [[:d:Q|label]] */
function depSuggest(r, n) {
  const ids = effDepicts(r);
  if (!ids.length) return h('div', { class: 'jv-dim jv-sugnone' }, 'No depicts on this file yet. Add them above and they appear here to link into the note.');
  const used = id => new RegExp('\\[\\[:d:' + id + '[|\\]]').test(n.text || '');
  return h('div', { class: 'jv-sugrow' }, h('span', { class: 'jv-dim' }, 'Click to link a depicts item:'),
    ...ids.map(id => h('button', { type: 'button', class: 'jv-sugchip' + (used(id) ? ' used' : ''), title: (WD[id] && WD[id].desc ? WD[id].desc + ' · ' : '') + id + (used(id) ? ' (already in this note)' : ' (adds it to the note)'),
      onclick: () => { n.text = (n.text ? n.text.replace(/\s+$/, '') + ' ' : '') + '[[:d:' + id + '|' + labelOf(id) + ']]'; renderSingle(true); } }, labelOf(id), h('small', {}, ' ' + id))));
}
function annSection(r) {
  const sec = h('section', {}, h('h4', {}, 'Image notes (ImageAnnotator)'));
  if (r.notes === undefined) return sec.append(h('div', { class: 'jv-dim' }, 'Loading notes…')), sec;
  if (r.notes === null) return sec.append(h('div', { class: 'jv-bad' }, 'Could not read the file page: ' + r.notesErr)), sec;
  const ok = canAnnotate();
  sec.append(h('div', { class: 'jv-row' },
    h('button', { class: S.annOn ? 'jv-primary' : '', disabled: !ok, onclick: () => { S.annOn = !S.annOn; renderSingle(true); } }, S.annOn ? '✎ Drawing: on' : '✎ Draw a note'),
    h('span', { class: 'jv-dim' }, !ok ? 'Needs an autoconfirmed account.' : S.annOn ? 'Drag a rectangle on the image.' : r.notes.length + ' note(s)')));
  r.notes.forEach(n => {
    const ta = h('textarea', { rows: 2, placeholder: 'Note text (wiki markup allowed)', class: noteDirty(r, n) ? 'dirty' : '',
      onfocus: () => { S.activeNote = n.id; SV.querySelectorAll('.jv-note').forEach((e, i) => e.classList.toggle('act', r.notes[i] === n)); },
      oninput: e => { n.text = e.target.value; e.target.classList.toggle('dirty', noteDirty(r, n)); } }, n.text);
    sec.append(h('div', { class: 'jv-nrow' + (noteDirty(r, n) ? ' dirty' : '') + (S.activeNote === n.id ? ' act' : '') },
      h('div', { class: 'jv-row' }, h('b', {}, 'Note ' + n.id), h('span', { class: 'jv-dim', style: 'flex:1' }, n.w + '×' + n.h + ' px'),
        h('button', { onclick: () => { r.notes.splice(r.notes.indexOf(n), 1); renderSingle(true); } }, 'Delete')),
      ta, depSuggest(r, n),
      sugInput('Link another subject → adds [[:d:Q…]] and depicts', fWD, it => { n.text = (n.text ? n.text + ' ' : '') + '[[:d:' + it.id + '|' + it.label + ']]'; addDepicts(r, it.id); renderSingle(true); })));
  });
  return sec;
}
/* ---- languages: the interface language chosen in the gear comes first, English is always shown too ---- */
const uiLang = () => { const l = (window.DW && DW.settings && DW.settings.lang) || ''; return l && l !== 'en' ? l : ''; };
const capLangs = () => (uiLang() ? [uiLang(), 'en'] : ['en']);
const orderLangs = (keys, pref) => pref.concat(keys.filter(k => !pref.includes(k)).sort());
['dw:language', 'dw:settings'].forEach(ev => document.addEventListener(ev, () => { if (SV && SV.style.display !== 'none') renderSingle(true); }));

/* ---- image size and fit: remembered for the next files ---- */
const SIZES = [500, 960, 1280, 1920, 3840]; // standard Wikimedia thumbnail widths, made on demand
function imgSrc(r) {
  const w = S.imgSize === 'orig' ? 0 : +S.imgSize;
  return !w || !r.w || w >= r.w ? (r.full || r.thumb) : imgUrl(r.name, w);
}
function setImg(o) {
  Object.assign(S, o);
  try { localStorage.setItem('dataweaver-img', JSON.stringify({ size: S.imgSize, fit: S.imgFit })); } catch (e) {}
  renderSingle(true);
}
function imgBar(r) {
  const opts = SIZES.filter(w => !r.w || w < r.w).map(w => h('option', { value: String(w) }, w + ' px'));
  opts.push(h('option', { value: 'orig' }, 'Original' + (r.w ? ' · ' + r.w + '×' + r.h : '')));
  const sel = h('select', { title: 'Image size. Wikimedia prepares these sizes when first asked, so a new size can take a moment. Your choice is kept for the next files.', onchange: e => setImg({ imgSize: e.target.value }) }, opts);
  sel.value = S.imgSize !== 'orig' && opts.some(o => o.value === S.imgSize) ? S.imgSize : 'orig';
  return h('div', { class: 'jv-imgbar' }, h('span', { class: 'jv-dim' }, 'Size'), sel,
    h('span', { class: 'jv-seg' },
      h('button', { class: S.imgFit === 'fit' ? 'jv-primary' : '', title: 'Show the whole image in the box', onclick: () => setImg({ imgFit: 'fit' }) }, 'Fit'),
      h('button', { class: S.imgFit === 'width' ? 'jv-primary' : '', title: 'Fill the width of the box and scroll down', onclick: () => setImg({ imgFit: 'width' }) }, 'Width')),
    h('a', { href: imgSrc(r), target: '_blank', rel: 'noopener', title: 'Open this image size in a new tab' }, '↗ New tab'),
    h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Open on Commons'));
}

function renderSingle(keepScroll) {
  const r = S.cur, eff = effDepicts(r), pc = pendCount(r), pref = capLangs(), multi = pref.length > 1;
  const keep = {};
  if (keepScroll) SV.querySelectorAll('[data-sc]').forEach(e => { keep[e.dataset.sc] = e.scrollTop; });
  SV.innerHTML = '';
  const twol = (a, b) => h('span', { class: 'jv-twol' }, a, h('br'), b);
  const head = h('div', { class: 'jv-sv-head' },
    h('button', { title: 'Previous file (←)', onclick: () => step(-1) }, '◀'), h('b', { class: 'jv-fname', title: r.name }, r.name),
    h('span', { class: 'jv-dim' }, (S.view.indexOf(r) + 1) + ' / ' + S.view.length),
    h('button', { title: 'Next file (→)', onclick: () => step(1) }, '▶'), h('span', { style: 'flex:1' }),
    h('button', { class: 'jv-starb' + (isStar(r) ? ' on' : ''), title: 'Star this file (Space)', onclick: () => { toggleStar(r); renderSingle(true); } }, isStar(r) ? '★ Starred' : '☆ Star'),
    h('button', { class: 'jv-starb jv-prb' + (r.pr === true ? ' ok' : r.pr === false ? ' no' : ''), title: prTip(r) + ' (P)', onclick: async () => { await addPR(r); renderSingle(true); } },
      h('img', { src: PR_ICON, alt: '', style: 'height:18px;vertical-align:middle' }), ' ', twol((r.pr === true ? '✔ ' : '✚ ') + 'Personality', 'rights')),
    S.project ? h('button', { class: 'jv-starb jv-helpb' + (isHelp(r) ? ' on' : '') + (helpCat() ? '' : ' off'), title: helpTip(r), onclick: () => { toggleHelp(r); renderSingle(true); } }, '⚑ ', twol('Help', 'needed')) : '',
    h('span', { class: r.status === 'error' ? 'jv-bad' : 'jv-dim' }, r.status === 'saved' && !pc ? 'Saved' : r.status === 'error' ? 'Error: ' + r.err : pc ? pc + ' unsaved' : ''),
    h('button', { class: 'jv-primary', onclick: async () => { await saveRec(r); renderSingle(true); } }, 'Save'),
    h('button', { class: 'jv-primary', onclick: async () => { await saveRec(r); step(1); } }, 'Save & next'),
    h('button', { class: 'jv-nextb', title: 'Next file without saving (→)', onclick: () => step(1) }, '▶'),
    h('button', { onclick: closeSingle, title: 'Close (Esc)' }, '✕'));

  // depicts: chips and hints scroll inside the box, the search box stays put
  const depL = h('div', { class: 'jv-scroll jv-depl', 'data-sc': 'dep' });
  if (eff.length) eff.forEach(id => { const w = WD[id] || {};
    depL.append(h('div', { class: 'jv-dchip' + (r.pend.addD.has(id) ? ' new' : '') },
      h('a', { href: 'https://www.wikidata.org/wiki/' + id, target: '_blank' }, w.label || id), h('small', {}, ' ' + id + (w.desc ? ' · ' + w.desc : '')),
      wdThumb(id, 120, 'lg'),
      h('button', { title: 'Remove depicts', onclick: () => { removeDepicts(r, id); renderSingle(true); } }, '×'))); });
  else depL.append(h('div', { class: 'jv-warn' }, 'No depicts yet. Identify the subject (species, place, object…) below.'));
  (r._det || []).filter(d => !eff.includes(d.id)).forEach(d => depL.append(h('div', { class: 'jv-hint' },
    'Category “' + d.cat + '” is linked to ', h('a', { href: 'https://www.wikidata.org/wiki/' + d.id, target: '_blank' }, h('b', {}, d.label)), ' (' + d.id + ') ',
    wdThumb(d.id, 88, 'sm'), h('button', { onclick: () => { addDepicts(r, d.id); renderSingle(true); } }, 'Use as depicts'))));
  const capLines = pref.map(l => r.caps[l] ? h('div', {}, h('b', {}, 'Caption' + (multi ? ' (' + l + ')' : '') + ': '), r.caps[l])
    : h('div', { class: 'jv-dim' }, 'No caption' + (multi ? ' (' + l + ')' : '')));
  const dl = pref.find(l => r.descs[l]) || Object.keys(r.descs)[0], desc = dl ? r.descs[dl] : '';
  const dep = h('section', { class: 'jv-box jv-dep' + (eff.length ? '' : ' none') }, depL,
    h('div', { class: 'jv-sub' }, capLines, desc ? h('div', {}, h('b', {}, 'Description' + (multi && dl ? ' (' + dl + ')' : '') + ': '), desc) : ''),
    sugInput('Subject (species, place, object…) → search Wikidata', fWD, it => pickSpecies(r, it), { pre: () => startDetectP(r), preHead: 'From this file’s categories (linked to Wikidata)' }));

  // categories (left) and file details (right) side by side, each scrolling on its own; the add box sits below both
  const cl = h('div', { class: 'jv-chips' });
  effCats(r).forEach(c => cl.append(h('span', { class: 'jv-chip' + (c.added ? ' new' : '') + (c.hidden ? ' hid' : '') },
    h('a', { href: mw.util.getUrl('Category:' + c.n), target: '_blank' }, c.n), h('button', { onclick: () => { removeCat(r, c.n); renderSingle(true); } }, '×'))));
  [...r.pend.remC].forEach(n => cl.append(h('span', { class: 'jv-chip del' }, n, h('button', { title: 'Undo', onclick: () => { addCat(r, n); renderSingle(true); } }, '↺'))));
  const left = h('div', { class: 'jv-cdl', 'data-sc': 'cdl' }, h('h4', {}, 'Categories'), cl);
  if (r._sugg && r._sugg.length) {
    const have = new Set(effCats(r).map(c => c.n)), todo = r._sugg.filter(s => s.exists && !have.has(s.n));
    left.append(h('div', { class: 'jv-sugg' }, h('b', {}, 'Suggested from Wikidata: '),
      r._sugg.map(s => s.exists ? (have.has(s.n) ? h('span', { class: 'jv-chipb off' }, '✓ ' + s.n) : h('button', { class: 'jv-chipb', onclick: () => { addCat(r, s.n); renderSingle(true); } }, '+ ' + s.n))
        : h('span', { class: 'jv-chipb off', title: 'No such category on Commons' }, s.n + ' (not found)')),
      todo.length > 1 ? h('button', { class: 'jv-primary', onclick: () => { todo.forEach(s => addCat(r, s.n)); renderSingle(true); } }, 'Add all') : ''));
  }
  const meta = h('table', { class: 'jv-meta' }, [
    ['Author', r.author], ['Licence', r.license], ['Observation date', r.dateObs], ['Uploaded', r.upload.slice(0, 10) + (r.uploader ? ' by ' + r.uploader : '')],
    ['Camera', r.camera], ['Dimensions', r.w + ' × ' + r.h + ' px (' + (r.w * r.h / 1e6).toFixed(1) + ' MP)'], ['File size', (r.bytes / 1048576).toFixed(2) + ' MB · ' + r.mime]
  ].map(x => h('tr', {}, h('th', {}, x[0]), h('td', {}, x[1] || '—'))));
  const right = h('div', { class: 'jv-cdr', 'data-sc': 'cdr' }, h('h4', {}, 'File details'), meta);
  const catBox = h('section', { class: 'jv-box jv-catbox' }, h('div', { class: 'jv-cd' }, left, right),
    sugInput('Add Commons category…', fCat, it => { addCat(r, it.label); if (it.free) warnCat(it.label); renderSingle(true); }, { free: true }));

  // location
  const loc = effLoc(r), mapEl = h('div', { class: 'jv-mapbox' });
  const locS = h('section', { class: 'jv-box jv-loc' }, h('h4', {}, 'Location'),
    h('div', { class: 'jv-row' }, h('span', { class: r.pend.loc ? 'jv-unsaved' : '' }, loc ? loc.lat.toFixed(5) + ', ' + loc.lon.toFixed(5) + (r.pend.loc ? ' (unsaved)' : '') : 'No location'),
      h('button', { onclick: () => openMapPicker(loc, p => { r.pend.loc = p; renderSingle(true); }) }, loc ? 'Change on map / search' : 'Pin on map / search'),
      r.pend.loc ? h('button', { onclick: () => { r.pend.loc = null; renderSingle(true); } }, 'Undo') : '', h('button', { onclick: () => { S.hideMap = !S.hideMap; renderSingle(true); } }, S.hideMap ? 'Show map' : 'Hide map')), S.hideMap ? '' : mapEl);

  // captions and descriptions: the interface language first, then English, then the rest
  const capBox = h('section', { class: 'jv-box', 'data-sc': 'cap' }, h('h4', {}, 'Captions (all languages)'));
  orderLangs(Object.keys(r.caps), pref).forEach(l => capBox.append(h('div', { class: 'jv-row' }, h('code', {}, l),
    h('input', { type: 'text', placeholder: 'Caption in ' + l, value: r.caps[l] || '', class: (r.caps[l] || '').trim() !== (r.capsOrig[l] || '') ? 'dirty' : '',
      oninput: e => { r.caps[l] = e.target.value; e.target.classList.toggle('dirty', e.target.value.trim() !== (r.capsOrig[l] || '')); } }))));
  const nl = h('input', { type: 'text', placeholder: 'lang', style: 'width:60px' }), nt = h('input', { type: 'text', placeholder: 'Caption in another language' });
  capBox.append(h('div', { class: 'jv-row' }, nl, nt, h('button', { onclick: () => { if (nl.value.trim() && nt.value.trim()) { r.caps[nl.value.trim()] = nt.value.trim(); renderSingle(true); } } }, 'Add')));
  capBox.append(h('h4', {}, 'Descriptions (all languages)'));
  const dk = orderLangs(Object.keys(r.descs), pref).filter(l => r.descs[l] !== undefined);
  if (!dk.length) capBox.append(h('div', { class: 'jv-dim' }, 'No description'));
  dk.forEach(l => capBox.append(h('div', { class: 'jv-row top' }, h('code', {}, l), h('div', {}, r.descs[l]))));

  const wrap = annotWrap(r), annS = annSection(r), ovS = ovSection(r);
  annS.classList.add('jv-box'); annS.dataset.sc = 'ann'; if (!ovS) annS.classList.add('span2');
  if (ovS) { ovS.classList.add('jv-box'); ovS.dataset.sc = 'ov'; }
  const imgPane = h('div', { class: 'jv-sv-img' + (S.imgFit === 'width' ? ' wide' : '') }, imgBar(r), h('div', { class: 'jv-imgbox', 'data-sc': 'img' }, wrap));
  SV.append(head, h('div', { class: 'jv-sv-body' }, imgPane, h('div', { class: 'jv-sv-side' }, dep, catBox, locS, capBox, ovS || '', annS)));
  if (!S.hideMap) SlippyMap(mapEl, { lat: loc && loc.lat, lon: loc && loc.lon, z: loc ? 13 : 4, marker: loc, readonly: true });
  if (keepScroll) SV.querySelectorAll('[data-sc]').forEach(e => { if (keep[e.dataset.sc] != null) e.scrollTop = keep[e.dataset.sc]; });
  if (r._detSig !== catSig(r)) startDetect(r);
}

/* ---------- main UI ---------- */
const root = h('div', { id: 'jv-root', style: 'display:none' });
const statusMsg = h('span', { class: 'jv-msg' }, 'Ready.'), bar = h('div', { class: 'jv-bar' }, h('div')), stats = h('span', { class: 'jv-stats' });
const grid = h('div', { class: 'jv-grid' });
function setStatus(m, pct) { statusMsg.textContent = m; if (S.gMsg && S.gMsg.isConnected) S.gMsg.textContent = m; if (pct != null) $('div', bar).style.width = Math.round(Math.min(1, pct) * 100) + '%'; }
function updateStats() {
  const un = S.recs.filter(r => pendCount(r)).length, n = S.sel.size, L = S.recs.length;
  const catN = all => S.recs.filter(r => !effCats(r).filter(c => all || !c.hidden).length).length;
  const noDep = S.recs.filter(r => !effDepicts(r).length).length, noLoc = S.recs.filter(r => !effLoc(r)).length, noCat = catN(false), noCatAll = catN(true);
  stats.textContent = '';
  stats.append('Loaded ' + L + ' · Showing ' + S.view.length + ' · ', h('b', { class: 'jv-selpill' + (n ? ' on' : '') }, 'Selected ' + n),
    ' · Starred ' + S.recs.filter(isStar).length + ' · Unsaved ' + un + ' · Missing: depicts ' + noDep + ', location ' + noLoc + ', category ' + noCat);
  const sc = $('#jv-selcount'); if (sc) { sc.textContent = n; sc.classList.toggle('on', n > 0); }
  try {
    const uns = S.recs.filter(r => r.pend.addD.size || r.pend.remD.size).length, set = (i, t) => { depSel.options[i].text = t; };
    set(1, 'Missing depicts (' + noDep + ')'); set(2, 'Has depicts (' + (L - noDep) + ')'); set(3, 'Unsaved depicts changes (' + uns + ')');
    set(4, 'Missing location (' + noLoc + ')'); set(5, 'Has location (' + (L - noLoc) + ')');
    set(6, 'Missing category · ignoring hidden cats (' + noCat + ')'); set(7, 'Missing category · counting hidden cats (' + noCatAll + ')'); set(8, 'Has category · ignoring hidden cats (' + (L - noCat) + ')');
  } catch (e) {}
}
const catIn = h('input', { type: 'text', placeholder: 'Category name, e.g. Fishes of Kerala', style: 'width:190px' });
const cfg = mw.config.get('wgNamespaceNumber') === 14 ? mw.config.get('wgTitle') : '';
catIn.value = cfg;
const mkSel = (opts, val, fn) => { const s = h('select', { onchange: e => fn(e.target.value) }, opts.map(o => h('option', { value: o[0] }, o[1]))); s.value = val; return s; };

const depSel = mkSel([['all', 'All files'], ['missing', 'Missing depicts'], ['has', 'Has depicts'], ['unsaved', 'Unsaved depicts changes'],
  ['loc-missing', 'Missing location'], ['loc-has', 'Has location'],
  ['cat-missing', 'Missing category · ignoring hidden cats'], ['cat-missing-all', 'Missing category · counting hidden cats'], ['cat-has', 'Has category · ignoring hidden cats']], 'all', v => setDepFilter(v));
function setDepFilter(v) {
  if (![...depSel.options].some(o => o.value === v)) depSel.append(h('option', { value: v }, 'Depicts: ' + labelOf(v)));
  depSel.value = v; S.fDep = 'all'; S.fLoc = 'all'; S.fCat = 'all'; S.hidCats = false;
  if (/^loc-/.test(v)) S.fLoc = v.slice(4);
  else if (/^cat-/.test(v)) { S.fCat = v.indexOf('missing') > 0 ? 'missing' : 'has'; S.hidCats = /-all$/.test(v); }
  else S.fDep = v;
  renderGrid();
}
const keysBtn = h('button', { onclick: () => keysModal(), title: 'Keyboard shortcuts (?)' }, '⌨ Keys');
function depictsFreq() {
  const m = new Map();
  S.recs.forEach(r => new Set(effDepicts(r)).forEach(id => {
    const e = m.get(id) || { id, count: 0, pending: 0 }; e.count++; if (r.pend.addD.has(id)) e.pending++; m.set(id, e);
  }));
  return [...m.values()];
}
function drawCloud(el, items, onPick) {
  el.innerHTML = '';
  if (!items.length) return el.append(h('div', { class: 'jv-empty' }, 'No depicts tagged yet.'));
  const W = el.clientWidth || 560, H = el.clientHeight || 420, ctx = document.createElement('canvas').getContext('2d'), placed = [];
  const max = items[0].count, min = items[items.length - 1].count, pal = ['#0b5c44', '#0b7a5a', '#2a8f6f', '#17302b', '#4d7c6a', '#1d6f8a'];
  items.slice(0, 80).forEach((it, k) => {
    let fs = 12 + (max === min ? 0.5 : Math.sqrt((it.count - min) / (max - min))) * 32;
    for (let tries = 0; tries < 5; tries++, fs *= 0.82) {
      ctx.font = '600 ' + fs + 'px "Segoe UI",system-ui,sans-serif';
      const w = ctx.measureText(it.label).width + 6, hh = fs * 1.2 + 2; let pos = null;
      for (let a = 0; a < 420 && !pos; a += 0.2) {
        const r = a * 2.2, x = W / 2 + r * Math.cos(a) * 1.5 - w / 2, y = H / 2 + r * Math.sin(a) - hh / 2;
        if (x >= 0 && y >= 0 && x + w <= W && y + hh <= H && !placed.some(p => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + hh > p.y)) pos = { x, y, w, h: hh };
      }
      if (pos) {
        placed.push(pos);
        const sp = h('span', { class: 'jv-cw', title: it.label + ' (' + it.id + ') · ' + it.count + ' file(s)', onclick: () => onPick(it.id) }, it.label);
        sp.style.cssText = 'left:' + pos.x + 'px;top:' + pos.y + 'px;font-size:' + fs + 'px;line-height:' + pos.h + 'px;color:' + (it.pending ? '#b3261e' : pal[k % pal.length]);
        el.append(sp); break;
      }
    }
  });
}
async function depictsModal() {
  if (!S.recs.length) return setStatus('Load files first.');
  const fr = depictsFreq(); await ensureWd(fr.map(f => f.id));
  fr.forEach(f => { f.label = labelOf(f.id); });
  fr.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const total = S.recs.length, tagged = S.recs.filter(r => effDepicts(r).length).length, cloud = h('div', { class: 'jv-cloud' });
  const tbl = fr.length ? h('table', { class: 'jv-ft' }, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Depicts'), h('th', {}, 'Files'), h('th', {}, '')),
    fr.map((f, i) => h('tr', {}, h('td', {}, i + 1),
      h('td', {}, h('a', { href: 'https://www.wikidata.org/wiki/' + f.id, target: '_blank' }, f.label), h('small', {}, ' ' + f.id), f.pending ? h('small', { class: 'jv-unsaved' }, ' · ' + f.pending + ' unsaved') : ''),
      h('td', {}, f.count),
      h('td', {}, h('div', { class: 'jv-fbar' }, h('div', { style: 'width:' + Math.round(f.count / fr[0].count * 100) + '%' }), h('span', {}, Math.round(f.count / total * 100) + '%')),
        h('button', { title: 'Show only these files', onclick: () => { m.remove(); setDepFilter(f.id); } }, '⌕'))))) : h('div', { class: 'jv-dim' }, 'No depicts tagged yet.');
  const csv = () => {
    const rows = ['rank,wikidata_id,label,files,percent_of_files,files_with_unsaved'].concat(fr.map((f, i) => [i + 1, f.id, '"' + f.label.replace(/"/g, '""') + '"', f.count, (f.count / total * 100).toFixed(1), f.pending].join(',')));
    download(outName('csv', 'depicts-frequency'), 'text/csv', '\ufeff' + rows.join('\n'));
  };
  const m = modal('Depicts overview', h('div', { class: 'jv-modal-c' },
    h('div', { class: 'jv-dim' }, tagged + ' of ' + total + ' files have depicts · ' + (total - tagged) + ' missing · ' + fr.length + ' distinct items. Click a word to filter the grid. Red = includes unsaved changes.'),
    h('div', { class: 'jv-dc' }, cloud, h('div', { class: 'jv-dlist' }, tbl))), [
    h('button', { onclick: csv }, 'Download CSV'), h('button', { class: 'jv-primary', onclick: () => m.remove() }, 'Close')], true);
  setTimeout(() => drawCloud(cloud, fr, id => { m.remove(); setDepFilter(id); }), 30);
}
function csvModal() {
  let nm = '';
  const ta = h('textarea', { rows: 10, placeholder: 'One filename per line, or CSV with a "filename"/"title" column.\nFile:Example.jpg' });
  const fi = h('input', { type: 'file', accept: '.csv,.txt,.tsv', onchange: e => { const f = e.target.files[0]; if (f) { nm = f.name.replace(/\.[^.]+$/, ''); f.text().then(t => { ta.value = t; }); } } });
  const m = modal('Load from CSV or list', h('div', { class: 'jv-modal-c' }, fi, ta), [
    h('button', { onclick: () => m.remove() }, 'Cancel'),
    h('button', { class: 'jv-primary', onclick: () => { const t = parseList(ta.value); m.remove(); loadTitles(t, nm || 'list'); } }, 'Load')]);
}
const projSel = h('select', { class: 'jv-projsel' + (S.project ? ' on' : ''), title: 'Project hashtag for edit summaries (default adds only #DataWeaver). A project also enables the Help needed button when it has a help category.', onchange: e => {
  S.project = e.target.value; e.target.classList.toggle('on', !!S.project);
  try { localStorage.setItem('dataweaver-project', S.project); } catch (x) {}
  setStatus(S.project ? 'Project ' + S.project + ': edit summaries will end with #DataWeaver' + projTag() + '.' + (helpCat() ? ' Help needed adds Category:' + helpCat() + '.' : ' No help category is set for it yet.') : 'Default project: edit summaries use only #DataWeaver.');
  applyProject();
} });
function applyProject() {
  root.classList.toggle('has-proj', !!S.project);
  S.recs.forEach(refreshCard); updateStats();
  if (SV && SV.style.display !== 'none') renderSingle(true);
}
function fillProj() {
  projSel.innerHTML = ''; projSel.append(h('option', { value: '' }, 'Project'), ...PROJ.map(p => h('option', { value: p.name }, p.name)));
  if (S.project && !PROJ.some(p => p.name === S.project)) S.project = '';
  projSel.value = S.project; projSel.classList.toggle('on', !!S.project); applyProject();
}
fillProj();
/* static/config/projects.json: [{ "name": "Folkland", "helpCategory": "…" }, …] */
fetch('/static/config/projects.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
  const list = j && Array.isArray(j.projects) ? j.projects.filter(p => p && PROJ_NAME_RE.test(p.name || '')).map(p => ({ name: p.name, tag: /^[A-Za-z0-9_-]{1,40}$/.test(p.tag || '') ? p.tag : p.name.replace(/[^A-Za-z0-9_-]/g, ''), helpCategory: String(p.helpCategory || '').trim() })) : [];
  if (list.length) { PROJ = list; fillProj(); }
}).catch(() => {});
const top = h('div', { class: 'jv-top' },
  h('div', { class: 'jv-brandw', title: 'Commons Data Weaver' }, h('img', { class: 'jv-logo', src: LOGO, alt: 'Data Weaver logo' }),
    h('b', { class: 'jv-brand' }, 'Commons', h('br'), 'Data Weaver')),
  projSel,
  catIn,
  h('button', { class: 'jv-primary', onclick: async () => { if (!catIn.value.trim()) return; try { const c = normCat(catIn.value); await loadTitles(await listCategory(c), c, true); } catch (e) { setStatus('Error: ' + e); } } }, 'Load category'),
  h('button', { onclick: csvModal }, 'CSV / list…'),
  h('button', { onclick: loadMyList, title: MYLIST ? 'Load the file list from ' + MYLIST : 'Log in to use your file list' }, 'My list'), h('span', { style: 'flex:1' }),
  h('button', { onclick: () => (window.DW && DW.stats ? DW.stats.open() : setStatus('Statistics are not available.')), title: 'Contributors, sizes, upload activity, cameras and a map of the loaded files' }, '▤ Statistics'),
  h('button', { onclick: depictsModal, title: 'Word cloud and frequency of tagged depicts' }, '◈ Depicts overview'),
  h('button', { class: 'jv-primary', onclick: () => confirmSave(S.recs) }, 'Save all changes'));
const starSel = mkSel([['off', '★ Stars: all files'], ['group', '★ Starred first'], ['only', '★ Only starred'], ['not', '☆ Only not starred']], 'off',
  v => { S.groupStar = v === 'group'; S.fStar = v === 'only' || v === 'not' ? v : false; renderGrid(); });
starSel.title = 'Show all files, starred files first, only starred files, or only files that are not starred';
const secBox = h('span', { style: 'display:none', title: 'Max seconds between shots (Auto by time)' },
  h('input', { type: 'number', min: '1', value: '60', style: 'width:56px', onchange: e => { S.gsec = Math.max(1, +e.target.value || 60); renderGrid(); } }), ' s');
const serSel = mkSel([['manual', 'Grouped (Manual)'], ['none', 'Ungrouped (All files)'], ['time', 'Auto by time'], ['name', 'Auto by file name']], 'manual', v => { S.gmode = v; secBox.style.display = v === 'time' ? '' : 'none'; renderGrid(); });
const dlSel = h('select', { title: 'Download the file data', onchange: e => { const v = e.target.value; e.target.value = ''; if (v) { const k = v.split(':'); doExport(k[0], k[1]); } } },
  h('option', { value: '' }, '⬇ Download'),
  ['json', 'csv'].map(k => h('optgroup', { label: k.toUpperCase() }, [['all', 'All files'], ['filtered', 'Filtered'], ['selected', 'Selected'], ['starred', 'Starred']].map(x => h('option', { value: k + ':' + x[0] }, k.toUpperCase() + ' · ' + x[1])))));
dlSel.value = '';
const toggle = h('button', { class: 'jv-toggle', title: 'Show or hide the batch edit panel (B). It changes every selected file at once.', onclick: () => {
  main.classList.toggle('collapsed'); toggle.textContent = main.classList.contains('collapsed') ? '⇔ Batch edit' : '⇔ Hide batch edit';
} }, '⇔ Batch edit');
const selAll = () => { S.view.forEach(r => S.sel.add(r.id)); touch(S.view); setStatus('Selected all ' + S.view.length + ' shown file(s).'); };
const selNone = () => { const l = selected(); S.sel.clear(); touch(l); setStatus('Selection cleared.'); };
const selInvert = () => { S.view.forEach(r => S.sel.has(r.id) ? S.sel.delete(r.id) : S.sel.add(r.id)); touch(S.view); setStatus('Selection inverted: ' + S.sel.size + ' of ' + S.view.length + ' shown file(s) selected.'); };
const tools = h('div', { class: 'jv-tools' }, toggle,
  h('span', { class: 'jv-selg' }, 'Select', h('button', { onclick: selAll, title: 'Select all shown files (A)' }, 'All'), h('button', { onclick: selNone, title: 'Clear the selection (Esc)' }, 'None'),
    h('button', { onclick: selInvert, title: 'Select what is not selected, among the shown files (I)' }, 'Invert')),
  h('span', {}, 'Sort'), mkSel([['name', 'Filename'], ['author', 'Author'], ['license', 'Licence'], ['dateObs', 'Observation date'], ['upload', 'Upload date'], ['camera', 'Camera'], ['resolution', 'Resolution'], ['size', 'File size'], ['starred', 'Starred']], 'name', v => { S.sort = v; renderGrid(); }),
  mkSel([['1', '↑ Asc'], ['-1', '↓ Desc']], '1', v => { S.dir = +v; renderGrid(); }),
  starSel, h('span', {}, 'Filter'), depSel, h('span', {}, 'Series'), serSel, secBox,
  h('input', { type: 'search', placeholder: 'Filter…', oninput: e => { S.fText = e.target.value; renderGrid(); } }), keysBtn, h('span', { style: 'flex:1' }),
  dlSel);

/* batch panel */
const bDepL = h('div', { class: 'jv-chips' }), bCatL = h('div', { class: 'jv-chips' });
function renderBatch() {
  bDepL.innerHTML = ''; S.bDep.forEach((d, i) => bDepL.append(h('span', { class: 'jv-chip' }, d.label + ' ' + d.id, h('button', { onclick: () => { S.bDep.splice(i, 1); renderBatch(); } }, '×'))));
  bCatL.innerHTML = ''; S.bCat.forEach((c, i) => bCatL.append(h('span', { class: 'jv-chip' }, c, h('button', { onclick: () => { S.bCat.splice(i, 1); renderBatch(); } }, '×'))));
}
const need = () => { const s = selected(); if (!s.length) setStatus('Select images first (click them in the grid).'); return s; };
const touch = l => { l.forEach(refreshCard); updateStats(); };
const bLat = h('input', { type: 'number', step: 'any', placeholder: 'Latitude' }), bLon = h('input', { type: 'number', step: 'any', placeholder: 'Longitude' });
const logBody = h('div', { class: 'jv-logbody' }), logHead = h('button', { class: 'jv-loghead', onclick: () => logWrap.classList.toggle('open') }, 'Edit log (0)');
const logWrap = h('div', { class: 'jv-log' }, logHead, logBody);
const plain = x => String(x || '').replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[:?([^\]]*)\]\]/g, '$1');
function renderLog() {
  logHead.textContent = 'Edit log (' + S.log.length + ')'; logBody.innerHTML = '';
  if (!S.log.length) logBody.append(h('div', { class: 'jv-lg jv-dim' }, 'No edits in this session yet.'));
  S.log.slice().reverse().forEach(e => logBody.append(h('div', { class: 'jv-lg' },
    h('span', { class: e.ok ? 'jv-okc' : 'jv-bad' }, e.time + (e.ok ? ' ✓ ' : ' ✗ ')),
    h('a', { href: mw.util.getUrl(e.title), target: '_blank' }, e.name),
    e.rev ? h('a', { href: mw.util.getUrl('Special:Diff/' + e.rev), target: '_blank' }, ' (diff)') : '',
    h('div', {}, plain(e.summary)), e.err ? h('div', { class: 'jv-bad' }, e.err) : '')));
}
function logEdit(r, summary, ok, err, d) {
  const rev = d && ((d.edit && d.edit.newrevid) || (d.entity && d.entity.lastrevid));
  S.log.push({ time: new Date().toLocaleTimeString(), title: r ? r.title : '', name: r ? r.name : '', summary, ok, err, rev }); renderLog();
}
renderLog();
const panel = h('aside', { class: 'jv-panel' }, h('div', { class: 'jv-pbody' },
  h('h3', {}, 'Batch edit'),
  h('div', { class: 'jv-warnnote' }, '⚠ These actions change ALL selected files at once. Check the Selected count first. Nothing is saved until you press Save.'),
  h('div', {}, 'Selected: ', h('b', { id: 'jv-selcount', class: 'jv-selpill' }, '0')),
  h('div', { class: 'jv-btns' },
    h('button', { onclick: () => { S.sel.clear(); S.recs.filter(isStar).forEach(r => S.sel.add(r.id)); touch(S.recs); }, title: 'Select the starred files' }, 'Select starred'),
    h('button', { onclick: () => { const l = need(); l.forEach(r => { if (!isStar(r)) toggleStar(r); }); } }, '★ Star'),
    h('button', { onclick: () => { const l = need(); l.forEach(r => { if (isStar(r)) toggleStar(r); }); } }, '☆ Unstar'),
    h('button', { onclick: groupSelected, title: 'Group the selected photos as one series (G)' }, '▣ Group (G)'),
    h('button', { onclick: ungroupSelected, title: 'Remove the selected photos from their series (U)' }, '▢ Ungroup (U)')),
  h('h4', {}, 'Depicts (P180)'),
  sugInput('Search Wikidata item…', fWD, it => { if (!S.bDep.some(d => d.id === it.id)) S.bDep.push({ id: it.id, label: it.label }); renderBatch(); }), bDepL,
  h('div', { class: 'jv-btns' },
    h('button', { class: 'jv-primary', onclick: () => { const l = need(); l.forEach(r => S.bDep.forEach(d => addDepicts(r, d.id))); touch(l); setStatus('Depicts added to ' + l.length + ' file(s) — not saved yet.'); } }, 'Add to selected'),
    h('button', { onclick: () => { const l = need(); l.forEach(r => S.bDep.forEach(d => removeDepicts(r, d.id))); touch(l); } }, 'Remove')),
  h('h4', {}, 'Categories'),
  sugInput('Search Commons category…', fCat, it => { if (!S.bCat.includes(it.label)) S.bCat.push(it.label); if (it.free) warnCat(it.label); renderBatch(); }, { free: true }), bCatL,
  h('div', { class: 'jv-btns' },
    h('button', { class: 'jv-primary', onclick: () => { const l = need(); l.forEach(r => S.bCat.forEach(c => addCat(r, c))); touch(l); setStatus('Categories added to ' + l.length + ' file(s) — not saved yet.'); } }, 'Add to selected'),
    h('button', { onclick: () => { const l = need(); l.forEach(r => S.bCat.forEach(c => removeCat(r, normCat(c)))); touch(l); } }, 'Remove')),
  h('h4', {}, 'Location'),
  h('div', { class: 'jv-row' }, bLat, bLon),
  h('div', { class: 'jv-btns' },
    h('button', { onclick: () => { const a = parseFloat(bLat.value), b = parseFloat(bLon.value); openMapPicker(isNaN(a) || isNaN(b) ? null : { lat: a, lon: b }, p => { bLat.value = p.lat.toFixed(6); bLon.value = p.lon.toFixed(6); }); } }, 'Pin / search on map'),
    h('button', { class: 'jv-primary', onclick: () => { const a = parseFloat(bLat.value), b = parseFloat(bLon.value); if (isNaN(a) || isNaN(b)) return setStatus('Enter or pick a location first.'); const l = need(); l.forEach(r => { r.pend.loc = { lat: a, lon: b }; }); touch(l); } }, 'Apply to selected')),
  h('h4', {}, 'Save'),
  h('div', { class: 'jv-btns' },
    h('button', { class: 'jv-primary', onclick: () => { const l = need(); if (l.length) saveMany(l); } }, 'Save selected'),
    h('button', { class: 'jv-primary', onclick: () => confirmSave(S.recs) }, 'Save all changes'))), logWrap);
const main = h('div', { class: 'jv-main collapsed' }, panel, h('div', { class: 'jv-gridwrap' }, grid));
root.append(top, tools, main, h('div', { class: 'jv-status' }, statusMsg, bar, stats),
  h('div', { class: 'jv-credit' }, h('span', {}, '© Commons Data Weaver, 2026'),
    h('span', {}, 'built and maintained by ', h('a', { href: ME_URL, target: '_blank' }, 'Manoj Karingamadathil'), ', Wikimedia Biodiversity Taskforce, Sahya Digital Conservation Foundation')));
document.body.append(root);
renderGrid();

function keysModal() {
  const rows = [['A', 'Select all files in the open window (the grid, or an open series)'], ['G', 'Group the selected files as one series'], ['U', 'Ungroup the selected files'],
    ['I', 'Invert the selection among the shown files'], ['Space', 'Star / unstar the selected files (in the one-by-one view: the open file)'], ['B', 'Show or hide the batch edit panel'],
    ['Esc', 'Clear the selection (in an open series or the one-by-one view, Esc again closes it)'], ['← / →', 'Previous / next file in the one-by-one view'],
    ['P', 'One-by-one view: add {{Personality rights}} to the open file'], ['H', 'One-by-one view: flag the open file as needing help (needs a project with a help category)'], ['Ctrl+M', 'In any text field: switch between the system keyboard (default) and your typing tool from the gear ⚙ (this one works while typing)'], ['?', 'Show this list']];
  const m = modal('Keyboard shortcuts', h('div', { class: 'jv-modal-c' }, h('table', { class: 'jv-meta' }, rows.map(x => h('tr', {}, h('th', {}, h('kbd', {}, x[0])), h('td', {}, x[1])))),
    h('small', { class: 'jv-dim' }, 'Shortcuts are ignored while you are typing in a field.')), [h('button', { class: 'jv-primary', onclick: () => m.remove() }, 'Close')]);
}
document.addEventListener('keydown', e => {
  if (root.style.display === 'none' || e.defaultPrevented) return;
  const el = document.activeElement, typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  const k = e.key, single = SV && SV.style.display !== 'none';
  const ms = root.querySelectorAll('.jv-modal'), top = ms[ms.length - 1], gm = S.gAct && S.gAct.m.isConnected ? S.gAct : null;
  if (!single && !top && window.DW && DW.stats && DW.stats.isOpen()) { if (k === 'Escape') { e.preventDefault(); DW.stats.close(); } return; }
  if (k === 'Escape') {
    if (typing) { el.blur(); return; }
    e.preventDefault();
    if (top) { if (gm && top === gm.m && gm.members().some(r => S.sel.has(r.id))) gm.setSel(false); else top.remove(); }
    else if (single) closeSingle();
    else { const l = selected(); if (l.length) { S.sel.clear(); touch(l); setStatus('Selection cleared.'); } }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (single && !top) {
    if (k === 'ArrowRight') step(1); else if (k === 'ArrowLeft') step(-1);
    else if (k === ' ' || k === 'Spacebar') { e.preventDefault(); if (el && el.tagName === 'BUTTON') el.blur(); toggleStar(S.cur); renderSingle(true); }
    else if (k.toLowerCase() === 'p') { e.preventDefault(); addPR(S.cur).then(() => renderSingle(true)); }
    else if (k.toLowerCase() === 'h') { e.preventDefault(); toggleHelp(S.cur); renderSingle(true); }
    return;
  }
  if (top && !(gm && top === gm.m)) return; // other dialogs keep their own keys
  const c = k.toLowerCase();
  if (k === ' ' || k === 'Spacebar') {
    e.preventDefault(); if (el && el.tagName === 'BUTTON') el.blur();
    const l = selected(); if (!l.length) return setStatus('Select files first, then press Space to star them.');
    const allOn = l.every(isStar); l.forEach(r => { if (allOn ? isStar(r) : !isStar(r)) toggleStar(r); });
    setStatus((allOn ? 'Unstarred ' : 'Starred ') + l.length + ' file(s).'); return;
  }
  if (c === 'i') { e.preventDefault(); selInvert(); return; }
  if (c === 'b') { e.preventDefault(); toggle.click(); return; }
  if (c === 'a') {
    e.preventDefault();
    if (gm) gm.setSel(true); else { S.view.forEach(r => S.sel.add(r.id)); touch(S.view); setStatus('Selected all ' + S.view.length + ' shown file(s).'); }
  } else if (c === 'g') { e.preventDefault(); if (groupSelected() && gm && gm.m.isConnected) gm.m.remove(); }
  else if (c === 'u') { e.preventDefault(); if (ungroupSelected() && gm && gm.m.isConnected) gm.m.remove(); }
  else if (k === '?') { e.preventDefault(); keysModal(); }
});

/* ---------- styles ---------- */
mw.util.addCSS(`
#jv-root{position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;background:#eef2ef;color:#17302b;font:14px/1.4 "Segoe UI",system-ui,sans-serif}
#jv-root *{box-sizing:border-box}
#jv-root button{font:inherit;padding:4px 10px;border:1px solid #b7c5bd;background:#fff;color:#17302b;border-radius:3px;cursor:pointer}
#jv-root button:hover{background:#e3f0ea}
#jv-root button.jv-primary{background:#0b7a5a;border-color:#0b7a5a;color:#fff}
#jv-root button.jv-primary:hover{background:#096449}
#jv-root input[type=text],#jv-root input[type=number],#jv-root input[type=search],#jv-root select,#jv-root textarea{font:inherit;padding:4px 6px;border:1px solid #b7c5bd;border-radius:3px;background:#fff;color:#17302b;min-width:0}
.jv-top,.jv-tools{display:flex;gap:6px;align-items:center;padding:5px 10px;flex-wrap:nowrap;overflow-x:auto;white-space:nowrap}.jv-top>*,.jv-tools>*{flex:none}.jv-top button,.jv-tools button{padding:3px 8px}.jv-tools select{max-width:200px}.jv-tools input[type=search]{width:120px}
.jv-top{background:#17302b;color:#fff}.jv-brand{font-size:16px;margin-right:8px;letter-spacing:.2px}
.jv-tools{background:#fff;border-bottom:1px solid #cdd8d2}
.jv-main{flex:1;display:flex;min-height:0;position:relative}
.jv-panel{width:310px;flex:none;display:flex;flex-direction:column;overflow:hidden;background:#fff;border-right:1px solid #cdd8d2}
.jv-pbody{flex:1;min-height:0;overflow:auto;padding:10px 12px}
.jv-main.collapsed .jv-panel{display:none}
.jv-panel h3{margin:0 0 6px}.jv-panel h4,.jv-sv-side h4{margin:14px 0 6px;font-size:13px;color:#0b5c44}
.jv-toggle{position:absolute;top:8px;left:296px;z-index:5;padding:2px 6px!important}
.jv-main.collapsed .jv-toggle{left:6px}
.jv-btns,.jv-row{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap;align-items:center}
.jv-row input{flex:1}.jv-row.top{align-items:flex-start}.jv-row.top div{flex:1}
.jv-gridwrap{flex:1;overflow:auto;padding:12px 12px 12px 36px}
.jv-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
.jv-group{grid-column:1/-1;font-weight:600;padding:6px 2px;border-bottom:2px solid #0b7a5a;margin-top:8px}
.jv-empty{grid-column:1/-1;padding:60px;text-align:center;color:#5d7068}
.jv-card{position:relative;aspect-ratio:1;background:#cfd9d3;overflow:hidden;cursor:pointer;border:3px solid transparent;border-radius:3px;user-select:none}
.jv-card img{width:100%;height:100%;object-fit:cover;display:block}
.jv-card.sel{border-color:#1a73e8}.jv-card.sel::after{content:"";position:absolute;inset:0;background:rgba(26,115,232,.32);pointer-events:none}
.jv-tick{position:absolute;right:6px;bottom:30px;width:22px;height:22px;border-radius:50%;background:#1a73e8;color:#fff;text-align:center;line-height:22px;display:none;z-index:2}
.jv-card.sel .jv-tick{display:block}
.jv-star,.jv-open{position:absolute;top:4px;width:26px;height:26px;border-radius:50%;background:rgba(23,48,43,.7);color:#fff;text-align:center;line-height:26px;z-index:3;opacity:0}
.jv-star{left:4px}.jv-open{right:4px}
.jv-card:hover .jv-star,.jv-card:hover .jv-open,.jv-card.starred .jv-star,.jv-card:hover .jv-pr{opacity:1}
.jv-card.starred .jv-star{color:#ffc933}
.jv-badges{position:absolute;left:0;right:0;bottom:22px;display:flex;gap:4px;padding:0 4px;flex-wrap:wrap;align-content:flex-end;max-height:50px;overflow:hidden;z-index:2}
.jv-badges span.dl{max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jv-badges span{background:rgba(23,48,43,.82);color:#fff;font-size:11px;padding:0 5px;border-radius:2px}
.jv-badges .ok{background:#0b7a5a}.jv-badges .bad{background:#b3261e}.jv-badges .pend,.jv-badges .unsaved{background:#d64545}
.jv-cap{position:absolute;left:0;right:0;bottom:0;background:rgba(23,48,43,.85);color:#fff;font-size:11px;padding:3px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2}
.jv-status{display:flex;gap:12px;align-items:center;padding:5px 12px;background:#17302b;color:#dfeae4;font-size:12px}
.jv-msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jv-bar{width:160px;height:6px;background:#3a574e;border-radius:3px;overflow:hidden}.jv-bar div{height:100%;width:0;background:#4fd1a1;transition:width .2s}
.jv-sw{position:relative}.jv-sw input{width:100%}
.jv-sug{display:none;position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid #8aa196;max-height:260px;overflow:auto;box-shadow:0 4px 10px rgba(0,0,0,.18)}
.jv-sug-i{padding:5px 8px;cursor:pointer;border-bottom:1px solid #edf1ee}.jv-sug-i:hover{background:#e3f4ec}.jv-sug-t>div{font-size:12px;color:#5d7068}.jv-sug-i i{color:#5d7068;font-size:12px}
.jv-chips{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}
.jv-chip{display:inline-flex;align-items:center;gap:4px;background:#e4ebe7;border-radius:12px;padding:1px 4px 1px 9px;font-size:13px}
.jv-chip a{color:inherit;text-decoration:none}.jv-chip.new{background:#f9d4d1;color:#8a1c16}.jv-chip.hid{opacity:.6}.jv-chip.del{background:#f6d7d4;text-decoration:line-through}
#jv-root .jv-chip button,#jv-root .jv-dchip button{border:0;background:transparent;padding:0 5px}
.jv-modal{position:fixed;inset:0;z-index:10001;background:rgba(10,25,20,.55);display:flex;align-items:center;justify-content:center}
.jv-modal-b{background:#fff;width:min(640px,94vw);max-height:92vh;overflow:auto;border-radius:4px;display:flex;flex-direction:column}
.jv-modal-h,.jv-modal-f{display:flex;justify-content:space-between;gap:8px;padding:10px 14px;background:#eef2ef}.jv-modal-f{justify-content:flex-end}
.jv-modal-c{padding:12px 14px;display:flex;flex-direction:column;gap:8px}.jv-modal-c textarea{width:100%}
.jv-map{position:relative;overflow:hidden;background:#dfe7e2;cursor:grab;touch-action:none;border:1px solid #b7c5bd}
.jv-map-l img{position:absolute;width:256px;height:256px;max-width:none;user-select:none}
.jv-pin{position:absolute;transform:translate(-50%,-100%);font-size:24px;pointer-events:none;display:none}
.jv-map-c{position:absolute;top:6px;left:6px;display:flex;flex-direction:column;gap:2px;z-index:3}
.jv-single{position:fixed;inset:0;z-index:10000;background:#eef2ef;color:#17302b;flex-direction:column;display:none;font:14px/1.4 "Segoe UI",system-ui,sans-serif}
.jv-single *{box-sizing:border-box}
.jv-single button{font:inherit;padding:4px 10px;border:1px solid #b7c5bd;background:#fff;color:#17302b;border-radius:3px;cursor:pointer}
.jv-single button.jv-primary{background:#0b7a5a;border-color:#0b7a5a;color:#fff}
.jv-single input[type=text]{font:inherit;padding:4px 6px;border:1px solid #b7c5bd;border-radius:3px;width:100%}
.jv-starb.on{background:#ffe9a8!important;border-color:#d99a00!important}
.jv-sv-head{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#fff;border-bottom:1px solid #cdd8d2;flex-wrap:wrap}
.jv-sv-body{flex:1;display:flex;min-height:0}
.jv-sv-img{flex:1.2;background:#0f1f1b;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px;min-width:0}
.jv-sv-img img{max-width:100%;max-height:calc(100% - 28px);object-fit:contain}.jv-sv-img a{color:#9fe3c6;margin-top:6px}
.jv-sv-side{flex:1;overflow:auto;padding:12px 16px;background:#fff;max-width:640px}
.jv-sv-side section{margin-bottom:6px}
.jv-dep{border:2px solid #0b7a5a;background:#e8f6ef;border-radius:4px;padding:10px 12px;margin-bottom:12px!important}
.jv-dep.none{border-color:#b3261e;background:#fdeceb}
.jv-dchip{display:flex;align-items:baseline;gap:4px;font-size:18px;margin-bottom:4px}.jv-dchip a{font-weight:700;color:#0b5c44}.jv-dchip small{font-size:12px;color:#5d7068;flex:1}.jv-dchip.new{background:#fbe1df;border-radius:3px;padding:0 4px}.jv-dchip.new a{color:#b3261e}
.jv-warn{color:#b3261e;font-weight:600;margin-bottom:4px}.jv-bad{color:#b3261e}
.jv-sub{font-size:13px;color:#33524a;margin:6px 0 8px;border-left:3px solid #0b7a5a;padding-left:8px}
.jv-hint,.jv-sugg{font-size:13px;margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.jv-single .jv-chipb{border-radius:12px;padding:1px 9px;background:#dbe8f7;border-color:#9bb9de}.jv-chipb.off{background:#e4ebe7;color:#5d7068;border:1px solid #cdd8d2;padding:1px 9px;border-radius:12px;font-size:13px}
.jv-meta{width:100%;border-collapse:collapse}.jv-meta th{text-align:left;width:130px;color:#5d7068;font-weight:500;padding:3px 0;vertical-align:top}.jv-meta td{padding:3px 0}
.jv-dim{color:#5d7068}
.jv-unsaved{color:#b3261e;font-weight:600}
.jv-card.dirty::before{content:"";position:absolute;inset:0;border:3px dashed #d64545;z-index:4;pointer-events:none}
.jv-single input.dirty,.jv-single textarea.dirty{border-color:#d64545;background:#fdeceb}
.jv-single textarea{font:inherit;width:100%;border:1px solid #b7c5bd;border-radius:3px;padding:4px;margin:4px 0}
.jv-log{flex:none;border-top:1px solid #cdd8d2;background:#f4f7f5}
#jv-root .jv-loghead{width:100%;text-align:left;border:0;border-radius:0;background:#e4ebe7;padding:6px 12px}
.jv-loghead::before{content:"▸ "}.jv-log.open .jv-loghead::before{content:"▾ "}
.jv-logbody{display:none;max-height:230px;overflow:auto;padding:2px 10px;font-size:12px}.jv-log.open .jv-logbody{display:block}
.jv-lg{padding:4px 0;border-bottom:1px solid #dde5e0}.jv-okc{color:#0b7a5a}
.jv-sv-img .jv-annwrap{position:relative;display:inline-block;line-height:0;max-width:100%}
.jv-sv-img .jv-annwrap img{display:block;max-width:100%;max-height:calc(100vh - 150px);width:auto;height:auto;object-fit:fill}
.jv-annwrap.draw{cursor:crosshair}
.jv-note{position:absolute;border:2px solid #666;box-shadow:inset 0 0 0 1px yellow;cursor:pointer}
.jv-note.dirty{border-color:#d64545}.jv-note.act{border-color:#FFA500}.jv-note.tmp{border-color:#d64545;pointer-events:none}
.jv-note span{display:none}
.jv-note:hover span{display:block;position:absolute;top:100%;left:0;z-index:5;min-width:120px;max-width:260px;background:#fff;color:#17302b;border:1px solid #666;padding:3px 6px;font-size:12px;line-height:1.3;white-space:pre-wrap}
#jv-root .jv-retry,.jv-single .jv-retry{position:absolute;right:6px;bottom:6px;width:26px;height:26px;line-height:24px;text-align:center;border-radius:50%;background:#fff;border:1px solid #72777d;cursor:pointer;z-index:4;font-weight:700}
.jv-nothumb{object-fit:contain;background:#e3e8e5}
.jv-sugrow{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:4px 0}.jv-sugnone{margin:4px 0;font-size:12.5px}
#jv-root button.jv-sugchip,.jv-single button.jv-sugchip{background:#e8f6ef;border:1px solid #0b7a5a;color:#0b5c44;border-radius:12px;padding:1px 9px;font-size:13px}
.jv-sugchip small{color:#5d7068}.jv-sugchip.used{opacity:.55;border-style:dashed}
.jv-nrow{border:1px solid #cdd8d2;padding:6px;margin:6px 0;border-radius:3px}.jv-nrow.act{border-color:#FFA500;background:#fff8e6}.jv-nrow.dirty{border-color:#d64545;background:#fdeceb}
.jv-modal-b.wide{width:min(1020px,96vw)}
.jv-sug-n{padding:6px 8px;color:#5d7068}
.jv-ovn{max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jv-gcard{margin:0 9px 9px 0;box-shadow:4px 4px 0 -1px #fff,5px 5px 0 0 #8aa196,9px 9px 0 -1px #fff,10px 10px 0 0 #8aa196}
.jv-card.partsel{border-color:#1a73e8;border-style:dashed}
.jv-badges .part{background:#c78500}
.jv-gwarn{background:#fdeceb;border:1px solid #d64545;color:#8a1c16;padding:6px 10px;border-radius:3px}
.jv-gwarn.soft{background:#fff4dc;border-color:#c78500;color:#6b4700}
.jv-gctl{display:flex;gap:8px}.jv-gctl .jv-sw{flex:1}
.jv-collage{display:flex;flex-wrap:wrap;gap:6px}
.jv-tile{position:relative;height:170px;min-width:90px;overflow:hidden;cursor:pointer;border:3px solid transparent;background:#cfd9d3;user-select:none}
.jv-tile img{width:100%;height:100%;object-fit:cover;display:block}
.jv-tile.dirty{border-color:#d64545;border-style:dashed}
.jv-tile.sel{border-color:#1a73e8;border-style:solid}.jv-tile.sel::after{content:"";position:absolute;inset:0;background:rgba(26,115,232,.32);pointer-events:none}
.jv-tile.sel .jv-tick{display:block}
.jv-tile .jv-star,.jv-tile .jv-open{opacity:0}
.jv-tile:hover .jv-star,.jv-tile:hover .jv-pr,.jv-tile:hover .jv-open,.jv-tile:hover .jv-rep,.jv-tile.starred .jv-star,.jv-tile.isrep .jv-rep{opacity:1}
.jv-tile.starred .jv-star{color:#ffc933}
.jv-rep{position:absolute;top:4px;left:34px;width:26px;height:26px;border-radius:50%;background:rgba(23,48,43,.7);color:#fff;text-align:center;line-height:26px;z-index:3;opacity:0}
.jv-tile.isrep .jv-rep{color:#9fe3c6}
.jv-tn{position:absolute;left:0;right:0;bottom:0;background:rgba(23,48,43,.88);color:#fff;font-size:11px;padding:2px 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;z-index:2}
.jv-tn .r{color:#ffb4ae}
.jv-dc{display:flex;gap:12px;align-items:flex-start}
.jv-cloud{flex:1.5;min-width:0;height:420px;position:relative;overflow:hidden;background:#f4f7f5;border:1px solid #cdd8d2}
.jv-cw{position:absolute;font-weight:600;white-space:nowrap;cursor:pointer;font-family:"Segoe UI",system-ui,sans-serif}.jv-cw:hover{text-decoration:underline}
.jv-dlist{flex:1;min-width:280px;max-height:420px;overflow:auto}
.jv-ft{width:100%;border-collapse:collapse;font-size:13px}.jv-ft th{text-align:left;color:#5d7068;font-weight:500;border-bottom:1px solid #cdd8d2;padding:3px 4px}.jv-ft td{padding:3px 4px;border-bottom:1px solid #edf1ee;vertical-align:middle}
.jv-ft td:last-child{display:flex;gap:6px;align-items:center}.jv-ft button{padding:0 6px!important}
.jv-fbar{flex:1;position:relative;height:16px;background:#e4ebe7;min-width:70px}.jv-fbar div{height:100%;background:#4fb58d}.jv-fbar span{position:absolute;left:4px;top:0;font-size:11px;line-height:16px}
@media(max-width:900px){.jv-dc{flex-direction:column}.jv-cloud{width:100%;flex:none}.jv-grid{grid-template-columns:repeat(3,1fr)}.jv-sv-body{flex-direction:column}}
@media(max-width:560px){.jv-grid{grid-template-columns:repeat(2,1fr)}}
.jv-brandw{display:flex;align-items:center;gap:8px;margin-right:6px}
.jv-logo{height:38px;width:auto;background:#fff;border-radius:6px;padding:2px;display:block}
.jv-brand{font-size:15px;line-height:1.1}
.jv-selpill{display:inline-block;min-width:22px;padding:0 8px;border-radius:10px;text-align:center;font-weight:700;background:rgba(127,145,137,.35)}
#jv-root .jv-selpill.on{background:#d0201a;color:#fff;box-shadow:0 0 0 2px rgba(208,32,26,.3)}
.jv-sug-i{display:flex;gap:8px;align-items:center}.jv-sug-t{flex:1;min-width:0}
.jv-sug-h{padding:3px 8px;font-size:11px;font-weight:600;background:#eef2ef;color:#0b5c44}
.jv-wdt{display:none;flex:none;width:44px;height:44px;border-radius:3px;overflow:hidden;background:#e4ebe7}
.jv-wdt.on{display:block}.jv-wdt img{width:100%;height:100%;object-fit:cover;display:block}
.jv-wdt.sm{width:30px;height:30px}.jv-wdt.lg{width:56px;height:56px}
.jv-dchip{align-items:center}
.jv-credit{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#0f1f1b;color:#9fb8ad;font-size:11px;padding:3px 12px}.jv-credit a{color:#9fe3c6}
.jv-modal-c h4{margin:8px 0 2px;font-size:13px;color:#0b5c44}
.jv-pr{position:absolute;top:4px;left:34px;width:26px;height:26px;border-radius:50%;background:#fff;border:2px solid #72777d;z-index:3;opacity:0;overflow:hidden;box-sizing:border-box}
.jv-pr img{width:100%;height:100%;object-fit:cover;display:block}.jv-pr.ok{border-color:#14866d}.jv-pr.no{border-color:#d33}.jv-pr.busy{opacity:.5!important}
.jv-tile .jv-pr{left:64px}
#jv-root button.jv-prb.ok{border-color:#14866d;color:#14866d}#jv-root button.jv-prb.no{border-color:#d33;color:#d33}
#jv-root select.jv-projsel.on{background:#ffe9a8;border-color:#d99a00}
/* ---- 1.1.0 ---- */
.jv-tools{flex-wrap:wrap;row-gap:4px;white-space:normal}
.jv-gridwrap{padding-left:12px}
.jv-tools .jv-toggle{position:static;top:auto;left:auto;z-index:auto;padding:3px 8px!important}
#jv-root button.jv-toggle{background:#fff3c4;border-color:#d99a00;font-weight:600}
#jv-root button.jv-toggle:hover{background:#ffe9a0}
.jv-selg{display:inline-flex;gap:4px;align-items:center}
.jv-warnnote{background:#fff3c4;border:1px solid #d99a00;color:#5c4200;padding:6px 8px;border-radius:3px;font-size:12.5px;margin:2px 0 8px}
.jv-help{position:absolute;top:4px;left:64px;width:26px;height:26px;border-radius:50%;background:#fff;border:2px solid #72777d;color:#72777d;text-align:center;line-height:22px;font-weight:700;z-index:3;opacity:0;display:none}
#jv-root.has-proj .jv-help{display:block}
.jv-card:hover .jv-help,.jv-tile:hover .jv-help,.jv-help.on{opacity:1}
.jv-help.on{background:#d33;border-color:#d33;color:#fff}.jv-help.off{border-style:dashed}
.jv-tile .jv-help{left:94px}
.jv-twol{display:inline-block;line-height:1.05;font-size:11px;text-align:left;vertical-align:middle}
#jv-root button.jv-helpb.on,.jv-single button.jv-helpb.on{background:#fbe1df;border-color:#d33;color:#8a1c16}
.jv-single button.jv-helpb.off{border-style:dashed;color:#72777d}
.jv-single button.jv-nextb{padding:4px 12px}
.jv-fname{max-width:34vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jv-sv-head{padding:5px 10px;gap:6px}
/* one-by-one view: one screen, boxes scroll inside */
.jv-sv-body{overflow:hidden}
.jv-sv-img{flex:1.2;padding:8px;justify-content:flex-start;align-items:stretch;min-width:0}
.jv-imgbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:#cfe0d8;padding:0 0 6px;font-size:13px}
.jv-imgbar select{font:inherit;padding:2px 4px;border-radius:3px;border:1px solid #b7c5bd}
.jv-imgbar a{color:#9fe3c6;margin:0}.jv-seg{display:inline-flex}.jv-seg button{border-radius:0!important;padding:2px 9px!important}.jv-seg button:first-child{border-radius:3px 0 0 3px!important}.jv-seg button:last-child{border-radius:0 3px 3px 0!important}
.jv-imgbox{flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center}
.jv-sv-img .jv-annwrap img{max-width:100%;max-height:calc(100vh - 150px)}
.jv-sv-img.wide .jv-imgbox{align-items:flex-start}
.jv-sv-img.wide .jv-annwrap{display:block;width:100%}
.jv-sv-img.wide .jv-annwrap img{width:100%;max-height:none}
.jv-sv-side{flex:1.5;max-width:none;min-width:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto auto minmax(110px,1fr) minmax(110px,1fr);grid-auto-rows:minmax(110px,1fr);gap:8px;padding:8px;background:#e6ece8;overflow:auto;align-content:stretch}
.jv-sv-side>.jv-box{background:#fff;border:1px solid #cdd8d2;border-radius:4px;padding:8px 10px;overflow:auto;min-height:0;min-width:0;margin:0}
.jv-sv-side>.jv-dep{grid-column:1/-1;grid-row:auto;max-height:30vh;display:flex;flex-direction:column;overflow:visible;border-width:2px}
.jv-sv-side>.jv-dep .jv-depl{flex:1;min-height:34px;overflow:auto}
.jv-sv-side>.jv-dep .jv-sub{margin:6px 0}
.jv-sv-side>.jv-catbox{grid-column:1/-1;display:flex;flex-direction:column;overflow:hidden;height:clamp(120px,22vh,230px)}
.jv-cd{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:6px}
.jv-cdl,.jv-cdr{overflow:auto;min-height:0}
.jv-cd h4{margin-top:0}
.jv-sv-side>.span2{grid-column:1/-1}
.jv-loc{display:flex;flex-direction:column;overflow:hidden!important}
.jv-mapbox{flex:1;min-height:110px}
.jv-sv-side h4{margin:4px 0 6px}
.jv-sv-side .jv-dchip{font-size:16px}
@media(max-width:900px){.jv-sv-body{flex-direction:column;overflow:auto}.jv-sv-side{grid-template-columns:1fr;max-height:none;overflow:visible}.jv-sv-side>.jv-catbox,.jv-cd{grid-template-columns:1fr}.jv-sv-side>.jv-catbox{height:auto;max-height:none}}
kbd{display:inline-block;min-width:26px;text-align:center;border:1px solid #b7c5bd;border-bottom-width:2px;border-radius:4px;background:#f4f7f5;padding:0 6px;font:600 12px monospace}
`);

/* ---------- entry point ---------- */
function open() {
  root.style.display = 'flex'; document.body.style.overflow = 'hidden';
  if (!S.listTried) { S.listTried = true; if (!S.recs.length) { if (cfg) listCategory(cfg).then(t => loadTitles(t, normCat(cfg), true)).then(() => { if (/(^|[?&])stats(=|&|$)/.test(location.search) && window.DW && DW.stats) DW.stats.open(); }).catch(e => setStatus('Error: ' + e)); else loadMyList(); } }
}
/* The web app is always open: there is no Tools-menu link or overlay toggle. */
window.DW = window.DW || {};
DW.core = { S, h, api, wd, root, WD, labelOf, ensureWd, normCat, effLoc, effDepicts, download, outName, safeName, stampNow, setStatus, openSingle, loadTitles, listCategory };
document.dispatchEvent(new CustomEvent('dw:core'));
open();

});
})();
