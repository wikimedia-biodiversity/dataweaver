# Deploying to Wikimedia Toolforge

Target: **https://dataweaver.toolforge.org/**, built with the Toolforge **Build Service** (Python buildpack) from the Git repository.

> I could not run these commands against Toolforge while writing this guide. Command names follow the current
> [Toolforge help pages](https://wikitech.wikimedia.org/wiki/Help:Toolforge); if one differs on your account, `toolforge --help` is the authority.

## 0. Prerequisites

- A Wikimedia developer account and membership of a Toolforge project: <https://toolsadmin.wikimedia.org/>
- A tool account named `dataweaver` (this gives the `dataweaver.toolforge.org` address). Create it in toolsadmin, and add co-maintainers there.
- The code in a public Git repository: <https://github.com/wikimedia-biodiversity/dataweaver>

## 1. Register the OAuth consumer

Open <https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2> and fill in:

| Field | Value |
|---|---|
| Application name | Commons Data Weaver |
| Application description | Adds depicts, categories, locations and links between similar files to Wikimedia Commons files, one file or a category at a time. |
| OAuth protocol | **OAuth 2.0** |
| Client is confidential | **Yes** (the tool keeps a client secret on the server) |
| Callback URL | `https://dataweaver.toolforge.org/oauth/callback` |
| Applicable wiki | All projects (or `commonswiki`) |
| Grants | **Request authorization for specific permissions**: *Basic rights* and *Edit existing pages* |
| Allowed IP ranges | leave the default |
| Contact email | an address you read; it is only seen by OAuth administrators |

You receive a **client id** and a **client secret** once the form is submitted. Keep the secret private: it goes into Toolforge environment variables, never into Git.

Notes:

- A public consumer needs approval by a Wikimedia OAuth administrator, usually within days. Until then **tick "This consumer is for use only by <your username>"** to get an owner-only consumer that works immediately for you. Owner-only consumers are also the right choice for local development.
- For local development register a second owner-only consumer with the callback `http://localhost:5000/oauth/callback`.
- Grant *Edit existing pages* only. The tool never creates pages (it edits with `nocreate`), moves, deletes or changes user rights.
- To change the callback URL or grants later you must propose an updated consumer version; plan the final values first.

## 2. Configure the tool

SSH to `login.toolforge.org`, then become the tool (`become dataweaver`), and store the configuration as Toolforge environment variables:

```bash
toolforge envvars create SECRET_KEY            # paste the output of: python3 -c "import secrets; print(secrets.token_hex(32))"
toolforge envvars create OAUTH_CLIENT_ID
toolforge envvars create OAUTH_CLIENT_SECRET
toolforge envvars create BASE_URL              # https://dataweaver.toolforge.org
toolforge envvars list
```

Each command asks for the value, so secrets do not land in your shell history. Rotating `SECRET_KEY` logs everybody out and nothing more.

| Variable | Required | Meaning |
|---|---|---|
| `SECRET_KEY` | yes | Derives the key that encrypts tokens at rest. 64 hex characters. |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | yes | From the consumer registration. |
| `BASE_URL` | yes | Public address, no trailing slash. Must match the registered callback and is checked on every write (`Origin`). |
| `DATA_DIR` | no | Where `sessions.sqlite` lives. Default `./var`, or `$TOOL_DATA_DIR` when the tool's storage is mounted. |
| `SESSION_DAYS` | no | Login lifetime, default 14. |
| `WRITES_PER_MINUTE` | no | Edits per user per minute, default 120. |
| `MAXLAG` | no | `maxlag` sent with edits, default 5. |
| `TILE_URL` | no | Map tile template, default `https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png`. |
| `NOMINATIM_URL` | no | OSM place search endpoint (used only when a user switches it on). |
| `CONTACT` | no | Contact string inside the `User-Agent`, default the repository URL. |

## 3. Build and start

```bash
toolforge build start https://github.com/wikimedia-biodiversity/dataweaver
toolforge build show                                   # wait for "build succeeded"
toolforge webservice buildservice start --mount=all
toolforge webservice status
```

The buildpack installs `requirements.txt` and runs the `web` process from the `Procfile` (gunicorn on port 8000).

**Sessions and storage.** Sessions are kept in SQLite. With `--mount=none` the container's disk is lost whenever the web service restarts, which logs users out. `--mount=all` keeps `sessions.sqlite` on the tool's shared storage (`$TOOL_DATA_DIR`, which the app picks up by itself). Either is correct; `all` is friendlier.

Check it:

```bash
curl -s https://dataweaver.toolforge.org/healthz        # {"status":"ok","version":"1.0.0"}
```

Then open the site, press **Log in**, and save an edit on a file in your sandbox.

## 4. Update

```bash
become dataweaver
toolforge build start https://github.com/wikimedia-biodiversity/dataweaver     # rebuilds from the default branch
toolforge webservice restart
```

Roll back by building an older tag or commit if your Toolforge version supports a ref argument; otherwise revert on the default branch and rebuild.

## 5. Operate

- Logs: `toolforge webservice logs -f`.
- Wikimedia policy: the tool sends a descriptive `User-Agent` with the repository URL (set `CONTACT` to add an address), respects `maxlag`, and caps edits per minute.
- Privacy: keep the [privacy note](../templates/privacy.html) accurate if you add anything that stores or forwards data.
- Third-party requests from the browser are limited to the optional OpenStreetMap place search (off by default) and the configured tile server. Do not add analytics, fonts, scripts or CDNs: Toolforge's rules and the Wikimedia privacy policy discourage loading third-party resources, and the Content-Security-Policy would block them anyway.

## Local development

```bash
cp .env.example .env     # DW_DEV=1, BASE_URL=http://localhost:5000, SECRET_KEY, and an owner-only consumer
make dev                 # http://localhost:5000
```

`DW_DEV=1` allows plain HTTP cookies and a throw-away secret. Never set it on Toolforge.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Login is not configured" | `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` missing; `toolforge envvars list`, then restart. |
| Wikimedia says "invalid redirect_uri" | `BASE_URL` or the registered callback differs; they must match exactly, including `https` and no trailing slash. |
| "state mismatch" after login | Cookies blocked, or the login took longer than the session lifetime; try again. |
| Saves fail with `notloggedin` right after login | The consumer is awaiting approval, or does not include *Edit existing pages*. |
| Saves fail with `permissiondenied` or `protectedpage` | The user's account cannot edit that file; not a tool fault. |
| Everyone is logged out after each restart | The web service runs with `--mount=none`; use `--mount=all` or set `DATA_DIR` to persistent storage. |
| `RuntimeError: SECRET_KEY is not set` in the logs | Missing environment variable. |
