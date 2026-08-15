// Plays every level in the game to the end and asserts it actually finishes.
//
//   node tests/all-levels.mjs           all 240
//   node tests/all-levels.mjs 1 40      a range
//
// Words are submitted in their BARE form, because that is the only thing a
// player can produce on the wheel. Where two answers share a bare spelling
// (věta / veta) the game must credit both from the single swipe — if it did
// not, the crossword could never be finished and the player would be walled
// in with a full-looking grid.

import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import fs from 'fs';

const FOLD = { 'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i','ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z' };
const fold = w => [...w].map(c => FOLD[c] ?? c).join('');

const data = JSON.parse(fs.readFileSync(new URL('../web/data/levels.json', import.meta.url), 'utf8'));
const levels = data.packs.flatMap(p => p.levels);

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? levels.length);
const WORKERS = Number(process.env.WORKERS ?? 6);

const stop = await serve(8765);
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

const queue = [];
for (let i = from; i <= to; i++) queue.push(i);
const failures = [];
let done = 0;

async function worker(id) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8765/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#np-name', { timeout: 20000 });
  await page.fill('#np-name', 'W' + id);
  await page.click('#np-go');
  await page.waitForFunction(() => !document.querySelector('#np-name'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  while (queue.length) {
    const n = queue.shift();
    errors.length = 0;
    // drop straight into the level rather than replaying everything before it
    await page.evaluate(i => {
      const r = JSON.parse(localStorage.getItem('slovotoc-v2'));
      const p = r.players[r.active];
      p.levelIndex = i; p.cur = null; p.coins = 100000;
      localStorage.setItem('slovotoc-v2', JSON.stringify(r));
    }, n - 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__slovotoc?.level(), null, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(300);

    const lvl = levels[n - 1];
    const bares = [...new Set(lvl.words.map(w => fold(w.w)))];
    for (const bare of bares) {
      await page.evaluate(x => window.__slovotoc.submit(x), bare);
      await page.waitForFunction(() => !window.__slovotoc.busy(), null, { timeout: 12000 }).catch(() => {});
    }
    await page.waitForTimeout(900);

    const st = await page.evaluate(() => ({
      rev: document.querySelectorAll('#grid .cell.revealed').length,
      tot: document.querySelectorAll('#grid .cell:not(.empty)').length,
      finished: !!document.getElementById('ov-next') || !!document.getElementById('ov-board'),
    }));
    if (!st.finished) {
      failures.push({ level: n, letters: lvl.letters, words: lvl.words.map(w => w.w),
        bares, revealed: `${st.rev}/${st.tot}`, errors: [...errors] });
      console.log(`FAIL L${n} (${lvl.letters}) ${st.rev}/${st.tot} — ${lvl.words.map(w=>w.w).join(' ')}${errors.length ? ' | ' + errors[0] : ''}`);
    }
    if (++done % 20 === 0) console.log(`  … ${done}/${to - from + 1}`);
  }
  await ctx.close();
}

await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));

console.log(`\n${to - from + 1} levels played, ${failures.length} could not be finished`);
for (const f of failures) {
  console.log(`\nL${f.level}  wheel=${f.letters}  revealed ${f.revealed}`);
  console.log(`  answers: ${f.words.join(', ')}`);
  console.log(`  typed:   ${f.bares.join(', ')}`);
  if (f.errors.length) console.log(`  errors:  ${f.errors.join(' | ')}`);
}
await browser.close();
stop();
process.exit(failures.length ? 1 : 0);
