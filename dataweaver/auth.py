"""Wikimedia OAuth 2.0 (authorization-code flow with PKCE, confidential client).

Flow: /login -> meta.wikimedia.org authorize -> /oauth/callback (code -> tokens) -> session.
Tokens never reach the browser; the browser holds only an opaque session id cookie.
Docs: https://www.mediawiki.org/wiki/OAuth/For_Developers
"""
import base64
import hashlib
import hmac
import secrets
import time
from urllib.parse import urlencode, urlparse

import requests
from flask import Blueprint, current_app, g, jsonify, make_response, redirect, render_template, request

bp = Blueprint("auth", __name__)
COOKIE = "dw_sid"


# ---------------------------------------------------------------- helpers
def user_agent():
    cfg = current_app.config["DW"]
    return "DataWeaver/%s (%s; %s) python-requests/%s" % (
        current_app.config["DW_VERSION"], cfg["BASE_URL"], cfg["CONTACT"], requests.__version__)


def store():
    return current_app.extensions["dw_store"]


def load_session():
    """Return (sid, data) for the current request; data is {} when not logged in."""
    if not hasattr(g, "dw_session"):
        sid = request.cookies.get(COOKIE)
        data = store().load(sid) if sid else None
        g.dw_session = (sid if data is not None else None, data or {})
    return g.dw_session


def set_cookie(resp, sid):
    cfg = current_app.config["DW"]
    resp.set_cookie(COOKIE, sid, max_age=cfg["SESSION_DAYS"] * 86400, httponly=True,
                    secure=not cfg["DEV"], samesite="Lax", path="/")
    return resp


def safe_next(value):
    """Only allow same-site relative paths to avoid open redirects."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    return value if not urlparse(value).netloc else "/"


def public_user(data):
    u = data.get("user")
    if not u or not data.get("tokens"):
        return None
    return {"username": u.get("username"), "groups": u.get("groups", []), "rights": u.get("rights", [])}


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _token_request(form):
    cfg = current_app.config["DW"]
    form = dict(form, client_id=cfg["OAUTH_CLIENT_ID"], client_secret=cfg["OAUTH_CLIENT_SECRET"])
    r = requests.post(cfg["OAUTH_BASE"] + "/access_token", data=form, timeout=30,
                      headers={"User-Agent": user_agent()})
    body = r.json() if r.content else {}
    if r.status_code != 200 or "access_token" not in body:
        raise RuntimeError(body.get("error_description") or body.get("message") or body.get("error") or "HTTP %s" % r.status_code)
    return {"access": body["access_token"], "refresh": body.get("refresh_token"),
            "expires_at": int(time.time()) + int(body.get("expires_in", 14400))}


def access_token(sid, data):
    """Return a valid access token for this session, refreshing it when needed (or None)."""
    tokens = data.get("tokens")
    if not tokens:
        return None
    if tokens["expires_at"] - 60 > time.time():
        return tokens["access"]
    if not tokens.get("refresh"):
        drop_tokens(sid, data)
        return None
    try:
        fresh = _token_request({"grant_type": "refresh_token", "refresh_token": tokens["refresh"]})
    except Exception:  # revoked / expired refresh token
        drop_tokens(sid, data)
        return None
    fresh["refresh"] = fresh.get("refresh") or tokens["refresh"]
    data["tokens"] = fresh
    store().save(sid, data)
    return fresh["access"]


def drop_tokens(sid, data):
    data.pop("tokens", None)
    data.pop("user", None)
    data.pop("csrf", None)
    if sid:
        store().save(sid, data)


def message(title, text, status):
    from .pages import context  # imported lazily: pages imports this module
    return render_template("message.html", **context("/", title=title, text=text)), status


# ---------------------------------------------------------------- routes
@bp.get("/login")
def login():
    cfg = current_app.config["DW"]
    if not cfg["OAUTH_CLIENT_ID"] or not cfg["OAUTH_CLIENT_SECRET"]:
        return message("Login is not configured",
                       "This installation has no OAuth consumer yet. Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET "
                       "(see docs/DEPLOY.md).", 503)
    sid, data = load_session()
    state, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(64)
    data["oauth"] = {"state": state, "verifier": verifier, "next": safe_next(request.args.get("next"))}
    sid = sid or store().create(data)
    store().save(sid, data)
    query = urlencode({
        "client_id": cfg["OAUTH_CLIENT_ID"], "response_type": "code", "state": state,
        "redirect_uri": cfg["BASE_URL"] + "/oauth/callback",
        "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256",
    })
    return set_cookie(redirect(cfg["OAUTH_BASE"] + "/authorize?" + query), sid)


@bp.get("/oauth/callback")
def callback():
    cfg = current_app.config["DW"]
    sid, data = load_session()
    oauth = data.pop("oauth", None)

    def fail(text, status=400):
        return message("Login failed", text, status)

    if request.args.get("error"):
        return fail("Wikimedia returned: %s. You can try again." % request.args.get("error_description", request.args["error"]))
    if not oauth or not hmac.compare_digest(oauth["state"], request.args.get("state", "")):
        return fail("The login session was not recognised (state mismatch). Please start again.")
    code = request.args.get("code")
    if not code:
        return fail("No authorization code was returned.")
    try:
        tokens = _token_request({"grant_type": "authorization_code", "code": code,
                                 "redirect_uri": cfg["BASE_URL"] + "/oauth/callback", "code_verifier": oauth["verifier"]})
        pr = requests.get(cfg["OAUTH_BASE"] + "/resource/profile", timeout=30,
                          headers={"Authorization": "Bearer " + tokens["access"], "User-Agent": user_agent()})
        profile = pr.json()
        if pr.status_code != 200 or "username" not in profile:
            raise RuntimeError(profile.get("message") or "profile HTTP %s" % pr.status_code)
    except Exception as exc:
        return fail("Could not complete the login: %s" % exc, 502)

    store().delete(sid)  # new id after login (prevents session fixation)
    new_sid = store().create({
        "user": {"username": profile["username"], "sub": profile.get("sub"),
                 "groups": profile.get("groups", []), "rights": profile.get("rights", [])},
        "tokens": tokens,
    })
    return set_cookie(redirect(safe_next(oauth.get("next"))), new_sid)


@bp.post("/logout")
def logout():
    from .proxy import check_csrf
    bad = check_csrf()
    if bad:
        return bad
    sid, _ = load_session()
    store().delete(sid)
    resp = make_response(jsonify({"ok": True}))
    resp.delete_cookie(COOKIE, path="/")
    return resp


@bp.get("/api/me")
def me():
    sid, data = load_session()
    if data.get("tokens") and access_token(sid, data) is None:  # refresh failed -> logged out
        data = load_session()[1]
    resp = jsonify({"authenticated": bool(public_user(data)), "user": public_user(data)})
    resp.headers["Cache-Control"] = "no-store"
    return resp
