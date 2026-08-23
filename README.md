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
- **💡 reveals a random letter, 🔨 a square you pick** (twice the price).
  The first hint in a level costs 20 coins and **every further hint in the
  same level costs double** — 20, 40, 80, 160 — starting over at 20 in the
  next level. See *The hint economy* below.
- **Stars:** finishing earns 1, finishing without hints 2, and adding three
  bonus words 3. The number of levels finished **without a hint** is one of
  the things the leaderboard can rank you by.
- **Daily challenge:** one puzzle a day, the same for everyone, no server
  involved — the date seeds the level index. It pays coins **and a free
  hint**, plus one extra hint on every fifth consecutive day.
- Progress lives in `localStorage`; several people can share one device, each
  under their own name.

## The hint economy

Hints were a flat 25 coins, and that quietly broke the game. Coins accumulate
without limit — mostly from bonus words, which are worth 15 coins per 10 and
of which one level can hold 707 — so the best player on the board had 3805
coins, enough to *buy five entire crosswords*. Meanwhile a beginner with 80
starting coins found the very first hint expensive.

The price now doubles with every hint bought **within one level** and resets
in the next:

| hint | 💡 | 🔨 |
|---|---|---|
| 1st | 20 | 40 |
| 2nd | 40 | 80 |
| 3rd | 80 | 160 |
| 4th | 160 | 320 |
| 5th | 320 | 640 |
| 6th | 640 | 1280 |

There is no ceiling — a ceiling is what a large purse buys its way through.
Both ends improve. The first hint of any level is cheaper than it used to be,
so being stuck is never unaffordable; buying a whole crossword is arithmetic
nobody can pay — that same 3805-coin purse now buys 7 letters of a 33-cell
grid instead of five finished levels.

A player who still cannot pay is not left with "not enough coins": they are
offered the daily challenge, which pays 40 coins **and a hint that costs
nothing** (green bulb), and told how many bonus words separate them from the
next payout.

Nothing is for sale for money, and nothing here is a currency sink for its
own sake — the point is that spending a hint should be a decision.

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
npm run test:hints     # the hint prices, free hints and the no-hint tally
npm run test:board     # the leaderboard, the player card and the changelog
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

`tests/hints.mjs` covers the hint economy: prices doubling inside a level,
resetting in the next, surviving a reload (otherwise reloading would be a
discount), free hints from the daily spending no coins and no ladder step,
and being short of coins opening the offer instead of a dead end.

`tests/board.mjs` covers the leaderboard's metric chips, the per-player card,
the changelog appearing exactly once, and — the part worth having — that a
database where `docs/leaderboard-stats.sql` has not been run yet still
receives scores. Sending arguments a stored function does not take makes
PostgREST answer 404, the same answer as a database with no functions at all;
mistaking one for the other would push every write down the direct-table path
that PIN-locked names are not allowed to take, and their scores would stop
saving silently. That has happened here once already.

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

`tools/add-words.mjs` is what you actually run when somebody reports a word
the game should have taken. It adds the hand-curated list in
[`tools/extra-words.txt`](tools/extra-words.txt) to every level whose wheel
can spell it, needs no dictionaries and touches nothing but the bonus lists —
`npm run words`, seconds, no crossword disturbed.

That list exists because of what the two big sources do and do not cover.
Between them they handle ordinary Czech well, dialect included — *šufánek*,
*erteple*, *škopek* and *cyp* are all in there, and 97% of the thousand
commonest word forms in the language. What they miss is the regional tail
that never made it into a national dictionary: *lokše* is absent because the
Institute of the Czech Language says plainly that the word is not in the
explanatory dictionaries and its gender is still unsettled, and *kolec* (a
barrow, around Strakonice) is absent for the same reason. No bigger
dictionary fixes that, because the words are not in any dictionary. A list
somebody maintains by hand is the right tool, and it is deliberately
bonus-words-only: nothing in it can become a crossword answer.

`tools/purge-words.mjs` is the surgical alternative: when the kid-safe filter
gains a rule, it strips the newly-banned words and relays *only* the affected
levels, leaving everyone's saved progress in the other levels intact.

## The leaderboard is one column wide

Five numbers per row — levels, stars, bonus words, daily streak — meant that
on a 360 px phone the names were cut to `Šá…`, `Ha…`, `Tý…`. A leaderboard
you cannot read the names on is not a leaderboard, and the answer to "where
does the sixth statistic go" is that it doesn't.

So a row carries **one** number and the player picks which — 🏆 levels, ★
stars, 🧠 levels without a hint, ⭐ bonus words — and tapping a row opens that
player's full set of figures, the daily streak and coins included. Four
metrics, not five: the daily streak is already on the button directly above
the board, and it was the chip that pushed the row onto a third line.

## Leaderboard

Scores go to a `leaderboard` table in Supabase (free tier). Identity is just
the player's name — deliberately, so a seven-year-old can join without an
email address. Score is the highest level ever reached, so starting over
doesn't cost you your place. Every call has a timeout and falls back to local
data, so the game stays playable when Supabase is asleep or unreachable.

Table setup: [`docs/leaderboard.sql`](docs/leaderboard.sql), then
[`docs/leaderboard-pin.sql`](docs/leaderboard-pin.sql), then
[`docs/leaderboard-stats.sql`](docs/leaderboard-stats.sql).

Every migration has to leave the *old* clients working, because they are
already installed on people's phones and a service worker can serve a stale
build for a launch or two. Each new column is therefore optional on the way
in and the client drops it after one refusal. `leaderboard-stats.sql` also
stops the "keep the best" trigger applying to **coins**: coins are the one
number that is supposed to go down, and while the trigger held them at their
all-time high, signing in on a second phone refilled the purse.

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

## Telling players what changed

`NEWS` in `web/js/main.js` is a short changelog, newest first. A player has
read up to `player.seenNews`, so adding an entry re-arms a dot on the trophy
button and shows the card once on the next launch — but only to somebody who
has played before. A newcomer gets the game, not its release notes.

## Licences

Code is MIT. The level data is CC BY-SA (it derives from Wiktionary), and the
photographs carry their own per-file Creative Commons terms. **Read
[`NOTICE.md`](NOTICE.md) before reusing any of it** — the three layers are not
interchangeable.

Not affiliated with Fugo Games or *Words of Wonders*.
