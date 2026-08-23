// The leaderboard's second life: one number at a time, a card per player,
// the changelog, and the two ways the new database columns can be missing.
// Run with:  node tests/board.mjs        (starts its own server on :8768)
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const stop = await serve(8768);
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
);
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const ROWS = [
  { name:'Šárka', avatar:'🦄', levels:73, bonus:1503, coins:3805, stars:181, streak:12, clean:40, clean_best:9, device_id:'a' },
  { name:'Hana',  avatar:'🐬', levels:30, bonus:640,  coins:1941, stars:74,  streak:4,  clean:18, clean_best:5, device_id:'b' },
  { name:'Týnka', avatar:'🐝', levels:22, bonus:410,  coins:1307, stars:55,  streak:2,  clean:12, clean_best:4, device_id:'c' },
];

// A player who was already playing when all this changed: their save has no
// seenNews, no freeHints and no clean fields.
const OLD_SAVE = {
  v: 2, sound: true, active: 'Filip', deviceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  players: { Filip: {
    name: 'Filip', avatar: '🦊', coins: 300, levelIndex: 12, best: 12, bonusTotal: 214,
    stars: { 0:3, 1:2, 2:1, 3:2, 4:2, 5:2, 6:3, 7:1, 8:2, 9:2, 10:2, 11:3 },
    daily: null, sawTip: true, pin: null, pinAsked: true, cur: null, createdAt: 1,
  } },
};

async function open({ save = OLD_SAVE, supabase, width = 360 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(u => u.hostname.includes('supabase'),
    supabase ?? (r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) })));
  // Seed once: this runs on every navigation, so writing unconditionally
  // would undo whatever the game saved before a reload.
  if (save) await page.addInitScript(s => {
    if (!localStorage.getItem('slovotoc-v2')) localStorage.setItem('slovotoc-v2', s);
  }, JSON.stringify(save));
  await page.goto('http://localhost:8768/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__slovotoc != null, { timeout: 20000 });
  await page.waitForTimeout(4000);
  page.__errors = errors;
  page.__ctx = ctx;
  return page;
}

const dismissNews = async page => {
  if (await page.locator('#ov-back').count()) { await page.click('#ov-back'); await page.waitForTimeout(500); }
};
const openBoard = async page => {
  await dismissNews(page);
  await page.click('#btn-player');
  await page.waitForTimeout(7000);
};

// ---------------------------------------------------------------- 1
// One number per row, and names are never cut short.
{
  const page = await open();
  await openBoard(page);
  const st = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.board-row[data-name]')];
    return {
      numbers: rows[0] ? rows[0].querySelectorAll('span').length : -1,
      names: rows.map(r => r.querySelector('b').textContent.trim()),
      clipped: rows.some(r => { const b = r.querySelector('b'); return b.scrollWidth > b.clientWidth + 1; }),
    };
  });
  record('a board row carries exactly one number', st.numbers === 1, `${st.numbers} value column(s)`);
  record('no name is truncated on a 360px phone', !st.clipped, st.names.join(', '));
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 2
// Choosing a metric re-sorts the board and relabels the column.
{
  const page = await open();
  await openBoard(page);
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('.board-row[data-name]')].map(r => r.dataset.name));
  await page.click('.chip[data-m="bonus"]');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    order: [...document.querySelectorAll('.board-row[data-name]')].map(r => r.dataset.name),
    head: document.querySelector('.board-head span').textContent,
    top: document.querySelector('.board-row[data-name] span').textContent,
  }));
  record('picking a metric re-sorts and relabels', after.head === 'Slova' && after.top === '1503',
    `${before[0]} by levels, ${after.order[0]} by bonus words (${after.top})`);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 3
