# Contributing to Commons Data Weaver

Thank you for helping. Everyone taking part is expected to follow the
[Universal Code of Conduct](https://foundation.wikimedia.org/wiki/Policy:Universal_Code_of_Conduct).

## Ways to help

- **Report a problem or an idea:** open an issue. Say what you did, what you expected, what happened, your browser, and the file or category involved.
- **Translate:** see [Translations](#translations).
- **Improve the code or the pages:** open a pull request.

## Set up

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
playwright install chromium          # only for the browser tests
cp .env.example .env                 # then fill in SECRET_KEY and the OAuth consumer
make dev                             # http://localhost:5000
make test
```

For login on your own machine, register an **owner-only** OAuth 2.0 consumer on Meta-Wiki
(accepted automatically, usable only by you) with the callback `http://localhost:5000/oauth/callback`.
Details are in [docs/DEPLOY.md](docs/DEPLOY.md#1-register-the-oauth-consumer).
Without a consumer, everything works except logging in and saving.

## How the code is organised

| Path | What it is |
|---|---|
| `dataweaver/` | Flask app: `auth.py` (OAuth 2.0), `proxy.py` (write proxy and its allow-list), `store.py` (sessions), `pages.py` (routes) |
| `templates/` | Jinja pages: tool shell, About, How to use, and so on |
| `static/js/dataweaver.js` | The tool's interface (grid, batch panel, one-by-one view, exports). Edit it directly |
| `static/js/dw-stats.js`, `static/css/stats.css` | The statistics page: calculations, SVG charts, map with clustering |
| `static/config/projects.json` | Projects for the Project menu and each project's "help needed" category |
| `static/js/dw-shim.js` | The few MediaWiki helpers (`mw.Api`, `mw.config`, …) the interface expects |
| `static/js/dw-site.js` | Navigation, login state, settings gear, localisation, typing tools |
| `static/i18n/` | Message files |
| `static/vendor/` | jQuery and jQuery IME, served from this site (Toolforge's rules discourage third-party scripts) |
| `tests/` | `test_backend.py`, `test_pages.py`, `test_e2e.py` and `test_e2e_110.py` (headless Chromium, mocked Wikimedia APIs) |
| `tools/` | `screenshots.py` and `sample_data.py` (invented data for the screenshots and the example statistics graphics) |

### The interface file

Since 1.1.0, `static/js/dataweaver.js` is the source of truth: edit it directly. It started as the Commons user
script; `tools/port_userscript.py` still reproduces the 1.0.0 baseline from that script, but running it now would
overwrite the 1.1.0 features, so it is kept only for reference.

`dw-stats.js` reaches the tool's data through `DW.core` (set at the end of `dataweaver.js`). Its calculations are
plain functions (`DW.stats._calc`, `_activity`) so they are easy to test.

### Projects and the Help needed category

Edit `static/config/projects.json`: a project's `name` becomes the hashtag in edit summaries, and its `helpCategory`
(without the `Category:` prefix) is what the Help needed button adds. Leave it empty until the category exists.

### The write proxy is deliberately small

`dataweaver/proxy.py` allows only `edit` (by page id), `wbeditentity` and `wbsetlabel` on `M…` ids,
and drops every other parameter. If the interface needs a new kind of edit, add it to `ALLOWED` and `REQUIRED`
there and add a test in `tests/test_backend.py`.

## Translations

1. Copy `static/i18n/en.json` to `static/i18n/<code>.json` and translate the values. Keep `$1`-style placeholders.
2. Add the language to `static/i18n/languages.json` (`code`, `name` in the language itself, `dir`, optional `status`).
3. To translate the tool's own labels, add `"English text": "translation"` pairs under `"@app"`.
   Only static labels are matched; text with counters or file names stays English.
4. `make test-fast` checks that placeholders and keys are consistent.

`qqq.json` documents every message for translators.

## Pull requests

- Keep changes focused, and run `make test`.
- Do not commit `.env`, `var/` or any secret. Use `toolforge envvars` on Toolforge.
- By contributing you agree to license your work under GPL-3.0-or-later.
