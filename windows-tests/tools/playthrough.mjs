// Automated playthrough of the compiled Super Model preview.
// usage: node playthrough.mjs <chromium|webkit|msedge> <pick:0|1|2|rand> <outdir> [maxMinutes] [baseUrl] [width] [height]
import { chromium, webkit, firefox } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [engine = 'chromium', pick = '0', outdir = 'out', maxMin = '25', base = 'http://127.0.0.1:4317', w = '1280', h = '800'] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const deadline = Date.now() + Number(maxMin) * 60000;
const report = { engine, pick, viewport: [Number(w), Number(h)], started: new Date().toISOString(), nodes: [], choices: [], combats: [], dialogs: [], buttons: [], consoleErrors: [], pageErrors: [], badResponses: [], failedRequests: [], shifts: [], end: null };
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(s); fs.appendFileSync(path.join(outdir, 'log.txt'), s + '\n'); };
const save = () => fs.writeFileSync(path.join(outdir, 'report.json'), JSON.stringify(report, null, 1));

let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const choose = (n) => pick === 'rand' ? rnd(n) : Math.min(Number(pick), n - 1);

const launcher = engine === 'webkit' ? webkit : engine === 'firefox' ? firefox : chromium;
const gpuArgs = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const browser = await launcher.launch(engine === 'msedge' ? { channel: 'msedge', headless: true, args: gpuArgs } : engine === 'chromium' ? { channel: 'chromium', headless: true, args: gpuArgs } : { headless: true });
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 300)));
page.on('response', r => { if (r.status() >= 400) report.badResponses.push(`${r.status()} ${r.url()}`); });
page.on('requestfailed', r => { const f = r.failure()?.errorText || ''; if (!/ERR_ABORTED|cancelled/i.test(f)) report.failedRequests.push(`${f} ${r.url()}`); });

let shots = 0;
const shot = async (name) => { if (shots++ > 120) return; try { await page.screenshot({ path: path.join(outdir, `${String(shots).padStart(3, '0')}-${name.replace(/[^a-z0-9-]+/gi, '_').slice(0, 60)}.png`) }); } catch {} };

const state = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('supermodel-vn-01') || '{}'); } catch { return {}; } });

async function checkShift(where) {
  const s = await page.evaluate(() => { const sc = document.querySelector('section.scene'); return sc ? { st: sc.scrollTop, sl: sc.scrollLeft } : null; }).catch(() => null);
  if (s && (s.st || s.sl)) { report.shifts.push({ where, ...s }); log('SHIFT', where, JSON.stringify(s)); }
}

