import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const stop = await serve(8765);
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const out = [];
const rec = (n, ok, d) => { out.push({n, ok}); console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); };

// Stands in for the database functions so the whole flow can be exercised
// without a live Supabase behind it.
const fakeDb = (rows) => async route => {
  const u = route.request().url();
  if (!u.includes('supabase')) return route.continue();
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
  const json = d => route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(d) });
  if (u.includes('/rpc/player_status')) {
    const r = rows[body.p_name];
    return json([{ taken: !!r, locked: !!(r && r.pin), levels: r?.levels ?? 0, avatar: r?.avatar ?? null }]);
  }
  if (u.includes('/rpc/sign_in')) {
    const r = rows[body.p_name];
    if (!r) return json([{ ok:false, reason:'unknown' }]);
    if (r.pin && body.p_pin !== r.pin) return json([{ ok:false, reason:'wrong', hint:r.hint ?? null }]);
    return json([{ ok:true, reason: r.pin?'ok':'nopin', hint:r.hint??null, avatar:r.avatar,
                   levels:r.levels, bonus:r.bonus??0, coins:r.coins??0, stars:r.stars??0, streak:0 }]);
  }
  if (u.includes('/rpc/set_pin')) {
    rows[body.p_name] ??= { levels: 0, avatar: '🦊' };   // the row is created by save_score in reality
    rows[body.p_name].pin = body.p_new_pin;
    rows[body.p_name].hint = body.p_hint;
    return json('ok');
  }
  if (u.includes('/rpc/save_score')) {
    const r = rows[body.p_name];
    if (r && r.pin && body.p_pin !== r.pin) return route.fulfill({status:400, body:'wrong pin'});
    return json('ok');
  }
  if (u.includes('leaderboard')) {
    const m = /name=eq\.([^&]+)/.exec(u);
    if (m) { const r = rows[decodeURIComponent(m[1])]; return json(r ? [{name:decodeURIComponent(m[1]), ...r}] : []); }
    return json(Object.entries(rows).map(([name,r])=>({name, ...r})));
  }
  return json([]);
};

async function page(rows) {
  const ctx = await b.newContext({ viewport:{width:430,height:932}, hasTouch:true, isMobile:true });
  const p = await ctx.newPage();
  p.on('pageerror', e => out.push({n:'PAGEERROR '+e.message, ok:false}));
  await p.route('**/*', fakeDb(rows));
  await p.goto('http://localhost:8765/', { waitUntil:'domcontentloaded' });
  await p.evaluate(()=>localStorage.clear());
  await p.reload({ waitUntil:'domcontentloaded' });
  await p.waitForSelector('#np-name', {timeout:20000});
  p.__ctx = ctx; return p;
}
const type = async (p, n) => { await p.fill('#np-name', n); await p.click('#np-go'); await p.waitForTimeout(1400); };
// A returning player is shown what has changed since they last played, and
// that card sits over the game until they acknowledge it.
const closeNews = async p => {
  if (await p.locator('#ov-back').count()) { await p.click('#ov-back'); await p.waitForTimeout(500); }
};

// 1. free name just works
{ const p = await page({}); await type(p,'Nováček'); await p.waitForTimeout(6000);
  rec('volné jméno se založí', await p.evaluate(()=>window.__slovotoc?.state().player)==='Nováček');
  await p.__ctx.close(); }

// 2. locked name asks for the PIN, and a wrong one is refused + shows the hint
{ const p = await page({ 'Šárka': {pin:'1234', hint:'pes', levels:71, avatar:'🦊'} });
  await type(p,'Šárka');
  const asked = await p.locator('#pin-in').count()===1;
  await p.fill('#pin-in','9999'); await p.click('#pin-go'); await p.waitForTimeout(900);
  const msg = await p.textContent('#pin-msg').catch(()=>'');
  const inGame = await p.evaluate(()=>window.__slovotoc?.state().player);
  rec('zamčené jméno chce PIN a špatný nepustí', asked && !inGame && /nesedí/.test(msg), msg.trim());
  rec('po chybě se ukáže nápověda', /pes/.test(msg));
  // correct PIN gets in
  await p.fill('#pin-in','1234'); await p.click('#pin-go'); await p.waitForTimeout(7000);
  const st = await p.evaluate(()=>window.__slovotoc?.state());
  rec('správný PIN pustí dovnitř na správnou úroveň', st?.player==='Šárka' && st.level===71, JSON.stringify(st&&{p:st.player,l:st.level}));
  await p.__ctx.close(); }