// A row opens that player's numbers, including the ones taken off the row.
{
  const page = await open();
  await openBoard(page);
  await page.click('.board-row[data-name="Šárka"]');
  await page.waitForTimeout(700);
  const card = await page.innerText('#overlay-card');
  const has = s => card.includes(s);
  record('a row opens the player\'s full numbers',
    has('Šárka') && has('1503') && has('40') && has('12') && has('3805'),
    card.replace(/\n+/g, ' | ').slice(0, 90));
  await page.click('#ov-back');
  await page.waitForTimeout(2000);
  record('the card goes back to the board',
    await page.locator('.board-row[data-name]').count() > 0);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 4
// The changelog: once for someone already playing, never again after that,
// and never for somebody who has just started.
{
  const page = await open();
  const shown = await page.evaluate(() => document.querySelector('#overlay-card')?.innerText ?? '');
  record('an existing player is shown what changed', /Co je nového/.test(shown),
    shown.split('\n')[0]?.slice(0, 40));
  await page.click('#ov-back');
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__slovotoc != null, { timeout: 20000 });
  await page.waitForTimeout(4000);
  const again = await page.evaluate(() => document.querySelector('#overlay')?.classList.contains('hidden'));
  record('and not shown again on the next launch', again === true);
  await page.__ctx.close();
}
{
  const page = await open({ save: null });
  await page.waitForSelector('#np-name', { timeout: 15000 });
  await page.fill('#np-name', 'Nováček');
  await page.click('#np-go');
  await page.waitForTimeout(8000);
  const txt = await page.evaluate(() => document.querySelector('#overlay-card')?.innerText ?? '');
  record('a brand-new player is not shown a changelog', !/Co je nového/.test(txt),
    txt.split('\n')[0]?.slice(0, 40) || 'no overlay');
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 5
// The no-hint numbers actually reach the database call.
{
  let saved = null;
  const page = await open({
    supabase: async r => {
      const url = r.request().url();
      if (url.includes('rpc/save_score')) {
        saved = JSON.parse(r.request().postData() ?? '{}');
        return r.fulfill({ status: 200, contentType: 'application/json', body: '"updated"' });
      }
      if (url.includes('rpc/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) });
    },
  });
  await openBoard(page);
  await page.waitForTimeout(2000);
  record('the score write carries the no-hint numbers',
    saved != null && saved.p_clean === 10 && saved.p_clean_best === 4,
    saved ? `clean=${saved.p_clean}, best=${saved.p_clean_best}` : 'no save_score call seen');
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 6
// …and if the SQL has not been run yet, the write must still go through
// without them rather than failing for everybody.
{
  const sent = [];
  const page = await open({
    supabase: async r => {
      const url = r.request().url();
      if (url.includes('rpc/save_score')) {
        const body = JSON.parse(r.request().postData() ?? '{}');
        sent.push(body);
        if ('p_clean' in body) {
          return r.fulfill({ status: 404, contentType: 'application/json',
            body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.save_score(p_clean, ...)' }) });
        }
        return r.fulfill({ status: 200, contentType: 'application/json', body: '"updated"' });
      }
      if (url.includes('rpc/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) });
    },
  });
  await openBoard(page);
  await page.waitForTimeout(2500);
  const retried = sent.length >= 2 && !('p_clean' in sent[sent.length - 1]);
  record('an un-migrated database still gets the score',
    retried || sent.length === 0 ? retried : false,
    sent.map(b => ('p_clean' in b ? 'with clean' : 'without clean')).join(' -> ') || 'nothing sent');
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 7
// Reporting a word: one tap, straight to the database, no GitHub anywhere.
{
  let sent = null, sentUrl = null;
  const page = await open({
    supabase: async r => {
      if (r.request().url().includes('word_reports')) {
        sentUrl = r.request().url();
        sent = JSON.parse(r.request().postData() ?? '[]')[0];
        return r.fulfill({ status: 201, contentType: 'application/json', body: '' });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) });
    },
  });
  await dismissNews(page);
  const word = await page.evaluate(() => window.__slovotoc.level().words[0].w);
  await page.evaluate(w => window.__slovotoc.submit(w), word);
  await page.waitForTimeout(1500);
  await page.click('#btn-report');
  await page.waitForTimeout(700);
  const card = await page.innerText('#overlay-card');
  record('the report screen no longer mentions GitHub', !/GitHub/i.test(card),
    card.split('\n').slice(-1)[0]?.slice(0, 50));
  await page.click('#rep-send');
  await page.waitForTimeout(1500);
  record('reporting a word writes it to the database',
    sent != null && sent.word === word && sent.kind === 'wrong' && sent.player === 'Filip',
    sent ? JSON.stringify(sent) : 'nothing sent');
  // An upsert would name device_id as the conflict target, and naming it
  // means being able to read it — which the public key must not.
  record('the report is a plain insert, not an upsert',
    sentUrl != null && !sentUrl.includes('on_conflict'),
    sentUrl?.split('/rest/v1/')[1] ?? 'no request');
  const closed = await page.evaluate(() => document.querySelector('#overlay').classList.contains('hidden'));
  record('and closes with a thank-you', closed);
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 8
// Reporting the same word twice from one phone answers 409, and that is a
// success, not a failure the player should ever see.
{
  const page = await open({
    supabase: async r => r.request().url().includes('word_reports')
      ? r.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint' }) })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) }),
  });
  await dismissNews(page);
  const word = await page.evaluate(() => window.__slovotoc.level().words[0].w);
  await page.evaluate(w => window.__slovotoc.submit(w), word);
  await page.waitForTimeout(1500);
  await page.click('#btn-report');
  await page.waitForTimeout(700);
  await page.click('#rep-send');
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({
    closed: document.querySelector('#overlay').classList.contains('hidden'),
    toast: document.querySelector('#toast')?.textContent ?? '',
  }));
  record('reporting the same word twice still says thank you',
    st.closed && /Díky/.test(st.toast), `${st.toast}`.slice(0, 50));
  await page.__ctx.close();
}

// ---------------------------------------------------------------- 9
// …and if the table is not there yet, the report is not simply lost.
{
  const page = await open({
    supabase: async r => r.request().url().includes('word_reports')
      ? r.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) }),
  });
  await dismissNews(page);
  const word = await page.evaluate(() => window.__slovotoc.level().words[0].w);
  await page.evaluate(w => window.__slovotoc.submit(w), word);
  await page.waitForTimeout(1500);
  await page.click('#btn-report');
  await page.waitForTimeout(700);
  await page.click('#rep-send');
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({
    open: !document.querySelector('#overlay').classList.contains('hidden'),
    btn: document.querySelector('#rep-send')?.textContent,
    toast: document.querySelector('#toast')?.textContent ?? '',
  }));
  record('a failed report says so and can be retried',
    st.open && /znovu/i.test(st.btn ?? '') && /nepovedlo/i.test(st.toast),
    `${st.btn} · ${st.toast}`.slice(0, 70));
  await page.__ctx.close();
}

console.log('\n' + '='.repeat(60));
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('FAILING:\n' + failed.map(f => '  - ' + f.name).join('\n'));
await browser.close();
stop();
process.exit(failed.length ? 1 : 0);
