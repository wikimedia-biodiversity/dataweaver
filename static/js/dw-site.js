/*!
 * Commons Data Weaver — site script (navigation, login state, settings gear, localisation, typing tools)
 * Copyright (C) 2026 Manoj Karingamadathil. License: GPL-3.0-or-later.
 * Loaded on every page. No inline scripts are used anywhere (strict Content-Security-Policy).
 */
(function () {
  'use strict';
  const DW = window.DW = window.DW || {};
  const cfgEl = document.getElementById('dw-config');
  DW.config = cfgEl ? JSON.parse(cfgEl.textContent) : {};
  DW.me = DW.config.me || null;

  /* ------------------------------------------------------------------ tiny helpers */
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  };
  const getJSON = url => fetch(url, { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  DW.h = h;

  /* ------------------------------------------------------------------ settings (this browser only) */
  const KEY = 'dataweaver-settings';
  const DEFAULTS = { lang: '', osm: false, ime: { enabled: false, lang: '', method: '' } };
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { lang: s.lang || '', osm: !!s.osm, ime: Object.assign({}, DEFAULTS.ime, s.ime || {}) };
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
  }
  DW.settings = loadSettings();
  DW.saveSettings = function () {
    try { localStorage.setItem(KEY, JSON.stringify(DW.settings)); } catch (e) { /* private mode: keep in memory */ }
    document.dispatchEvent(new CustomEvent('dw:settings'));
  };

  /* ------------------------------------------------------------------ localisation (l10n) */
  const I18N = DW.i18n = { lang: 'en', en: {}, msgs: {}, app: {}, languages: [] };
  const I18N_URL = '/static/i18n/';
  /** Message lookup with MediaWiki-style $1 placeholders; falls back to English, then to the key. */
  DW.t = function (key, ...params) {
    let s = I18N.msgs[key];
    if (s == null) s = I18N.en[key];
    if (s == null) return key;
    params.forEach((p, i) => { s = s.split('$' + (i + 1)).join(p); });
    return s;
  };
  function pickLanguage() {
    const wanted = DW.settings.lang || (navigator.language || 'en').toLowerCase();
    const codes = I18N.languages.map(l => l.code);
    return codes.includes(wanted) ? wanted : (codes.includes(wanted.split('-')[0]) ? wanted.split('-')[0] : 'en');
  }
  function applyDom(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(e => { e.textContent = DW.t(e.dataset.i18n); });
    (root || document).querySelectorAll('[data-i18n-title]').forEach(e => { e.title = DW.t(e.dataset.i18nTitle); });
    (root || document).querySelectorAll('[data-i18n-placeholder]').forEach(e => { e.placeholder = DW.t(e.dataset.i18nPlaceholder); });
  }
  async function setLanguage(code) {
    I18N.en = I18N.en && Object.keys(I18N.en).length ? I18N.en : await getJSON(I18N_URL + 'en.json').catch(() => ({}));
    I18N.msgs = code === 'en' ? I18N.en : await getJSON(I18N_URL + code + '.json').catch(() => ({}));
    I18N.lang = code;
    I18N.app = I18N.msgs['@app'] || {};
    const meta = I18N.languages.find(l => l.code === code) || {};
    document.documentElement.lang = code;
    document.documentElement.dir = meta.dir || 'ltr';
    applyDom();
    startAppTranslator();
    document.dispatchEvent(new CustomEvent('dw:language', { detail: code }));
  }
  DW.setLanguage = setLanguage;

  /* Source-text translation for the tool's own interface: translators add "English text": "translation"
     pairs under "@app" in static/i18n/<code>.json. Only exact, static strings match; file names and counters are left alone. */
  let appObserver = null;
  function trText(n) {
    const raw = n.nodeValue, key = raw.trim();
    if (key && I18N.app[key] && n.parentNode && !/^(TEXTAREA|SCRIPT|STYLE)$/.test(n.parentNode.nodeName)) n.nodeValue = raw.replace(key, I18N.app[key]);
  }
  function trTree(node) {
    if (node.nodeType === 3) return trText(node);
    if (node.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA)$/.test(node.nodeName)) return;
    ['title', 'placeholder'].forEach(a => { const v = node.getAttribute(a); if (v && I18N.app[v]) node.setAttribute(a, I18N.app[v]); });
    node.childNodes.forEach(trTree);
  }
  function startAppTranslator() {
    if (appObserver) { appObserver.disconnect(); appObserver = null; }
    const start = root => {
      if (!Object.keys(I18N.app).length) return;
      trTree(root);
      appObserver = new MutationObserver(muts => {
        muts.forEach(m => {
          if (m.type === 'childList') m.addedNodes.forEach(trTree);
          else if (m.type === 'characterData') trText(m.target);
          else if (m.type === 'attributes') trTree(m.target);
        });
      });
      appObserver.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
    };
    const root = document.getElementById('jv-root');
    if (root) return start(root);
    new MutationObserver((_, o) => { const r = document.getElementById('jv-root'); if (r) { o.disconnect(); start(r); } })
      .observe(document.body, { childList: true });
  }

  /* ------------------------------------------------------------------ login state */
  function renderUser() {
    const box = document.getElementById('dw-user'); if (!box) return;
    box.textContent = '';
    if (DW.me) {
      box.append(
        h('a', { class: 'dw-uname', href: 'https://commons.wikimedia.org/wiki/User:' + encodeURIComponent(DW.me.username.replace(/ /g, '_')), target: '_blank', rel: 'noopener' }, DW.me.username),
        h('button', { type: 'button', class: 'dw-btn dw-btn-sm', id: 'dw-logout', onclick: logout }, DW.t('logout')));
    } else {
      box.append(h('a', { class: 'dw-btn dw-btn-sm dw-btn-primary', id: 'dw-login', href: '/login?next=' + encodeURIComponent(location.pathname + location.search) }, DW.t('login')));
    }
    const banner = document.getElementById('dw-loginbar');
    if (banner) banner.hidden = !!DW.me;
    document.body.classList.toggle('dw-has-bar', !!banner && !DW.me);
  }
  async function logout() {
    try { await fetch('/logout', { method: 'POST', headers: { 'X-Requested-With': 'DataWeaver' }, credentials: 'same-origin' }); } catch (e) { /* reload anyway */ }
    location.reload();
  }
  async function refreshMe() {
    try { const d = await getJSON('/api/me'); DW.me = d.authenticated ? d.user : null; } catch (e) { /* keep state */ }
    renderUser();
    document.dispatchEvent(new CustomEvent('dw:login', { detail: DW.me }));
    return DW.me;
  }
  DW.refreshMe = refreshMe;
  /** Log in in a new tab so the work in this tab (loaded files, unsaved edits) is not lost. */
  DW.openLogin = function () {
    const w = window.open('/login?next=' + encodeURIComponent('/login/done'), 'dw-login', 'width=900,height=720');
    if (!w) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); return; }
    // The login tab tells us when it is done (postMessage); polling covers browsers that sever window.opener.
    let tries = 0;
    const t = setInterval(async () => { if (DW.me || ++tries > 90) return clearInterval(t); await refreshMe(); }, 2000);
  };
  window.addEventListener('message', e => { if (e.origin === location.origin && e.data === 'dw-login-done') refreshMe(); });
  DW.requireLogin = function (info) {
    if (document.getElementById('dw-login-modal')) return;
    const m = modal(DW.t('login-required-title'), h('div', {},
      h('p', {}, info || DW.t('login-required-text')),
      h('p', { class: 'dw-dim' }, DW.t('login-required-note'))), [
      h('button', { type: 'button', class: 'dw-btn', onclick: () => m.close() }, DW.t('close')),
      h('button', { type: 'button', class: 'dw-btn dw-btn-primary', onclick: () => { DW.openLogin(); m.close(); } }, DW.t('login'))], 'dw-login-modal');
  };

  /* ------------------------------------------------------------------ modal */
  function modal(title, body, buttons, id) {
    const prev = document.activeElement;
    const root = h('div', { class: 'dw-modal', id: id || null, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'dw-modal-box' },
        h('div', { class: 'dw-modal-head' }, h('h2', {}, title), h('button', { type: 'button', class: 'dw-icon-btn', 'aria-label': DW.t('close'), onclick: () => close() }, '✕')),
        h('div', { class: 'dw-modal-body' }, body),
        buttons && buttons.length ? h('div', { class: 'dw-modal-foot' }, buttons) : null));
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    function close() { root.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); }
    root.addEventListener('mousedown', e => { if (e.target === root) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(root);
    const first = root.querySelector('select, input, button.dw-btn');
    if (first) first.focus();
    return { el: root, close };
  }

  /* ------------------------------------------------------------------ typing tools (jquery.ime) */
  const IME_BASE = '/static/vendor/jquery.ime/';
  const IME_SEL = 'input:not([type]), input[type=text], input[type=search], textarea';
  const attached = new Set();
  let imeLoading = null;
  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s);
  });
  DW.loadIME = function () {
    if (imeLoading) return imeLoading;
    imeLoading = (async () => {
      document.head.append(h('link', { rel: 'stylesheet', href: IME_BASE + 'css/jquery.ime.css' }));
      if (!window.jQuery) await loadScript('/static/vendor/jquery/jquery.min.js');
      for (const f of ['jquery.ime.js', 'jquery.ime.selector.js', 'jquery.ime.preferences.js', 'jquery.ime.inputmethods.js']) await loadScript(IME_BASE + 'src/' + f);
      // jquery.ime fills $.ime.languages in a DOM-ready callback; queue ours behind it
      await new Promise(res => window.jQuery(res));
      window.jQuery.ime.setPath(IME_BASE);
      window.jQuery.ajaxSetup({ crossDomain: true }); // load rule files with <script src>, which the strict CSP allows
    })().catch(e => { imeLoading = null; throw e; });
    return imeLoading;
  };
  function applyToIme(ime) {
    const $ = window.jQuery, s = DW.settings.ime;
    if (!s.enabled) { ime.disable(); return; }
    if (s.lang && s.method && $.ime.languages[s.lang]) {
      ime.setLanguage(s.lang);
      $.ime.load(s.method).done(() => { ime.setIM(s.method); ime.enable(); });
    }
  }
  function attach(el) {
    const $ = window.jQuery;
    if (!$ || !DW.settings.ime.enabled || $(el).data('ime') || el.classList.contains('dw-no-ime')) return;
    $(el).ime();
    const ime = $(el).data('ime');
    if (ime) { attached.add(ime); applyToIme(ime); }
  }
  function syncIme() {
    document.body.classList.toggle('dw-ime-off', !DW.settings.ime.enabled);
    if (!DW.settings.ime.enabled || !window.jQuery) { attached.forEach(i => i.disable()); return; }
    attached.forEach(applyToIme);
  }
  document.addEventListener('focusin', e => { if (DW.settings.ime.enabled && window.jQuery && e.target.matches && e.target.matches(IME_SEL)) attach(e.target); });
  document.addEventListener('dw:settings', syncIme);

  /* ------------------------------------------------------------------ settings dialog (gear) */
  function openSettings() {
    const s = DW.settings;
    const langSel = h('select', { id: 'dw-set-lang' }, I18N.languages.map(l => h('option', { value: l.code }, l.name + (l.status ? ' (' + l.status + ')' : ''))));
    langSel.value = I18N.lang;
    langSel.addEventListener('change', async () => { s.lang = langSel.value; DW.saveSettings(); await setLanguage(langSel.value); m.close(); openSettings(); });

    const imeOn = h('input', { type: 'checkbox', id: 'dw-set-ime', checked: s.ime.enabled });
    const imeLang = h('select', { id: 'dw-set-ime-lang', disabled: true });
    const imeMethod = h('select', { id: 'dw-set-ime-method', disabled: true });
    const imeStatus = h('p', { class: 'dw-dim', id: 'dw-set-ime-status' });
    const tryBox = h('textarea', { rows: 2, class: 'dw-try', 'data-i18n-placeholder': 'settings-typing-try', placeholder: DW.t('settings-typing-try') });

    async function fillIme() {
      imeStatus.textContent = DW.t('settings-typing-loading');
      try { await DW.loadIME(); } catch (e) { imeStatus.textContent = String(e.message || e); return; }
      const $ = window.jQuery;
      const codes = Object.keys($.ime.languages).sort((a, b) => ($.ime.languages[a].autonym || a).localeCompare($.ime.languages[b].autonym || b));
      imeLang.textContent = '';
      imeLang.append(h('option', { value: '' }, '—'), ...codes.map(c => h('option', { value: c }, ($.ime.languages[c].autonym || c) + ' · ' + c)));
      if (!s.ime.lang && I18N.lang !== 'en' && $.ime.languages[I18N.lang]) s.ime.lang = I18N.lang;
      imeLang.value = s.ime.lang || '';
      fillMethods();
      imeStatus.textContent = DW.t('settings-typing-ready', codes.length);
      toggleDisabled();
    }
    function fillMethods() {
      const $ = window.jQuery;
      imeMethod.textContent = '';
      const lang = $.ime.languages[imeLang.value];
      const ids = lang ? lang.inputmethods : [];
      imeMethod.append(...ids.map(id => h('option', { value: id }, ($.ime.sources[id] || {}).name || id)));
      if (!ids.includes(s.ime.method)) s.ime.method = ids[0] || '';
      imeMethod.value = s.ime.method;
    }
    function toggleDisabled() { imeLang.disabled = imeMethod.disabled = !imeOn.checked || !window.jQuery || !window.jQuery.ime; }
    imeOn.addEventListener('change', async () => {
      s.ime.enabled = imeOn.checked;
      if (imeOn.checked && !window.jQuery) await fillIme();
      toggleDisabled(); DW.saveSettings();
      if (imeOn.checked && s.ime.lang) attach(tryBox);
    });
    imeLang.addEventListener('change', () => { s.ime.lang = imeLang.value; fillMethods(); DW.saveSettings(); });
    imeMethod.addEventListener('change', () => { s.ime.method = imeMethod.value; DW.saveSettings(); });
    if (s.ime.enabled) fillIme(); else {
      imeLang.append(h('option', { value: '' }, '—')); imeMethod.append(h('option', { value: '' }, '—'));
      imeOn.addEventListener('change', () => { if (imeOn.checked) fillIme(); }, { once: true });
    }

    const osm = h('input', { type: 'checkbox', id: 'dw-set-osm', checked: s.osm, onchange: e => { s.osm = e.target.checked; DW.saveSettings(); } });
    const field = (label, control, help) => h('div', { class: 'dw-field' }, h('label', { for: control.id }, label), control, help ? h('small', { class: 'dw-dim' }, help) : null);
    const check = (label, control, help) => h('div', { class: 'dw-field dw-check' }, h('label', {}, control, ' ', label), help ? h('small', { class: 'dw-dim' }, help) : null);

    const body = h('div', { class: 'dw-settings' },
      h('section', {}, h('h3', {}, DW.t('settings-language')),
        field(DW.t('settings-language-label'), langSel, DW.t('settings-language-help'))),
      h('section', {}, h('h3', {}, DW.t('settings-typing')),
        check(DW.t('settings-typing-enable'), imeOn, DW.t('settings-typing-help')),
        field(DW.t('settings-typing-language'), imeLang), field(DW.t('settings-typing-method'), imeMethod), imeStatus, tryBox),
      h('section', {}, h('h3', {}, DW.t('settings-privacy')),
        check(DW.t('settings-osm'), osm, DW.t('settings-osm-help'))),
      h('p', { class: 'dw-dim' }, DW.t('settings-local-note')));

    const m = modal(DW.t('settings-title'), body, [
      h('button', { type: 'button', class: 'dw-btn', onclick: () => { DW.settings = loadDefaults(); DW.saveSettings(); setLanguage(pickLanguage()); m.close(); } }, DW.t('settings-reset')),
      h('button', { type: 'button', class: 'dw-btn dw-btn-primary', onclick: () => m.close() }, DW.t('close'))], 'dw-settings-modal');
    applyDom(m.el);
  }
  const loadDefaults = () => JSON.parse(JSON.stringify(DEFAULTS));
  DW.openSettings = openSettings;

  /* ------------------------------------------------------------------ boot */
  async function boot() {
    document.getElementById('dw-gear')?.addEventListener('click', openSettings);
    document.getElementById('dw-logout')?.addEventListener('click', logout);
    I18N.languages = await getJSON(I18N_URL + 'languages.json').catch(() => [{ code: 'en', name: 'English', dir: 'ltr' }]);
    await setLanguage(pickLanguage());
    renderUser();
    if (document.body.classList.contains('dw-app')) {
      const bar = h('div', { id: 'dw-loginbar', class: 'dw-loginbar', hidden: !!DW.me },
        h('span', {}, DW.t('loginbar-text')), h('button', { type: 'button', class: 'dw-btn dw-btn-sm dw-btn-primary', onclick: DW.openLogin }, DW.t('login')));
      document.querySelector('.dw-nav').after(bar);
      renderUser();
    }
    if (DW.settings.ime.enabled) { try { await DW.loadIME(); syncIme(); } catch (e) { /* settings dialog explains */ } }
    // Keep the login state honest when a session expires in the background
    document.addEventListener('visibilitychange', () => { if (!document.hidden && DW.me) refreshMe(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
