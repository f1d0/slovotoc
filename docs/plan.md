# Slova divů — Czech Words of Wonders clone: Analysis & Plan

Goal: a polished, ad-free, Czech-language clone of *Words of Wonders* (Fugo Games),
playable in any browser (phone or desktop) via a simple shared link, with no accounts
and no backend. This document is the analysis and implementation plan; no game code
has been written yet.

---

## 1. How the real game works (target experience)

Researched from the official game, gameplay guides and store descriptions.

**Core loop**
- At the bottom of the screen there is a **letter wheel** with 4–7 letters arranged
  in a circle. The player **presses and drags** (finger or mouse) from letter to
  letter; a line/rope visibly connects the selected letters and the word being built
  is shown in a preview pill above the wheel.
- On release, the word is validated:
  - **Target word** (belongs in the crossword) → its letters fly into the crossword
    grid with a satisfying animation.
  - **Already found** → the word's cells flash/pulse in the grid.
  - **Valid Czech word but not in the grid** → collected as a **bonus word**
    ("extra word"); a counter/jar fills up and periodically pays out coins.
  - **Not a word** → the preview pill shakes and dissolves.
- The level is complete when the whole crossword grid is filled. Completion shows a
  celebration (confetti, praise text) and auto-advances to the next level.

**Support systems**
- **Shuffle button** in the center of the wheel rearranges the letters (helps you see
  new combinations).
- **Hints**, paid with coins:
  - *Lightbulb* — reveals a random letter in the grid (cheap).
  - *Hammer/pick* — reveals a **cell of the player's choosing** (more expensive,
    more strategic).
- **Coins** are earned by completing levels and finding bonus words.
- **Progression & theming**: levels are grouped into "wonders"/landmarks; each group
  has a scenic background image and a progress bar. Difficulty ramps: early levels
  use 4–5 letters and few words; later levels 6–7 letters and denser grids.
- Frictionless feel: no penalties for wrong guesses, instant feedback, subtle sounds
  and haptics.

## 2. What the reference repo (kOOnzTe/Words-of-Wonders) teaches us

It is a student project and much simpler than the real game:
- One **hardcoded** level (`EARTH`), answers with fixed grid coordinates in JS.
- Letters are **clicked** to select and the word is submitted with **right-click** —
  no drag/swipe interaction, no line drawing.
- No dictionary; only the 5 predefined answers are accepted. No bonus words, coins,
  levels, persistence, or mobile support. jQuery + jQuery-style animations.

Useful takeaways: the crossword-as-grid rendering with `has-letter`/`has-no-letter`
cells, the shuffle behavior, and the hint that flashes cells. Everything else we will
build properly: pointer-drag wheel, generated levels, real dictionary validation,
progress saving, mobile-first UX.

## 3. Czech language: the key design decisions

**Diacritics — keep them (recommended).** Czech has á č ď é ě í ň ó ř š ť ú ů ý ž.
The official Czech localization of these games treats each accented character as its
own tile (Á ≠ A), and words displayed without háčky/čárky look wrong to Czech
players. So the wheel can contain e.g. `K, Ř, Í, D, L, O` and the player builds
`KŘÍDLO`, `DÍLO`, `ŘÍKL`… Uppercase display throughout (as in the real game).
The digraph **CH** is treated as two tiles C + H (standard in Czech word games).

**Word data — two-tier dictionary:**
1. **Target-word pool** (small, curated): common Czech words, 3–8 letters, used to
   build the crossword grids. Source: intersect a full Czech word list with a
   frequency list (Hermit Dave's Czech subtitle frequency list, or a Czech National
   Corpus-derived list) and keep the top N common words; manually skim for oddities.
   Lemmas preferred, but common inflected forms are fine and make puzzles richer.
2. **Validation dictionary** (large): every acceptable Czech word 3–8 letters, used
   only to recognize bonus words. Source: expanded **hunspell `cs_CZ`** dictionary
   (LibreOffice dictionaries repo, GPL) or the pre-expanded
   `filip-opalka/czech-wordlist`. Filter out proper nouns (capitalized entries) and
   abbreviations. Ship compressed (sorted word list, gzipped by the host —
   roughly a few hundred kB over the wire; loaded once and cached).

Licensing note: hunspell cs_CZ is GPL — fine for a free fan project; we keep the
word-list attribution in the repo. Vulgarisms: keep them out of target words, but
leaving them valid as bonus words is part of the fun (configurable flag in the
generator).

## 4. Architecture

