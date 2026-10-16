// Visible page whose native scene never reports ready must still fail after the visible budget.
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:4296';
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { if (location.pathname.startsWith('/combat')) window.addEventListener('sm-combat-ready', e => e.stopImmediatePropagation(), true); });
const p = await ctx.newPage();
await p.goto(base + '/'); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.getByRole('button', { name: 'New story', exact: true }).click(); await p.waitForTimeout(1200);
await p.getByRole('button', { name: 'Skip intro' }).click(); await p.waitForTimeout(1500);
for (let i = 0; i < 200 && !p.url().includes('/combat'); i++) { await p.keyboard.press('1'); await p.waitForTimeout(120); await p.keyboard.press(' '); await p.waitForTimeout(120); }
await p.waitForTimeout(2500);
const t0 = Date.now(); await p.locator('#start').click();
const r = await p.waitForFunction(() => !document.getElementById('runtime-error').hidden, null, { timeout: 90000 }).then(() => p.evaluate(() => document.getElementById('runtime-error').innerText.replace(/\s+/g, ' ').slice(0, 110))).catch(() => 'NO ERROR within 90 s');
console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), result: r }));
await browser.close();
