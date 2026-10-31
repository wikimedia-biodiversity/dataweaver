# Architecture and technology choices

Commons Data Weaver as a Toolforge web application. This note records what was chosen and why, so the choices can be revisited.

## Goals

1. The **same interface and experience** as the Commons user script (grid, batch panel, one-by-one view, series, Other versions, image notes, exports).
2. Real **Wikimedia login**, so edits are attributed to the user.
3. A **settings gear** for interface language and typing tools (jQuery IME), ready for more languages later.
4. Hosted on **Toolforge**, deployable from Git, with documentation pages (About, Features, Technology, Story, Community, Credits, How to use).
5. Licence **GPL-3.0-or-later**.

## Overview

```
                      ┌───────────────────────────── browser ─────────────────────────────┐
                      │ dw-site.js    navigation, login state, gear, l10n, jQuery IME      │
  Jinja pages ───────►│ dw-shim.js    mw.Api / mw.config / mw.util for the interface       │
  (Flask)             │ dataweaver.js the interface (generated from the user script)       │
                      └───────┬──────────────────────────────┬─────────────────────────────┘
                              │ reads (CORS, origin=*)       │ writes: POST /api/write
                              ▼                              ▼
        commons.wikimedia.org · www.wikidata.org      ┌───────────────────────┐
        (public, no login)                            │ Flask on Toolforge    │
                                                      │  /login /oauth/callback│
                                                      │  /api/write (allow-list)│──► commons.wikimedia.org
                                                      │  sessions.sqlite (enc.)│     (Bearer token)
                                                      └───────────┬───────────┘
                                                                  │ OAuth 2.0
                                                                  ▼
                                                      meta.wikimedia.org (authorize, token, profile)
```

## Decisions

### Hosting: Toolforge Build Service

- Free, run by Wikimedia, inside the community's trust boundary; `*.toolforge.org` addresses are the norm for community tools.
- Deploys from a Git URL with a buildpack: no Dockerfile and no server to patch. `Procfile` is the only deployment file.
- Alternatives: the older `webservice python3.x` (uwsgi + virtualenv on the grid) works but is being replaced by the Build Service; a VPS in Cloud VPS gives more freedom but more maintenance.

### Backend: Python 3 + Flask

- Toolforge's best-supported language; small, readable code; the backend only does OAuth, a write proxy, sessions and page rendering.
- Node or PHP would work equally well; Python was chosen for the OAuth/HTTP libraries and for pytest.

### Authentication: OAuth 2.0, authorization code + PKCE, confidential client

- Wikimedia's recommended flow for tools that edit as a user ([OAuth/For Developers](https://www.mediawiki.org/wiki/OAuth/For_Developers)). The tool never sees the user's password.
- A **confidential** consumer keeps the client secret server-side. PKCE is added on top as defence in depth.
- Tokens stay on the server, encrypted at rest (Fernet, key derived from `SECRET_KEY`) in SQLite; the browser holds only a random session id (`HttpOnly`, `Secure`, `SameSite=Lax`). Session id is rotated on login. Access tokens are refreshed automatically; a failed refresh logs the user out cleanly.
- Why not a browser-only (public client) flow? It would put long-lived tokens into JavaScript and into every XSS's reach.
- Grants requested: *Basic rights* and *Edit existing pages*. Nothing else.

### Reads direct, writes proxied

- **Reads** (category listing, file info, wikitext, Wikidata search) are public. The browser calls the Wikimedia APIs directly with `origin=*`: fast, no load on the tool, and the tool cannot become an open relay.
- **Writes** go to `POST /api/write`. The proxy:
  - needs a logged-in session, a custom `X-Requested-With` header and a matching `Origin` (CSRF, on top of `SameSite=Lax`);
  - accepts only `edit` (by `pageid`), `wbeditentity` and `wbsetlabel` (on `M…` ids), drops all other parameters and validates formats;
  - fetches and caches the CSRF token, retries once on `badtoken`, retries on `maxlag`;
  - makes sure the summary contains `#DataWeaver`;
  - limits edits per user per minute;
  - turns revoked or expired authorisation into a clear `session_expired` error and keeps the user's unsaved work in the page.

### Frontend: plain JavaScript, no framework

- The interface started as the Commons user script (about 1,500 lines) that users already knew. Rewriting it in a framework would have changed behaviour for no user benefit, so it was kept and grows in place.
- **Since 1.1.0 `static/js/dataweaver.js` is edited directly** (single page one-by-one view, image size and fit, Help needed flag, statistics hook). `tools/port_userscript.py` only reproduces the 1.0.0 baseline now.
- `dw-shim.js` implements the handful of MediaWiki helpers it uses (`mw.Api`, `mw.ForeignApi`, `mw.config`, `mw.util`, `mw.loader`). Reads become `fetch` calls; `postWithEditToken` becomes a call to `/api/write`, keeping the `(code, data)` failure signature.
- **Statistics** (`dw-stats.js`, `stats.css`): calculated in the browser from the files already loaded, so it adds no server code and no requests except map tiles. Charts are hand-written SVG (one blue for data, neutral text, hairline grids, hover tooltips, a table view, PNG/SVG/CSV downloads); the map is a small tile map with grid clustering. The interface reaches it through `DW.core`.
- **Projects** (`static/config/projects.json`): the Project menu and each project's help category. It is a static file so maintainers can edit it in Git without touching code; if it cannot be read the four default project names are used.
- No build step, no bundler, no npm in production: the repository is readable and fixable with a text editor.

