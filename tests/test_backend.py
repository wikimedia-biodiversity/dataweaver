"""Backend tests: OAuth flow, session storage and the write proxy. No network is used."""
import sqlite3
import time
from urllib.parse import parse_qs, urlparse

import pytest
import requests

from dataweaver import create_app
from dataweaver.auth import safe_next

H = {"X-Requested-With": "DataWeaver"}


class FakeWiki:
    """Stands in for meta.wikimedia.org (OAuth) and commons.wikimedia.org (API)."""

    def __init__(self):
        self.calls = []
        self.token_counter = 0
        self.edit_results = []          # queued JSON bodies for POST api.php
        self.csrf = "csrf-1+\\"
        self.refresh_fails = False

    def _resp(self, body, status=200, headers=None):
        r = requests.Response()
        r.status_code = status
        r._content = __import__("json").dumps(body).encode()
        r.headers.update(headers or {})
        return r

    def post(self, url, data=None, headers=None, timeout=None, **kw):
        self.calls.append(("POST", url, dict(data or {}), dict(headers or {})))
        if url.endswith("/access_token"):
            if data["grant_type"] == "refresh_token" and self.refresh_fails:
                return self._resp({"error": "invalid_grant"}, 400)
            self.token_counter += 1
            return self._resp({"access_token": "AT%d" % self.token_counter, "refresh_token": "RT%d" % self.token_counter,
                               "expires_in": 14400, "token_type": "Bearer"})
        body = self.edit_results.pop(0) if self.edit_results else {"edit": {"result": "Success", "newrevid": 99}}
        return self._resp(body)

    def get(self, url, params=None, headers=None, timeout=None, **kw):
        self.calls.append(("GET", url, dict(params or {}), dict(headers or {})))
        if url.endswith("/resource/profile"):
            return self._resp({"sub": "123", "username": "Test User", "groups": ["*", "user", "autoconfirmed"], "rights": ["edit"]})
        if params and params.get("meta") == "tokens":
            return self._resp({"query": {"tokens": {"csrftoken": self.csrf}}})
        return self._resp({})


@pytest.fixture
def wiki(monkeypatch):
    w = FakeWiki()
    monkeypatch.setattr(requests, "post", w.post)
    monkeypatch.setattr(requests, "get", w.get)
    return w


@pytest.fixture
def app(tmp_path):
    return create_app({"DATA_DIR": str(tmp_path), "SECRET_KEY": "test-secret", "DEV": True, "BASE_URL": "http://localhost",
                       "OAUTH_CLIENT_ID": "cid", "OAUTH_CLIENT_SECRET": "csecret"})


@pytest.fixture
def client(app):
    return app.test_client()


def login(client, wiki, next_path="/howto"):
    r = client.get("/login?next=" + next_path)
    assert r.status_code == 302
    state = parse_qs(urlparse(r.headers["Location"]).query)["state"][0]
    r = client.get("/oauth/callback?code=abc&state=" + state)
    assert r.status_code == 302, r.data
    return r


def writes(wiki):
    return [c for c in wiki.calls if c[0] == "POST" and c[1].endswith("api.php")]


# ------------------------------------------------------------------ OAuth
def test_login_redirects_to_wikimedia_with_pkce(client):
    r = client.get("/login")
    assert r.status_code == 302
    u = urlparse(r.headers["Location"])
    assert u.netloc == "meta.wikimedia.org" and u.path.endswith("/oauth2/authorize")
    q = parse_qs(u.query)
    assert q["client_id"] == ["cid"] and q["response_type"] == ["code"]
    assert q["code_challenge_method"] == ["S256"] and q["code_challenge"][0]
    assert q["redirect_uri"] == ["http://localhost/oauth/callback"]
    assert "dw_sid" in r.headers.get("Set-Cookie", "") and "HttpOnly" in r.headers["Set-Cookie"]


def test_login_unconfigured_is_a_clear_503(tmp_path):
    app = create_app({"DATA_DIR": str(tmp_path), "SECRET_KEY": "k", "DEV": True, "OAUTH_CLIENT_ID": "", "OAUTH_CLIENT_SECRET": ""})
    r = app.test_client().get("/login")
    assert r.status_code == 503 and b"not configured" in r.data


