# Vendored third-party code

Served from this tool's own origin on purpose: Toolforge tools must not load scripts or styles from third-party servers.

| Library | Version | Source | Licence |
|---|---|---|---|
| jquery.ime | git `77ed339` (2026-10-21) | https://github.com/wikimedia/jquery.ime (`src/`, `css/`, `images/`, `rules/`) | GPL-3.0-or-later or MIT (`jquery.ime/GPL-LICENSE`, `jquery.ime/MIT-LICENSE`) |
| jQuery | 3.6.1 | https://jquery.com (`dist/jquery.min.js`, taken from the Debian `libjs-jquery` package) | MIT (`jquery/LICENSE.txt`) |

To update jquery.ime: clone the repository, copy `src/`, `css/`, `images/` and `rules/` over `jquery.ime/`, and update the commit above.
To update jQuery: replace `jquery/jquery.min.js` with the latest 3.x `dist/jquery.min.js` (3.7.1 or newer is recommended) and its licence.
Individual input-method rule files carry their own author and licence headers.