// 3. taken-but-unlocked name asks who you are instead of handing it over
{ const p = await page({ 'Pavel': {levels:80, avatar:'🦉'} });
  await type(p,'Pavel');
  const txt = await p.evaluate(()=>document.getElementById('overlay-card').innerText);
  const asks = /už někdo má/.test(txt) && await p.locator('#iy-no').count()===1;
  rec('obsazené jméno se nepředá mlčky', asks, txt.split('\n')[0]);
  await p.click('#iy-no'); await p.waitForTimeout(700);
  rec('„to nejsem já" vrátí na výběr jména', await p.locator('#np-name').count()===1);
  await p.__ctx.close(); }

// 4. the PIN screen validates
{ const p = await page({}); await type(p,'Test'); await p.waitForTimeout(6000);
  await p.click('#btn-player'); await p.waitForTimeout(1200);
  await p.click('#ov-pin'); await p.waitForTimeout(600);
  await p.fill('#sp-pin','12'); await p.click('#sp-go'); await p.waitForTimeout(400);
  const short = await p.textContent('#sp-msg');
  await p.fill('#sp-pin','1234'); await p.fill('#sp-hint','muj pin je 1234'); await p.click('#sp-go'); await p.waitForTimeout(400);
  const leaky = await p.textContent('#sp-msg');
  rec('krátký PIN je odmítnut', /čtyři/.test(short), short.trim());
  rec('nápověda nesmí obsahovat PIN', /nesmí/.test(leaky), leaky.trim());
  await p.fill('#sp-hint','pes'); await p.click('#sp-go'); await p.waitForTimeout(900);
  rec('platný PIN se uloží', await p.evaluate(()=>JSON.parse(localStorage.getItem('slovotoc-v2')).players['Test'].pin)==='1234');
  await p.__ctx.close(); }

// 5. why-PIN explainer is reachable
{ const p = await page({ 'Šárka': {pin:'1234', levels:71, avatar:'🦊'} });
  await type(p,'Šárka'); await p.click('#pin-why'); await p.waitForTimeout(500);
  const t = await p.evaluate(()=>document.getElementById('overlay-card').innerText);
  rec('vysvětlení „Proč PIN?" jde otevřít', /Proč PIN/.test(t) && /e-mail/i.test(t));
  await p.__ctx.close(); }

// 6. a rude name is refused at the name box
{ const p = await page({});
  await p.fill('#np-name','kokot'); await p.click('#np-go'); await p.waitForTimeout(900);
  const stuck = await p.locator('#np-name').count()===1;
  const msg = await p.textContent('#toast').catch(()=>'');
  rec('sprosté jméno se nepustí dál', stuck && /nejde/.test(msg), msg.trim());
  // and the obfuscated spelling too
  await p.fill('#np-name','K0k0t'); await p.click('#np-go'); await p.waitForTimeout(900);
  rec('ani obcházené („K0k0t")', await p.locator('#np-name').count()===1);
  // a normal name still works
  await p.fill('#np-name','Bára'); await p.click('#np-go'); await p.waitForTimeout(7000);
  rec('běžné jméno projde', await p.evaluate(()=>window.__slovotoc?.state().player)==='Bára');
  await p.__ctx.close(); }

// 7. A board row written from another device must not show the player twice.
// Moving from the Messenger browser to the installed app is enough to make
// the ids differ, and that used to duplicate the row on their own screen.
{ const p = await page({ 'Hana': { levels: 29, avatar: '🐬', bonus: 444, coins: 1400, stars: 75 } });
  await p.evaluate(() => {
    const mk = (name, lvl) => ({ name, avatar:'🐬', coins:1400, levelIndex:lvl, best:lvl, bonusTotal:444,
      stars:{}, daily:null, sawTip:true, pin:null, pinAsked:true, cur:null, createdAt:Date.now(), lastPlayed:Date.now() });
    localStorage.setItem('slovotoc-v2', JSON.stringify({ v:2, sound:true, active:'Hana',
      deviceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sawInApp:true, players:{ 'Hana': mk('Hana',29) } }));
  });
  await p.reload({ waitUntil:'domcontentloaded' });
  await p.waitForFunction(()=>window.__slovotoc?.state().player, null, {timeout:25000}).catch(()=>{});
  await p.waitForTimeout(2500);
  await closeNews(p);
  await p.click('#btn-player'); await p.waitForTimeout(2500);
  const names = await p.evaluate(()=>[...document.querySelectorAll('#board-box .board-row b')].map(e=>e.innerText.trim()));
  const hanas = names.filter(n=>/Hana/.test(n)).length;
  const highlighted = await p.evaluate(()=>document.querySelector('#board-box .board-row.me b')?.innerText.trim() ?? '');
  rec('hráč se na žebříčku neobjeví dvakrát', hanas === 1, `Hana ${hanas}x, řádky: ${names.join(', ')}`);
  rec('vlastní řádek je zvýrazněný', /Hana/.test(highlighted), highlighted);
  await p.__ctx.close(); }

