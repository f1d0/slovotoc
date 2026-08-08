// Edge-case suite: each case tries to break the game the way a real player,
// a flaky network or a hostile leaderboard row could.
// Run with:  node tests/edge.mjs        (starts its own server on :8765)
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const stop = await serve(8765);
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
);
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function fresh({ route, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (init) await page.addInitScript(init);
  if (route) await page.route('**/*', route);
  await page.goto('http://localhost:8765/', { waitUntil: 'domcontentloaded' });
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

// ---------------------------------------------------------------- 1
// A hint tapped while the winning word is still flying: the fly animation
// finishes on an already-completed level and the reward lands twice.
{
  const page = await fresh();
  await startGame(page);
  await page.evaluate(() => { window.__slovotoc.setCoins?.(9999); });
  const words = await page.evaluate(() => window.__slovotoc.level().words.map(w => w.w));
  for (const w of words.slice(0, -1)) {
    await page.evaluate(x => window.__slovotoc.submit(x), w);
    await page.waitForTimeout(800);
  }
  const before = await page.evaluate(() => window.__slovotoc.state());
  await page.evaluate(x => window.__slovotoc.submit(x), words[words.length - 1]);
  await page.waitForTimeout(60);                 // mid-flight
  for (let i = 0; i < 6; i++) { await page.click('#btn-bulb', { force: true }).catch(() => {}); await page.waitForTimeout(40); }
  await page.waitForTimeout(3500);
  const after = await page.evaluate(() => window.__slovotoc.state());
  const advanced = after.level - before.level;
  record('hint during the winning animation does not double-complete',
    advanced === 1, `level ${before.level} -> ${after.level}`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 2
// Reopening a finished game must not keep paying out.
{
  const page = await fresh();
  await startGame(page);
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('slovotoc-v2'));
    const p = r.players[r.active];
    p.levelIndex = 240; p.best = 240; p.coins = 500;
    localStorage.setItem('slovotoc-v2', JSON.stringify(r));
  });
  const coins = [];
  for (let i = 0; i < 3; i++) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__slovotoc?.state().coins != null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    coins.push(await page.evaluate(() => window.__slovotoc.state().coins));
  }
  record('finished game does not mint coins on every reload',
    coins[0] === coins[1] && coins[1] === coins[2], `coins ${coins.join(' -> ')}`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 3
// A leaderboard row is remote data. Its avatar field must not become markup.
{
  const page = await fresh({
    route: async (r) => {
      if (r.request().url().includes('supabase')) {
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
          { name: 'Mallory', avatar: '<img src=x onerror="window.__pwned=1">', levels: 5,
            bonus: 1, coins: 1, stars: 1, streak: 0, device_id: 'x' },
        ]) });
      }
      return r.continue();
    },
  });
  await startGame(page);
  await page.click('#btn-player');
  await page.waitForTimeout(2500);
  const pwned = await page.evaluate(() => !!window.__pwned);
  const shown = await page.evaluate(() => document.querySelector('#board-box')?.innerText ?? '');
  record('leaderboard avatar cannot inject markup', !pwned,
    pwned ? 'script executed' : 'rendered as text: ' + shown.split('\n')[1]?.slice(0, 40));
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 4
// First launch on a dead network: the player must be told, not left staring
// at an empty screen.
{
  const page = await fresh({
    route: async (r) => r.request().url().includes('levels.json')
      ? r.abort('failed') : r.continue(),
  });
  await page.waitForTimeout(6000);
  const txt = await page.evaluate(() => document.body.innerText.trim());
  const hasMessage = txt.length > 0 && /nepodařilo|chyba|zkus|připoj/i.test(txt);
  record('level data failing to load shows a message', hasMessage,
    hasMessage ? txt.split('\n')[0].slice(0, 60) : `blank screen (${txt.length} chars)`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 5
// Leaving the daily challenge while letters are still flying must not let
// the animation land on the level that replaced it.
{
  const page = await fresh();
  await startGame(page);
  await page.click('#btn-player');
  await page.waitForTimeout(1500);
  await page.click('#ov-daily');
  await page.waitForTimeout(1500);
  const w = await page.evaluate(() => window.__slovotoc.level().words[0].w);
  await page.evaluate(x => window.__slovotoc.submit(x), w);
  await page.waitForTimeout(60);
  await page.click('#btn-exit-daily');
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => ({
    revealed: document.querySelectorAll('#grid .cell.revealed').length,
    found: window.__slovotoc.state().found.length,
  }));
  record('leaving the daily mid-animation leaves a clean board',
    st.revealed === 0 && st.found === 0,
    `${st.revealed} revealed cells, ${st.found} found words on the campaign level`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 6
// Private browsing: localStorage throws on write. The game should still play.
{
  const page = await fresh({
    init: () => {
      const ls = window.localStorage;
      Object.defineProperty(window, 'localStorage', { configurable: true, value: {
        getItem: k => ls.getItem(k),
        setItem: () => { throw new DOMException('QuotaExceededError'); },
        removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
      } });
    },
  });
  let ok = true, why = '';
  try {
    await startGame(page);
    const w = await page.evaluate(() => window.__slovotoc.level().words[0].w);
    await page.evaluate(x => window.__slovotoc.submit(x), w);
    await page.waitForTimeout(1500);
    const found = await page.evaluate(() => window.__slovotoc.state().found.length);
    ok = found === 1;
    why = `${found} word(s) accepted`;
  } catch (e) { ok = false; why = e.message.slice(0, 60); }
  record('game is playable with localStorage blocked', ok, why);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 7
// Whitespace-only and over-long names.
{
  const page = await fresh();
  await page.waitForSelector('#np-name');
  await page.fill('#np-name', '   ');
  await page.click('#np-go');
  await page.waitForTimeout(1200);
  const stillPicking = await page.locator('#np-name').count() === 1;
  record('a blank name does not start a game', stillPicking);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 8
// The same word submitted twice in quick succession.
{
  const page = await fresh();
  await startGame(page);
  const w = await page.evaluate(() => window.__slovotoc.level().words[0].w);
  await page.evaluate(x => { window.__slovotoc.submit(x); window.__slovotoc.submit(x); }, w);
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => window.__slovotoc.state());
  record('double submit of one word counts once',
    st.found.length === 1, `found=${JSON.stringify(st.found)}`);
  await page.__ctx.close();
}

console.log('\n' + '='.repeat(60));
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('FAILING:\n' + failed.map(f => '  - ' + f.name).join('\n'));
await browser.close();
stop();
process.exit(failed.length ? 1 : 0);
