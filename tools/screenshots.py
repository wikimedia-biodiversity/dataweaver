#!/usr/bin/env python3
"""Regenerate docs/img/*.png using sample data (no real wiki is contacted).

Run from the repository root:  python tools/screenshots.py
"""
import json
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402

from dataweaver import create_app  # noqa: E402
from tests.test_e2e import api_response, free_port, imageinfo  # noqa: E402
from urllib.parse import parse_qs, urlparse  # noqa: E402

COLORS = [("#2a8f6f", "#9fe3c6"), ("#1d6f8a", "#9bd0e8"), ("#8a5a1d", "#f2d29b"), ("#6a3f8a", "#d6b8ec"), ("#8a2a3f", "#f0a8b8"), ("#3f6a8a", "#b3d3ec")]
NAMES = ["Fish A", "Fish B", "Fish C", "Fish D", "Fish E", "Fish F", "Fish G", "Fish H", "Fish I", "Fish J"]


def svg(i):
    a, b = COLORS[i % len(COLORS)]
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="270"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient></defs><rect width="360" height="270" fill="url(#g)"/>'
            '<ellipse cx="170" cy="135" rx="85" ry="38" fill="#ffffff" opacity=".55"/><path d="M250 135 L300 100 L300 170 Z" fill="#ffffff" opacity=".55"/>'
            '<circle cx="118" cy="127" r="6" fill="#17302b"/></svg>') % (a, b)


def files_response(params):
    if params.get("list") == "categorymembers":
        return {"query": {"categorymembers": [{"title": "File:%s.jpg" % n} for n in NAMES]}}
    if "imageinfo" in (params.get("prop") or ""):
        pages = {}
        for i, n in enumerate(NAMES):
            p = imageinfo(200 + i, "File:%s.jpg" % n, "2026-10-02 02:%02d:00" % (50 + i))
            p["imageinfo"][0]["thumburl"] = "https://upload.wikimedia.org/thumb/%d.jpg" % i
            pages[str(200 + i)] = p
        return {"query": {"pages": pages}}
    if params.get("action") == "wbgetentities" and params.get("ids", "").startswith("M"):
        ents = {}
        for i in range(len(NAMES)):
            if i % 3 != 2:
                ents["M%d" % (200 + i)] = {"labels": {"en": {"language": "en", "value": "Barilius bakeri"}},
                    "statements": {"P180": [{"id": "M%d$a" % (200 + i), "mainsnak": {"snaktype": "value", "datavalue": {"value": {"entity-type": "item", "id": "Q123"}}}}]}}
            else:
                ents["M%d" % (200 + i)] = {}
        return {"entities": ents}
    return api_response(None, params)