**100% static site, zero backend.**
- **Stack:** Vite + vanilla TypeScript (no framework — the game is one screen with
  canvas/SVG interactions; a framework adds nothing). CSS with custom properties for
  theming. SVG for the letter wheel and connecting rope; DOM/CSS for the grid and
  animations (cheap and smooth).
- **Hosting:** **GitHub Pages** from this repo (free, no ads, instant shareable
  link, HTTPS). Deploy via GitHub Actions on push.
- **Persistence:** `localStorage` — current level, coins, found words per level,
  bonus-word collection, sound on/off. Each friend's progress lives on their device.
- **PWA:** manifest + tiny service worker → installable to home screen, fully
  playable offline after first visit.
- **Levels are pre-generated at build time**, not at runtime: a Node script produces
  `levels.json` shipped with the app. This guarantees curated, deterministic quality
  (runtime generation produces bad grids and unbalanced letter sets).

## 5. Level generator (offline Node script)

1. Pick a **base word** (its letters become the wheel): 4 letters for early levels
   up to 7–8 letters later, chosen from the curated pool with good letter variety.
2. Compute **all subwords** formable from the base word's letter multiset
   (respecting duplicates), from both dictionaries.
3. Choose **4–10 target words** from the curated pool: mix of lengths, always
   including the base word; prefer words sharing letters so the grid connects.
4. **Crossword layout**: place the longest word, then backtracking placement of the
   rest on shared letters (standard crossword-compaction scoring: compact bounding
   box, more intersections = better). Retry with a different word subset if layout
   fails. Grid must be fully connected.
5. Remaining valid subwords → the level's **bonus-word list** (stored as hashes or
   in the big dictionary lookup).
6. Output: `levels.json` = `[{ letters, grid: [{word, row, col, dir}], … }]`,
   ordered by difficulty, grouped into themed packs of ~10–16 levels named after
   Czech and world landmarks (Karlštejn, Petřín, Eiffelovka, Machu Picchu…).
7. Initial shipment: **~150–200 levels** (a few evenings of play), trivially
   extensible by re-running the script.

## 6. UX plan (where the polish budget goes)

- **Mobile-first**, one-screen layout: grid on top, wheel at the bottom, thumb-reach
  friendly; scales up gracefully to desktop (mouse drag works identically via
  Pointer Events).
- **Wheel interaction:** letter pops + color fill when caught by the drag; thick
  rounded SVG rope between selected letters following the finger; current word in a
  colored pill above the wheel.
- **Feedback animations:** letters fly from pill into grid cells (FLIP animation);
  already-found → cells pulse; invalid → pill shake + fade; bonus word → letters fly
  into the bonus jar; level complete → confetti + „Výborně!" / „Skvěle!" overlay,
  coins tick up, auto-advance.
- **Czech UI copy** throughout: Úroveň, Zamíchat, Nápověda, Bonusová slova, Další
  úroveň, atd.
- **Hints:** lightbulb (random letter, ~25 coins), hammer (tap any cell to reveal,
  ~50 coins); coins earned per level (~20) and per bonus-word jar payout.
- **Backgrounds:** soft landscape-style gradients/illustrations per pack (CSS or
  inline SVG) rather than photos — looks premium, zero licensing risk, tiny payload.
- **Sound & haptics:** subtle tick per letter, chime on word, fanfare on level;
  `navigator.vibrate` on mobile; both toggleable, default respectful.
- **No ads, no tracking, no accounts.** Share = send the URL.

## 7. Build milestones

1. **Data pipeline** — fetch + filter dictionaries, produce curated & validation
   word lists (scripts in `tools/`).
2. **Level generator** — layout algorithm + difficulty curve → `levels.json`
     (~150–200 levels), with a quick preview/QA page.
3. **Core engine** — wheel drag interaction, word validation, grid rendering/fill.
4. **Meta systems** — bonus words, coins, hints, level progression, localStorage.
5. **Polish** — animations, sound, haptics, backgrounds, Czech copy, PWA.
6. **Deploy** — GitHub Pages workflow; play-test with friends, tune difficulty.

## 8. Defaults chosen (say the word to change any of these)

- Diacritics **kept** as distinct letters (matches the real Czech game).
- Inflected word forms allowed, not just lemmas.
- Vulgar words: excluded from grids, accepted as bonus words.
- Illustrated/gradient backgrounds instead of landmark photos.
- Vanilla TypeScript + Vite, GitHub Pages hosting, ~150–200 launch levels.