def test_callback_rejects_wrong_state(client, wiki):
    client.get("/login")
    r = client.get("/oauth/callback?code=abc&state=wrong")
    assert r.status_code == 400 and b"state mismatch" in r.data


def test_callback_rejects_missing_login_session(client, wiki):
    assert client.get("/oauth/callback?code=abc&state=x").status_code == 400


def test_full_login_flow_uses_secret_and_verifier(client, wiki):
    r = login(client, wiki)
    assert r.headers["Location"] == "/howto"
    token_call = [c for c in wiki.calls if c[1].endswith("/access_token")][0]
    assert token_call[2]["client_secret"] == "csecret" and token_call[2]["code_verifier"] and token_call[2]["code"] == "abc"
    me = client.get("/api/me").get_json()
    assert me["authenticated"] and me["user"]["username"] == "Test User"
    assert "access_token" not in client.get("/api/me").get_data(as_text=True)


def test_session_id_is_rotated_on_login(client, wiki):
    first = client.get("/login").headers["Set-Cookie"].split(";")[0]
    state = parse_qs(urlparse(client.get("/login").headers["Location"]).query)["state"][0]
    second = client.get("/oauth/callback?code=abc&state=" + state).headers["Set-Cookie"].split(";")[0]
    assert first.split("=")[1] != second.split("=")[1]


def test_tokens_are_encrypted_at_rest(client, wiki, app):
    login(client, wiki)
    raw = sqlite3.connect(app.extensions["dw_store"].path).execute("SELECT data FROM sessions").fetchall()
    assert raw and all(b"AT1" not in row[0] and b"Test User" not in row[0] for row in raw)


def test_logout_needs_header_and_clears_session(client, wiki):
    login(client, wiki)
    assert client.post("/logout").status_code == 403
    assert client.post("/logout", headers=H).status_code == 200
    assert client.get("/api/me").get_json()["authenticated"] is False


def test_safe_next_blocks_open_redirects():
    assert safe_next("/howto") == "/howto"
    for bad in ("//evil.com", "https://evil.com", "/\\evil.com", "", None, "javascript:alert(1)"):
        assert safe_next(bad) == "/"


# ------------------------------------------------------------------ write proxy
def post_write(client, params, headers=H):
    return client.post("/api/write", json={"params": params}, headers=headers)


def test_write_requires_custom_header(client, wiki):
    login(client, wiki)
    assert post_write(client, {"action": "edit", "pageid": 1, "text": "x"}, headers={}).status_code == 403


def test_write_rejects_foreign_origin(client, wiki):
    login(client, wiki)
    r = post_write(client, {"action": "edit", "pageid": 1, "text": "x"}, headers=dict(H, Origin="https://evil.example"))
    assert r.status_code == 403


def test_write_requires_login(client, wiki):
    r = post_write(client, {"action": "edit", "pageid": 1, "text": "x"})
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "notloggedin"
    assert not writes(wiki)


@pytest.mark.parametrize("params", [
    {"action": "delete", "pageid": 1},
    {"action": "block", "user": "x"},
    {"action": "edit", "pageid": "1; DROP", "text": "x"},
    {"action": "edit", "text": "no page"},
    {"action": "wbeditentity", "id": "Q5", "data": "{}"},
    {"action": "wbsetlabel", "id": "M1", "language": "../en", "value": "x"},
])
def test_write_rejects_disallowed_requests(client, wiki, params):
    login(client, wiki)
    r = post_write(client, params)
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "badrequest"
    assert not writes(wiki)


def test_write_forwards_with_bearer_tag_and_maxlag(client, wiki):
    login(client, wiki)
    r = post_write(client, {"action": "edit", "pageid": 123, "text": "T", "summary": "Added [[Category:X]]", "nocreate": 1,
                            "title": "File:Evil.jpg", "bot": 1, "token": "client-supplied"})
    assert r.status_code == 200 and r.get_json()["edit"]["result"] == "Success"
    method, url, data, headers = writes(wiki)[0]
    assert headers["Authorization"] == "Bearer AT1" and "DataWeaver/" in headers["User-Agent"]
    assert data["summary"] == "Added [[Category:X]] #DataWeaver"
    assert data["maxlag"] == "5" and data["assert"] == "user" and data["format"] == "json"
    assert data["token"] == "csrf-1+\\" and "title" not in data and "bot" not in data and data["nocreate"] == "1"