// 8. Exactly what happened on Filip's phone: a profile named Hana already sat
// in this device's storage, so typing the name walked straight in — past the
// PIN she had since set — and the only sign was the score refusing to save.
{ const p = await page({ 'Hana': { pin:'4321', hint:'delfín', levels:30, avatar:'🐬' } });
  await p.evaluate(() => {
    const mk = (name, lvl) => ({ name, avatar:'🐬', coins:100, levelIndex:lvl, best:lvl, bonusTotal:1,
      stars:{}, daily:null, sawTip:true, pin:null, pinAsked:true, cur:null, createdAt:Date.now(), lastPlayed:Date.now() });
    localStorage.setItem('slovotoc-v2', JSON.stringify({ v:2, sound:true, active:null,
      deviceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sawInApp:true, players:{ 'Hana': mk('Hana',30) } }));
  });
  await p.reload({ waitUntil:'domcontentloaded' });
  await p.waitForSelector('#np-name', {timeout:20000});

  // via the chip in the list
  await p.click('.player-chip[data-name="Hana"]'); await p.waitForTimeout(1800);
  const askedChip = await p.locator('#pin-in').count()===1;
  const inGame = await p.evaluate(()=>window.__slovotoc?.state().player);
  rec('místní profil se zamčeným jménem chce PIN (dlaždice)', askedChip && !inGame,
      askedChip ? 'ptá se ✓' : 'PUSTILO DOVNITŘ jako '+inGame);

  // wrong PIN keeps them out
  await p.fill('#pin-in','0000'); await p.click('#pin-go'); await p.waitForTimeout(900);
  rec('špatný PIN nepustí ani u místního profilu',
      await p.evaluate(()=>window.__slovotoc?.state().player)==null);

  // right one gets in and is remembered for next time
  await p.fill('#pin-in','4321'); await p.click('#pin-go'); await p.waitForTimeout(7000);
  const st = await p.evaluate(()=>({ who: window.__slovotoc?.state().player,
    saved: JSON.parse(localStorage.getItem('slovotoc-v2')).players['Hana'].pin }));
  rec('správný PIN pustí a zapamatuje se', st.who==='Hana' && st.saved==='4321', JSON.stringify(st));
  await p.__ctx.close(); }

// 9. A device that already knows the PIN must not be asked again.
{ const p = await page({ 'Hana': { pin:'4321', levels:30, avatar:'🐬' } });
  await p.evaluate(() => {
    localStorage.setItem('slovotoc-v2', JSON.stringify({ v:2, sound:true, active:null,
      deviceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc', sawInApp:true, players:{ 'Hana':
      { name:'Hana', avatar:'🐬', coins:100, levelIndex:30, best:30, bonusTotal:1, stars:{},
        daily:null, sawTip:true, pin:'4321', pinAsked:true, cur:null, createdAt:Date.now(), lastPlayed:Date.now() } } }));
  });
  await p.reload({ waitUntil:'domcontentloaded' });
  await p.waitForSelector('#np-name', {timeout:20000});
  await p.click('.player-chip[data-name="Hana"]'); await p.waitForTimeout(7000);
  rec('uložený PIN se podruhé neptá',
      await p.evaluate(()=>window.__slovotoc?.state().player)==='Hana');
  await p.__ctx.close(); }

console.log('\n' + out.filter(x=>!x.ok).length + ' selhalo z ' + out.length);
await b.close(); stop();
process.exit(out.some(x=>!x.ok) ? 1 : 0);
