"""End-to-end test in headless Chromium.

The real Wikimedia APIs are replaced by canned responses (Playwright request interception for the
browser's reads, FakeWiki for the server's writes), so no network and no real wiki are involved.
Run:  pytest tests/test_e2e.py     (skipped automatically when Playwright or Chromium is missing)
"""
import json
import socket
import threading
import time
from urllib.parse import parse_qs, urlparse

import pytest

pytest.importorskip("playwright")
from playwright.sync_api import expect, sync_playwright  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402

from dataweaver import create_app  # noqa: E402
from tests.test_backend import FakeWiki  # noqa: E402

PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0000003010100c9fe92ef0000000049454e44ae426082")
WIKITEXT = ("=={{int:filedesc}}==\n{{Information\n|description={{en|1=A fish}}\n|date=2026-10-02\n|source={{own}}\n|author=Anna\n|permission=\n}}\n"
            "=={{int:license-header}}==\n{{self|cc-by-sa-4.0}}\n\n[[Category:Fishes of Kerala]]\n")


def imageinfo(n, title, when):
    return {"pageid": n, "title": title, "categories": [{"title": "Category:Fishes of Kerala"}], "imageinfo": [{
        "url": "https://upload.wikimedia.org/full/%d.jpg" % n, "thumburl": "https://upload.wikimedia.org/thumb/%d.jpg" % n,
        "descriptionurl": "https://commons.wikimedia.org/wiki/" + title.replace(" ", "_"), "width": 4000, "height": 3000, "size": 5000000,
        "timestamp": "2026-10-03T10:00:00Z", "user": "Anna", "mime": "image/jpeg",
        "commonmetadata": [{"name": "Make", "value": "Nikon"}, {"name": "Model", "value": "D850"}],
        "extmetadata": {"Artist": {"value": "Anna"}, "LicenseShortName": {"value": "CC BY-SA 4.0"}, "DateTimeOriginal": {"value": when}}}]}


