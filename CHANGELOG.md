# Changelog

## 1.2.0 — 2026-11-03

Version 1.1.0 was developed but never released on its own, so this release contains everything since 1.0.0. New in the last days: **Map** and **Calendar** selection, **custom hashtag**, **Clear** options in the batch panel, **Photographed / Uploaded time**, sort by **Uploader**, series by **date, licence and uploader**, and a simpler Depicts overview that links to WikiWordCloud.

### Added
- **One-by-one view: always-visible strip** at the top of the edit panel with shortcuts to *Categories*, *File details*, *Image notes*, *Captions* and *Location* (scrolling does not hide it). Newly added categories and the **Suggested from Wikidata** categories sit in the same strip in red, one click adds them.
- **Series: Grouped by Author.** Files with the same author form a series. In such a series *Link all as Other versions* is replaced by **Author → Creator template**, which changes `|author=` and `|photographer=` from `[[User:Name|Name]]` to `{{Creator:Full Name}}`. It refuses when the authors differ, checks that the `Creator:` page exists, warns when the user page is not yours, needs a confirmation about mass edits, and saves one file every 1.5 seconds (at most 50 per run).
- **Depicts overview redesigned:** word cloud, bubbles or bars; outline shapes (rectangle, circle, heart, star, diamond, triangle, cloud), canvas ratios (4:3, 16:9, 1:1, 9:16, A4), rotation modes and angle, word spacing, spiral density, opacity, smallest and largest size, font and weight, palettes or your own colour, background colour with gradient or transparent, a *New layout* button, letter case, number of items, counts, unsaved in red (settings inspired by [Vaakkumegham](https://github.com/nethahussain/vaakkumegham) by Netha Hussain and the NScience [Vaakkuttam](https://www.nscience.in/p/word-cloud-generator.html) generator by Navaneeth Krishnan S); downloads as CSV, SVG, PNG, JSON, TXT or **all formats**; **Depicts language** (top right): English by default; pick from the list or type any language code.
- **Depicts overview word cloud simplified**: only style, colours, background, number of items, unsaved in red and *New layout*; a link opens the full studio at WikiWordCloud (`wordcloud.toolforge.org`) with the current category. WikiWordCloud opens the CSV/JSON downloaded from Data Weaver.
- **Batch edit: Clear options.** *Clear all (depicts, categories, location)* at the top, and *Clear depicts*, *Clear categories* and *Clear location* in their own sections. Each asks for confirmation, changes only the selected files and is saved only with *Save* (location removal deletes the `{{Location}}` template). The one-by-one view has a *Clear* button for the location. The save summary counts "Locations to remove".
- **Sort by Uploader.**
- **Series: Grouped by Date (photographed), Grouped by Uploaded date, Grouped by Licence, Grouped by Uploader.**
- **Terminology:** "Observation date" is now **Photographed time**, and **Uploaded time** is shown beside it (sort, file details, CSV columns `photographed_time` and `uploaded_time`).
- **Custom hashtag** next to *Project*: type it without `#` and without spaces (for example `TheyyamEditathon`); it is added after `#DataWeaver` (and the project tag) in every edit summary, and remembered in this browser.
- **🗺 Map** (left of Calendar): all photos with a location on a map, clustered. Click a point to select its photos (a cluster zooms in). Select an area with a **rectangle**, a **circle** or a **free-hand shape** (shapes add up), or **import a shape file**: GeoJSON, KML, `.shp` or a zipped shapefile (polygons in WGS84; holes are ignored). Then *Select photos in shapes* or *Show only these* in the grid. Photos without a location are counted, not shown.
- **📅 Calendar** (left of Statistics): twelve months per year, each day shaded by the number of photos (photographed or uploaded time), pick a range of days or a whole month, then select those photos or show only that range in the grid.
- **Sort by file format** in the main toolbar.
- Batch edit panel: **Unselect all** replaces *Select starred*.
- Hotkey **S** stars like **Space**.
- **Statistics page** (`▤ Statistics`, or `/?stats&category=Name`): totals (contributors, files, size, average with largest and smallest, geotagged, depicts added); upload activity with a unit that follows the date range and screen width; top contributors, camera models and upload days; contribution, file size and upload hour distributions; a photo map with clustering that can be switched off; a sortable table of user contributions. Every chart has a **chart type** menu: contributors, cameras and days switch between bars, columns, pie and donut (the smaller shares fold into one grey "Other" slice); the distributions add a line; upload activity can be area, line, columns or cumulative; upload hours can be a 24-hour clock (radial). New cards: uploads by weekday, file formats, data coverage (rings or meters) and an upload-rhythm heatmap (weekday by hour). The chosen types are remembered and used in the PNG/SVG/CSV file names. Every chart downloads as PNG or SVG with its title and details, as CSV, and shows as a table.
- **One-by-one view layout restored to image left, edit panel right** (about 1.2 : 1, panel at most 640 px). The panel scrolls and the file header stays locked at the top. *Image notes* and *Captions* sit side by side; the campaign category (the one you loaded, any named *Wiki Loves…* / *Images from…*, or starting *Uploaded via Campaign:*) is pinned and locked (🔒) in the category list until you unlock it; the *Location* box can be hidden (remembered).
- **Project from your list page:** a heading like `== Folkland ==` above a gallery or list on `User:You/DataWeaver` sets the project of the files below it (a deeper `===` heading keeps it). Edit summaries (`#Folkland`) and the Help flag use each file's own project; the Project menu is the default for the rest.
- **Filter: files without camera information** (and with camera information), with counts.
- **Keys** button moved to the top bar beside the gear; the tool bar stays on one line with *Download* last (the menus shrink to fit instead of wrapping).
- **Credit line** shows the version (`v1.2.0`), and the DOI. The Phabricator board (<https://phabricator.wikimedia.org/project/board/9174/>) is linked from the About and Community pages and the README, not from the tool page.
- DOI updated to 10.5281/zenodo.23680558.
- **Image notes: depicts suggestions.** Each note lists the depicts already on the file (saved or staged) as chips; one click adds `[[:d:Q…|label]]` to the note.
- **Typing tool on Ctrl+M.** The system keyboard is the default. `Ctrl+M` in any text field turns the configured input method on and off, with a short on-screen hint. It is not remembered between visits.
- **Thumbnail fix:** Wikimedia now serves thumbnails from `thumb.wikimedia.org` (the API's `thumburl` points there). The page's Content Security Policy only allowed `upload.wikimedia.org`, so the browser blocked every preview. `thumb.wikimedia.org` is now allowed, and a test loads a thumbnail from that host under the strict policy.
- **Thumbnails retry.** A preview that fails (Wikimedia busy or still making the size) is retried with growing pauses, then through `Special:FilePath`, and only then replaced by a grey tile with a ↻ button. The next and previous images are preloaded in the one-by-one view.
- **Projects and help categories** filled in: Bioregister, Folkland, Heritage and **Wiki Village** (renamed from Wikivoyage; hashtag `#WikiVillage`), each with its `… (Maintenance)` category. Project names may now contain spaces; an optional `tag` sets the hashtag.
- **Stars menu** with *only not starred*, merged into the star filter.
- **Select** buttons (All, None, **Invert**) in the toolbar; keys `I` (invert), `Space` (star), `B` (batch panel).
- **One-by-one view** on a single screen: depicts, categories with file details side by side, location, captions, other versions and image notes in boxes that scroll inside themselves.
- **Image size and fit** in the one-by-one view, with a *New tab* link; remembered for the next files.
- **Help needed** flag (`H`) for problematic files, shown when a project is chosen; adds the project's help category. Projects and their help categories live in `static/config/projects.json`.
- Keys in the one-by-one view: `Space` star, `P` Personality rights, `H` help needed. A ▶ button after *Save & next*.
- Captions and descriptions show the interface language chosen in the gear first, then English.
- Download file names: `dataweaver-<category or source file>-<date>-<time>`.

### Changed
- The batch panel starts hidden, behind a highlighted *Batch edit* button, and opens with a warning.
- The Personality rights button is a compact two-line label.
- Depicts edit summaries no longer repeat "Added 1 statement: depicts (P180)": Wikibase already writes that part.
- Suggestion lists open as floating lists, so scrolling boxes and dialogs never cut them off.
- `static/js/dataweaver.js` is now edited directly (see CONTRIBUTING.md).

### Fixed
- When logged out, the log-in banner covered the top of the one-by-one view, including the Save buttons.

## 1.0.0 — 2026-10-29
First web application release: Wikimedia OAuth 2.0 login, write proxy, settings gear (interface language and typing tools with jQuery IME), About, Features, Technology, Story, Community, Credits, How to use and Privacy pages, GPL-3.0-or-later.
