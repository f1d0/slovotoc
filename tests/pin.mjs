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

console.log('\n' + out.filter(x=>!x.ok).length + ' selhalo z ' + out.length);
await b.close(); stop();
process.exit(out.some(x=>!x.ok) ? 1 : 0);
