// Extra checks: keyboard focus restore unchanged, Skip/Menu pointer paths, F3 hidden-start.
// usage: node regress-extra.mjs <baseUrl> [skipF3]
import { chromium } from 'playwright';
const [base = 'http://127.0.0.1:4296', skipF3] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const out = {};
async function story(initScript) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (initScript) await ctx.addInitScript(initScript);
  if (process.env.SM_RUNTIME) await ctx.route('**/assets/combat/runtime.json', r => r.fulfill({ path: process.env.SM_RUNTIME, contentType: 'application/json' }));
  const p = await ctx.newPage();
  await p.goto(base + '/'); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.getByRole('button', { name: 'New story', exact: true }).click(); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Skip intro' }).click(); await p.waitForTimeout(1500);
  return p;
}
const line = p => p.evaluate(() => document.getElementById('dialogue-text').textContent);
const st = p => p.evaluate(() => ({ focus: document.activeElement.id || document.activeElement.textContent.trim().slice(0, 20), open: [...document.querySelectorAll('dialog[open]')].map(d => d.id) }));

{ // keyboard: focus quick-save, Enter opens, Escape closes -> focus returns to quick-save (native behaviour kept)
  const p = await story();
  await p.locator('#quick-save').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  const opened = await st(p);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  out.keyboardRestore = { opened: opened.open, after: await st(p) };
  // Skip by pointer then Space: dialogue advances, skip mode toggled once
  await p.evaluate(() => document.getElementById('next-button').focus());
  await p.keyboard.press(' '); await p.waitForTimeout(300);
  await p.locator('#quick-skip').click(); await p.waitForTimeout(300);
  const skipPressed = await p.getAttribute('#quick-skip', 'aria-pressed');
  const focusAfterSkip = (await st(p)).focus;
  await p.locator('#quick-skip').click(); await p.waitForTimeout(300); // turn skip off again
  const b = await line(p); await p.keyboard.press(' '); await p.waitForTimeout(300); await p.keyboard.press(' '); await p.waitForTimeout(400);
  out.skipPointer = { skipPressed, focusAfterSkip, skipAfterSpace: await p.getAttribute('#quick-skip', 'aria-pressed'), advanced: (await line(p)) !== b };
  // Menu by pointer, Escape, Space
  const m = await line(p);
  await p.locator('#menu-button').click(); await p.waitForTimeout(400);
  const menuOpen = (await st(p)).open;
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.keyboard.press(' '); await p.waitForTimeout(400); await p.keyboard.press(' '); await p.waitForTimeout(400);
  out.menuPointer = { menuOpen, after: await st(p), advanced: (await line(p)) !== m };
  // House by pointer, close button
  await p.locator('#cast-button').click(); await p.waitForTimeout(400);
  const houseOpen = (await st(p)).open;
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  out.housePointer = { houseOpen, after: await st(p) };
  await p.context().close();
}

if (!skipF3) { // F3: page hidden (no frames) while the native combat starts, shown again after 25 s
  const hide = `window.__smHidden=false;Object.defineProperty(Document.prototype,'visibilityState',{configurable:true,get(){return window.__smHidden?'hidden':'visible';}});Object.defineProperty(Document.prototype,'hidden',{configurable:true,get(){return window.__smHidden;}});const raf=window.requestAnimationFrame.bind(window);const queued=[];window.requestAnimationFrame=cb=>{if(window.__smHidden){queued.push(cb);return 0;}return raf(cb);};window.__smShow=()=>{window.__smHidden=false;document.dispatchEvent(new Event('visibilitychange'));for(const cb of queued.splice(0))raf(cb);};`;
  const p = await story(hide);
  for (let i = 0; i < 200 && !p.url().includes('/combat'); i++) { await p.keyboard.press('1'); await p.waitForTimeout(120); await p.keyboard.press(' '); await p.waitForTimeout(120); }
  await p.waitForTimeout(2500);
  await p.evaluate(() => { window.__smHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  await p.locator('#start').click();
  await p.waitForTimeout(25000);
  const whileHidden = await p.evaluate(() => ({ error: !document.getElementById('runtime-error').hidden, text: document.getElementById('runtime-error').innerText.slice(0, 120) }));
  await p.evaluate(() => window.__smShow());
  const ok = await p.waitForFunction(() => /Your turn/.test(document.body.innerText) || !document.getElementById('runtime-error').hidden, null, { timeout: 60000 }).then(() => p.evaluate(() => /Your turn/.test(document.body.innerText) ? 'started' : 'error: ' + document.getElementById('runtime-error').innerText.slice(0, 120))).catch(() => 'timeout');
  out.F3 = { runtime: await p.evaluate(() => fetch('/assets/combat/runtime.json').then(r => r.json()).then(j => j.loader)), url: p.url(), hiddenFor: '25s', whileHidden, afterShow: ok };
  await p.context().close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
