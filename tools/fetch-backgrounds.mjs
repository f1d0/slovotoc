// Fetch a freely licensed photo for each level pack from Wikimedia Commons
// and turn it into a small, pre-blurred background image.
//
// Blurring happens here (not in CSS) so phones don't pay for a fullscreen
// filter every frame, and because a blurred JPEG compresses to a few kB.
//
// Writes: web/assets/bg/<slug>.jpg and web/data/photo-credits.json
// Usage:  node tools/fetch-backgrounds.mjs

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'web', 'assets', 'bg');
const CREDITS = join(__dirname, '..', 'web', 'data', 'photo-credits.json');
// Originals are cached outside the repo so the look can be re-tuned
// (blur/brightness) without hitting Commons again.
const SRC_DIR = process.env.BG_SRC ?? '/workspace/bg-src';

// pack slug -> Wikipedia articles whose lead image is the iconic view
// (tried first, in order), plus Commons search terms as a fallback.
const WANTED = {
  'lazne-bohdanec': { articles: ['Lázně Bohdaneč'], terms: ['Lázně Bohdaneč radnice'] },
  'kuneticka-hora': { articles: ['Kunětická hora (hrad)', 'Kunětická hora'], terms: ['Kunětická hora hrad'] },
  'lanskroun': { articles: ['Lanškroun'], terms: ['Lanškroun náměstí'] },
  'karlstejn': { articles: ['Karlštejn (hrad)'], terms: ['Karlštejn hrad', 'Karlstejn castle view'] },
  'uvaly': { articles: ['Úvaly (okres Praha-východ)', 'Úvaly'], terms: ['Úvaly náměstí Arnošta z Pardubic'] },
  'kutna-hora': { articles: ['Chrám svaté Barbory', 'Kutná Hora'], terms: ['Kutna Hora Saint Barbara church', 'Kutná Hora panorama'] },
  'celakovice': { articles: ['Čelákovice'], terms: ['Čelákovice tvrz muzeum'] },
  'cesky-krumlov': { articles: ['Český Krumlov'], terms: ['Český Krumlov panorama'] },
  'hradek-oplatil': { articles: ['Oplatil'], terms: ['Písník Oplatil', 'Staré Ždánice písník'] },
  'adrspach': { articles: ['Adršpašsko-teplické skály', 'Adršpašské skály'], terms: ['Adršpašské skály'] },
  'komorany': { articles: ['Komořany (Praha)'], terms: ['Komořanské a modřanské tůně', 'Zámek Komořany Praha'] },
  'telc': { articles: ['Telč'], terms: ['Telč náměstí Zachariáše z Hradce'] },
  'macocha': { articles: ['Macocha'], terms: ['Propast Macocha'] },
  'hluboka': { articles: ['Hluboká (zámek)', 'Hluboká nad Vltavou'], terms: ['Hluboka castle', 'Zámek Hluboká nad Vltavou pohled'] },
  'lednice': { articles: ['Lednice (zámek)', 'Lednice'], terms: ['Zámek Lednice'] },
  'snezka': { articles: ['Sněžka'], terms: ['Sněžka vrchol léto', 'Snezka summer'] },
  'pravcicka-brana': { articles: ['Pravčická brána'], terms: ['Pravčická brána'] },
  'trosky': { articles: ['Trosky (hrad)', 'Trosky'], terms: ['Hrad Trosky'] },
  'jested': { articles: ['Ještěd'], terms: ['Ještěd vysílač hotel'] },
  'spilberk': { articles: ['Špilberk'], terms: ['Hrad Špilberk Brno'] },
  'karlovy-vary': { articles: ['Karlovy Vary'], terms: ['Karlovy Vary kolonáda'] },
  'olomouc': { articles: ['Sloup Nejsvětější Trojice', 'Olomouc'], terms: ['Olomouc Horní náměstí'] },
  'pernstejn': { articles: ['Pernštejn (hrad)', 'Pernštejn'], terms: ['Hrad Pernštejn'] },
  'litomysl': { articles: ['Zámek Litomyšl', 'Litomyšl'], terms: ['Zámek Litomyšl'] },
};

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'SlovotocBackgroundFetcher/1.0 (hobby word game; contact via github.com/f1d0/wowczechversion)';

