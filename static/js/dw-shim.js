/*!
 * Commons Data Weaver — MediaWiki compatibility shim.
 * Copyright (C) 2026 Manoj Karingamadathil. License: GPL-3.0-or-later.
 *
 * The Data Weaver interface was written as a Commons user script and calls a handful of MediaWiki
 * helpers (mw.Api, mw.ForeignApi, mw.config, mw.util, mw.loader). This file provides just those, so
 * the same interface runs as a normal web page:
 *   - reads  : straight from the browser to the public Wikimedia APIs (CORS, origin=*)
 *   - writes : to this tool's /api/write, which edits as the logged-in user via OAuth 2.0
 */
(function () {
  'use strict';
  const DW = window.DW = window.DW || {};
  const cfg = DW.config || {};
  const WIKI_BASE = (cfg.apiUrl || 'https://commons.wikimedia.org/w/api.php').replace(/\/w\/api\.php.*$/, '/wiki/');
  const params = new URLSearchParams(location.search);
  const category = (params.get('category') || '').replace(/_/g, ' ').replace(/^\s*Category:/i, '').trim();

  function toForm(p) {
    const u = new URLSearchParams();
    for (const k in p) {
      let v = p[k];
      if (v == null || v === false) continue;
      if (v === true) v = '1';
      if (Array.isArray(v)) v = v.join('|');
      u.append(k, String(v));
    }
    return u;
  }

  class Api {
    constructor(url) { this.url = url || cfg.apiUrl; }

    /** Anonymous read. Resolves with the parsed JSON; rejects with the MediaWiki error code (like mw.Api). */
    get(p) {
      const q = toForm(Object.assign({ format: 'json' }, p));
      const long = q.toString().length > 6000; // keep URLs short enough for every proxy
      const url = this.url + '?origin=*' + (long ? '' : '&' + q.toString());
      const init = long ? { method: 'POST', body: q, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {};
      return fetch(url, init).then(r => {
        if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { code: 'http' });
        return r.json();
      }).then(d => {
        if (d && d.error) { const e = new Error(d.error.info || d.error.code); e.code = d.error.code; e.data = d; throw e; }
        return d;
      }).catch(e => { throw e.code || e.message || String(e); });
    }

    /** Edit through the tool's OAuth proxy. The returned thenable passes (code, data) to the failure
     *  callback, as jQuery promises from mw.Api do. */
    postWithEditToken(p) {
      const run = async () => {
        if (!DW.me) {
          if (DW.requireLogin) DW.requireLogin();
          throw { code: 'notloggedin', data: { error: { code: 'notloggedin', info: 'Log in with your Wikimedia account to save edits.' } } };
        }
        let r, d;
        try {
          r = await fetch('/api/write', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'DataWeaver' },
            body: JSON.stringify({ params: p })
          });
          d = await r.json();
        } catch (e) {
          throw { code: 'network', data: { error: { code: 'network', info: 'Could not reach Data Weaver: ' + (e.message || e) } } };
        }
        if (d && d.error) {
          if (d.error.code === 'session_expired' || d.error.code === 'notloggedin') {
            DW.me = null;
            if (DW.refreshMe) DW.refreshMe();
            if (DW.requireLogin) DW.requireLogin(d.error.info);
          }
          throw { code: d.error.code, data: d };
        }
        return d;
      };
      const pr = run();
      return {
        then: (ok, fail) => pr.then(ok, fail ? e => fail(e.code, e.data) : undefined),
        catch: fail => pr.catch(e => fail(e.code, e.data))
      };
    }
  }

  const mw = window.mw = window.mw || {};
  mw.Api = Api;
  mw.ForeignApi = class extends Api { constructor(url) { super(url); } };
  mw.loader = { using: () => Promise.resolve() };
  mw.config = {
    get(key) {
      switch (key) {
        case 'wgUserName': return DW.me ? DW.me.username : null;
        case 'wgUserGroups': return DW.me ? DW.me.groups : [];
        case 'wgNamespaceNumber': return category ? 14 : 0;
        case 'wgTitle': return category;
        case 'wgContentLanguage': return 'en';
        default: return null;
      }
    }
  };
  mw.util = {
    getUrl: title => WIKI_BASE + encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%3A/g, ':').replace(/%2F/g, '/'),
    addCSS: css => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); return s; },
    addPortletLink: () => null
  };

  /* Third-party endpoints are configurable and the OSM place search is opt-in (see the gear settings). */
  DW.tile = (z, x, y) => String(cfg.tileUrl).replace('{z}', z).replace('{x}', x).replace('{y}', y);
  DW.osmEnabled = () => !!(DW.settings && DW.settings.osm);
})();
