"""Configuration for Data Weaver.

Everything comes from environment variables so that secrets never live in git.
On Toolforge set them with ``toolforge envvars create NAME`` (see docs/DEPLOY.md).
"""
import os

VERSION = "1.1.0"
DOI = "10.5281/zenodo.23680559"
GIT_URL = "https://github.com/wikimedia-biodiversity/dataweaver"
AUTHOR = "Manoj Karingamadathil"
AUTHOR_URL = "https://meta.wikimedia.org/wiki/User:Manojk"
ORCID = "0000-0003-3885-6595"


def _bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def load_config(env=None):
    """Return the configuration as a plain dict (testable, no globals)."""
    env = os.environ if env is None else env
    dev = _bool(env.get("DW_DEV"))
    base_url = env.get("BASE_URL", "http://localhost:5000" if dev else "https://dataweaver.toolforge.org").rstrip("/")
    return {
        "DEV": dev,
        "BASE_URL": base_url,
        "SECRET_KEY": env.get("SECRET_KEY") or ("dev-only-insecure-key" if dev else None),
        # Wikimedia OAuth 2.0 consumer (register at Special:OAuthConsumerRegistration on meta.wikimedia.org)
        "OAUTH_CLIENT_ID": env.get("OAUTH_CLIENT_ID", ""),
        "OAUTH_CLIENT_SECRET": env.get("OAUTH_CLIENT_SECRET", ""),
        "OAUTH_BASE": env.get("OAUTH_BASE", "https://meta.wikimedia.org/w/rest.php/oauth2").rstrip("/"),
        # The wiki that receives the edits
        "API_URL": env.get("API_URL", "https://commons.wikimedia.org/w/api.php"),
        "WIKIDATA_API_URL": env.get("WIKIDATA_API_URL", "https://www.wikidata.org/w/api.php"),
        # Browser-side map settings (kept configurable, see docs/PRIVACY in the About pages)
        "TILE_URL": env.get("TILE_URL", "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png"),
        "NOMINATIM_URL": env.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search"),
        # Server-side session storage (SQLite). On Toolforge point this at a mounted directory.
        "DATA_DIR": env.get("DATA_DIR") or env.get("TOOL_DATA_DIR") or os.path.join(os.getcwd(), "var"),
        "SESSION_DAYS": int(env.get("SESSION_DAYS", "14")),
        # Courtesy limits for the write proxy
        "WRITES_PER_MINUTE": int(env.get("WRITES_PER_MINUTE", "120")),
        "MAXLAG": int(env.get("MAXLAG", "5")),
        # User-Agent contact: Wikimedia policy wants a way to reach the tool owner
        "CONTACT": env.get("CONTACT", GIT_URL),
    }
