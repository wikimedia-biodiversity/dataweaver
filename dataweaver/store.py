"""Server-side session store.

The browser only ever holds a random, signed session id in an HttpOnly cookie.
OAuth tokens stay on the server, encrypted at rest (Fernet, key derived from SECRET_KEY).
SQLite keeps this dependency-free and works with several gunicorn workers.
"""
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import time

from cryptography.fernet import Fernet, InvalidToken


class SessionStore:
    def __init__(self, data_dir, secret_key, lifetime_days=14):
        os.makedirs(data_dir, exist_ok=True)
        self.path = os.path.join(data_dir, "sessions.sqlite")
        self.lifetime = int(lifetime_days) * 86400
        key = hashlib.sha256(b"dataweaver-session-key:" + secret_key.encode()).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(key))
        with self._db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data BLOB NOT NULL, expires INTEGER NOT NULL)")

    def _db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def create(self, data=None):
        sid = secrets.token_urlsafe(32)
        self.save(sid, data or {})
        return sid

    def save(self, sid, data):
        blob = self._fernet.encrypt(json.dumps(data).encode())
        expires = int(time.time()) + self.lifetime
        with self._db() as db:
            db.execute("INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)", (sid, blob, expires))
            if secrets.randbelow(50) == 0:  # opportunistic clean-up
                db.execute("DELETE FROM sessions WHERE expires < ?", (int(time.time()),))

    def load(self, sid):
        if not sid:
            return None
        with self._db() as db:
            row = db.execute("SELECT data, expires FROM sessions WHERE sid = ?", (sid,)).fetchone()
        if not row or row[1] < time.time():
            return None
        try:
            return json.loads(self._fernet.decrypt(row[0]))
        except (InvalidToken, ValueError):
            return None

    def delete(self, sid):
        if sid:
            with self._db() as db:
                db.execute("DELETE FROM sessions WHERE sid = ?", (sid,))
