# Slovotoč 🟡

Česká slovní hra ve stylu *Words of Wonders*: spojuj písmena tahem prstu,
hledej slova a vyplň křížovku. 160 úrovní v 16 balíčcích, bonusová slova,
mince a nápovědy. Bez reklam, bez účtů, bez sledování — prostě pošli
kamarádům odkaz a hrajte.

**▶ Hrát:** https://f1d0.github.io/wowczechversion/

- Funguje na mobilu i na počítači (tah prstem / tažení myší).
- Průběh hry se ukládá v prohlížeči (localStorage).
- Na jednom zařízení může hrát víc lidí — každý pod svým jménem.
- **Společný žebříček** všech hráčů napříč zařízeními (🏆 nahoře).
- Nesprávné slovo lze nahlásit tlačítkem ⚑ (založí GitHub issue).
- Po prvním načtení funguje i offline (PWA — lze přidat na plochu);
  žebříček se v offline režimu přepne na hráče z tohoto zařízení.

## Jak hra funguje

- Ve spodním kruhu **spoj písmena tahem** a vytvoř slovo.
- Slovo z křížovky se doplní do mřížky; platné české slovo, které v křížovce
  není, se počítá jako **bonusové slovo** (⭐) — každých 10 přinese mince.
- **💡 (25 mincí)** odkryje náhodné písmeno, **🔨 (60 mincí)** odkryje
  políčko, které si vybereš. Mince dostáváš za dokončené úrovně.

## Fotky míst

Každý balíček má na pozadí jemnou (rozostřenou a ztlumenou) fotku daného
místa. Fotky stahuje `tools/fetch-backgrounds.mjs` z **Wikimedia Commons**
a bere jen volně licencované snímky (CC0 / CC BY / CC BY-SA / public
domain). Autor a licence každé fotky jsou uvedeny v `web/data/photo-credits.json`
a přímo ve hře v sekci **ℹ️ O hře a fotkách**.

```bash
node tools/fetch-backgrounds.mjs   # doplní web/assets/bg/*.jpg + kredity
```

Hra je nekomerční projekt pro kamarády; fotky jsou použity v souladu se
svými licencemi včetně uvedení autorů.

## Žebříček (Supabase)

Skóre se ukládá do tabulky `leaderboard` v Supabase (free tier).
`web/js/leaderboard.js` obsahuje URL projektu a veřejný **anon** klíč —
ten je určen k publikování v klientském kódu, přístup hlídají RLS politiky
v databázi (čtení a zápis skóre ano, mazání ne).

Skóre = nejvyšší dosažená úroveň (`best`), takže restart hry o pozici
v žebříčku nepřipraví. Zápis probíhá po dokončení úrovně a při odchodu
ze stránky; když je hráč offline, žebříček zobrazí jen hráče z tohoto
zařízení a skóre se dosynchronizuje později.

Založení tabulky (SQL editor v Supabase) je popsáno v `docs/leaderboard.sql`.

## Struktura repozitáře

- `web/` — celá hra, čistý HTML/CSS/JS bez build kroku; nasazuje se na
  GitHub Pages akcí v `.github/workflows/deploy.yml`.
- `web/data/levels.json` — předgenerované úrovně (písmena, rozložení
  křížovky, bonusová slova).
- `tools/` — offline generátor úrovní (Node 18+):
  - `wordfilter.mjs` — filtr slovníku (znaky, délka, dětem přátelský obsah),
  - `extract-wikt-lemmas.mjs` — extrakce slovníkových hesel z Wikislovníku,
  - `generate-levels.mjs` — výběr slov + skládání křížovek.

Slova v křížovce jsou výhradně **slovníková hesla** (podstatná jména
v 1. pádě, slovesa v infinitivu…) z anglického Wikislovníku pro češtinu;
tvary jako „kol" nebo „jsme" se v mřížce nikdy neobjeví. Bonusová slova
jsou benevolentnější a přijímají i vyskloňované tvary.

### Přegenerování úrovní

```bash
# zdrojová data (viz Poděkování níže):
git clone --depth 1 https://github.com/filip-opalka/czech-wordlist /workspace/czech-wordlist
git clone --depth 1 --filter=blob:none --sparse https://github.com/hermitdave/FrequencyWords /workspace/freqwords
(cd /workspace/freqwords && git sparse-checkout set content/2018/cs)
curl -L -o /workspace/cs_CZ.dic https://raw.githubusercontent.com/LibreOffice/dictionaries/master/cs_CZ/cs_CZ.dic
curl -L -o /workspace/kaikki-cs.jsonl https://kaikki.org/dictionary/Czech/kaikki.org-dictionary-Czech.jsonl

node tools/extract-wikt-lemmas.mjs   # slovníková hesla → /workspace/wikt-cs-lemmas.txt
node tools/generate-levels.mjs       # zapíše web/data/levels.json + QA výpis
```

## Poděkování / licence dat

- Slovníková hesla: [Wikislovník (en.wiktionary, čeština)](https://en.wiktionary.org)
  přes extrakci [kaikki.org](https://kaikki.org/dictionary/Czech/) (CC BY-SA / GFDL).
- Český slovník tvarů: [filip-opalka/czech-wordlist](https://github.com/filip-opalka/czech-wordlist)
  (odvozeno z hunspell `cs_CZ`, GPL) a [LibreOffice dictionaries](https://github.com/LibreOffice/dictionaries) (GPL).
- Frekvenční seznam: [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
  (z korpusu OpenSubtitles, CC-BY-SA 4.0).
- Písmo: [Nunito](https://fonts.google.com/specimen/Nunito) (SIL Open Font License).
- Inspirováno hrou *Words of Wonders* (Fugo Games). Tento projekt je
  nekomerční fanouškovská hra a není s Fugo Games nijak spojen.
