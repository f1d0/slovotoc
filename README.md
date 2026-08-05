# Slovotoč 🟡

Česká slovní hra ve stylu *Words of Wonders*: spojuj písmena tahem prstu,
hledej slova a vyplň křížovku. 160 úrovní v 16 balíčcích, bonusová slova,
mince a nápovědy. Bez reklam, bez účtů, bez sledování — prostě pošli
kamarádům odkaz a hrajte.

**▶ Hrát:** https://f1d0.github.io/wowczechversion/

- Funguje na mobilu i na počítači (tah prstem / tažení myší).
- Průběh hry se ukládá v prohlížeči (localStorage).
- Po prvním načtení funguje i offline (PWA — lze přidat na plochu).

## Jak hra funguje

- Ve spodním kruhu **spoj písmena tahem** a vytvoř slovo.
- Slovo z křížovky se doplní do mřížky; platné české slovo, které v křížovce
  není, se počítá jako **bonusové slovo** (⭐) — každých 10 přinese mince.
- **💡 (25 mincí)** odkryje náhodné písmeno, **🔨 (60 mincí)** odkryje
  políčko, které si vybereš. Mince dostáváš za dokončené úrovně.

## Struktura repozitáře

- `web/` — celá hra, čistý HTML/CSS/JS bez build kroku; nasazuje se na
  GitHub Pages akcí v `.github/workflows/deploy.yml`.
- `web/data/levels.json` — předgenerované úrovně (písmena, rozložení
  křížovky, bonusová slova).
- `tools/` — offline generátor úrovní (Node 18+):
  - `wordfilter.mjs` — filtr slovníku (znaky, délka, dětem přátelský obsah),
  - `generate-levels.mjs` — výběr slov + skládání křížovek.

### Přegenerování úrovní

```bash
# zdrojová data (viz Poděkování níže):
git clone --depth 1 https://github.com/filip-opalka/czech-wordlist /workspace/czech-wordlist
git clone --depth 1 --filter=blob:none --sparse https://github.com/hermitdave/FrequencyWords /workspace/freqwords
(cd /workspace/freqwords && git sparse-checkout set content/2018/cs)
curl -L -o /workspace/cs_CZ.dic https://raw.githubusercontent.com/LibreOffice/dictionaries/master/cs_CZ/cs_CZ.dic

node tools/generate-levels.mjs   # zapíše web/data/levels.json + QA výpis
```

## Poděkování / licence dat

- Český slovník: [filip-opalka/czech-wordlist](https://github.com/filip-opalka/czech-wordlist)
  (odvozeno z hunspell `cs_CZ`, GPL) a [LibreOffice dictionaries](https://github.com/LibreOffice/dictionaries) (GPL).
- Frekvenční seznam: [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
  (z korpusu OpenSubtitles, CC-BY-SA 4.0).
- Písmo: [Nunito](https://fonts.google.com/specimen/Nunito) (SIL Open Font License).
- Inspirováno hrou *Words of Wonders* (Fugo Games). Tento projekt je
  nekomerční fanouškovská hra a není s Fugo Games nijak spojen.
