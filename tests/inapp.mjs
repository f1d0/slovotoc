import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const stop = await serve(8766);
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const MSG='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 [FBAN/MessengerLiteForiOS;FBAV/450.0]';
const NORM='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
async function run(label, ua) {
  const ctx = await b.newContext({ viewport:{width:430,height:932}, hasTouch:true, isMobile:true, userAgent:ua });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8766/', {waitUntil:'domcontentloaded'});
  await p.evaluate(()=>localStorage.clear());
  await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForSelector('#np-name',{timeout:20000});
  await p.fill('#np-name','Zk'); await p.click('#np-go');
  await p.waitForFunction(()=>!document.querySelector('#np-name'),null,{timeout:25000}).catch(()=>{});
  await p.waitForTimeout(1500);
  const shown = await p.locator('#ia-ok').count()===1;
  const txt = shown ? (await p.evaluate(()=>document.getElementById('overlay-card').innerText)).split('\n')[0] : '';
  console.log(`${label}: cedule ${shown?'ANO':'ne'} ${txt}`);
  if (shown) { await p.click('#ia-ok'); await p.waitForTimeout(500);
    // must not come back a second time
    await p.reload({waitUntil:'domcontentloaded'});
    await p.waitForTimeout(4000);
    console.log('  po restartu znovu:', await p.locator('#ia-ok').count()===1 ? 'ANO (špatně)' : 'ne ✓'); }
  await ctx.close(); return shown;
}
const a = await run('Messenger ', MSG);
const c = await run('Safari    ', NORM);
console.log('\n' + (a && !c ? 'v pořádku' : 'CHYBA'));
await b.close(); stop();
