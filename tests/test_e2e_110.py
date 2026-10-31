"""End-to-end tests for the 1.1.0 features (headless Chromium, canned Wikimedia API responses)."""
import json
import re
import time

import pytest

pytest.importorskip("playwright")
from playwright.sync_api import expect  # noqa: E402

import tests.test_e2e as e2e  # noqa: E402
from tests.test_e2e import load_category, new_page, stack  # noqa: E402,F401

ORIG = e2e.api_response
CONFIG = {"projects": [{"name": "Folkland", "helpCategory": "Folkland files needing help"}, {"name": "Heritage", "helpCategory": ""}]}


def with_config(ctx):
    ctx.route(re.compile(r".*/static/config/projects\.json$"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(CONFIG)))


def gps(lat_b=10.52, lon_b=76.21):
    def wrapped(host, p):
        d = ORIG(host, p)
        pages = (d.get("query") or {}).get("pages")
        if isinstance(pages, dict) and "imageinfo" in (p.get("prop") or ""):
            for k, pg in pages.items():
                em = pg["imageinfo"][0]["extmetadata"]
                em["GPSLatitude"] = {"value": "10.5" if k == "101" else str(lat_b)}
                em["GPSLongitude"] = {"value": "76.2" if k == "101" else str(lon_b)}
        return d
    return wrapped


def open_single(page, n=0):
    page.locator(".jv-card").nth(n).locator(".jv-open").click()
    page.wait_for_selector(".jv-single .jv-sv-head")


