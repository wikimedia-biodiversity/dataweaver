"""Server-rendered pages: the tool shell and the documentation pages."""
from flask import Blueprint, current_app, render_template

from . import config
from .auth import load_session, public_user

bp = Blueprint("pages", __name__)

NAV = [  # (endpoint-path, i18n key, English label)
    ("/", "nav-tool", "Tool"),
    ("/howto", "nav-howto", "How to use"),
    ("/about", "nav-about", "About"),
]
ABOUT_TABS = [
    ("/about", "tab-about", "About"),
    ("/features", "tab-features", "Features"),
    ("/technology", "tab-technology", "Technology"),
    ("/story", "tab-story", "Story and workflows"),
    ("/community", "tab-community", "Community"),
    ("/credits", "tab-credits", "Credits"),
]


def context(active, **extra):
    cfg = current_app.config["DW"]
    _, data = load_session()
    me = public_user(data)
    client = {
        "apiUrl": cfg["API_URL"], "wikidataApiUrl": cfg["WIKIDATA_API_URL"],
        "tileUrl": cfg["TILE_URL"], "nominatimUrl": cfg["NOMINATIM_URL"],
        "me": me, "version": config.VERSION, "loginUrl": "/login",
    }
    base = dict(active=active, nav=NAV, about_tabs=ABOUT_TABS, me=me, client_config=client,
                version=config.VERSION, doi=config.DOI, git_url=config.GIT_URL, author=config.AUTHOR,
                author_url=config.AUTHOR_URL, orcid=config.ORCID, base_url=cfg["BASE_URL"],
                oauth_ready=bool(cfg["OAUTH_CLIENT_ID"]))
    base.update(extra)
    return base


def page(template, active, **extra):
    return render_template(template, **context(active, **extra))


@bp.get("/")
def tool():
    return page("app.html", "/")


@bp.get("/howto")
def howto():
    return page("howto.html", "/howto")


@bp.get("/about")
def about():
    return page("about.html", "/about", tab="/about")


@bp.get("/features")
def features():
    return page("features.html", "/about", tab="/features")


@bp.get("/technology")
def technology():
    return page("technology.html", "/about", tab="/technology")


@bp.get("/story")
def story():
    return page("story.html", "/about", tab="/story")


@bp.get("/community")
def community():
    return page("community.html", "/about", tab="/community")


@bp.get("/credits")
def credits():
    return page("credits.html", "/about", tab="/credits")


@bp.get("/login/done")
def login_done():
    return page("done.html", "/")


@bp.get("/privacy")
def privacy():
    return page("privacy.html", "/about", tab="/privacy")
