"""Write proxy: the browser asks Data Weaver to edit on its behalf.

Reads (search, file info, Wikidata) go straight from the browser to the public Wikimedia APIs.
Writes go through here so that the OAuth access token never reaches JavaScript, the tool can
add the #DataWeaver tag, respect maxlag, and refuse anything outside a small allow-list.
"""
import re
import threading
import time
from collections import defaultdict, deque

import requests
from flask import Blueprint, current_app, jsonify, request

from .auth import access_token, drop_tokens, load_session, store, user_agent

bp = Blueprint("proxy", __name__)

TAG = "#DataWeaver"
ID_M = re.compile(r"^M\d{1,12}$")
DIGITS = re.compile(r"^\d{1,12}$")
# action -> {param: validator or None}. Anything not listed is dropped.
ALLOWED = {
    "edit": {"pageid": DIGITS, "text": None, "summary": None, "nocreate": None, "minor": None,
             "baserevid": DIGITS, "basetimestamp": None, "starttimestamp": None},
    "wbeditentity": {"id": ID_M, "data": None, "summary": None, "baserevid": DIGITS},
    "wbsetlabel": {"id": ID_M, "language": re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$"), "value": None,
                   "summary": None, "baserevid": DIGITS},
}
REQUIRED = {"edit": ("pageid", "text"), "wbeditentity": ("id", "data"), "wbsetlabel": ("id", "language", "value")}
SESSION_ERRORS = {"mwoauth-invalid-authorization", "mwoauth-invalid-authorization-invalid-user",
                  "mwoauth-invalid-authorization-not-found", "assertuserfailed", "assertnameduserfailed"}

_hits = defaultdict(deque)
_hits_lock = threading.Lock()


def error(code, info, status):
    return jsonify({"error": {"code": code, "info": info}}), status


def check_csrf():
    """Same-origin + custom header. Cookies are SameSite=Lax; this is the second layer."""
    if request.headers.get("X-Requested-With") != "DataWeaver":
        return error("csrf", "Missing X-Requested-With header.", 403)
    origin = request.headers.get("Origin")
    if origin and origin.rstrip("/") != current_app.config["DW"]["BASE_URL"]:
        return error("csrf", "Cross-origin request refused.", 403)
    return None


def _throttled(sid):
    limit = current_app.config["DW"]["WRITES_PER_MINUTE"]
    now = time.time()
    with _hits_lock:
        q = _hits[sid]
        while q and q[0] < now - 60:
            q.popleft()
        if len(q) >= limit:
            return True
        q.append(now)
    return False


def clean_params(raw):
    """Validate and normalise client parameters. Returns (params, error_message)."""
    if not isinstance(raw, dict):
        return None, "params must be an object"
    action = raw.get("action")
    if action not in ALLOWED:
        return None, "Action '%s' is not allowed through Data Weaver." % action
    out = {"action": action}
    for key, check in ALLOWED[action].items():
        if key not in raw or raw[key] is None:
            continue
        value = raw[key]
        value = ("1" if value else "0") if isinstance(value, bool) else str(value)
        if check is not None and not check.match(value):
            return None, "Invalid value for '%s'." % key
        out[key] = value
    for key in REQUIRED[action]:
        if key not in out:
            return None, "Missing parameter '%s'." % key
    if "summary" in out or action in ("edit", "wbeditentity", "wbsetlabel"):
        summary = out.get("summary", "").strip()
        out["summary"] = summary if TAG in summary else (summary + " " + TAG).strip()
    return out, None


def _mw(method, token, params):
    cfg = current_app.config["DW"]
    headers = {"Authorization": "Bearer " + token, "User-Agent": user_agent()}
    if method == "GET":
        return requests.get(cfg["API_URL"], params=params, headers=headers, timeout=60)
    return requests.post(cfg["API_URL"], data=params, headers=headers, timeout=120)


def _csrf_token(sid, data, token, refresh=False):
    if data.get("csrf") and not refresh:
        return data["csrf"]
    r = _mw("GET", token, {"action": "query", "meta": "tokens", "type": "csrf", "format": "json", "assert": "user"})
    body = r.json()
    value = (body.get("query", {}).get("tokens", {}) or {}).get("csrftoken")
    if not value or value == "+\\":
        code = (body.get("error") or {}).get("code", "")
        return ("session", code)
    data["csrf"] = value
    store().save(sid, data)
    return value


@bp.post("/api/write")
def write():
    bad = check_csrf()
    if bad:
        return bad
    cfg = current_app.config["DW"]
    sid, data = load_session()
    token = access_token(sid, data) if sid else None
    if not token:
        return error("notloggedin", "Log in with your Wikimedia account to save edits.", 401)
    if _throttled(sid):
        return error("ratelimited", "Too many edits in a minute. Wait a moment and save again.", 429)

    body = request.get_json(silent=True) or {}
    params, problem = clean_params(body.get("params"))
    if problem:
        return error("badrequest", problem, 400)

    try:
        csrf = _csrf_token(sid, data, token)
        if isinstance(csrf, tuple):
            drop_tokens(sid, data)
            return error("session_expired", "Your Wikimedia login has expired. Please log in again.", 401)
        params.update({"format": "json", "assert": "user", "maxlag": str(cfg["MAXLAG"])})
        result = None
        for attempt in range(4):
            params["token"] = csrf
            resp = _mw("POST", token, params)
            result = resp.json()
            code = (result.get("error") or {}).get("code")
            if code == "badtoken" and attempt == 0:
                csrf = _csrf_token(sid, data, token, refresh=True)
                if isinstance(csrf, tuple):
                    break
                continue
            if code == "maxlag":
                time.sleep(min(float(resp.headers.get("Retry-After", 2)), 6))
                continue
            break
    except (requests.RequestException, ValueError) as exc:
        return error("proxy-network", "Could not reach the wiki: %s" % exc, 502)

    code = (result.get("error") or {}).get("code")
    if code in SESSION_ERRORS or isinstance(csrf, tuple):
        drop_tokens(sid, data)
        return error("session_expired", "Your Wikimedia login has expired. Please log in again.", 401)
    resp = jsonify(result)
    resp.headers["Cache-Control"] = "no-store"
    return resp