const myTurn = () => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^Source Cut/.test(x.textContent.trim())); return !!(b && b.offsetParent && !b.disabled && !document.querySelector('#runtime-error:not([hidden])')); }).catch(() => false);
async function combat() {
  const c = { url: page.url(), rounds: [], result: null, startMs: null };
  const t0 = Date.now();
  await shot('combat-intro');
  const start = page.locator('#start');
  await start.waitFor({ state: 'visible', timeout: 120000 }).catch(() => {});
  if (await start.isVisible().catch(() => false)) await start.click();
  // wait for the 3D scene or the failure panel
  const ok = await page.waitForFunction(() => /Your turn|to survive/.test(document.body.innerText) || /could not start/.test(document.body.innerText), null, { timeout: 240000 }).then(() => true).catch(() => false);
  c.startMs = Date.now() - t0;
  let body = await page.evaluate(() => document.body.innerText);
  if (!ok || /could not start/.test(body)) { c.result = 'START-FAIL ' + body.slice(body.indexOf('could not') - 20, body.indexOf('could not') + 120).replace(/\n/g, ' '); await shot('combat-start-fail'); report.combats.push(c); log('combat start fail'); return 'fail'; }
  await shot('combat-hud');
  let lastRound = '';
  const combatDeadline = Date.now() + 8 * 60000;
  while (Date.now() < deadline && Date.now() < combatDeadline) {
    if (!page.url().includes('/combat')) { c.result = c.result || 'left combat'; break; }
    body = await page.evaluate(() => document.body.innerText).catch(() => '');
    const rm = body.match(/Round (\d+) \/ (\d+)/);
    if (rm && rm[0] !== lastRound) { lastRound = rm[0]; const hp = body.match(/Sami\n+(\d+) \/ (\d+)/); const foe = body.match(/\n(\d+) \/ (\d+)\n+Next/); c.rounds.push(`${rm[0]} sami=${hp?.[1]} foe=${foe?.[1]}`); log('round', c.rounds[c.rounds.length-1]); }
    // end screens: look for visible primary buttons other than the HUD
    const endBtn = await page.evaluate(() => {
      const hud = /^(Source Cut|Guard|Focus|Log|Pause|Assist|\?)/;
      const b = [...document.querySelectorAll('button,a')].filter(x => x.offsetParent && !x.disabled && x.id !== 'story-link' && !x.closest('#assists') && !hud.test(x.textContent.trim()) && !/^(Sami|Claudia|Gigi|Gemma|Raven):/.test(x.getAttribute('aria-label') || ''));
      return b.map(x => ({ id: x.id, t: (x.getAttribute('aria-label') || x.textContent.trim()).slice(0, 50) }));
    });
    const turn = await myTurn();
    if (!turn && endBtn.length) {
      const ret = endBtn.find(b => /return|continue|story/i.test(b.t)) || endBtn[0];
      c.result = `END ${body.match(/(Victory|Defeat|won|lost|claim[^\n]*|The copy[^\n]*)/i)?.[0] || ''} buttons=${endBtn.map(b => b.t).join('|')}`;
      await shot('combat-end');
      log('combat end', c.result);
      if (/retry|again/i.test(ret.t) && !/return|story/i.test(ret.t)) { c.result += ' (defeat-retry)'; }
      await page.locator(ret.id ? `#${ret.id}` : `text=${ret.t}`).first().click().catch(() => {});
      await page.waitForURL(u => !u.toString().includes('/combat'), { timeout: 60000 }).catch(() => {});
      break;
    }
    if (turn) {
      const assist = page.locator('button[aria-label^="Sami:"]:not([disabled]), button[aria-label^="Claudia:"]:not([disabled]), button[aria-label^="Gigi:"]:not([disabled]), button[aria-label^="Gemma:"]:not([disabled]), button[aria-label^="Raven:"]:not([disabled])');
      if (!/Used this round/.test(body) && await assist.count() > 0) {
        // prefer Claudia (damage), Raven (cancel), Gigi (heal when low)
        const labels = await assist.evaluateAll(bs => bs.map(b => b.getAttribute('aria-label') || ''));
        const hp = Number(body.match(/Sami\n+(\d+) \/ (\d+)/)?.[1] || 99);
        let i = labels.findIndex(l => (hp < 40 ? /^Gigi/ : /^Claudia/).test(l)); if (i < 0) i = labels.findIndex(l => /^Raven/.test(l)); if (i < 0) i = 0;
        log('assist', labels[i].slice(0,30)); await assist.nth(i).click({ force: true, timeout: 5000 }).catch(e => log('assist click fail', e.message.slice(0,120)));
        await page.waitForTimeout(2500);
        continue;
      }
      const sel = page.locator('select').first();
      if (await sel.count()) { const opts = await sel.evaluate(s => [...s.options].map(o => o.value)); await sel.selectOption(opts[opts.length - 1]).catch(() => {}); }
      const focusN = Number(body.match(/Focus (\d+) \/ 3/)?.[1] || 0);
      const key = /Guard to survive/.test(body) ? '2' : focusN === 0 && rnd(3) === 0 ? '3' : '1';
      await page.locator('body').click({ position: { x: 5, y: 5 }, timeout: 2000 }).catch(() => {});
      await page.keyboard.press(key);
      const moved = await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => /^Source Cut/.test(x.textContent.trim())); return !b || b.disabled; }, null, { timeout: 4000 }).then(() => true).catch(() => false);
      if (!moved) { log('key', key, 'did not act; force click'); await page.getByRole('button', { name: key === '1' ? /^Source Cut/ : key === '2' ? /^Guard/ : /^Focus/ }).first().click({ force: true, timeout: 3000 }).catch(e => log('force click fail', e.message.slice(0, 100))); }
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => /^Source Cut/.test(x.textContent.trim())); return (b && !b.disabled) || !location.pathname.startsWith('/combat') || [...document.querySelectorAll('button')].some(b => b.offsetParent && /return|continue/i.test(b.textContent)); }, null, { timeout: 30000 }).catch(() => {});
      continue;
    }
    await page.waitForTimeout(1000);
  }
  if (!c.result) { c.result = 'COMBAT TIMEOUT'; await shot('combat-timeout'); log('combat timeout', JSON.stringify(c.rounds.slice(-3))); report.combats.push(c); save(); return 'fail'; }
  report.combats.push(c);
  save();
  return 'done';
}

