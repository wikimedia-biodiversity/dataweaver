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
    # the edit panel scrolls inside the view; the file header stays locked at the top and the page itself does not scroll
    page.evaluate("() => { const e = document.querySelector('.jv-sv-side'); e.scrollTop = e.scrollHeight; }")
    assert abs(page.locator(".jv-sv-head").bounding_box()["y"] - page.locator(".jv-single").bounding_box()["y"]) <= 1
    assert page.evaluate("() => document.documentElement.scrollTop") == 0
    # layout: image on the left (larger), edit panel on the right (at most 640px); notes and captions side by side
    ib, sb = page.locator(".jv-sv-img").bounding_box(), page.locator(".jv-sv-side").bounding_box()
    assert ib["x"] < sb["x"] and ib["width"] >= sb["width"] and sb["width"] <= 641
    nb, cb = page.locator(".jv-sv-side > .jv-ann").bounding_box(), page.locator(".jv-sv-side > .jv-capb").bounding_box()
    assert nb["x"] < cb["x"] and abs(nb["y"] - cb["y"]) < 6
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
    ctx.route(re.compile(r"https://thumb\.wikimedia\.org/thumb/101\.jpg.*"), flaky)
    page.goto(stack["base"] + "/")
    load_category(page)
    for _ in range(60):                                 # no string-eval under the page's strict CSP: poll with a function
        if page.evaluate("() => document.querySelector('.jv-card img').naturalWidth") > 0:
            break
        page.wait_for_timeout(250)
    assert calls["n"] >= 2 and page.locator(".jv-retry").count() == 0     # busy at first, then a retry worked
    ctx.close()

    ctx, page, problems = new_page(stack, logged_in=False)                # always failing: grey tile and a button
    ctx.route(re.compile(r"https://thumb\.wikimedia\.org/thumb/101\.jpg.*"), lambda r: r.fulfill(status=500, body="no"))
    ctx.route(re.compile(r".*/Special:FilePath/.*width=360.*"), lambda r: r.fulfill(status=500, body="no"))
    page.goto(stack["base"] + "/")
    load_category(page)
    expect(page.locator(".jv-retry")).to_have_count(1, timeout=25000)
    assert "jv-nothumb" in page.locator(".jv-card img").first.get_attribute("class")
    ctx.close()