def test_summary_tag_not_duplicated(client, wiki):
    login(client, wiki)
    post_write(client, {"action": "wbsetlabel", "id": "M5", "language": "en", "value": "A fish", "summary": "Caption, #DataWeaver #Bioregister"})
    assert writes(wiki)[0][2]["summary"] == "Caption, #DataWeaver #Bioregister"


def test_badtoken_is_retried_once_with_a_fresh_token(client, wiki):
    login(client, wiki)
    wiki.edit_results = [{"error": {"code": "badtoken", "info": "Invalid CSRF token."}}, {"edit": {"result": "Success"}}]
    r = post_write(client, {"action": "edit", "pageid": 7, "text": "T"})
    assert r.get_json()["edit"]["result"] == "Success" and len(writes(wiki)) == 2


def test_maxlag_is_retried(client, wiki, monkeypatch):
    monkeypatch.setattr("dataweaver.proxy.time.sleep", lambda s: None)
    login(client, wiki)
    wiki.edit_results = [{"error": {"code": "maxlag", "info": "lagged"}}, {"edit": {"result": "Success"}}]
    assert post_write(client, {"action": "edit", "pageid": 7, "text": "T"}).get_json()["edit"]["result"] == "Success"


def test_api_errors_pass_through_unchanged(client, wiki):
    login(client, wiki)
    wiki.edit_results = [{"error": {"code": "editconflict", "info": "Edit conflict."}}]
    r = post_write(client, {"action": "edit", "pageid": 7, "text": "T"})
    assert r.status_code == 200 and r.get_json()["error"]["code"] == "editconflict"


def test_revoked_token_ends_the_session_cleanly(client, wiki):
    login(client, wiki)
    wiki.edit_results = [{"error": {"code": "mwoauth-invalid-authorization", "info": "revoked"}}]
    r = post_write(client, {"action": "edit", "pageid": 7, "text": "T"})
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "session_expired"
    assert client.get("/api/me").get_json()["authenticated"] is False


def test_expired_access_token_is_refreshed(client, wiki, app):
    login(client, wiki)
    store = app.extensions["dw_store"]
    sid = client.get_cookie("dw_sid").value
    data = store.load(sid)
    data["tokens"]["expires_at"] = int(time.time()) - 10
    store.save(sid, data)
    assert post_write(client, {"action": "edit", "pageid": 7, "text": "T"}).status_code == 200
    refresh = [c for c in wiki.calls if c[1].endswith("/access_token") and c[2].get("grant_type") == "refresh_token"]
    assert refresh and refresh[0][2]["refresh_token"] == "RT1"
    assert writes(wiki)[0][3]["Authorization"] == "Bearer AT2"


def test_failed_refresh_logs_out(client, wiki, app):
    login(client, wiki)
    store = app.extensions["dw_store"]
    sid = client.get_cookie("dw_sid").value
    data = store.load(sid)
    data["tokens"]["expires_at"] = 0
    store.save(sid, data)
    wiki.refresh_fails = True
    r = post_write(client, {"action": "edit", "pageid": 7, "text": "T"})
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "notloggedin"


def test_write_rate_limit(tmp_path, wiki):
    app = create_app({"DATA_DIR": str(tmp_path), "SECRET_KEY": "k", "DEV": True, "BASE_URL": "http://localhost",
                      "OAUTH_CLIENT_ID": "cid", "OAUTH_CLIENT_SECRET": "s", "WRITES_PER_MINUTE": 2})
    c = app.test_client()
    login(c, wiki)
    codes = [post_write(c, {"action": "edit", "pageid": 7, "text": "T"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_security_headers(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert "script-src 'self'" in r.headers["Content-Security-Policy"] and r.headers["X-Content-Type-Options"] == "nosniff"