async function closeDialogs() {
  const open = await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(d => d.id));
  for (const id of open) { report.dialogs.push(id); await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  return open.length;
}

try {
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await shot('title');
  await page.getByRole('button', { name: 'New story', exact: true }).click();
  await page.waitForTimeout(1500);
  const skip = page.getByRole('button', { name: 'Skip intro' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForTimeout(1500);
  let lastNode = '', idle = 0, steps = 0, lastChapter = '';
  while (Date.now() < deadline) {
    steps++;
    if (page.url().includes('/combat')) { log('-> combat', page.url()); const r = await combat(); if (r === 'fail') { report.end = 'combat start failed'; break; } await page.waitForTimeout(2000); continue; }
    const st = await state();
    if (st.node && st.node !== lastNode) { lastNode = st.node; report.nodes.push(st.node); idle = 0; }
    const info = await page.evaluate(() => {
      const vis = e => e && e.offsetParent !== null && !e.hidden;
      const nb = document.getElementById('next-button');
      const choices = [...document.querySelectorAll('#choices button')].filter(b => vis(b) && !b.disabled).map(b => b.textContent.trim().slice(0, 70));
      const others = [...document.querySelectorAll('main button')].filter(b => vis(b) && !b.disabled && !b.closest('.quick-menu,.topbar,#choices,dialog,#title-screen,#wardrobe') && b !== nb).map(b => ({ id: b.id, t: (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 60) }));
      const title = vis(document.getElementById('title-screen'));
      const chapter = document.querySelector('.chapter h1, .chapter')?.textContent?.trim().slice(0, 60);
      return { next: vis(nb), choices, others, title, dialog: !!document.querySelector('dialog[open]'), chapter, puzzle: !!document.querySelector('.puzzle-panel:not([hidden])') && vis(document.querySelector('.puzzle-panel')) };
    }).catch(() => null);
    if (!info) { await page.waitForTimeout(1000); continue; }
    if (info.chapter && info.chapter !== lastChapter) { lastChapter = info.chapter; await shot('chapter-' + info.chapter); }
    if (info.dialog) { await closeDialogs(); continue; }
    if (info.title) { report.end = 'returned to title'; await shot('title-end'); break; }
    const ded = await page.evaluate(() => { const b = document.getElementById('deduce-button'); if (!b || !b.offsetParent) return null; const st = [...document.querySelectorAll('#choices button[data-statement]')].map(x => ({ id: x.dataset.statement, on: x.getAttribute('aria-pressed') === 'true', t: x.textContent.trim().slice(0, 60) })); const m = b.textContent.match(/(\d+)\s*\/\s*(\d+)/); return { st, need: m ? Number(m[2]) : 2, label: b.textContent.trim() }; }).catch(() => null);
    if (ded) {
      const n = ded.st.length, need = ded.need;
      let want = pick === '1' ? [0, ...Array.from({ length: need - 1 }, (_, k) => k + 2)] : pick === 'rand' ? [] : Array.from({ length: need }, (_, k) => k);
      if (pick === 'rand') { while (want.length < need) { const r = rnd(n); if (!want.includes(r)) want.push(r); } }
      want = want.filter(i => i < n);
      for (let i = 0; i < n; i++) { const should = want.includes(i); if (ded.st[i].on !== should) await page.locator(`#choices button[data-statement="${ded.st[i].id}"]`).click().catch(() => {}); await page.waitForTimeout(150); }
      report.choices.push({ node: lastNode, deduction: true, picked: want.map(i => ded.st[i].id).join('+') });
      log('deduction', lastNode, want.map(i => ded.st[i].id).join('+'));
      await page.locator('#deduce-button').click({ timeout: 5000 }).catch(e => log('deduce click fail', e.message.slice(0, 100)));
      await page.waitForTimeout(1200);
      await shot('deduction-result-' + lastNode);
      continue;
    }
    if (info.choices.length) {
      const rep = report.choices.slice(-3);
      if (rep.length === 3 && rep.every(r => r.node === lastNode)) {
        const dump = await page.evaluate(() => ({ dlg: document.getElementById('dialogue-text')?.textContent, choices: document.getElementById('choices')?.outerHTML, deduction: document.querySelector('[class*=deduction]')?.outerHTML?.slice(0, 4000), state: localStorage.getItem('supermodel-vn-01') }));
        fs.writeFileSync(path.join(outdir, `loop-${lastNode}.json`), JSON.stringify(dump, null, 1));
        await shot('loop-' + lastNode);
        report.end = 'choice loop at ' + lastNode; break;
      }
      const i = choose(info.choices.length);
      report.choices.push({ node: lastNode, n: info.choices.length, picked: info.choices[i] });
      log('choice', lastNode, `[${i}/${info.choices.length}]`, info.choices[i]);
      if (report.choices.length % 4 === 1) await shot('choice-' + lastNode);
      await page.locator('#choices button:not([disabled])').nth(i).click().catch(e => log('choice click fail', e.message.slice(0, 80)));
      await page.waitForTimeout(900);
      await checkShift('after choice ' + lastNode);
      continue;
    }
    if (info.next) { await page.locator('#next-button').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(220); continue; }
    if (info.puzzle) {
      report.buttons.push({ node: lastNode, puzzle: true, others: info.others });
      log('puzzle at', lastNode, JSON.stringify(info.others).slice(0, 200));
      await shot('puzzle-' + lastNode);
      // try the exposed preview hook for a solution hint
      const snap = await page.evaluate(() => { try { return window.smPreview?.puzzle; } catch { return null; } });
      fs.writeFileSync(path.join(outdir, `puzzle-${lastNode}.json`), JSON.stringify(snap, null, 1));
      report.end = 'stopped at puzzle ' + lastNode; break;
    }
    if (info.others.length) {
      const b = info.others[0];
      report.buttons.push({ node: lastNode, clicked: b.t, all: info.others.map(o => o.t) });
      log('button', lastNode, b.t, '| all:', info.others.map(o => o.t).join(' | '));
      if (/another answer|begin again|new story/i.test(b.t)) { report.end = 'ending reached: ' + lastNode; await shot('ending-' + lastNode); break; }
      await page.locator(b.id ? `#${b.id}` : 'main button').filter({ hasText: b.id ? undefined : b.t }).first().click({ timeout: 5000 }).catch(e => log('btn click fail', e.message.slice(0, 80)));
      await page.waitForTimeout(1200);
      continue;
    }
    idle++;
    if (idle > 30) { report.end = 'stuck at ' + lastNode; await shot('stuck-' + lastNode); log('stuck', lastNode); break; }
    await page.waitForTimeout(500);
  }
  if (!report.end) report.end = 'time limit at ' + lastNode;
} catch (e) {
  report.end = 'exception: ' + String(e).slice(0, 300);
  await shot('exception');
}
report.finished = new Date().toISOString();
report.finalState = await state().catch(() => ({}));
save();
log('END', report.end, 'nodes', report.nodes.length, 'choices', report.choices.length, 'combats', report.combats.length, 'errors', report.consoleErrors.length + report.pageErrors.length, 'bad', report.badResponses.length);
await browser.close();