def test_camera_filter_keys_beside_gear_one_line_toolbar_credit_line(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.set_viewport_size({"width": 1366, "height": 800})
    page.goto(stack["base"] + "/")
    load_category(page)
    # filter: files without / with camera information (the canned files carry no camera data)
    flt = page.locator(".jv-tools select").filter(has_text="Files without camera information")
    page.evaluate("() => { DW.core.S.recs[0].camera = ''; }")      # one file without camera data
    cams = page.evaluate("() => DW.core.S.recs.map(r => !!r.camera)")
    with_cam, without = sum(cams), len(cams) - sum(cams)
    flt.select_option("cam-missing")
    assert page.locator(".jv-card").count() == without
    flt.select_option("cam-has")
    assert page.locator(".jv-card").count() == with_cam
    flt.select_option("all")
    assert page.locator(".jv-card").count() == len(cams)
    assert "Files without camera information (%d)" % without in flt.inner_text()
    # Keys button sits in the header beside the gear, not in the tool bar
    assert page.locator(".dw-nav .dw-keysbtn").count() == 1 and page.locator(".jv-tools .dw-keysbtn").count() == 0
    kb, gear = page.locator(".dw-keysbtn").bounding_box(), page.locator("#dw-gear").bounding_box()
    assert kb["x"] < gear["x"] and gear["x"] - (kb["x"] + kb["width"]) < 40
    # the tool bar stays on one line, and the Download menu is the last item, inside the window
    tb = page.locator(".jv-tools").bounding_box()
    dl = page.locator(".jv-tools select[title^='Download']").bounding_box()
    assert tb["height"] < 50, tb
    assert dl["x"] + dl["width"] <= 1366 and dl["x"] > page.locator(".jv-tools input[type=search]").bounding_box()["x"]
    # credit line: version and the Phabricator link
    credit = page.locator(".jv-credit")
    assert "v1.2.0" in credit.inner_text()
    assert credit.locator("a", has_text="Phabricator").count() == 0          # no Phabricator link on the tool page itself
    assert credit.locator("a", has_text="DOI").get_attribute("href") == "https://doi.org/10.5281/zenodo.23680558"
    page.goto(stack["base"] + "/about")
    assert "10.5281/zenodo.23680558" in page.content() and "project/board/9174" in page.content()
    assert not problems, problems
    ctx.close()


def test_location_can_be_hidden_and_campaign_category_is_locked(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    page.evaluate("() => { DW.core.S.srcCat = 'Images from Wiki Loves Birds India 2025'; }")
    open_single(page)
    # location: hide / show, remembered
    page.get_by_role("button", name="▾ Hide location").click()
    expect(page.locator(".jv-mapbox")).to_have_count(0)
    page.keyboard.press("Escape")
    open_single(page, 1)
    expect(page.get_by_role("button", name="▸ Show location")).to_be_visible()
    page.get_by_role("button", name="▸ Show location").click()
    expect(page.locator(".jv-mapbox")).to_have_count(1)
    # campaign category: locked chip pinned at the top; unlock to remove
    cats = page.evaluate("() => DW.core.S.cur.cats.map(c => c.n)")
    assert cats
    page.evaluate("() => { DW.core.S.cur.pend.addC.add('Images from Wiki Loves Birds India 2025'); }")
    page.keyboard.press("Escape"); open_single(page, 1)
    lock = page.locator(".jv-pinned .jv-chip.lock")
    expect(lock).to_have_count(1)
    assert lock.locator("button").count() == 1 and "🔒" in lock.inner_text()
    page.evaluate("() => { DW.core.S.cur.pend.addC.add('Uploaded via Campaign:wlo_2026'); }")
    page.keyboard.press("Escape"); open_single(page, 1)
    expect(page.locator(".jv-pinned .jv-chip.lock")).to_have_count(2)       # "Uploaded via Campaign:…" is locked too
    lock = page.locator(".jv-pinned .jv-chip.lock").first
    lock.locator("button").first.click()
    assert page.locator(".jv-pinned .jv-chip.lock button").count() == 4
    assert not problems, problems
    ctx.close()


def test_project_from_list_headings_sets_summary_and_help(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    text = "== Folkland ==\n<gallery>\nFile:Fish A.jpg|x\n</gallery>\n=== Batch 2 ===\nFile:Fish B.jpg\n== Notes ==\nFile:Other.jpg\n== Wiki Village ==\nFile:Village.jpg"
    got = page.evaluate("t => DW.core.parseListProjects(t)", text)
    assert got == {"File:Fish A.jpg": "Folkland", "File:Fish B.jpg": "Folkland", "File:Village.jpg": "Wiki Village"}, got
    # a file's own project drives its hashtag and its help category
    out = page.evaluate("""() => { const r = DW.core.S.recs[0]; r.proj = 'Wiki Village'; return [DW.core.sumTail(r), DW.core.helpCat(r)]; }""")
    assert out[0].endswith("#DataWeaver #WikiVillage"), out
    assert not problems, problems
    ctx.close()


def test_thumbnails_from_thumb_wikimedia_org_are_allowed_by_the_security_policy_and_load(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    src = page.locator(".jv-card img").first.get_attribute("src")
    assert src.startswith("https://thumb.wikimedia.org/"), src
    for _ in range(40):                                                   # the strict CSP must not block the thumbnail host
        if page.evaluate("() => document.querySelector('.jv-card img').naturalWidth") > 0:
            break
        page.wait_for_timeout(250)
    assert page.evaluate("() => document.querySelector('.jv-card img').naturalWidth") > 0
    assert page.locator(".jv-retry").count() == 0
    # it loaded from the thumbnail host itself, not through the retry fallback
    assert page.locator(".jv-card img").first.get_attribute("src").startswith("https://thumb.wikimedia.org/")
    ctx.close()


def test_sort_by_file_format_unselect_all_and_s_key(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    opts = page.evaluate("() => [...document.querySelectorAll('.jv-tools select option')].map(o => o.textContent)")
    assert "File format" in opts, opts
    page.locator(".jv-tools select").filter(has_text="File format").select_option("format")
    assert page.locator(".jv-card").count() == 2
    page.locator(".jv-card").first.click()
    page.keyboard.press("s")                                   # S stars like Space
    assert "starred" in page.locator(".jv-card").first.get_attribute("class")
    page.keyboard.press("b")
    assert page.get_by_role("button", name="Select starred").count() == 0
    page.get_by_role("button", name="Unselect all").click()
    assert page.evaluate("() => DW.core.S.sel.size") == 0
    assert not problems, problems
    ctx.close()


def test_one_by_one_strip_stays_visible_with_red_new_and_suggested_categories(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    open_single(page)
    page.evaluate("() => { const r = DW.core.S.cur; r.pend.addC.add('Brand new cat'); r._sugg = [{ n: 'Panthera leo', exists: true }, { n: 'Nope', exists: false }]; r._detSig = null; }")
    page.evaluate("() => { const r = DW.core.S.cur; r._detSig = 'x'; }")
    page.keyboard.press("Escape"); open_single(page)
    page.evaluate("() => { const r = DW.core.S.cur; r.pend.addC.add('Brand new cat'); r._sugg = [{ n: 'Panthera leo', exists: true }]; }")
    page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowLeft")
    page.evaluate("() => { const r = DW.core.S.cur; r._detSig = null; }")
    bar = page.locator(".jv-stickybar")
    expect(bar).to_be_visible()
    for name in ["Categories", "File details", "Image notes", "Captions", "Location"]:
        expect(bar.get_by_role("button", name=name)).to_be_visible()
    side = page.locator(".jv-sv-side")
    side.evaluate("e => { e.scrollTop = e.scrollHeight; }")
    top_side = side.evaluate("e => e.getBoundingClientRect().top")
    top_bar = bar.evaluate("e => e.getBoundingClientRect().top")
    assert abs(top_bar - top_side) < 14, (top_bar, top_side)   # still pinned after scrolling to the bottom
    color = page.locator(".jv-redsug").first.evaluate("e => getComputedStyle(e).color")
    assert color.startswith("rgb(164, 22, 26)"), color
    bar.get_by_role("button", name="Captions").click()
    assert not problems, problems
    ctx.close()


def test_group_by_author_has_creator_tool_and_no_link_all(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    page.locator(".jv-tools select").filter(has_text="Grouped by Author").select_option("author")
    assert page.locator(".jv-gcard").count() == 1                # both files are by Anna
    page.locator(".jv-gcard .jv-open").click()
    expect(page.get_by_role("button", name="Author → Creator template")).to_be_visible()
    assert page.get_by_role("button", name="Link all as Other versions").count() == 0
    # wikitext helpers
    t = "{{Information\n|description=x\n|author=[[User:Manojk|Manojk]]\n|photographer = [[User:Manojk|Manojk]]\n|permission=\n}}"
    got = page.evaluate("t => [DW.core.authVals(t), DW.core.replaceAuthor(t, '[[User:Manojk|Manojk]]', '{{Creator:Manoj Karingamadathil}}')]", t)
    assert [v["name"] for v in got[0]] == ["author", "photographer"]
    assert "|author={{Creator:Manoj Karingamadathil}}\n" in got[1] and "|photographer = {{Creator:Manoj Karingamadathil}}\n" in got[1], got[1]
    assert "[[User:" not in got[1] and "|description=x" in got[1]
    # the tool refuses when the authors differ
    page.evaluate("""() => { const g = Object.values(DW.core.S.groups)[0]; g.members.forEach((r, i) => { r._t = i; }); }""")
    page.get_by_role("button", name="Author → Creator template").click()
    expect(page.locator(".jv-modal").last).to_contain_text("Current author in all 2 file(s)")
    expect(page.locator(".jv-modal").last.get_by_text("I understand")).to_be_visible()
    assert page.locator(".jv-modal").last.get_by_role("button", name="Replace in 2 file(s)").is_disabled()
    assert not problems, problems
    ctx.close()


def test_depicts_overview_modes_downloads_and_language(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    page.evaluate("""() => { const S = DW.core.S; DW.core.WD.Q1 = { label: 'Lion', desc: '' }; DW.core.WD.Q2 = { label: 'Tiger', desc: '' };
      S.recs[0].dep = ['Q1', 'Q2']; S.recs[1].dep = ['Q1']; S.recs.forEach(r => { r.pend.addD.add('Q1'); }); }""")
    page.get_by_role("button", name="Depicts overview").click()
    modal = page.locator(".jv-modal").last
    expect(modal.locator("svg.jv-wa")).to_be_visible()
    expect(modal.get_by_text("Depicts language")).to_be_visible()
    assert modal.locator("input.jv-langin").first.input_value() == "en"
    for mode, sel in [("bubbles", "circle"), ("bars", "rect"), ("cloud", "text")]:
        modal.locator(".jv-wacfg select").first.select_option(mode)
        assert modal.locator("svg.jv-wa " + sel).count() >= 1, mode
    opts = modal.locator("select.jv-dlsel option").all_inner_texts()
    for want in ["CSV", "SVG", "PNG", "All formats"]:
        assert any(want in o for o in opts), (want, opts)
    assert modal.locator("input.jv-langin").count() == 1          # one language, English by default
    more = modal.locator(".jv-wamore")                              # the simple overview points to the full tool
    expect(more).to_contain_text("WikiWordCloud")
    expect(more).not_to_contain_text("Vaakkuttam")
    href = more.locator("a").first.get_attribute("href")
    assert href.startswith("https://wordcloud.toolforge.org/"), href
    assert modal.locator(".jv-wacfg select").count() == 3 and modal.locator(".jv-wacfg input[type=range]").count() == 1   # style, colours, background, items: nothing more
    page.evaluate("() => { DW.core.S.srcCat = 'Category:Birds of Kerala'; }")
    modal.get_by_role("button", name="Close").click()
    page.get_by_role("button", name="Depicts overview").click()
    href = page.locator(".jv-modal").last.locator(".jv-wamore a").first.get_attribute("href")
    assert href == "https://wordcloud.toolforge.org/studio?src=" + "https%3A%2F%2Fcommons.wikimedia.org%2Fwiki%2FCategory%3ABirds_of_Kerala", href
    modal = page.locator(".jv-modal").last
    svg = page.evaluate("() => DW.core.svgText(document.querySelector('svg.jv-wa'))")
    assert svg.startswith("<?xml") and "xmlns=" in svg
    assert not problems, problems
    ctx.close()


def test_clear_options_sort_uploader_new_groups_time_words_and_calendar(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    page.on("dialog", lambda d: d.accept())
    # --- terminology and sort
    opts = page.locator(".jv-tools select").filter(has_text="Photographed time").first.locator("option").all_inner_texts()
    assert "Photographed time" in opts and "Uploaded time" in opts and "Uploader" in opts and not any("Observation" in o for o in opts), opts
    # --- series groupings
    grp = page.locator(".jv-tools select").filter(has_text="Grouped by Author")
    gopts = grp.locator("option").all_inner_texts()
    for want in ("Grouped by Date (photographed)", "Grouped by Uploaded date", "Grouped by Licence", "Grouped by Uploader"):
        assert want in gopts, gopts
    page.evaluate("() => { DW.core.S.recs.forEach(r => { r.license = 'CC BY-SA 4.0'; r.uploader = 'Anna'; r.dateObs = '2025:03:04 10:00:00'; }); }")
    for v in ("license", "uploader", "date"):
        grp.select_option(v)
        assert page.locator(".jv-gcard").count() == 1, v
    # --- batch Clear (pending edits only; nothing is saved)
    grp.select_option("none")
    page.keyboard.press("b")
    page.evaluate("() => { const S = DW.core.S; S.recs.forEach(r => { r.depicts = [{ id: 'Q1', claim: 'c1' }]; r.cats = [{ n: 'Birds', hidden: false }]; r.lat = 10; r.lon = 76; S.sel.add(r.id); }); }")
    page.get_by_role("button", name="Clear depicts").click()
    page.get_by_role("button", name="Clear categories").click()
    page.get_by_role("button", name="Clear location").click()
    st = page.evaluate("() => DW.core.S.recs.map(r => [[...r.pend.remD], [...r.pend.remC], !!(r.pend.loc && r.pend.loc.clear)])")
    assert all(x[0] == ["Q1"] and x[1] == ["Birds"] and x[2] for x in st), st
    t = page.evaluate("() => DW.core.editText('a\\n{{Location|1|2}}\\n[[Category:Birds]]\\n', DW.core.S.recs[0].pend, DW.core.S.recs[0])")
    assert "Location" not in t and "Category:Birds" not in t, t
    page.evaluate("() => DW.core.S.recs.forEach(r => { r.pend = { addC: new Set(), remC: new Set(), addD: new Set(), remD: new Set(), loc: null }; })")
    expect(page.get_by_role("button", name="Clear all (depicts, categories, location)")).to_be_visible()
    # --- calendar
    page.get_by_role("button", name="Calendar").click()
    modal = page.locator(".jv-modal").last
    day = modal.locator("button.d[title^='2025-03-04']")
    assert "2 photo" in day.get_attribute("title") and "c0" not in day.get_attribute("class")
    day.click(); modal.locator("button.d[title^='2025-03-05']").click()
    expect(modal.locator(".jv-calinfo")).to_contain_text("2 photos")
    modal.get_by_role("button", name="Show only this range").click()
    assert page.evaluate("() => DW.core.S.fDate.from") == "2025-03-04"
    assert page.locator(".jv-card").count() == 2
    page.get_by_role("button", name="Calendar").click()
    page.locator(".jv-modal").last.get_by_role("button", name="Show all dates").click()
    assert page.evaluate("() => DW.core.S.fDate") is None
    assert not problems, problems
    ctx.close()


def _shp_bytes(ring):
    import struct
    pts = ring
    content = struct.pack("<i4d2i", 5, min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts), 1, len(pts)) + struct.pack("<i", 0) + b"".join(struct.pack("<2d", *p) for p in pts)
    rec = struct.pack(">2i", 1, len(content) // 2) + content
    head = struct.pack(">i5ii", 9994, 0, 0, 0, 0, 0, (100 + len(rec)) // 2) + struct.pack("<2i", 1000, 5) + struct.pack("<8d", 0, 0, 0, 0, 0, 0, 0, 0)
    return head + rec


def test_map_selects_photos_with_shapes_and_imports_shape_files(stack, tmp_path):
    import io, json, zipfile
    ctx, page, problems = new_page(stack, logged_in=False)
    page.on("dialog", lambda d: d.accept())
    page.goto(stack["base"] + "/")
    load_category(page)
    page.evaluate("() => { const R = DW.core.S.recs; R[0].lat = 10.0; R[0].lon = 76.0; R[1].lat = 11.0; R[1].lon = 77.0; }")
    page.get_by_role("button", name="Map").click()
    modal = page.locator(".jv-modal").last
    expect(modal.locator(".jv-calinfo")).to_contain_text("2 photos on the map")
    page.wait_for_function("() => document.querySelectorAll('.jv-gmap .jv-gp').length === 2")
    # click a point selects its photo
    cx, cy = page.evaluate("() => { const c = document.querySelector('.jv-gmap .jv-gp'); return [+c.getAttribute('cx'), +c.getAttribute('cy')]; }")
    box = page.locator(".jv-gmap").bounding_box()
    page.mouse.click(box["x"] + cx, box["y"] + cy)
    assert page.evaluate("() => DW.core.S.sel.size") == 1
    page.get_by_role("button", name="Unselect all").click()
    box = page.locator(".jv-gmap").bounding_box()          # the photo strip moved the dialog
    # rectangle around that point
    modal.get_by_role("button", name="Rectangle").click()
    page.mouse.move(box["x"] + cx - 25, box["y"] + cy - 25); page.mouse.down(); page.mouse.move(box["x"] + cx + 25, box["y"] + cy + 25, steps=4); page.mouse.up()
    expect(modal.locator(".jv-calinfo")).to_contain_text("1 inside 1 shape")
    modal.get_by_role("button", name="Select photos in shapes").click()
    assert page.evaluate("() => DW.core.S.sel.size") == 1
    # circle and free draw add shapes
    modal.get_by_role("button", name="Circle").click()
    box = page.locator(".jv-gmap").bounding_box()
    page.mouse.move(box["x"] + 60, box["y"] + 60); page.mouse.down(); page.mouse.move(box["x"] + 90, box["y"] + 60, steps=3); page.mouse.up()
    modal.get_by_role("button", name="Free draw").click()
    page.mouse.move(box["x"] + 100, box["y"] + 300); page.mouse.down()
    for x, y in [(160, 300), (160, 360), (100, 360)]:
        page.mouse.move(box["x"] + x, box["y"] + y, steps=3)
    page.mouse.up()
    assert page.locator(".jv-gmap .jv-gsh").count() == 3
    modal.get_by_role("button", name="Clear shapes").click()
    assert page.locator(".jv-gmap .jv-gsh").count() == 0
    # imported shape files: GeoJSON, .shp and a zipped .shp all select only the photo at 10, 76
    ring = [(75.5, 9.5), (75.5, 10.5), (76.5, 10.5), (76.5, 9.5), (75.5, 9.5)]       # clockwise outline
    gj = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in ring]]}}]}
    shp = _shp_bytes(ring)
    zb = io.BytesIO()
    with zipfile.ZipFile(zb, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("area.shp", shp)
    for name, mime, data in [("a.geojson", "application/json", json.dumps(gj).encode()), ("a.shp", "application/octet-stream", shp), ("a.zip", "application/zip", zb.getvalue())]:
        modal.locator("input[type=file]").set_input_files(files=[{"name": name, "mimeType": mime, "buffer": data}])
        expect(modal.locator(".jv-calinfo")).to_contain_text("1 inside 1 shape")
        modal.get_by_role("button", name="Clear shapes").click()
    # a file in another projection is refused with a message
    bad = dict(gj); bad["features"] = [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[[500000, 1000000], [500000, 1100000], [600000, 1100000], [500000, 1000000]]]}}]
    modal.locator("input[type=file]").set_input_files(files=[{"name": "b.geojson", "mimeType": "application/json", "buffer": json.dumps(bad).encode()}])
    assert page.locator(".jv-gmap .jv-gsh").count() == 0
    # filter the grid by the imported area
    modal.locator("input[type=file]").set_input_files(files=[{"name": "a.geojson", "mimeType": "application/json", "buffer": json.dumps(gj).encode()}])
    modal.get_by_role("button", name="Show only these").click()
    assert page.locator(".jv-card").count() == 1
    assert not problems, problems
    ctx.close()


def test_custom_hashtag_is_typed_without_hash_or_spaces_and_ends_edit_summaries(stack):
    ctx, page, problems = new_page(stack, logged_in=False)
    page.goto(stack["base"] + "/")
    load_category(page)
    box = page.locator("input.jv-taginput")
    box.click()
    page.keyboard.type("#Theyyam Edit athon")
    assert box.input_value() == "TheyyamEditathon"
    tail = page.evaluate("() => DW.core.sumTail(DW.core.S.recs[0])")
    assert tail.endswith("#DataWeaver #TheyyamEditathon"), tail
    page.reload(); load_category(page)
    assert page.locator("input.jv-taginput").input_value() == "TheyyamEditathon"      # remembered in this browser
    box = page.locator("input.jv-taginput"); box.fill("")
    assert page.evaluate("() => DW.core.sumTail(DW.core.S.recs[0])").endswith("#DataWeaver")
    assert not problems, problems
    ctx.close()
