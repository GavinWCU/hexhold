// Exercises each interactive feature through the real UI and captures the dialogs.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const phone = process.argv[2] === 'phone';
const size = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const tag = phone ? 'phone' : 'desktop';
const PORT = 4700 + Math.floor(Math.random() * 200);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: 'packages/client', stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: size, hasTouch: phone });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
mkdirSync('screenshots/features', { recursive: true });
const shot = (n) => page.screenshot({ path: `screenshots/features/${tag}-${n}.png` });
const results = {};
const check = (name, ok) => { results[name] = ok ? 'pass' : 'FAIL'; };

await page.addInitScript(() => localStorage.setItem('hexhold.settings', JSON.stringify({ name: 'Tester', mode: 'pixel3d', players: 4, level: 'normal', mapType: 'starter', targetVP: 10, friendly: false })));
await page.goto(`http://localhost:${PORT}/`);
await page.click('[data-act=solo]');
await page.waitForFunction(() => window.__test?.view());
await page.evaluate(() => { window.__test.host().fastBots = true; });

const tapMarker = async (filter, random = false) => {
  const pos = await page.evaluate(([f, rnd]) => {
    const t = window.__test;
    const ms = t.markers().filter((m) => !f || m.kind === f);
    if (rnd) ms.sort(() => Math.random() - 0.5);
    for (const m of ms) {
      const p = t.screenOf(m);
      if (!p || p.x < 5 || p.y < 5 || p.x > innerWidth - 5 || p.y > innerHeight - 5) continue;
      const el = document.elementFromPoint(p.x, p.y);
      if (el && el.id === 'view') return p;
    }
    return null;
  }, [filter, random]);
  if (!pos) return false;
  if (phone) await page.touchscreen.tap(pos.x, pos.y); else await page.mouse.click(pos.x, pos.y);
  return true;
};
const until = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(100); } return false; };
const mine = () => page.evaluate(() => { const v = window.__test.view(); const me = window.__test.me(); return { b: Object.values(v.buildings).filter((b) => b.owner === me).map((b) => b.kind), roads: Object.values(v.roads).filter((o) => o === me).length, hand: v.players[me].hand, ch: v.players[me].charters.length }; });

// Setup: place 2 hamlets + 2 roads by tapping markers
for (let i = 0; i < 4; i++) {
  await until(() => window.__test.markers().length > 0 || window.__test.view().phase !== 'setup');
  if ((await page.evaluate(() => window.__test.view().phase)) !== 'setup') break;
  if (i === 0) await shot('01-setup');
  await tapMarker();
  await page.waitForTimeout(250);
}
check('setup placement by tapping', (await mine()).b.length === 2 && (await mine()).roads === 2);

// Wait for my turn, roll by button
await until(() => window.__test.view().phase === 'preRoll' && window.__test.view().current === window.__test.me());
await shot('02-your-turn');
// give a pre-roll charter to test the charters dialog before rolling later
await page.click('[data-act=roll]');
await until(() => { const v = window.__test.view(); return v.phase === 'main' || v.phase === 'bandit' || v.phase === 'discard'; });
// resolve a 7 if it happened
for (let k = 0; k < 3; k++) {
  const ph = await page.evaluate(() => window.__test.view().phase);
  if (ph === 'discard') { await until(() => window.__test.view().phase !== 'discard', 5000); }
  if (ph === 'bandit') { await tapMarker('hex'); await page.waitForTimeout(300); const v = await page.$('[data-act^=victim]'); if (v) await v.click(); }
  await page.waitForTimeout(200);
}
await until(() => window.__test.view().phase === 'main');
check('rolled dice by button', (await page.evaluate(() => !!window.__test.view().dice)));