def main():
    from tools import sample_data as sd
    out = ROOT / "docs" / "img"
    ex = out / "stats-example"
    ex.mkdir(parents=True, exist_ok=True)
    port = free_port()
    base = "http://127.0.0.1:%d" % port
    app = create_app({"DATA_DIR": tempfile.mkdtemp(), "SECRET_KEY": "k", "DEV": True, "BASE_URL": "https://dataweaver.toolforge.org"})
    srv = make_server("127.0.0.1", port, app, threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    sid = app.extensions["dw_store"].create({"user": {"username": "Example user", "groups": ["*", "user", "autoconfirmed"], "rights": []},
                                              "tokens": {"access": "AT", "refresh": "RT", "expires_at": int(time.time()) + 9999}})
    recs = sd.build()

    def handle(route):
        u = urlparse(route.request.url)
        cors = {"access-control-allow-origin": "*"}
        if u.path == "/w/api.php":
            params = {k: v[0] for k, v in parse_qs(u.query).items()}
            if route.request.method == "POST" and route.request.post_data:
                params.update({k: v[0] for k, v in parse_qs(route.request.post_data).items()})
            return route.fulfill(headers=cors, content_type="application/json", body=json.dumps(sd.api(recs, params)))
        if u.path.startswith("/thumb/") or u.path.startswith("/full/"):
            return route.fulfill(headers=cors, content_type="image/svg+xml", body=svg(int(Path(u.path).stem)))
        if "maps.wikimedia.org" in (u.hostname or ""):   # placeholder tile: the real map tiles come from the tile server
            return route.fulfill(headers=cors, content_type="image/svg+xml", body='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8eee3"/><path d="M0 0H256V256" fill="none" stroke="#d6dfd0"/></svg>')
        if u.path.startswith("/wiki/Special:FilePath"):
            return route.fulfill(headers=cors, content_type="image/svg+xml", body=svg(1))
        return route.fulfill(status=204)

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1400, "height": 820}, device_scale_factor=1, accept_downloads=True)
        ctx.route(lambda url: urlparse(url).hostname not in ("127.0.0.1", "localhost"), handle)
        ctx.route("**/static/config/projects.json", lambda r: r.fulfill(content_type="application/json", body=json.dumps(
            {"projects": [{"name": "Bioregister", "helpCategory": "Sample files needing help"}, {"name": "Folkland", "helpCategory": ""}]})))
        ctx.add_cookies([{"name": "dw_sid", "value": sid, "url": base}])
        page = ctx.new_page()
        page.goto(base + "/?category=" + sd.CATEGORY.replace(" ", "_"))
        page.wait_for_selector(".jv-card .jv-badges span:has-text('◈')", timeout=60000)
        page.wait_for_timeout(1500)
        page.select_option(".jv-projsel", "Bioregister")
        for i in (0, 1, 3):
            page.locator(".jv-card").nth(i).click()
        page.click(".jv-toggle")
        page.fill("input[placeholder='Search Commons category…']", "Test")
        page.locator(".jv-sug-i").first.click()
        page.get_by_role("button", name="Add to selected").nth(1).click()
        page.wait_for_timeout(400)
        page.screenshot(path=str(out / "tool-grid.png"))
        page.click(".jv-toggle")
        # one-by-one view
        page.locator(".jv-card").nth(2).locator(".jv-open").click()
        page.wait_for_selector(".jv-single .jv-sv-head")
        page.keyboard.press("Space")
        page.wait_for_timeout(900)
        page.screenshot(path=str(out / "single-view.png"))
        page.keyboard.press("Escape")
        # statistics: sample data, clearly labelled
        page.evaluate("DW.core.S.srcCat = %s" % json.dumps(sd.CATEGORY + " [SAMPLE DATA]"))
        page.set_viewport_size({"width": 1400, "height": 2350})
        page.get_by_role("button", name="▤ Statistics").click()
        page.wait_for_selector(".dws.open .dws-pin, .dws.open .dws-cl", timeout=20000)
        page.wait_for_timeout(1200)
        page.screenshot(path=str(out / "statistics.png"))
        names = {"Upload activity": "upload-activity", "Top contributors (files)": "top-contributors", "Top camera models": "top-camera-models", "Top upload days": "top-upload-days",
                 "Contribution distribution": "contribution-distribution", "File size distribution": "file-size-distribution", "Upload hours distribution": "upload-hours-distribution"}
        for card in page.locator(".dws-card").all():
            title = card.locator("h3").inner_text()
            if title in names:
                with page.expect_download() as d:
                    card.get_by_role("button", name="PNG").click()
                d.value.save_as(str(ex / ("sample-" + names[title] + ".png")))
        # the other chart types, the new analytics cards, and one page with the alternatives selected
        extra = {"Weekday": ("Uploads by weekday", None, "upload-weekdays"), "Formats": ("File formats", None, "file-formats"),
                 "Coverage": ("Data coverage", None, "data-coverage"), "Rhythm": ("Upload rhythm", None, "upload-rhythm")}
        variants = [("Top contributors (files)", "donut", "top-contributors-donut"), ("Top camera models", "pie", "top-camera-models-pie"),
                    ("Upload hours distribution", "radial", "upload-hours-radial"), ("Top upload days", "column", "top-upload-days-columns"),
                    ("Upload activity", "cum", "upload-activity-cumulative"), ("File size distribution", "donut", "file-size-distribution-donut")]
        def grab(title, kind, fname):
            card = page.locator(".dws-card").filter(has=page.locator("h3", has_text=title)).first
            if kind:
                card.locator("select.dws-type").select_option(kind)
                page.wait_for_timeout(250)
            with page.expect_download() as d:
                card.get_by_role("button", name="PNG").click()
            d.value.save_as(str(ex / ("sample-" + fname + ".png")))
        for title, _k, fname in extra.values():
            grab(title, None, fname)
        for title, kind, fname in variants:
            grab(title, kind, fname)
        page.locator(".dws-card").filter(has=page.locator("h3", has_text="Top camera")).first.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        page.screenshot(path=str(out / "statistics-chart-types.png"))
        page.set_viewport_size({"width": 1400, "height": 820})
        page.keyboard.press("Escape")
        page.click("#dw-gear")
        page.select_option("#dw-set-lang", "ml")
        page.wait_for_timeout(500)
        page.check("#dw-set-ime")
        page.wait_for_selector("#dw-set-ime-lang option[value=ml]", state="attached")
        page.select_option("#dw-set-ime-lang", "ml")
        page.select_option("#dw-set-ime-method", "ml-transliteration")
        page.click(".dw-try")
        page.wait_for_timeout(500)
        page.keyboard.type("namaskaaram", delay=40)
        page.wait_for_timeout(300)
        page.screenshot(path=str(out / "settings.png"))
        page.evaluate("localStorage.clear()")
        page.goto(base + "/about")
        page.wait_for_timeout(500)
        page.screenshot(path=str(out / "about.png"))
        b.close()
    srv.shutdown()
    print("Wrote", ", ".join(sorted(x.name for x in out.glob("*.png"))), "+", len(list(ex.glob("*.png"))), "example graphics")


if __name__ == "__main__":
    main()
