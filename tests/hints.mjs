// The hint economy: prices double within a level, start over in the next
// one, survive a reload, and a player who cannot pay is offered a way to
// earn rather than a dead end.
// Run with:  node tests/hints.mjs        (starts its own server on :8767)
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const stop = await serve(8767);
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
);
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8767/', { waitUntil: 'domcontentloaded' });
  page.__errors = errors;
  page.__ctx = ctx;
  return page;
}

async function startGame(page, name = 'Filip') {
  await page.waitForSelector('#np-name', { timeout: 15000 });
  await page.fill('#np-name', name);
  await page.click('#np-go');
  await page.waitForTimeout(7000);
}

// Coins can only be granted the way a player's device already holds them.
async function setCoins(page, n) {
  await page.evaluate(c => {
    const r = JSON.parse(localStorage.getItem('slovotoc-v2'));
    r.players[r.active].coins = c;
    localStorage.setItem('slovotoc-v2', JSON.stringify(r));
  }, n);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__slovotoc?.hints() != null, { timeout: 15000 });
  await page.waitForTimeout(1500);
}

const hints = page => page.evaluate(() => window.__slovotoc.hints());
const coins = page => page.evaluate(() => window.__slovotoc.state().coins);

// ---------------------------------------------------------------- 1
// Each hint in a level costs double the one before it.
{
  const page = await fresh();
  await startGame(page);
  await setCoins(page, 5000);
  const paid = [];
  for (let i = 0; i < 4; i++) {
    const before = await coins(page);
    const price = (await hints(page)).bulb;
    await page.click('#btn-bulb');
    await page.waitForTimeout(700);
    paid.push({ price, spent: before - (await coins(page)) });
  }
  const asExpected = [20, 40, 80, 160];
  const ok = paid.every((p, i) => p.price === asExpected[i] && p.spent === asExpected[i]);
  record('each hint in a level costs double the last', ok,
    paid.map(p => `${p.price}/${p.spent}`).join(' '));
  page.__page = page;
  // ------------------------------------------------------------- 2
  // …and the price starts over in the next level.
  const words = await page.evaluate(() => window.__slovotoc.level().words.map(w => w.w));
  for (const w of words) {
    await page.evaluate(x => window.__slovotoc.submit(x), w);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(3000);
  await page.click('#ov-next').catch(() => {});
  await page.waitForTimeout(2500);
  const next = await hints(page);
  record('the price starts over in the next level',
    next.bulb === 20 && next.bought === 0, `bulb ${next.bulb}, bought ${next.bought}`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 3
// Reloading mid-level must not reset the ladder to the cheap first step.
{
  const page = await fresh();
  await startGame(page);
  await setCoins(page, 5000);
  await page.click('#btn-bulb');
  await page.waitForTimeout(700);
  await page.click('#btn-bulb');
  await page.waitForTimeout(900);
  const before = await hints(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__slovotoc?.hints() != null, { timeout: 15000 });
  await page.waitForTimeout(2000);
  const after = await hints(page);
  record('reloading mid-level keeps the hint price', after.bulb === before.bulb && after.bulb === 80,
    `${before.bulb} -> ${after.bulb}`);
  record('a hint used before the reload still costs the star', after.usedHint === true,
    `usedHint=${after.usedHint}`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 4
// A free hint from the daily costs nothing and does not move the ladder.
{
  const page = await fresh();
  await startGame(page);
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('slovotoc-v2'));
    r.players[r.active].freeHints = 2;
    r.players[r.active].coins = 30;
    localStorage.setItem('slovotoc-v2', JSON.stringify(r));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__slovotoc?.hints() != null, { timeout: 15000 });
  await page.waitForTimeout(1800);
  const before = await coins(page);
  await page.click('#btn-bulb');
  await page.waitForTimeout(900);
  const after = await hints(page);
  const spent = before - (await coins(page));
  record('a free hint costs no coins and no ladder step',
    spent === 0 && after.free === 1 && after.bulb === 20 && after.bought === 0,
    `spent ${spent}, free left ${after.free}, next bulb ${after.bulb}`);
  const revealed = await page.evaluate(() => document.querySelectorAll('#grid .cell.hinted, #grid .cell.revealed').length);
  record('a free hint still reveals a letter', revealed > 0, `${revealed} cells revealed`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 5
// Too few coins: the player is shown where to earn some, not a dead end.
{
  const page = await fresh();
  await startGame(page);
  await setCoins(page, 5);
  await page.click('#btn-bulb');
  await page.waitForTimeout(900);
  const txt = await page.evaluate(() => document.querySelector('#overlay-card')?.innerText ?? '');
  const offersDaily = await page.locator('#ov-daily').count() === 1;
  const revealed = await page.evaluate(() => document.querySelectorAll('#grid .cell.hinted').length);
  record('being short of coins offers the daily challenge',
    offersDaily && /nestačí mince/i.test(txt) && revealed === 0,
    offersDaily ? 'daily offered' : txt.split('\n')[0]?.slice(0, 50));
  // and the offer must not have revealed anything or charged anything
  record('the offer neither reveals nor charges', (await coins(page)) === 5 && revealed === 0,
    `${await coins(page)} coins, ${revealed} revealed`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 6
// Finishing the daily pays a free hint.
{
  const page = await fresh();
  await startGame(page);
  await page.click('#btn-player');
  await page.waitForTimeout(1800);
  await page.click('#ov-daily');
  await page.waitForTimeout(2000);
  const words = await page.evaluate(() => window.__slovotoc.level().words.map(w => w.w));
  for (const w of words) {
    await page.evaluate(x => window.__slovotoc.submit(x), w);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(3500);
  const free = (await hints(page)).free;
  record('the daily challenge pays a free hint', free >= 1, `${free} free hint(s)`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 7
// "Levels without a hint" counts clean levels and skips hinted ones.
{
  const page = await fresh();
  await startGame(page);
  await setCoins(page, 5000);
  // level 1, clean
  let words = await page.evaluate(() => window.__slovotoc.level().words.map(w => w.w));
  for (const w of words) { await page.evaluate(x => window.__slovotoc.submit(x), w); await page.waitForTimeout(700); }
  await page.waitForTimeout(3000);
  const shown = await page.evaluate(() => document.querySelector('#overlay-card')?.innerText ?? '');
  await page.click('#ov-next');
  await page.waitForTimeout(2500);
  const afterClean = (await hints(page)).clean;
  // level 2, with a hint
  await page.click('#btn-bulb');
  await page.waitForTimeout(800);
  words = await page.evaluate(() => window.__slovotoc.level().words.map(w => w.w));
  for (const w of words) { await page.evaluate(x => window.__slovotoc.submit(x), w); await page.waitForTimeout(700); }
  await page.waitForTimeout(3000);
  await page.click('#ov-next');
  await page.waitForTimeout(2500);
  const afterHinted = (await hints(page)).clean;
  record('a clean level counts, a hinted one does not',
    afterClean === 1 && afterHinted === 1, `${afterClean} then ${afterHinted}`);
  record('the clean-level tally is shown when a level is finished clean',
    /🧠 Bez nápovědy: 1 kolo/.test(shown),
    shown.split('\n').find(l => l.includes('🧠'))?.slice(0, 60) ?? 'no 🧠 line in: ' + shown.replace(/\n/g, ' | ').slice(0, 90));
  await page.__ctx.close();
}

console.log('\n' + '='.repeat(60));
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('FAILING:\n' + failed.map(f => '  - ' + f.name).join('\n'));
await browser.close();
stop();
process.exit(failed.length ? 1 : 0);