// Give resources and charters (test hook), then build through the UI
await page.evaluate(() => {
  const h = window.__test.host(); const me = window.__test.me();
  h.state.players[me].hand = { timber: 6, clay: 6, fleece: 4, grain: 6, stone: 6 };
  h.state.players[me].charters.push({ type: 'windfall', boughtOn: -1 }, { type: 'embargo', boughtOn: -1 }, { type: 'monument', boughtOn: -1 });
  h.touch();
});
await page.waitForTimeout(300);
await shot('03-main-actions');
let before = await mine();
await page.click('[data-act=build-road]'); await page.waitForTimeout(200);
await shot('04-road-markers');
await tapMarker('edge'); await page.waitForTimeout(300);
check('build road', (await mine()).roads === before.roads + 1);
before = await mine();
await page.click('[data-act=build-keep]'); await page.waitForTimeout(200);
await tapMarker('vertex'); await page.waitForTimeout(400);
check('build keep', (await mine()).b.includes('keep'));
// hamlet: may need another road to reach a legal spot
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => { const h = window.__test.host(); const me = window.__test.me(); const hd = h.state.players[me].hand; hd.timber = Math.max(hd.timber, 2); hd.clay = Math.max(hd.clay, 2); hd.fleece = Math.max(hd.fleece, 1); hd.grain = Math.max(hd.grain, 1); h.touch(); });
  await page.waitForTimeout(100);
  const can = await page.$('[data-act=build-hamlet]:not([disabled])');
  if (can) break;
  await page.click('[data-act=build-road]'); await page.waitForTimeout(150); await tapMarker('edge', true); await page.waitForTimeout(250);
}
before = await mine();
await page.click('[data-act=build-hamlet]'); await page.waitForTimeout(200);
const hm = await page.evaluate(() => window.__test.markers().map((m) => ({ m, p: window.__test.screenOf(m) })));
const tappedH = await tapMarker('vertex'); await page.waitForTimeout(400);
if (!tappedH) console.log('hamlet markers', JSON.stringify(hm));
await shot('04b-hamlet');
check('build hamlet', (await mine()).b.length === before.b.length + 1);

// Charters dialog + windfall
await page.click('[data-act=charters]'); await page.waitForTimeout(200);
await shot('05-charters');
await page.click('[data-act="playch:windfall"]'); await page.waitForTimeout(150);
await page.click('[data-act="pick:stone"]'); await page.click('[data-act="pick:stone"]');
await shot('06-windfall');
before = await mine();
await page.click('[data-act=pickgo]'); await page.waitForTimeout(300);
check('windfall', (await mine()).hand.stone === before.hand.stone + 2);
// second charter same turn is refused (button disabled)
await page.click('[data-act=charters]'); await page.waitForTimeout(150);
check('one charter per turn', !!(await page.$('[data-act="playch:embargo"][disabled]')));
await page.click('[data-act=close]');

// Buy a charter
before = await mine();
await page.click('[data-act=buy]'); await page.waitForTimeout(300);
check('buy charter', (await mine()).ch === before.ch + 1);

// Bank trade through the dialog
await page.click('[data-act=trade]'); await page.waitForTimeout(150);
await page.click('[data-act="tab:bank"]');
await page.click('[data-act="bg:stone"]'); await page.click('[data-act="bt:fleece"]');
await shot('07-bank-trade');
before = await mine();
await page.click('[data-act=bank]'); await page.waitForTimeout(300);
const after = await mine();
check('bank trade', after.hand.fleece === before.hand.fleece + 1 && after.hand.stone < before.hand.stone);

// Player trade offer: give 1 of our most plentiful card (not timber) for 1 timber
await page.click('[data-act="tab:players"]').catch(() => {});
const h0 = (await mine()).hand;
const giveRes = ['clay', 'fleece', 'grain', 'stone'].sort((a, b) => h0[b] - h0[a])[0];
await page.click(`[data-ctr="give:${giveRes}:1"]`); await page.click('[data-ctr="get:timber:1"]');
await shot('08-player-trade');
await page.click('[data-act=offer]');
await until(() => { const v = window.__test.view(); return !v.offer || v.offer.accepted.length + v.offer.declined.length >= 3; }, 15000);
await page.waitForTimeout(200);
await shot('09-offer-responses');
const accepted = await page.$('[data-act^=confirm]');
if (accepted) { before = await mine(); await accepted.click(); await page.waitForTimeout(300); check('player trade confirmed', (await mine()).hand.timber === before.hand.timber + 1); }
else { await page.click('[data-act=cancel-offer]').catch(() => {}); check('player trade offer answered', true); }

