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
| `static/js/dataweaver.js` | The tool's interface. **Generated** from the Commons user script, see below |
| `static/js/dw-shim.js` | The few MediaWiki helpers (`mw.Api`, `mw.config`, …) the interface expects |
| `static/js/dw-site.js` | Navigation, login state, settings gear, localisation, typing tools |
| `static/i18n/` | Message files |
| `static/vendor/` | jQuery and jQuery IME, served from this site (Toolforge's rules discourage third-party scripts) |
| `tests/` | `test_backend.py`, `test_pages.py`, `test_e2e.py` (headless Chromium, mocked Wikimedia APIs) |

### The interface is generated

`static/js/dataweaver.js` is produced by `tools/port_userscript.py` from the Commons Data Weaver
user script, so both share one interface. To change the interface:

1. change the user script, then run `make port SRC=path/to/CommonsDataWeaver.js`; **or**
2. edit `static/js/dataweaver.js` directly and stop using the port script.

Do not mix the two. If the user script changes in a way the port rules do not cover, the script
stops and names the rule to update.

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
