# Changelog

## 1.1.0 — 2026-10-30

### Added
- **Statistics page** (`▤ Statistics`, or `/?stats&category=Name`): totals (contributors, files, size, average with largest and smallest, geotagged, depicts added); upload activity with a unit that follows the date range and screen width; top contributors, camera models and upload days; contribution, file size and upload hour distributions; a photo map with clustering that can be switched off; a sortable table of user contributions. Every chart has a **chart type** menu: contributors, cameras and days switch between bars, columns, pie and donut (the smaller shares fold into one grey "Other" slice); the distributions add a line; upload activity can be area, line, columns or cumulative; upload hours can be a 24-hour clock (radial). New cards: uploads by weekday, file formats, data coverage (rings or meters) and an upload-rhythm heatmap (weekday by hour). The chosen types are remembered and used in the PNG/SVG/CSV file names. Every chart downloads as PNG or SVG with its title and details, as CSV, and shows as a table.
- **Image notes: depicts suggestions.** Each note lists the depicts already on the file (saved or staged) as chips; one click adds `[[:d:Q…|label]]` to the note.
- **Typing tool on Ctrl+M.** The system keyboard is the default. `Ctrl+M` in any text field turns the configured input method on and off, with a short on-screen hint. It is not remembered between visits.
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