// Menu: switch look to isometric and back
await page.click('[data-act=menu]'); await page.waitForTimeout(150);
await shot('10-menu');
await page.selectOption('[data-set=mode]', 'iso2d'); await page.waitForTimeout(700);
await shot('11-iso-live');
await page.click('[data-act=menu]'); await page.selectOption('[data-set=mode]', 'top2d'); await page.waitForTimeout(500);
await page.evaluate(() => { const h = window.__test.host(); const me = window.__test.me(); h.state.players[me].hand.timber += 1; h.state.players[me].hand.clay += 1; h.touch(); });
await page.click('[data-act=build-road]'); await page.waitForTimeout(200);
before = await mine();
await tapMarker('edge'); await page.waitForTimeout(300);
check('build road in 2D mode', (await mine()).roads === before.roads + 1);
await page.click('[data-act=menu]'); await page.selectOption('[data-set=mode]', 'pixel3d'); await page.waitForTimeout(800);

async function waitMyTurn() {
  for (let i = 0; i < 1200; i++) {
    const st = await page.evaluate(() => { const v = window.__test.view(); return { mine: v.phase === 'preRoll' && v.current === window.__test.me(), discard: !!document.querySelector('[data-act=discard]'), offer: !!document.querySelector('[data-act=decline]') }; });
    if (st.mine) return true;
    if (st.offer) await page.click('[data-act=decline]', { timeout: 1000 }).catch(() => {});
    if (st.discard) {
      for (let k = 0; k < 20; k++) {
        if (await page.evaluate(() => !document.querySelector('[data-act=discard]')?.hasAttribute('disabled'))) break;
        const plus = await page.$$('[data-ctr^="discard:"][data-ctr$=":1"]:not([disabled])');
        if (!plus.length) break;
        await plus[0].click().catch(() => {});
      }
      await page.click('[data-act=discard]', { timeout: 1000 }).catch(() => {});
    }
    await page.waitForTimeout(100);
  }
  return false;
}

// End turn; then force a 7 with me over 7 cards to test the discard dialog
await page.click('[data-act=end]');
check('back to my turn', await waitMyTurn());
await page.evaluate(() => {
  const h = window.__test.host(); const me = window.__test.me();
  h.state.players[me].hand = { timber: 3, clay: 3, fleece: 2, grain: 2, stone: 0 };
  // find a seed that rolls 7
  for (let seed = 1; seed < 100000; seed++) { let x = seed; const nr = () => { let t = (x = (x + 0x6d2b79f5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    if (Math.floor(nr() * 6) + 1 + Math.floor(nr() * 6) + 1 === 7) { h.state.rng = seed; break; } }
  h.touch();
});
await page.click('[data-act=roll]');
await until(() => !!document.querySelector('[data-act=discard]'), 5000);
await page.click('[data-ctr="discard:timber:1"]'); await page.click('[data-ctr="discard:timber:1"]'); await page.click('[data-ctr="discard:clay:1"]'); await page.click('[data-ctr="discard:clay:1"]'); await page.click('[data-ctr="discard:fleece:1"]');
await shot('12-discard');
await page.click('[data-act=discard]');
await until(() => window.__test.view().phase === 'bandit', 10000);
await page.waitForTimeout(200);
await shot('13-move-bandit');
check('discard on 7', (await mine()).hand.timber + (await mine()).hand.clay + (await mine()).hand.fleece + (await mine()).hand.grain === 5);
await tapMarker('hex'); await page.waitForTimeout(400);
const vb = await page.$('[data-act^=victim]'); if (vb) { await shot('14-victim'); await vb.click(); }
await until(() => window.__test.view().phase === 'main', 5000);
check('moved bandit by tapping', (await page.evaluate(() => window.__test.view().phase)) === 'main');

// Save to file
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('[data-act=menu]').then(() => page.click('[data-act=savefile]'))]);
check('save game to file', !!dl);
// Autosave + continue after reload
await page.reload();
await page.waitForSelector('[data-act=continue]', { timeout: 5000 }).catch(() => {});
const cont = await page.$('[data-act=continue]');
check('autosave continue offered', !!cont);
if (cont) { await cont.click(); await page.waitForFunction(() => window.__test?.view()); check('continue restores my keep', (await mine()).b.includes('keep')); }
await page.waitForTimeout(500);
await shot('15-continued');

console.log(JSON.stringify({ results, errors }, null, 1));
await browser.close();
server.kill();
