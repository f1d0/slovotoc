# Návrh: diakritika jako herní mechanika

Cíl: dát Slovotoči vlastní mechaniku, kterou anglická hra ze své podstaty mít
nemůže — a tím ho odlišit od Words of Wonders na úrovni pravidel, ne jen
grafiky.

## 1. Co říkají data

Změřeno na slovníku hry (32 807 lemmat, 10 002 běžných slov nad prahem
frekvence 150):

| Zjištění | Hodnota | Co z toho plyne |
|---|---|---|
| slov s háčkem/čárkou | **62 %** | mechanika se uplatní skoro pořád, ne okrajově |
| slov, kde holý tvar nestačí (kolize) | **3 %** | nejednoznačnost je vzácná → nemusí hru brzdit |
| kolizních dvojic mezi běžnými slovy | 148 | *může/muže, pan/pán, rada/řada, jež/jez, pas/pás, tvář/tvar, přát/prát, čtvrt/čtvrť, vina/vína, pero/péro* |
| písmen s diakritikou na dnešních kolečkách | jen 11 % | dnes je diakritika spíš překážka než téma |
| úrovní bez jediné diakritiky na kolečku | 110 z 240 | skoro polovina hry se češtiny vůbec nedotkne |

Klíčový test — kolečko **K, R, I, D, L, O** (holá písmena):

* dnes (písmena přesně jak jsou): **11 slov**
* s možností nasadit háčky a čárky: **19 slov** — přibude
  *křídlo, dílo, díl, loď, kód, lídr, orlí, dík*

**Kolečko z holých písmen tedy zhruba zdvojnásobí zásobu slov.** To je samo o
sobě velká výhoda: stejně bohatá křížovka vyjde z menšího počtu dlaždic, což
se na mobilu ovládá mnohem líp.

## 2. Jádro mechaniky

Na kolečku jsou **holá písmena** (K, R, I, D, L, O) a k nim **modifikátory**:

| Dlaždice | Co dělá | Písmena |
|---|---|---|
| **´** čárka | prodlouží následující písmeno | á é í ó ú ý |
| **ˇ** háček | změkčí následující písmeno | č ď ě ň ř š ť ž |
| **°** kroužek | jen pro u | ů |

Modifikátor se táhne **před** písmenem, kterého se týká, jedním plynulým
tahem:

```
K → ˇ → R → ´ → I → D → L → O     =  KŘÍDLO
```

Pravidla:

* modifikátory jsou **opakovaně použitelné** v rámci jednoho slova
  (ŠŤASTNÝ = ˇS ˇT A S T N ´Y), písmena zůstávají na jedno použití;
* když modifikátor nesedí na následující písmeno (´ a potom K), **tiše
  odpadne** — žádná chyba, jen se dlaždice zatřese;
* kroužek se na kolečku objeví jen tehdy, když je mezi písmeny **u**.

Proč zrovna takhle: nepřidává to nový druh ovládání. Zůstává jeden tah
prstem, jen má víc zastávek. Pilulka nahoře přitom průběžně ukazuje
`K → KŘ → KŘÍ → …`, takže je pořád vidět, co se děje.

### Zvažované alternativy (a proč ne)

| Varianta | Proč ne |
|---|---|
| dvojitý prstenec (vnitřek písmeno, vnějšek s háčkem) | na mobilu moc malé cíle, a nefunguje pro e (é/ě) a u (ú/ů) |
| švihnutí od středu | totéž + kolize s tahem po kolečku |
| doplnění háčků až dodatečně v pilulce | rozbíjí plynulost, přidává krok ke *každému* slovu |

## 3. Dva režimy obtížnosti

Aby hra zůstala hratelná pro děti i pro pravopisné puristy:

* **Klasik** (výchozí) — háčky a čárky jsou nepovinné. Když holý tvar
  odpovídá právě jednomu slovu, hra ho uzná a diakritiku sama „docvakne"
  animací (učící moment zdarma). Nejednoznačné případy (*může / muže*) se
  zeptají, které slovo hráč myslel — přesně tam, kde je čeština zajímavá.
* **Pravopis** — diakritika povinná. Za slovo napsané správně hned napoprvé
  je bonus k mincím a **třetí hvězda se dá získat jen v tomto režimu**.

Data to podporují: v Klasiku se hráč zdrží jen u 3 % slov, takže tempo hry
neutrpí.

## 4. Dopad na generátor úrovní

Změna je menší, než vypadá:

1. Kolečko = **složené (holé) písmenné složení** základního slova.
2. Slovo lze složit, pokud jeho holý tvar sedí do holého složení kolečka —
   tedy porovnávat přes `fold()`, ne přes přesné znaky.
3. Do křížovky se ukládá **plný tvar s diakritikou** (KŘÍDLO), do mřížky se
   vykresluje s háčky a čárkami.
4. Protože slov přibude zhruba dvojnásobek, jde **zmenšit kolečka** o jednu
   dlaždici při zachování počtu slov (7 písmen místo 8) — na telefonu velká
   úleva.
5. Odpadá dnešní problém, že polovina úrovní diakritiku vůbec nepotká: i
   z holého KRIDLO vypadne *křídlo, dílo, loď, kód*.

## 5. Napojení na zbytek hry

* **Nápověda „háček"** (nová, levná) — ukáže, na kterých políčkách v mřížce
  je diakritika, ale neprozradí písmeno.
* **Hvězdy** — třetí hvězda za dokončení úrovně v režimu Pravopis.
* **Denní výzva** — mohla by jet vždy v režimu Pravopis, aby měli všichni
  stejné podmínky.
* **Bonusová slova** — beze změny, jen se jich přirozeně nabídne víc.

## 6. Proč to řeší tu původní obavu

Herní pravidla se autorským právem obecně nechrání, takže dnešní podoba není
právní problém; potíž je reputační („jen český klon"). Diakritická vrstva je
mechanika, kterou **anglicky psaná hra nemůže převzít**, protože v angličtině
nemá co dělat. Sedí i k názvu — ve Slovotoči se točí nejen slova, ale i
písmeno na Ř. Marketingově navíc otevírá směr, který WOW nemá vůbec:
*hra, která mimochodem učí háčky a čárky* (rodiče, školy).

## 7. Rizika

* **Delší tah** — z 6 zastávek na 8. Nutno vyzkoušet na telefonu; kdyby to
  vadilo, pomůže větší kolečko nebo „lepivější" trefování dlaždic.
* **Nechtěné modifikátory** při rychlém tahu → proto tiché odpadnutí místo
  chyby.
* **Přegenerování úrovní** — hádanky se opět změní. Postup, mince ani
  žebříček se neztratí, ale hráči poznají, že mají jiná zadání.
* **Děti** — proto je Klasik výchozí a Pravopis dobrovolný.

## 8. Postup

1. **Prototyp ovládání** na jedné úrovni za přepínačem — jen si osahat tah
   `K → ˇ → R → ´ → I`. Bez toho nemá cenu měnit data.
2. Playtest ve dvou lidech: sedí to prstem? Není tah moc dlouhý?
3. Teprve pak `fold()` v generátoru + přegenerování úrovní.
4. Režimy, hvězdy, nápověda „háček".
5. Playtest s partou, a teprve potom případná plnohodnotná aplikace.

## 9. Otevřené otázky

* Má být výchozí **Klasik**, nebo rovnou Pravopis?
* **Kroužek** samostatnou dlaždicí, nebo jako „čárka dvakrát"?
* Mají být modifikátory opakovaně použitelné (návrh: **ano**)?
* Zmenšit kolečka o jednu dlaždici, když slov přibude?