def test_star_filter_selection_invert_and_hotkeys_in_grid(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    page.locator(".jv-card").first.locator(".jv-star").click()
    star = page.locator(".jv-tools select").filter(has_text="Only not starred")
    star.select_option("not")
    assert page.locator(".jv-card").count() == 1 and "Fish B" in page.locator(".jv-card .jv-cap").inner_text()
    star.select_option("only")
    assert page.locator(".jv-card").count() == 1 and "Fish A" in page.locator(".jv-card .jv-cap").inner_text()
    star.select_option("off")
    assert page.locator(".jv-card").count() == 2
    # selection: invert (button and I key)
    page.locator(".jv-card").first.click()
    page.get_by_role("button", name="Invert").click()
    assert "sel" not in page.locator(".jv-card").first.get_attribute("class") and "sel" in page.locator(".jv-card").nth(1).get_attribute("class")
    page.keyboard.press("i")
    assert "sel" in page.locator(".jv-card").first.get_attribute("class") and "sel" not in page.locator(".jv-card").nth(1).get_attribute("class")
    # Space stars the selected file, B toggles the batch panel
    page.keyboard.press("Space")                       # file A was starred above: Space un-stars it
    assert "starred" not in page.locator(".jv-card").first.get_attribute("class")
    page.keyboard.press("Space")
    assert "starred" in page.locator(".jv-card").first.get_attribute("class")
    assert not page.is_visible(".jv-warnnote")
    page.keyboard.press("b")
    expect(page.locator(".jv-warnnote")).to_be_visible()
    assert not problems, problems
    ctx.close()


def test_single_view_fits_one_screen_hotkeys_image_size_and_captions(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    open_single(page)
    side = page.locator(".jv-sv-side")
    assert page.evaluate("(()=>{const e=document.querySelector('.jv-sv-side');return e.scrollHeight<=e.clientHeight+1})()"), "boxes should scroll inside, not the page"
    # categories and file details sit side by side above the add box
    assert page.locator(".jv-catbox .jv-cdl h4").inner_text() == "Categories" and page.locator(".jv-catbox .jv-cdr h4").inner_text() == "File details"
    # image size: default 1280, choice is kept for the next file
    img = page.locator(".jv-annwrap img")
    assert "width=1280" in img.get_attribute("src")
    page.locator(".jv-imgbar select").select_option("960")
    assert "width=960" in page.locator(".jv-annwrap img").get_attribute("src")
    assert page.locator(".jv-imgbar a", has_text="New tab").get_attribute("href") == page.locator(".jv-annwrap img").get_attribute("src")
    page.keyboard.press("ArrowRight")
    expect(page.locator(".jv-fname")).to_have_text("Fish B.jpg")
    assert "width=960" in page.locator(".jv-annwrap img").get_attribute("src")
    # Space stars, the next arrow after Save & next steps back/forward
    page.keyboard.press("Space")
    expect(page.locator(".jv-starb.on")).to_have_count(1)
    page.keyboard.press("ArrowLeft")
    expect(page.locator(".jv-fname")).to_have_text("Fish A.jpg")
    page.locator(".jv-nextb").click()
    expect(page.locator(".jv-fname")).to_have_text("Fish B.jpg")
    # no project: no Help button; Personality rights keeps its two-line label
    assert page.locator(".jv-helpb").count() == 0
    assert "Personality" in page.locator(".jv-prb .jv-twol").inner_text() and "rights" in page.locator(".jv-prb .jv-twol").inner_text()
    page.keyboard.press("Escape")
    # interface language from the gear comes first in the captions, English is still shown
    page.click("#dw-gear")
    page.select_option("#dw-set-lang", "ml")
    page.click("#dw-settings-modal .dw-btn-primary")
    open_single(page)
    expect(page.locator(".jv-sub")).to_contain_text("No caption (ml)")
    expect(page.locator(".jv-sub")).to_contain_text("Caption (en): A fish")
    assert page.locator("input[placeholder='Caption in ml']").count() == 1
    assert not problems, problems
    ctx.close()


def test_help_flag_uses_the_project_category_and_summary(stack):
    wiki = stack["wiki"]; wiki.calls.clear()
    ctx, page, problems = new_page(stack, logged_in=True)
    with_config(ctx)
    page.goto(stack["base"] + "/")
    load_category(page)
    assert not page.locator(".jv-card").first.locator(".jv-help").is_visible()          # default view: no help button
    page.select_option(".jv-projsel", "Folkland")
    assert page.locator(".jv-card").first.locator(".jv-help").count() == 1
    open_single(page)
    page.keyboard.press("h")
    expect(page.locator(".jv-helpb.on")).to_have_count(1)
    assert "Folkland files needing help" in page.locator(".jv-cdl .jv-chips").inner_text()
    page.locator(".jv-sv-head button", has_text="Save").first.click()
    page.wait_for_selector(".jv-sv-head >> text=\"Saved\"", timeout=15000)   # exact: "1 unsaved" also contains "saved"
    edits = [c for c in wiki.calls if c[0] == "POST" and c[1].endswith("api.php")]
    assert len(edits) == 1
    data = edits[0][2]
    assert "[[Category:Folkland files needing help]]" in data["text"]
    assert "Flagged as needing help (project Folkland)" in data["summary"] and data["summary"].endswith("via #DataWeaver #Folkland")
    # a project without a help category: the button stays but explains itself
    page.keyboard.press("Escape")
    page.select_option(".jv-projsel", "Heritage")
    open_single(page, 1)
    assert "No help category" in page.locator(".jv-helpb").get_attribute("title")
    assert not problems, problems
    ctx.close()


def test_depicts_summary_has_no_duplicate_statement_text(stack):
    wiki = stack["wiki"]; wiki.calls.clear()
    ctx, page, problems = new_page(stack, logged_in=True)
    page.goto(stack["base"] + "/")
    load_category(page)
    page.locator(".jv-card").nth(1).click()
    page.click(".jv-toggle")
    page.fill("input[placeholder='Search Wikidata item…']", "Bar")
    page.locator(".jv-sug-i").first.click()
    page.get_by_role("button", name="Add to selected").first.click()
    page.get_by_role("button", name="Save selected").first.click()
    page.wait_for_selector(".jv-card .jv-badges span:has-text('saved')", timeout=15000)
    edits = [c for c in wiki.calls if c[0] == "POST" and c[1].endswith("api.php")]
    assert len(edits) == 1 and edits[0][2]["action"] == "wbeditentity"
    assert edits[0][2]["summary"] == "Metadata updated with Commons Data Weaver via #DataWeaver"
    assert not problems, problems
    ctx.close()


def test_download_file_names_use_category_and_time(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    dl = page.locator(".jv-tools select[title='Download the file data']")
    with page.expect_download() as d:
        dl.select_option("csv:all")
    assert re.fullmatch(r"dataweaver-Fishes_of_Kerala-\d{8}-\d{6}\.csv", d.value.suggested_filename), d.value.suggested_filename
    with page.expect_download() as d:
        dl.select_option("json:selected") if False else dl.select_option("json:all")
    assert re.fullmatch(r"dataweaver-Fishes_of_Kerala-\d{8}-\d{6}\.json", d.value.suggested_filename)
    assert not problems, problems
    ctx.close()


def test_statistics_page_opens_from_url_and_charts_download(stack, monkeypatch):
    monkeypatch.setattr(e2e, "api_response", gps())
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/?stats&category=Fishes_of_Kerala")
    expect(page.locator(".dws.open")).to_be_visible(timeout=15000)
    tiles = page.locator(".dws-tile")
    assert tiles.count() == 6
    text = page.locator(".dws-tiles").inner_text()
    assert "Contributors" in text and "Geotagged" in text and "Depicts added" in text and "Average file size" in text
    assert page.locator(".dws-card").count() == 13                     # 11 charts + map + user table
    # units follow the data: two hours apart -> hours, a few weeks -> days, years -> months/years
    t0 = 1_760_000_000_000
    units = page.evaluate("([a,b,c])=>[DW.stats._activity(a,0,80).unit,DW.stats._activity(b,0,80).unit,DW.stats._activity(c,0,80).unit]",
                          [[t0, t0 + 7_200_000], [t0, t0 + 40 * 86_400_000], [t0, t0 + 3 * 365 * 86_400_000]])
    assert units == ["hour", "day", "month"]
    # map: two separate pins; clustering can be switched off; a pin opens the photo
    expect(page.locator(".dws-pin")).to_have_count(2)
    page.locator(".dws-pin").first.click()
    expect(page.locator(".dws-pop")).to_contain_text("Fish")
    page.uncheck("#dws-clus")
    expect(page.locator(".dws-pin")).to_have_count(2)
    # chart downloads carry the title and details
    with page.expect_download() as d:
        page.locator(".dws-card").first.get_by_role("button", name="PNG").click()
    name = d.value.suggested_filename
    assert re.fullmatch(r"dataweaver-Fishes_of_Kerala-stats-upload-activity-area-\d{8}-\d{6}\.png", name), name
    assert open(d.value.path(), "rb").read(8) == b"\x89PNG\r\n\x1a\n"
    with page.expect_download() as d:
        page.locator(".dws-card").first.get_by_role("button", name="SVG").click()
    svg = open(d.value.path(), encoding="utf-8").read()
    assert "Upload activity" in svg and "Category: Fishes of Kerala" in svg and "2 files" in svg
    with page.expect_download() as d:
        page.locator(".dws-card").nth(1).get_by_role("button", name="CSV").click()
    assert open(d.value.path(), encoding="utf-8-sig").read().startswith('"contributor","files"')
    page.locator(".dws-card").nth(1).get_by_role("button", name="Table").click()
    expect(page.locator(".dws-card").nth(1).locator(".dws-table")).to_be_visible()
    # Esc closes it and restores the address
    page.keyboard.press("Escape")
    expect(page.locator(".dws.open")).to_have_count(0)
    assert page.evaluate("location.search") == "?category=Fishes_of_Kerala"
    assert not problems, problems
    ctx.close()


def test_statistics_map_clusters_photos_at_the_same_spot(stack, monkeypatch):
    monkeypatch.setattr(e2e, "api_response", gps(10.5, 76.2))
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    page.get_by_role("button", name="▤ Statistics").click()
    expect(page.locator(".dws-cl")).to_have_count(1)
    assert page.locator(".dws-cl").inner_text() == "2"
    page.locator(".dws-cl").click()
    expect(page.locator(".dws-pop")).to_contain_text("2 photos at this spot")
    page.uncheck("#dws-clus")
    expect(page.locator(".dws-cl")).to_have_count(0)
    page.get_by_role("button", name="✕ Close").click()
    expect(page.locator(".dws.open")).to_have_count(0)
    assert not problems, problems
    ctx.close()


def test_statistics_chart_types_switch_and_are_remembered(stack, monkeypatch):
    monkeypatch.setattr(e2e, "api_response", gps())
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/?stats&category=Fishes_of_Kerala")
    expect(page.locator(".dws.open")).to_be_visible(timeout=15000)
    card = page.locator(".dws-card").filter(has=page.locator("h3", has_text="Top contributors"))
    assert card.locator("svg .dws-bar").count() >= 1
    card.locator("select.dws-type").select_option("donut")
    assert card.locator("svg .dws-slice").count() >= 2 and card.locator("svg .dws-bar").count() == 0
    page.locator(".dws-card").filter(has=page.locator("h3", has_text="Upload hours")).locator("select.dws-type").select_option("radial")
    assert page.locator(".dws-card").filter(has=page.locator("h3", has_text="Upload hours")).locator("svg path.dws-bar").count() >= 1
    for t in ("Uploads by weekday", "File formats", "Data coverage", "Upload rhythm"):
        assert page.locator(".dws-card").filter(has=page.locator("h3", has_text=t)).count() == 1
    with page.expect_download() as d:
        card.get_by_role("button", name="CSV").click()
    assert open(d.value.path(), encoding="utf-8-sig").read().startswith('"contributor","files","share %"')
    # the choice is remembered when the page is opened again
    page.reload()
    expect(page.locator(".dws.open")).to_be_visible(timeout=15000)
    assert page.locator(".dws-card").filter(has=page.locator("h3", has_text="Top contributors")).locator("select.dws-type").input_value() == "donut"
    assert not problems, problems
    ctx.close()


def test_default_projects_have_maintenance_categories_and_wiki_village_hashtag(stack):
    ctx, page, problems = new_page(stack, logged_in=False)           # the real static/config/projects.json
    page.goto(stack["base"] + "/")
    opts = page.locator(".jv-projsel option").all_inner_texts()
    assert opts == ["Project", "Bioregister", "Folkland", "Heritage", "Wiki Village"], opts
    cfg = page.evaluate("fetch('/static/config/projects.json').then(r=>r.json())")["projects"]
    assert {p["name"]: p["helpCategory"] for p in cfg} == {"Bioregister": "Bioregister (Maintenance)", "Folkland": "Folkland (Maintenance)",
                                                          "Heritage": "Heritage (Maintenance)", "Wiki Village": "Wiki Village (Maintenance)"}
    page.select_option(".jv-projsel", "Wiki Village")
    expect(page.locator(".jv-status, #jv-status").first).to_contain_text("#DataWeaver #WikiVillage")
    assert not problems, problems
    ctx.close()


def test_image_note_suggests_depicts_already_on_the_file(stack):
    ctx, page, problems = new_page(stack, logged_in=True)
    page.goto(stack["base"] + "/")
    load_category(page)
    open_single(page)
    expect(page.get_by_role("button", name="✎ Draw a note")).to_be_enabled(timeout=10000)
    page.get_by_role("button", name="✎ Draw a note").click()
    img = page.locator(".jv-annwrap img").first
    page.evaluate("(()=>{const i=document.querySelector('.jv-annwrap img');i.style.width='400px';i.style.height='300px';})()")   # the canned image is 1x1 px
    box = img.bounding_box()
    page.mouse.move(box["x"] + 20, box["y"] + 20); page.mouse.down(); page.mouse.move(box["x"] + 90, box["y"] + 80); page.mouse.up()
    expect(page.locator(".jv-nrow")).to_have_count(1)
    chips = page.locator(".jv-sugchip")
    n = chips.count()
    ids = page.evaluate("DW.core.effDepicts(DW.core.S.cur)")
    assert n == len(ids)
    if n:
        chips.first.click()
        assert re.search(r"\[\[:d:Q\d+\|[^\]]+\]\]", page.locator(".jv-nrow textarea").input_value())
        assert "used" in page.locator(".jv-sugchip").first.get_attribute("class")
    else:
        expect(page.locator(".jv-sugnone")).to_be_visible()
    assert not problems, problems
    ctx.close()


def test_failed_thumbnail_is_retried_then_shows_a_retry_button(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    calls = {"n": 0}

    def flaky(route):                                   # the first thumbnail: busy twice, then fine
        calls["n"] += 1
        if calls["n"] <= 2:
            return route.fulfill(status=429, body="busy")
        return route.fulfill(status=200, content_type="image/png", body=e2e.PNG)
    ctx.route(re.compile(r"https://upload\.wikimedia\.org/thumb/101\.jpg.*"), flaky)
    page.goto(stack["base"] + "/")
    load_category(page)
    for _ in range(60):                                 # no string-eval under the page's strict CSP: poll with a function
        if page.evaluate("() => document.querySelector('.jv-card img').naturalWidth") > 0:
            break
        page.wait_for_timeout(250)
    assert calls["n"] >= 2 and page.locator(".jv-retry").count() == 0     # busy at first, then a retry worked
    ctx.close()

    ctx, page, problems = new_page(stack, logged_in=False)                # always failing: grey tile and a button
    ctx.route(re.compile(r"https://upload\.wikimedia\.org/thumb/101\.jpg.*"), lambda r: r.fulfill(status=500, body="no"))
    ctx.route(re.compile(r".*/Special:FilePath/.*width=360.*"), lambda r: r.fulfill(status=500, body="no"))
    page.goto(stack["base"] + "/")
    load_category(page)
    expect(page.locator(".jv-retry")).to_have_count(1, timeout=25000)
    assert "jv-nothumb" in page.locator(".jv-card img").first.get_attribute("class")
    ctx.close()
