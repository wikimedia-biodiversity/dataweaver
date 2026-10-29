"""Commons Data Weaver — web application factory."""
from urllib.parse import urlparse

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from . import auth, config, pages, proxy
from .store import SessionStore


def create_app(overrides=None):
    cfg = config.load_config()
    cfg.update(overrides or {})
    if not cfg["SECRET_KEY"]:
        raise RuntimeError("SECRET_KEY is not set. Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\"")

    app = Flask(__name__, static_folder="../static", template_folder="../templates")
    app.config["DW"] = cfg
    app.config["DW_VERSION"] = config.VERSION
    app.config["MAX_CONTENT_LENGTH"] = 3 * 1024 * 1024  # wikitext is limited to 2 MB
    app.config["JSON_AS_ASCII"] = False
    # Toolforge terminates TLS in front of the app and sends X-Forwarded-* headers
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    app.extensions["dw_store"] = SessionStore(cfg["DATA_DIR"], cfg["SECRET_KEY"], cfg["SESSION_DAYS"])
    app.register_blueprint(auth.bp)
    app.register_blueprint(proxy.bp)
    app.register_blueprint(pages.bp)

    nominatim_origin = "{0.scheme}://{0.netloc}".format(urlparse(cfg["NOMINATIM_URL"]))
    tiles_origin = "{0.scheme}://{0.netloc}".format(urlparse(cfg["TILE_URL"].replace("{z}", "0").replace("{x}", "0").replace("{y}", "0")))
    csp = "; ".join([
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",  # the interface injects its stylesheet at runtime
        "img-src 'self' data: blob: https://commons.wikimedia.org https://upload.wikimedia.org %s" % tiles_origin,
        "connect-src 'self' https://commons.wikimedia.org https://www.wikidata.org %s" % nominatim_origin,
        "font-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
    ])

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("Content-Security-Policy", csp)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("Permissions-Policy", "geolocation=(), camera=(), microphone=()")
        return resp

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "version": config.VERSION}

    return app