### Security headers

Strict CSP: `script-src 'self'` (no inline scripts, no eval), images only from this site and Wikimedia, connections only to this site, Commons, Wikidata and the configured Nominatim host. `frame-ancestors 'none'`, `nosniff`, a restrictive `Referrer-Policy`. jQuery IME loads its rule files with `<script src>` (`crossDomain: true`), which the CSP allows.

### Localisation and typing tools

- **Messages:** JSON files in `static/i18n/`, MediaWiki-style `$1` placeholders, a `qqq.json` documentation file, and a `languages.json` manifest. This is the shape translatewiki.net expects, so moving there later needs no rewrite.
- **Gear → Interface language:** stored in `localStorage`. Chrome (menus, dialogs) uses message keys with English fallback. The tool's own interface, which is large and generated, is translated by **source text** under the `@app` key, applied by a `MutationObserver` that only runs when a non-English dictionary is loaded. Translators can therefore add labels one at a time without any code change; untranslated text stays English.
- **Gear → Typing tools:** [jQuery IME](https://github.com/wikimedia/jquery.ime) (vendored, GPL-or-MIT) is loaded on demand. Users pick a language and input method; every text field then accepts it, including the dynamically created search boxes (a delegated `focusin` handler attaches IME lazily). Switching off hides the selector icons.
- Right-to-left languages are supported through the `dir` field in `languages.json`; the interface's own stylesheet has not yet been audited for RTL.

### Third parties and privacy

Toolforge's rules and the Wikimedia privacy policy discourage loading third-party resources and sending users' data to others without consent. Therefore:

- jQuery and jQuery IME are **vendored** (`static/vendor/`), not loaded from a CDN.
- **OpenStreetMap Nominatim** place search is **off by default** and enabled by a checkbox in the gear (which explains what is sent). Wikidata place search is always on.
- Map tiles come from a **configurable** server (`TILE_URL`), default the Wikimedia maps server. Verify it is still available to external tools before launch; otherwise point `TILE_URL` at a compliant source.

### State and storage

| Where | What | Lifetime |
|---|---|---|
| Server, `sessions.sqlite` | encrypted tokens, username, groups, cached CSRF token | up to `SESSION_DAYS` |
| Browser `localStorage` | settings (language, typing tools, OSM choice), project hashtag | until cleared |
| Browser `sessionStorage` | stars | tab session |
| Page memory | loaded files and all staged (unsaved) edits | until the tab closes |

The server stores no file metadata. Everything that matters lives on Commons.

### Testing

- `tests/test_backend.py`: the OAuth flow (PKCE, state, rotation), encryption at rest, token refresh, every proxy rule, retries, rate limit. The Wikimedia endpoints are faked.
- `tests/test_pages.py`: every page renders, internal links resolve, no inline scripts, i18n files are complete and placeholder-safe.
- `tests/test_e2e.py`: headless Chromium against the running app with Wikimedia APIs replaced by canned responses: boot, load a category, select, stage a category, save while logged out (login prompt keeps the work), save while logged in (verify the proxied edit), switch language, type Malayalam with jQuery IME, render every documentation page. CSP violations and JavaScript errors fail the tests.

## Known limits and next steps

- The real Wikimedia OAuth endpoints, Toolforge deployment and the map tile server could not be exercised from the development sandbox; do a smoke test on a sandbox file after the first deploy (`docs/DEPLOY.md`).
- Reads are anonymous, so heavy use is subject to the public API's anonymous rate limits. If that bites, reads could move behind the proxy using the user's token.
- Statistics count what is saved on Commons for the loaded files only; a whole category is first listed and read in batches, so very large categories (many thousands of files) take a while to open.
- The statistics map uses the configured tile server (`TILE_URL`), default the Wikimedia maps server (OpenStreetMap data). It cannot be downloaded as PNG because tile images from another site would block the canvas export; its locations are available as CSV.
- Settings are per browser. Storing them in the user's Commons/Meta preferences (`Special:MyPage/DataWeaver.json`) would make them follow the user across devices.
- Not implemented: a check for **missing reciprocal Other versions links** (file A lists B, but B does not list A). The data needed is already loaded for series.
- Most of the tool's own labels still need translation (`@app` entries); only a starter Malayalam set is included, marked as a draft.
- RTL layout review and translatewiki.net integration.
