// Plays a full game as the human seat by clicking the real UI (board markers + buttons).
// Usage: node e2e/solo.mjs [mode]   (expects `vite preview` build in packages/client/dist)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const mode = process.argv[2] ?? 'pixel3d';
const size = process.argv[3] === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const PORT = 4180 + Math.floor(Math.random() * 500);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: 'packages/client', stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: size, hasTouch: process.argv[3] === 'phone' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
mkdirSync('screenshots/play', { recursive: true });
const shot = (n) => page.screenshot({ path: `screenshots/play/${mode}-${process.argv[3] ?? 'desktop'}-${n}.png` });

await page.addInitScript((m) => localStorage.setItem('hexhold.settings', JSON.stringify({ name: 'Tester', mode: m, players: 4, level: 'normal', mapType: 'spiral', targetVP: 10, friendly: false })), mode);
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('[data-act=solo]');
await shot('0-home');
await page.click('[data-act=solo]');
await page.waitForFunction(() => window.__test && window.__test.view());
await page.waitForTimeout(800);
await page.evaluate(() => { window.__test.host().fastBots = true; });

const clickMarker = async () => {
  const pos = await page.evaluate(() => {
    const t = window.__test;
    for (const m of t.markers()) {
      const p = t.screenOf(m);
      if (!p || p.x < 5 || p.y < 5 || p.x > innerWidth - 5 || p.y > innerHeight - 5) continue;
      const el = document.elementFromPoint(p.x, p.y);
      if (el && el.id === 'view') return p;
    }
    return null;
  });
  if (!pos) return false;
  if (process.argv[3] === 'phone') await page.touchscreen.tap(pos.x, pos.y); else await page.mouse.click(pos.x, pos.y);
  return true;
};

let shots = 0, iter = 0, built = 0, trades = 0, lastLog = 0;
const counts = {};
while (iter++ < 4000) {
  const st = await page.evaluate(() => {
    const v = window.__test.view(); const me = window.__test.me();
    const q = (s) => !!document.querySelector(s);
    return { phase: v.phase, turn: v.turn, current: v.current, me, ended: v.phase === 'ended', markers: window.__test.markers().length,
      roll: q('[data-act=roll]'), discard: q('[data-act=discard]'), accept: q('[data-act=accept]'), end: q('[data-act=end]'),
      hamlet: q('[data-act=build-hamlet]:not([disabled])'), keep: q('[data-act=build-keep]:not([disabled])'), road: q('[data-act=build-road]:not([disabled])'),
      buy: q('[data-act=buy]:not([disabled])'), offerMine: q('[data-act=cancel-offer]'), victim: q('[data-act^=victim]') };
  });
  if (st.ended) break;
  const act = async (what) => { counts[what] = (counts[what] ?? 0) + 1; };
  const click = (sel) => page.click(sel, { timeout: 1500 }).catch(() => {});
  if (st.discard) {
    // add cards until the button enables
    for (let i = 0; i < 20; i++) {
      const ok = await page.evaluate(() => !document.querySelector('[data-act=discard]')?.hasAttribute('disabled'));
      if (ok) break;
      const plus = await page.$$('[data-ctr^="discard:"][data-ctr$=":1"]:not([disabled])');
      if (!plus.length) break;
      await plus[i % plus.length].click();
    }
    await click('[data-act=discard]'); await act('discard');
  } else if (st.victim) { await click('[data-act^=victim]'); await act('victim'); }
  else if (st.accept) { await click(Math.random() < 0.5 ? '[data-act=accept]:not([disabled])' : '[data-act=decline]'); await click('[data-act=decline]'); await act('respond'); }
  else if (st.offerMine) { await click('[data-act=cancel-offer]'); }
  else if (st.markers > 0) { if (!(await clickMarker())) await page.evaluate(() => window.__test.view()) ; else await act('marker'); }
  else if (st.roll) { await click('[data-act=roll]'); await act('roll'); }
  else if (st.keep) { await click('[data-act=build-keep]'); built++; await act('keep'); }
  else if (st.hamlet) { await click('[data-act=build-hamlet]'); built++; await act('hamlet'); }
  else if (st.buy) { await click('[data-act=buy]'); await act('buy'); }
  else if (st.road && Math.random() < 0.5) { await click('[data-act=build-road]'); await act('road'); }
  else if (st.end) {
    // occasionally try a bank trade through the dialog
    if (Math.random() < 0.3) {
      await click('[data-act=trade]');
      const tab = await page.$('[data-act="tab:bank"]'); if (tab) await tab.click();
      const ok = await page.$('[data-act=bank]:not([disabled])');
      if (ok) { await ok.click(); trades++; }
      const close = await page.$('[data-act=close]'); if (close) await close.click();
    }
    await click('[data-act=end]'); await act('end');
  }
  else await page.waitForTimeout(60);
  if (st.turn >= [1, 12, 30][shots] && shots < 3) { await page.waitForTimeout(400); await shot(`${shots + 1}-turn${st.turn}`); shots++; }
}
await page.waitForTimeout(600);
await shot('9-end');
const result = await page.evaluate(() => { const v = window.__test.view(); return { phase: v.phase, winner: v.winner, turn: v.turn, me: window.__test.me(), vp: v.players.map((p) => p.name) }; });
console.log(JSON.stringify({ result, counts, bankTrades: trades, errors }));
await browser.close();
server.kill();
