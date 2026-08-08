# Third-party content and licences

Slovotoč is three different things under one roof, and they are **not** all
under the same licence. If you are reusing any of it, this is the part to
read.

| Layer | What it is | Licence |
|---|---|---|
| **Source code** | `web/js/**`, `web/css/**`, `web/*.html`, `tools/**`, `tests/**` | MIT — see [`LICENSE`](LICENSE) |
| **Level data** | `web/data/levels.json` | CC BY-SA 4.0 (derived from Wiktionary — see below) |
| **Photographs** | `web/assets/bg/*.jpg` | Per-file CC BY / CC BY-SA — see [`web/data/photo-credits.json`](web/data/photo-credits.json) |
| **Font** | `web/assets/fonts/nunito-*.woff2` | SIL Open Font License 1.1 |
| **Icon** | `web/assets/icon.svg` and the PNGs generated from it | MIT, with the code |

## Level data — why it is share-alike, not MIT

The crossword answers are drawn from dictionary headwords extracted from the
**Czech section of the English Wiktionary** via [kaikki.org](https://kaikki.org/dictionary/Czech/).
Wiktionary content is CC BY-SA / GFDL, so a word list derived from it is a
derivative work and inherits share-alike terms. `web/data/levels.json` is
therefore offered under **CC BY-SA 4.0**, with attribution to Wiktionary.

That is why the code licence and the data licence are separate: MIT code can
be dropped into anything, but if you ship this word list you have to keep it
open and credit Wiktionary. Building your own list from a differently
licensed source removes that obligation.

Also used while generating the data (not shipped in this repository):

- **Czech word forms** — [LibreOffice dictionaries](https://github.com/LibreOffice/dictionaries)
  `cs_CZ` hunspell (GPL), via [filip-opalka/czech-wordlist](https://github.com/filip-opalka/czech-wordlist).
  Used only to *test whether a string is a Czech word* during generation; no
  part of it is redistributed here.
- **Word frequencies** — [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords),
  built from the OpenSubtitles corpus (CC BY-SA 4.0). Used to rank candidates
  by familiarity; not redistributed.

## Photographs

Each pack shows a blurred, dimmed photograph of the place it is named after.
All 24 were taken from **Wikimedia Commons** and every one is freely licensed:
14× CC BY-SA 3.0, 8× CC BY-SA 4.0, 1× CC BY-SA 2.0, 1× CC BY 3.0. **None are
NonCommercial or NoDerivatives.**

Author, licence and source page for every photo are recorded in
[`web/data/photo-credits.json`](web/data/photo-credits.json) and shown in the
game itself under **ℹ️ O hře a fotkách**. If you fork this, keep that screen —
the attribution is a licence condition, not a courtesy.

The photos are displayed with CSS blur and opacity; the files themselves are
unmodified.

## Relationship to Words of Wonders

Slovotoč was written after studying *Words of Wonders* (Fugo Games) and the
genre it belongs to — which starts earlier, with *Wordscapes* (PeopleFun,
2017) and others. Game rules and mechanics are not copyrightable; the name,
logo, artwork, code and word list here are all original to this project, and
the diacritics mechanic (bare tiles, the game writes the accents) does not
exist in either.

This is a non-commercial fan project and is not affiliated with, endorsed by,
or connected to Fugo Games in any way.

## Supabase key

`web/js/leaderboard.js` contains a Supabase project URL and a public **anon**
key. That key is designed to be shipped in client code; access is controlled
by row-level-security policies in the database, not by keeping it secret. If
you fork this, point it at your own project — see [`docs/leaderboard.sql`](docs/leaderboard.sql).
