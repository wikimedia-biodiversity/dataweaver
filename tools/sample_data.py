"""Deterministic SAMPLE data for screenshots and the example statistics graphics.

Nothing here comes from Wikimedia Commons: contributor names, file names, numbers and coordinates are invented.
The example category name is only used so the graphics show the shape of a real contest category.
"""
import math
import random
from datetime import datetime, timedelta, timezone

CATEGORY = "Images from Wiki Loves Birds India 2025 (Behavior and action)"
CAMERAS = [("Canon", "EOS 90D", 22), ("Nikon", "D7500", 17), ("Sony", "ILCE-7M3", 13), ("Canon", "EOS 7D Mark II", 11), ("Nikon", "COOLPIX P1000", 9),
           ("Sony", "ILCE-6400", 8), ("Canon", "EOS R6", 6), ("Nikon", "Z 6II", 5), ("OnePlus", "KB2001", 4), ("samsung", "SM-S908B", 3), ("Panasonic", "DC-FZ1000M2", 2)]
HOTSPOTS = [(10.13, 76.69), (27.16, 77.52), (12.42, 76.65), (21.95, 88.90), (22.80, 72.00), (29.53, 78.77), (19.70, 85.30), (26.58, 93.17), (15.35, 73.95), (11.41, 76.70)]


def build(n=240, seed=2025):
    rnd = random.Random(seed)
    users = ["Contributor %02d" % (i + 1) for i in range(22)]
    w = [1 / (i + 1) ** 1.1 for i in range(len(users))]
    base = datetime(2025, 2, 1, tzinfo=timezone.utc)
    bursts = [base + timedelta(days=d) for d in (3, 4, 11, 24, 25)]
    recs = []
    for i in range(n):
        u = rnd.choices(users, w)[0]
        day = rnd.choice(bursts) if rnd.random() < 0.45 else base + timedelta(days=rnd.randint(0, 41))
        hour = rnd.choices(range(24), [1, 1, 1, 1, 1, 2, 3, 4, 3, 2, 2, 3, 6, 9, 11, 12, 10, 9, 7, 5, 3, 2, 1, 1])[0]
        ts = day.replace(hour=hour, minute=rnd.randint(0, 59), second=rnd.randint(0, 59))
        size = int(min(38, max(0.4, rnd.lognormvariate(math.log(7), 0.7))) * 1048576)
        mk, md, _ = rnd.choices(CAMERAS, [c[2] for c in CAMERAS])[0]
        geo = rnd.random() < 0.68
        la, lo = rnd.choice(HOTSPOTS)
        if rnd.random() < 0.25:
            pass  # several photos at exactly the same spot
        else:
            la += rnd.gauss(0, 0.04); lo += rnd.gauss(0, 0.04)
        deps = ["Q%d" % (900001 + rnd.randint(0, 29)) for _ in range(rnd.choice([0, 0, 1, 1, 1, 2]))] if rnd.random() < 0.9 else []
        recs.append({"id": 3000 + i, "title": "File:Sample bird behaviour %03d.jpg" % (i + 1), "user": u, "ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "bytes": size,
                     "make": mk, "model": md, "lat": round(la, 6) if geo else None, "lon": round(lo, 6) if geo else None,
                     "w": rnd.choice([4000, 4608, 5472, 6000, 3840]), "h": rnd.choice([2667, 3072, 3648, 4000, 2160]), "deps": sorted(set(deps))})
    return recs


def imageinfo_page(r):
    em = {"Artist": {"value": r["user"]}, "LicenseShortName": {"value": "CC BY-SA 4.0"}, "DateTimeOriginal": {"value": r["ts"][:10] + " " + r["ts"][11:19]}}
    if r["lat"] is not None:
        em["GPSLatitude"] = {"value": str(r["lat"])}; em["GPSLongitude"] = {"value": str(r["lon"])}
    return {"pageid": r["id"], "title": r["title"], "categories": [{"title": "Category:" + CATEGORY}], "imageinfo": [{
        "url": "https://upload.wikimedia.org/full/%d.jpg" % r["id"], "thumburl": "https://upload.wikimedia.org/thumb/%d.jpg" % r["id"],
        "descriptionurl": "https://commons.wikimedia.org/wiki/" + r["title"].replace(" ", "_"), "width": r["w"], "height": r["h"], "size": r["bytes"],
        "timestamp": r["ts"], "user": r["user"], "mime": "image/jpeg",
        "commonmetadata": [{"name": "Make", "value": r["make"]}, {"name": "Model", "value": r["model"]}], "extmetadata": em}]}


def api(recs, params):
    """Answers the handful of API calls the tool makes while loading a category."""
    by_title = {r["title"]: r for r in recs}
    by_mid = {"M%d" % r["id"]: r for r in recs}
    a = params.get("action")
    if params.get("list") == "categorymembers":
        return {"query": {"categorymembers": [{"title": r["title"]} for r in recs]}}
    if a == "query" and "imageinfo" in (params.get("prop") or ""):
        pages = {}
        for t in (params.get("titles") or "").split("|"):
            if t in by_title:
                pages[str(by_title[t]["id"])] = imageinfo_page(by_title[t])
        return {"query": {"pages": pages}}
    if a == "query" and params.get("prop") == "templates":
        return {"query": {"pages": [{"pageid": by_title[t]["id"], "title": t} for t in (params.get("titles") or "").split("|") if t in by_title]}}
    if a == "query" and params.get("prop") == "revisions":
        return {"query": {"pages": [{"pageid": 3000, "revisions": [{"slots": {"main": {"content": "=={{int:filedesc}}==\n{{Information\n|description=\n|source={{own}}\n|author=Sample\n|permission=\n}}\n=={{int:license-header}}==\n{{self|cc-by-sa-4.0}}\n"}}}]}]}}
    if a == "wbgetentities":
        ids = (params.get("ids") or "").split("|")
        if ids and ids[0].startswith("M"):
            out = {}
            for i in ids:
                r = by_mid.get(i)
                if not r:
                    continue
                out[i] = {"labels": {"en": {"language": "en", "value": "Sample bird behaviour"}} if r["id"] % 3 else {},
                          "statements": {"P180": [{"id": "%s$%s" % (i, d), "mainsnak": {"snaktype": "value", "datavalue": {"value": {"entity-type": "item", "id": d}}}} for d in r["deps"]]} if r["deps"] else {}}
            return {"entities": out}
        return {"entities": {i: {"id": i, "labels": {"en": {"language": "en", "value": "Sample subject %d" % (int(i[1:]) - 900000)}}, "descriptions": {"en": {"language": "en", "value": "invented sample item"}}, "claims": {}} for i in ids}}
    if a == "wbsearchentities":
        return {"search": [{"id": "Q900001", "label": "Sample subject 1", "description": "invented sample item"}]}
    if params.get("list") == "prefixsearch":
        return {"query": {"prefixsearch": [{"title": "Category:Sample category"}]}}
    if a == "opensearch":
        return ["x", ["Category:Sample category"], [], []]
    return {"query": {"pages": {}}}