// licences we accept: public domain and CC variants (attribution recorded)
const OK_LICENSE = /^(cc0|cc[- ]by([- ]sa)?([- ]\d(\.\d)?)?|public domain|pd\b)/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Commons rate-limits bursts (HTTP 429), so requests are spaced out and
// retried with a growing backoff.
async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (res.status !== 429) throw new Error(`commons ${res.status}`);
    const wait = Number(res.headers.get('retry-after')) * 1000 || 4000 * (attempt + 1);
    console.error(`   …rate limited, čekám ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
  throw new Error('commons 429 (vyčerpány pokusy)');
}

function plain(html) {
  return (html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// The lead image of a Wikipedia article is almost always the iconic view of
// the place, unlike a fulltext search which happily returns a bus stop.
async function findViaArticle(articles) {
  for (const article of articles) {
    const wiki = `https://cs.wikipedia.org/w/api.php?${new URLSearchParams({
      format: 'json', origin: '*', action: 'query', prop: 'pageimages',
      piprop: 'original', titles: article,
    })}`;
    const res = await fetch(wiki, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const data = await res.json();
    const page = Object.values(data?.query?.pages ?? {})[0];
    const src = page?.original?.source;
    if (!src) continue;
    const file = decodeURIComponent(src.split('/').pop());
    // pull licence/author for that exact file from Commons
    const info = await api({
      action: 'query', titles: `File:${file}`,
      prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1000',
    });
    const ii = Object.values(info?.query?.pages ?? {})[0]?.imageinfo?.[0];
    if (!ii) continue;
    const license = plain(ii.extmetadata?.LicenseShortName?.value);
    if (!OK_LICENSE.test(license)) continue;
    const buf = await download(ii.thumburl ?? ii.url);
    if (!(await looksGood(buf))) continue;
    return {
      buf,
      page: ii.descriptionurl,
      author: plain(ii.extmetadata?.Artist?.value) || 'neuveden',
      license: license || 'neuvedena',
      title: plain(ii.extmetadata?.ObjectName?.value) || article,
      term: `článek: ${article}`,
    };
  }
  return null;
}

async function findPhoto(terms) {
  for (const term of terms) {
    const data = await api({
      action: 'query',
      generator: 'search',
      gsrsearch: `filetype:bitmap ${term}`,
      gsrnamespace: '6',
      gsrlimit: '12',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|size|mime',
      iiurlwidth: '1000',
    });
    const pages = Object.values(data?.query?.pages ?? {});
    const candidates = pages
      .map(p => p.imageinfo?.[0])
      .filter(Boolean)
      .filter(ii => /jpeg|png/.test(ii.mime ?? ''))
      .filter(ii => (ii.width ?? 0) >= 800 && ii.width >= ii.height) // landscape
      .filter(ii => {
        const lic = plain(ii.extmetadata?.LicenseShortName?.value);
        return OK_LICENSE.test(lic);
      });
    await sleep(1200);
    for (const ii of candidates.slice(0, 6)) {
      const buf = await download(ii.thumburl ?? ii.url);
      if (!(await looksGood(buf))) continue;
      return {
        buf,
        page: ii.descriptionurl,
        author: plain(ii.extmetadata?.Artist?.value) || 'neuveden',
        license: plain(ii.extmetadata?.LicenseShortName?.value) || 'neuvedena',
        title: plain(ii.extmetadata?.ObjectName?.value) || term,
        term,
      };
    }
  }
  return null;
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Reject black-and-white photos and flat ones (whiteout, empty sky) – as a
// faint backdrop they read as a grey smudge rather than a place.
async function looksGood(buf) {
  try {
    const { channels } = await sharp(buf).stats();
    if (channels.length < 3) return false;
    const [r, g, b] = channels;
    const colourSpread = (Math.abs(r.mean - g.mean) + Math.abs(g.mean - b.mean) + Math.abs(r.mean - b.mean)) / 3;
    const detail = (r.stdev + g.stdev + b.stdev) / 3;
    return colourSpread >= 4 && detail >= 28;
  } catch {
    return false;
  }
}

// Softened just enough to sit behind the puzzle, but sharp enough that the
// place stays recognisable — readability is handled by the tiles, not by
// blurring the photo into a smudge.
async function makeBackground(buf, outPath) {
  await sharp(buf)
    .resize(1000, 1550, { fit: 'cover', position: 'attention' })
    .blur(4)
    .modulate({ brightness: 0.9, saturation: 1.05 })
    .jpeg({ quality: 68, progressive: true })
    .toFile(outPath);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(SRC_DIR, { recursive: true });
// resume: keep what previous runs already produced
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {};

for (const [slug, { articles, terms }] of Object.entries(WANTED)) {
  const out = join(OUT_DIR, `${slug}.jpg`);
  const src = join(SRC_DIR, `${slug}.jpg`);
  // cached original → just re-render, no network
  if (credits[slug] && existsSync(src)) {
    await makeBackground(readFileSync(src), out);
    console.error(`· ${slug}: přegenerováno z cache`);
    continue;
  }
  if (credits[slug] && existsSync(out)) {
    console.error(`· ${slug}: hotovo (bez originálu v cache), přeskakuji`);
    continue;
  }
  try {
    await sleep(2500); // be gentle with the Commons API
    const found = (await findViaArticle(articles)) ?? (await findPhoto(terms));
    if (!found) { console.error(`✗ ${slug}: no suitable photo`); continue; }
    writeFileSync(src, found.buf);
    await makeBackground(found.buf, out);
    credits[slug] = {
      title: found.title,
      author: found.author,
      license: found.license,
      page: found.page,
    };
    console.error(`✓ ${slug}  [${found.term}]  ${found.license} — ${found.author.slice(0, 40)}`);
  } catch (e) {
    console.error(`✗ ${slug}: ${e.message}`);
  }
}

writeFileSync(CREDITS, JSON.stringify(credits, null, 2));
console.error(`\nWrote ${Object.keys(credits).length} backgrounds + ${CREDITS}`);
