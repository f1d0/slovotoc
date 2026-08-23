# Slovotoč 🟡

**A Czech word game: swipe letters on a wheel to spell words and fill a
crossword.** No ads, no accounts, no tracking. 240 levels across 24 packs
named after real Czech places, a shared leaderboard, a daily challenge, and
full offline play once loaded.

### ▶ [slovotoc.cz](https://slovotoc.cz)

> 🇨🇿 *Česká slovní hra — spojuj písmena tahem prstu, hledej slova a vyplň
> křížovku. Hraj na [slovotoc.cz](https://slovotoc.cz), nic se nestahuje
> a nikde se neregistruješ.*

The whole game is a static site: plain ES modules and CSS, no framework, no
build step, ~120 kB gzipped including the entire dictionary. `web/` is
deployed verbatim.

---

## The mechanic that makes it not a clone

The genre is well trodden — *Wordscapes*, *Words of Wonders* and a dozen
others. Czech is what makes it interesting, because Czech has diacritics and
a wheel with 8 tiles cannot carry `e ě é` as separate letters without
becoming unplayable.

**The wheel holds bare letters, and the game writes the accents for you.**
Swipe `KRIDLO` and it fills in `KŘÍDLO`. Words are matched on their
de-accented form, which roughly doubles the usable vocabulary from the same
eight tiles.

When one bare spelling fits several real words — `sit` → `síť` *and* `sít`,
`rad` → `řád` *and* `rád` — the game credits **all** of them at once rather
than asking which you meant. 38 levels contain such a pair on purpose.

## Playing

- Drag across the letters in the bottom wheel; release to submit.
- A word in the crossword flies into the grid. A valid Czech word that
  *isn't* in the crossword counts as a **bonus word** (⭐) — every 10 pay out
  coins.
- **💡 25 coins** reveals a random letter, **🔨 60 coins** a square you pick.
- **Stars:** finishing earns 1, finishing without hints 2, and adding three
  bonus words 3.
- **Daily challenge:** one puzzle a day, the same for everyone, no server
  involved — the date seeds the level index.
- Progress lives in `localStorage`; several people can share one device, each
  under their own name.

## How it fits together

```
web/                     the game — deployed as-is, no build
  index.html
  js/main.js             game flow, levels, overlays, scoring
  js/wheel.js            pointer-driven letter wheel + rope
  js/grid.js             crossword rendering and reveals
  js/state.js            localStorage, multiple players
  js/leaderboard.js      Supabase REST client (fails soft when offline)
  sw.js                  service worker: network-first code, cache-first art
  data/levels.json       240 pre-generated levels
  js/wordfilter.js       the kid-safe filter, shared with tools/
tools/                   offline generation (Node, run by hand)
  wordfilter.mjs         re-exports web/js/wordfilter.js — one list, not two
  extract-wikt-lemmas.mjs  dictionary headwords from Wiktionary
  generate-levels.mjs    picks words, builds crosswords, writes levels.json
  layout.mjs             the crossword layout algorithm
  fetch-backgrounds.mjs  Wikimedia Commons photos + credits
tests/                   see below
```

**Levels are generated offline, never in the browser.** Choosing words and
laying out a crossword is a search problem; doing it at runtime would be both
slow and non-deterministic. `levels.json` is the frozen result.

**Crossword answers are dictionary headwords only** — nouns in the nominative,
verbs in the infinitive — taken from Wiktionary. Inflected fragments like
*kol* or *jsme* never appear as answers. Bonus words are deliberately far more
permissive, so ordinary Czech is accepted even when it is not a headword —
the accept pool merges a hunspell-derived form list with the inflection
tables Wiktionary publishes, because the form list alone had gaps (the whole
paradigm of *osa* was missing bar the nominative, so OSE was refused in all
twelve levels it fits). The list also carried no `-é`/`-á` form for 76% of
its adjectives, so `zelný` was accepted and `zelné` was not; those are
derived from the regular hard-adjective pattern instead — minus the
nominative plural, which palatalises the stem and cannot be derived safely.
`tools/expand-bonus.mjs` rebuilds those lists without touching a single
crossword.

## Running it locally

```bash
npm install          # playwright-core, for the tests only
npm test             # data integrity + browser edge cases

# the game itself needs no build:
cd web && python3 -m http.server 8000
```

The service worker only registers over HTTPS, so plain `http://localhost`
gives you the game without offline caching — which is usually what you want
while developing.

## Tests

```bash
npm run test:data      # structural checks on levels.json, no browser
npm run test:edge      # ten ways to break the game, in a real browser
npm run test:pin       # the sign-in flow, against a stubbed database
npm run test:levels    # play all 240 levels to the end (~10 min)
```

`tests/data.mjs` checks every level: words buildable from the wheel, letters
agreeing where words cross, nothing outside the grid, no two words running
along the same line, a connected crossword, and every word passing the
kid-safe filter.

`tests/edge.mjs` is the interesting one. Each case reproduces a bug that was
actually in this game:

| Case | The bug it guards |
|---|---|
| hint during the winning animation | finished the level twice — double reward, campaign jumped two levels |
| reopening a finished game | replayed the last level's payout on every visit |
| hostile leaderboard avatar | remote text went into the DOM unescaped and ran script |
| level data fails to load | blank screen, no message, no way forward |
| leaving the daily mid-animation | letters landing on the level that replaced it |
| `localStorage` blocked | private browsing threw on write |
| blank player name | started a game as nobody |
| the same word submitted twice | counted twice |
| no canvas, no audio | confetti threw and took the level-advance timer with it |
| a save captured mid-completion | reopened to a full crossword that never finished |

`tests/pin.mjs` covers the sign-in flow — locked names, wrong PINs, the hint
appearing only after a mistake, a taken name being refused — and the name
filter. `tests/inapp.mjs` checks the Messenger warning appears there and
nowhere else.

`tests/all-levels.mjs` plays every level in the game to the end, submitting
only the bare spellings a player can actually produce on the wheel. It is the
answer to "is any level unwinnable" — run it after regenerating levels, along
with `npm run test:data`.

## Regenerating the levels

The source dictionaries are large and not vendored here:

```bash
git clone --depth 1 https://github.com/filip-opalka/czech-wordlist /workspace/czech-wordlist
git clone --depth 1 --filter=blob:none --sparse https://github.com/hermitdave/FrequencyWords /workspace/freqwords
(cd /workspace/freqwords && git sparse-checkout set content/2018/cs)
curl -L -o /workspace/cs_CZ.dic https://raw.githubusercontent.com/LibreOffice/dictionaries/master/cs_CZ/cs_CZ.dic
curl -L -o /workspace/kaikki-cs.jsonl https://kaikki.org/dictionary/Czech/kaikki.org-dictionary-Czech.jsonl

node tools/extract-wikt-lemmas.mjs   # → /workspace/wikt-cs-lemmas.txt
npm run levels                        # → web/data/levels.json
npm test
```

`tools/purge-words.mjs` is the surgical alternative: when the kid-safe filter
gains a rule, it strips the newly-banned words and relays *only* the affected
levels, leaving everyone's saved progress in the other levels intact.

## Leaderboard

Scores go to a `leaderboard` table in Supabase (free tier). Identity is just
the player's name — deliberately, so a seven-year-old can join without an
email address. Score is the highest level ever reached, so starting over
doesn't cost you your place. Every call has a timeout and falls back to local
data, so the game stays playable when Supabase is asleep or unreachable.

Table setup: [`docs/leaderboard.sql`](docs/leaderboard.sql), then
[`docs/leaderboard-pin.sql`](docs/leaderboard-pin.sql).

### Locking a name

A player can lock their name with a four-digit PIN, which is what stops
somebody typing your name and playing as you. **The check runs in Postgres,
not in the browser** — the anon key ships in the game's source, so a check in
JavaScript would be a suggestion rather than a lock. Direct writes are
revoked from `anon` entirely and all writes go through `save_score()`, which
verifies the PIN server-side. Five wrong tries lock the name for fifteen
minutes.

Four digits rather than an email or a social login, because the children this
was built for are not old enough to have either — Google will not let an
under-16 in the Czech Republic create an account at all. Nothing is bound to
a device: the same name and PIN work in any browser, on any phone, which was
the whole point.

Names with no PIN keep working exactly as before, so nobody already playing
is locked out. The game offers the lock as soon as somebody claims an
unlocked name, and otherwise once they have finished a few levels.

Player names go through the same kid-safe filter the word list does — the
name is on a board children read. The name is flattened first (diacritics
folded, separators dropped, digit-for-letter swaps undone, repeated letters
collapsed) so `K0k0t` and `k.o.k.o.t` are caught along with the plain
spelling. This runs in the browser, so it stops someone picking a rude name
rather than someone determined to force one through.

## Licences

Code is MIT. The level data is CC BY-SA (it derives from Wiktionary), and the
photographs carry their own per-file Creative Commons terms. **Read
[`NOTICE.md`](NOTICE.md) before reusing any of it** — the three layers are not
interchangeable.

Not affiliated with Fugo Games or *Words of Wonders*.
