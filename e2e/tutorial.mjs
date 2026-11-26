// Walks through the whole tutorial by following Sly's instructions, like a new player would.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const phone = process.argv[2] === 'phone';
const mode = process.argv[3] ?? 'pixel3d';
const size = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const tag = `${phone ? 'phone' : 'desktop'}-${mode}`;
const PORT = 5100 + Math.floor(Math.random() * 300);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: 'packages/client', stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: size, hasTouch: phone });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
mkdirSync('screenshots/tutorial', { recursive: true });

await page.addInitScript((m) => localStorage.setItem('hexhold.settings', JSON.stringify({ name: 'Newbie', mode: m, players: 4, level: 'normal', mapType: 'spiral', targetVP: 10, friendly: false })), mode);
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('[data-act=tutorial]');
await page.screenshot({ path: `screenshots/tutorial/${tag}-00-home.png` });
await page.click('.newhere [data-act=tutorial]');
await page.waitForSelector('#coach .coach-title');

const click = (sel) => page.click(sel, { timeout: 2000 }).then(() => true).catch(() => false);
const tap = async (kind, random = false) => {
  const pos = await page.evaluate(([k, rnd]) => {
    const t = window.__test; let ms = t.markers().filter((m) => !k || m.kind === k);
    if (rnd) ms = ms.sort(() => Math.random() - 0.5);
    for (const m of ms) { const p = t.screenOf(m); if (!p || p.x < 4 || p.y < 4 || p.x > innerWidth - 4 || p.y > innerHeight - 4) continue; const el = document.elementFromPoint(p.x, p.y); if (el && el.id === 'view') return p; }
    return null;
  }, [kind, random]);
  if (!pos) return false;
  if (phone) await page.touchscreen.tap(pos.x, pos.y); else await page.mouse.click(pos.x, pos.y);
  return true;
};
const seen = [];
let blockedChecked = false;
for (let guard = 0; guard < 600; guard++) {
  const title = await page.textContent('#coach .coach-title').catch(() => null);
  if (!title) break;
  if (seen[seen.length - 1] !== title) {
    seen.push(title);
    await page.waitForTimeout(phone ? 900 : 700);
    await page.screenshot({ path: `screenshots/tutorial/${tag}-${String(seen.length).padStart(2, '0')}-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png` });
  }
  if (await page.$('[data-coach=next]')) { await click('[data-coach=next]'); continue; }
  if (await page.$('[data-coach=keep]')) { await click('[data-coach=keep]'); break; }
  // discard dialog can appear in several steps
  if (await page.$('[data-act=discard]')) {
    for (let k = 0; k < 20; k++) { if (await page.evaluate(() => !document.querySelector('[data-act=discard]')?.hasAttribute('disabled'))) break; const plus = await page.$$('[data-ctr^="discard:"][data-ctr$=":1"]:not([disabled])'); if (!plus.length) break; await plus[0].click(); }
    if (title.includes('7')) await page.screenshot({ path: `screenshots/tutorial/${tag}-discard.png` });
    await click('[data-act=discard]'); continue;
  }
  if (await page.$('[data-act^=victim]')) { await click('[data-act^=victim]'); continue; }
  switch (title) {
    case 'Place your first Hamlet': case 'Your second Hamlet': case 'Now a Road': case 'Starting hand': case 'Move me!':
      await tap(); break;
    case 'Roll the dice': case 'Uh oh, a 7': await click('[data-act=roll]'); break;
    case 'Build a Road':
      if (!blockedChecked) { await click('[data-act=end]'); blockedChecked = !!(await page.waitForSelector('.toast', { timeout: 1500 }).catch(() => null)); }
      if (!(await page.$('[data-act=build-road].on'))) await click('[data-act=build-road]');
      await tap('edge'); break;
    case 'Build a Hamlet':
      if (await page.$('[data-act=build-hamlet]:not([disabled])')) { if (!(await page.$('[data-act=build-hamlet].on'))) await click('[data-act=build-hamlet]'); await tap('vertex'); }
      else { if (!(await page.$('[data-act=build-road].on'))) await click('[data-act=build-road]'); await tap('edge', true); }
      break;
    case 'Upgrade to a Keep': if (!(await page.$('[data-act=build-keep].on'))) await click('[data-act=build-keep]'); await tap('vertex'); break;
    case 'Trading':
      if (!(await page.$('[data-act=bank]'))) { await click('[data-act=trade]'); await click('[data-act="tab:bank"]'); }
      await click('[data-act="bg:timber"]'); await click('[data-act="bt:stone"]');
      await page.screenshot({ path: `screenshots/tutorial/${tag}-trade-dialog.png` });
      await click('[data-act=bank]'); await click('[data-act=close]'); break;
    case 'Charters': await click('[data-act=buy]'); break;
    case 'End your turn': await click('[data-act=end]'); break;
    case 'Play your Warden':
      if (await page.evaluate(() => window.__test.view().phase === 'bandit')) await tap('hex');
      else { if (!(await page.$('[data-act="playch:warden"]'))) await click('[data-act=charters]'); await click('[data-act="playch:warden"]'); }
      break;
    default: await page.waitForTimeout(200);
  }
  await page.waitForTimeout(250);
}
const final = await page.evaluate(() => ({ coach: !!document.querySelector('#coach'), phase: window.__test.view().phase, vp: window.__test.view().players[0].name }));
await page.waitForTimeout(2000);
const botsMoving = await page.evaluate(() => window.__test.view().turn);
await page.screenshot({ path: `screenshots/tutorial/${tag}-99-after.png` });
console.log(JSON.stringify({ steps: seen.length, seen, blockedChecked, final, botsMoving, errors }));
await browser.close();
server.kill();
