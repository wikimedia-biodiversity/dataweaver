# Zenodo record for Commons Data Weaver 1.2.0

Release steps: commit, then tag `v1.2.0` and publish the release on GitHub. If the repository is linked to Zenodo, a new version of the record is created automatically (new version DOI, same concept DOI). If you upload by hand, choose *New version* on the existing record 10.5281/zenodo.23680558 and replace the files.

Fields to change on the new version: Version `1.2.0`, publication date `2026-11-03`. Everything else stays. Paste the description below (plain text; use Zenodo's bold and bullet buttons if you like).

## One line

Commons Data Weaver adds depicts, categories, locations and links between similar files to Wikimedia Commons, one file or a whole category at a time.

## Description

Commons Data Weaver (https://dataweaver.toolforge.org/) is a free web tool for Wikimedia Commons. It loads a category, a list of files or a user's own list, shows the files in a grid and lets editors add what is missing, in bulk or one file at a time, and save under their own Wikimedia account (OAuth 2.0).

What it does

- Depicts (P180), categories and locations: search Wikidata and Commons, batch add, remove or clear, subject suggestions from the files' categories.
- Series and Other versions: group photos by time, file name, author, date, licence or uploader, or by hand; warn when uploaders differ; replace author links with the Creator template with safeguards.
- One file at a time: image size and fit, captions in many languages, image notes, personality rights, Help needed flag.
- Map and Calendar (new in 1.2.0): explore photos by place and select them with points, a rectangle, circle, free shape or an imported GeoJSON, KML or shapefile area; a calendar shaded by number of photos with date range selection.
- Statistics: contributors, sizes, upload activity, cameras, a clustered map and a contributions table, with chart downloads.
- Depicts overview with word cloud, bubbles or bars; a link opens the full WikiWordCloud studio (https://wordcloud.toolforge.org/).
- Custom hashtag for edit summaries (for example for an edit-a-thon), Photographed and Uploaded time, sorting and filtering with live counts, CSV and JSON export.

Changes in 1.2.0: see CHANGELOG.md in the repository. It includes everything developed as 1.1.0, which was not released separately.

Source code: https://github.com/wikimedia-biodiversity/dataweaver . Licence: GPL-3.0-or-later. Built and maintained by Manoj Karingamadathil, Wikimedia Biodiversity Taskforce, Sahya Digital Conservation Foundation. Related: WikiWordCloud, https://doi.org/10.5281/zenodo.23854750 .

## Related identifiers

- Is supplemented by / has part: 10.5281/zenodo.23854750 (WikiWordCloud, began during Data Weaver's development)
- Is identical to / new version of: 10.5281/zenodo.23680558
