// Regression checks for Windows findings F1-F3.
// usage: node regress-f1f2f3.mjs <baseUrl> [hubStateFile]
import { chromium } from 'playwright';
import fs from 'node:fs';
const [base = 'http://127.0.0.1:4317', hubStateFile] = process.argv.slice(2);
const gpuArgs = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: gpuArgs });
const results = {};
const newPage = async (w = 1280, h = 800) => (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
const scene = p => p.evaluate(() => { const s = document.querySelector('section.scene'); return { st: s.scrollTop, sl: s.scrollLeft }; });

// F1: close a toolbar panel with Escape, press Space -> dialogue must advance, panel must stay closed.
{
  const p = await newPage();
  await p.goto(base + '/'); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.getByRole('button', { name: 'New story', exact: true }).click(); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Skip intro' }).click(); await p.waitForTimeout(1500);
  const r = {};
  for (const id of ['quick-save', 'quick-load', 'history-button', 'quick-settings']) {
    const btn = p.locator('#' + id);
    if (!(await btn.count()) || !(await btn.isVisible())) { r[id] = 'n/a'; continue; }
    await p.keyboard.press(' '); await p.waitForTimeout(400); // finish typing
    const before = await p.evaluate(() => document.getElementById('dialogue-text').textContent);
    await btn.click(); await p.waitForTimeout(400);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.keyboard.press(' '); await p.waitForTimeout(500);
    const after = await p.evaluate(() => ({ t: document.getElementById('dialogue-text').textContent, open: [...document.querySelectorAll('dialog[open]')].map(d => d.id), focus: document.activeElement.id }));
    r[id] = { advanced: after.t !== before, reopened: after.open, focus: after.focus };
    await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); document.getElementById('next-button')?.focus({ preventScroll: true }); }); await p.waitForTimeout(300);
  }
  // mouse click on Skip then Space
  results.F1 = r;
  await p.context().close();
}

// F2: scrollIntoView / Tab focus must not shift the scene.
{
  const out = {};
  for (const [w, h] of [[1280, 800], [1024, 768], [375, 812]]) {
    const p = await newPage(w, h);
    await p.goto(base + '/'); await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.getByRole('button', { name: 'New story', exact: true }).click(); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: 'Skip intro' }).click(); await p.waitForTimeout(1500);
    await p.evaluate(() => document.getElementById('quick-load').scrollIntoView({ block: 'center', inline: 'center' }));
    const a = await scene(p);
    await p.evaluate(() => { const s = document.querySelector('section.scene'); s.scrollTop = 0; s.scrollLeft = 0; });
    for (let i = 0; i < 14; i++) await p.keyboard.press('Tab');
    const b = await scene(p);
    out[`${w}x${h}`] = { scrollIntoView: a, tab14: b };
    await p.context().close();
  }
  if (hubStateFile && fs.existsSync(hubStateFile)) {
    const p = await newPage(1280, 800);
    await p.goto(base + '/');
    await p.evaluate(s => { localStorage.clear(); localStorage.setItem('supermodel-vn-01', s); }, fs.readFileSync(hubStateFile, 'utf8'));
    await p.reload(); await p.waitForTimeout(800);
    await p.locator('#title-continue').click(); await p.waitForTimeout(1500);
    for (let i = 0; i < 30 && !(await p.locator('#choices button').count()); i++) { await p.keyboard.press(' '); await p.waitForTimeout(300); }
    const n = await p.locator('#choices button').count();
    await p.locator('#choices button').first().focus();
    for (let i = 1; i < n; i++) { await p.keyboard.press('Tab'); await p.waitForTimeout(80); }
    out.hubTabToLastChoice = { choices: n, focus: await p.evaluate(() => document.activeElement.textContent.trim().slice(0, 40)), ...(await scene(p)) };
    await p.context().close();
  }
  results.F2 = out;
}

console.log(JSON.stringify(results, null, 1));
await browser.close();