def api_response(host, p):
    a, q = p.get("action"), p
    if a == "query":
        if q.get("list") == "categorymembers":
            return {"query": {"categorymembers": [{"title": "File:Fish A.jpg"}, {"title": "File:Fish B.jpg"}]}}
        if q.get("list") == "prefixsearch":
            return {"query": {"prefixsearch": [{"title": "Category:Test cat"}]}}
        if q.get("list") == "allcategories":
            return {"query": {"allcategories": [{"*": "Test cat"}]}}
        if q.get("prop") == "revisions":
            return {"query": {"pages": [{"pageid": 101, "revisions": [{"slots": {"main": {"content": WIKITEXT}}}]}]}}
        if q.get("prop") == "templates":
            return {"query": {"pages": [{"pageid": 101, "title": "File:Fish A.jpg"}, {"pageid": 102, "title": "File:Fish B.jpg"}]}}
        if "imageinfo" in (q.get("prop") or ""):
            return {"query": {"pages": {"101": imageinfo(101, "File:Fish A.jpg", "2026-10-02 02:59:00"),
                                        "102": imageinfo(102, "File:Fish B.jpg", "2026-10-02 02:59:20")}}}
        if q.get("titles", "").startswith("Category:"):
            return {"query": {"pages": {"7": {"pageid": 7, "title": q["titles"].split("|")[0]}}}}
        return {"query": {"pages": {}}}
    if a == "opensearch":
        return ["x", ["Category:Test cat"], [], []]
    if a == "wbgetentities":
        if q.get("ids", "").startswith("M"):
            return {"entities": {
                "M101": {"labels": {"en": {"language": "en", "value": "A fish"}},
                         "statements": {"P180": [{"id": "M101$a", "mainsnak": {"snaktype": "value", "datavalue": {"value": {"entity-type": "item", "id": "Q123"}}}}]}},
                "M102": {}}}
        return {"entities": {"Q123": {"id": "Q123", "labels": {"en": {"language": "en", "value": "Barilius bakeri"}},
                                      "descriptions": {"en": {"language": "en", "value": "species of fish"}}, "claims": {}}}}
    if a == "wbsearchentities":
        return {"search": [{"id": "Q123", "label": "Barilius bakeri", "description": "species of fish"}]}
    return {}


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close(); return port


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    port = free_port()
    base = "http://127.0.0.1:%d" % port
    wiki = FakeWiki()
    import requests
    mp = pytest.MonkeyPatch()
    mp.setattr(requests, "post", wiki.post)
    mp.setattr(requests, "get", wiki.get)
    app = create_app({"DATA_DIR": str(tmp_path_factory.mktemp("data")), "SECRET_KEY": "k", "DEV": True, "BASE_URL": base,
                      "OAUTH_CLIENT_ID": "cid", "OAUTH_CLIENT_SECRET": "s"})
    server = make_server("127.0.0.1", port, app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as exc:  # pragma: no cover
            pytest.skip("Chromium is not available: %s" % exc)
        yield {"base": base, "app": app, "wiki": wiki, "browser": browser}
        browser.close()
    server.shutdown()
    mp.undo()


def new_page(stack, logged_in):
    ctx = stack["browser"].new_context(viewport={"width": 1400, "height": 900})
    problems = []

    def handle(route):
        url = urlparse(route.request.url)
        cors = {"access-control-allow-origin": "*"}
        if url.hostname in ("commons.wikimedia.org", "www.wikidata.org") and url.path == "/w/api.php":
            params = {k: v[0] for k, v in parse_qs(url.query).items()}
            if route.request.method == "POST" and route.request.post_data:
                params.update({k: v[0] for k, v in parse_qs(route.request.post_data).items()})
            return route.fulfill(status=200, headers=cors, content_type="application/json", body=json.dumps(api_response(url.hostname, params)))
        if url.hostname.endswith("wikimedia.org"):
            return route.fulfill(status=200, headers=cors, content_type="image/png", body=PNG)
        return route.fulfill(status=204)

    ctx.route(lambda u: urlparse(u).hostname not in ("127.0.0.1", "localhost"), handle)
    if logged_in:
        sid = stack["app"].extensions["dw_store"].create({
            "user": {"username": "Test User", "groups": ["*", "user", "autoconfirmed"], "rights": []},
            "tokens": {"access": "AT", "refresh": "RT", "expires_at": int(time.time()) + 9999}})
        ctx.add_cookies([{"name": "dw_sid", "value": sid, "url": stack["base"]}])
    page = ctx.new_page()
    page.on("pageerror", lambda e: problems.append("pageerror: %s" % e))
    page.on("console", lambda m: problems.append("console: " + m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    return ctx, page, problems


def load_category(page):
    page.fill("input[placeholder^='Category name']", "Fishes of Kerala")
    page.get_by_role("button", name="Load category").click()
    page.wait_for_selector(".jv-card")


def test_tool_loads_grid_and_stages_a_category_without_login(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    page.wait_for_selector("#jv-root")
    assert page.is_visible("#dw-loginbar")            # not logged in: banner explains
    assert page.locator(".dw-brand").inner_text().replace("\n", " ") == "Commons Data Weaver"
    load_category(page)
    assert page.locator(".jv-card").count() == 2
    page.wait_for_selector(".jv-card .jv-badges span:has-text('◈ 1')")   # depicts read from structured data
    page.locator(".jv-card").first.click()
    assert "sel" in page.locator(".jv-card").first.get_attribute("class")
    # batch: add a category to the selected file (category search uses three Commons queries)
    page.fill("input[placeholder='Search Commons category…']", "Test")
    page.locator(".jv-sug-i", has_text="Test cat").first.click()
    page.get_by_role("button", name="Add to selected").nth(1).click()
    page.wait_for_selector(".jv-card.dirty")
    # saving needs a login: the dialog appears and the staged edit is kept
    page.get_by_role("button", name="Save selected").first.click()   # "Save all changes" asks to confirm first; this saves directly
    page.wait_for_selector("#dw-login-modal")
    assert page.locator(".jv-card.dirty").count() == 1
    assert not problems, problems
    ctx.close()


def test_logged_in_save_goes_through_the_proxy_with_tags(stack):
    wiki = stack["wiki"]
    wiki.calls.clear()
    ctx, page, problems = new_page(stack, logged_in=True)
    page.goto(stack["base"] + "/?category=Fishes_of_Kerala")
    page.wait_for_selector(".jv-card")               # ?category= loads by itself
    assert not page.is_visible("#dw-loginbar") and page.locator(".dw-uname").inner_text() == "Test User"
    page.locator(".jv-card").first.click()
    page.fill("input[placeholder='Search Commons category…']", "Test")
    page.locator(".jv-sug-i", has_text="Test cat").first.click()
    page.get_by_role("button", name="Add to selected").nth(1).click()
    page.get_by_role("button", name="Save selected").first.click()
    page.wait_for_selector(".jv-card .jv-badges span:has-text('saved')", timeout=15000)
    edits = [c for c in wiki.calls if c[0] == "POST" and c[1].endswith("api.php")]
    assert len(edits) == 1
    data, headers = edits[0][2], edits[0][3]
    assert headers["Authorization"] == "Bearer AT" and data["pageid"] == "101"
    assert "[[Category:Test cat]]" in data["text"] and "[[Category:Fishes of Kerala]]" in data["text"]
    assert data["summary"].endswith("via #DataWeaver") and "#DataWeaver" in data["summary"] and data["nocreate"] == "1"
    assert not problems, problems
    ctx.close()


def test_settings_gear_switches_language_and_typing_works(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    page.wait_for_selector("#jv-root")
    assert page.locator(".dw-links a").first.inner_text() == "Tool"
    page.click("#dw-gear")
    page.select_option("#dw-set-lang", "ml")
    expect(page.locator(".dw-links a").first).to_have_text("ഉപകരണം")
    assert page.evaluate("document.documentElement.lang") == "ml"
    # the tool's own labels use the @app source-text dictionary
    expect(page.get_by_role("button", name="വർഗ്ഗം ലോഡ് ചെയ്യുക")).to_be_visible()
    # typing tools: Malayalam transliteration (the page's strict CSP stays on: no eval-based waits here)
    page.check("#dw-set-ime")
    page.wait_for_selector("#dw-set-ime-lang option[value=ml]", state="attached", timeout=15000)
    page.select_option("#dw-set-ime-lang", "ml")
    page.select_option("#dw-set-ime-method", "ml-transliteration")
    page.fill(".dw-try", "")
    page.click(".dw-try")
    page.wait_for_timeout(800)
    page.keyboard.type("amma", delay=60)
    assert page.input_value(".dw-try") == "അമ്മ"
    stored = json.loads(page.evaluate("localStorage.getItem('dataweaver-settings')"))
    assert stored["lang"] == "ml" and stored["ime"]["enabled"] and stored["ime"]["method"] == "ml-transliteration"
    assert not problems, problems
    ctx.close()


@pytest.mark.parametrize("path", ["/about", "/features", "/technology", "/story", "/community", "/credits", "/howto", "/privacy"])
def test_documentation_pages_render_cleanly(stack, path):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + path)
    assert page.locator("h1").first.inner_text()
    page.click("#dw-gear")
    assert page.is_visible("#dw-settings-modal")
    assert not problems, problems
    ctx.close()
