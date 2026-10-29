"""Every page renders, links to real routes, and ships working i18n files."""
import json
import re
from pathlib import Path

import pytest

from dataweaver import create_app

ROOT = Path(__file__).resolve().parent.parent
PAGES = ["/", "/howto", "/about", "/features", "/technology", "/story", "/community", "/credits", "/privacy", "/login/done"]


@pytest.fixture
def client(tmp_path):
    app = create_app({"DATA_DIR": str(tmp_path), "SECRET_KEY": "k", "DEV": True, "BASE_URL": "http://localhost"})
    return app.test_client()


@pytest.mark.parametrize("path", PAGES)
def test_page_renders_with_required_chrome(client, path):
    r = client.get(path)
    assert r.status_code == 200, path
    html = r.get_data(as_text=True)
    assert 'id="dw-gear"' in html and 'id="dw-config"' in html and "Commons<br>Data Weaver" in html
    assert "<script>" not in html  # strict CSP: no inline scripts


def test_about_has_author_doi_git_and_licence(client):
    html = client.get("/about").get_data(as_text=True)
    for needle in ("10.5281/zenodo.23680559", "github.com/wikimedia-biodiversity/dataweaver", "User:Manojk", "GNU General Public License v3.0"):
        assert needle in html


def test_about_tabs_cover_the_requested_sections(client):
    html = client.get("/about").get_data(as_text=True)
    for tab in ("Features", "Technology", "Story and workflows", "Community", "Credits"):
        assert tab in html


def test_internal_links_resolve(client):
    seen = set()
    for path in PAGES:
        for href in re.findall(r'href="(/[^"#?]*)', client.get(path).get_data(as_text=True)):
            if href.startswith("/static/") or href in seen:
                continue
            seen.add(href)
            assert client.get(href).status_code in (200, 302, 503), href


def test_tool_page_loads_scripts_in_order(client):
    html = client.get("/").get_data(as_text=True)
    order = [html.index(s) for s in ("dw-site.js", "dw-shim.js", "dataweaver.js")]
    assert order == sorted(order) and 'class="dw-app"' in html


def test_login_state_is_rendered_server_side(client):
    assert 'id="dw-login"' in client.get("/").get_data(as_text=True)


def test_static_assets_are_served(client):
    for p in ("/static/js/dw-site.js", "/static/js/dw-shim.js", "/static/js/dataweaver.js", "/static/css/site.css", "/static/img/logo.svg",
              "/static/vendor/jquery/jquery.min.js", "/static/vendor/jquery.ime/src/jquery.ime.js", "/static/vendor/jquery.ime/rules/ml/ml-inscript.js"):
        assert client.get(p).status_code == 200, p


def test_i18n_files_are_consistent():
    d = ROOT / "static" / "i18n"
    langs = json.loads((d / "languages.json").read_text(encoding="utf-8"))
    en = json.loads((d / "en.json").read_text(encoding="utf-8"))
    qqq = json.loads((d / "qqq.json").read_text(encoding="utf-8"))
    keys = {k for k in en if not k.startswith("@")}
    assert keys == {k for k in qqq if not k.startswith("@")}, "every message needs a qqq description"
    for lang in langs:
        data = json.loads((d / (lang["code"] + ".json")).read_text(encoding="utf-8"))
        unknown = {k for k in data if not k.startswith("@")} - keys
        assert not unknown, (lang["code"], unknown)
        for k, v in data.items():
            if not k.startswith("@"):
                assert sorted(re.findall(r"\$\d", v)) == sorted(re.findall(r"\$\d", en[k])), (lang["code"], k)


def test_every_message_key_used_in_code_exists():
    en = json.loads((ROOT / "static/i18n/en.json").read_text(encoding="utf-8"))
    used = set()
    for f in [ROOT / "static/js/dw-site.js", *(ROOT / "templates").glob("*.html")]:
        t = f.read_text(encoding="utf-8")
        used |= set(re.findall(r"DW\.t\('([a-z0-9-]+)'", t)) | set(re.findall(r'data-i18n(?:-title|-placeholder)?="([a-z0-9-]+)"', t))
    assert used - set(en) == set()
