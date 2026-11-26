// Online room test: a local PeerJS signaling server, a host browser and two friends.
// Checks joining, wrong password, live sync of every move, and reconnecting.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { PeerServer } from 'peer';
import { mkdirSync } from 'node:fs';

const PORT = 4900 + Math.floor(Math.random() * 90);
const PEER_PORT = 9000 + Math.floor(Math.random() * 90);
const peerServer = PeerServer({ port: PEER_PORT, path: '/', host: '127.0.0.1' });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: 'packages/client', stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync('screenshots/online', { recursive: true });
const base = `http://localhost:${PORT}/`;
const peerQ = `peerHost=127.0.0.1&peerPort=${PEER_PORT}`;
const results = {};
const check = (n, ok) => { results[n] = ok ? 'pass' : 'FAIL'; console.log(n, ok ? 'pass' : 'FAIL'); };
const errors = [];

async function open(name, size = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport: size });
  await ctx.addInitScript((n) => { if (!localStorage.getItem('hexhold.settings')) localStorage.setItem('hexhold.settings', JSON.stringify({ name: n, mode: 'top2d', players: 4, level: 'normal', mapType: 'starter', targetVP: 10, friendly: false })); }, name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  return { ctx, page };
}

// Host opens a room with a password
const host = await open('Hosty');
await host.page.goto(`${base}?${peerQ}`);
await host.page.click('[data-act=host]');
await host.page.waitForFunction(() => document.body.innerText.includes('Room open'), null, { timeout: 20000 });
const code = (await host.page.textContent('[data-testid=room-code]')).trim();
await host.page.fill('#pw', 'otter');
await host.page.dispatchEvent('#pw', 'change');
check('room opened with a code', /^[A-Z0-9]{6}$/.test(code));

// Wrong password is refused
const bad = await open('Sneaky');
await bad.page.goto(`${base}?room=${code}&${peerQ}`);
// first visit asks for name when settings lack it; ours has one, so it connects directly with no password
await bad.page.waitForFunction(() => document.body.innerText.includes('Wrong password'), null, { timeout: 20000 }).then(() => check('wrong password refused', true)).catch(() => check('wrong password refused', false));
await bad.ctx.close();

// Two friends join with the password via the home screen join box
async function join(name, size) {
  const f = await open(name, size);
  await f.page.goto(`${base}?${peerQ}`);
  await f.page.fill('#code', code);
  await f.page.fill('#pw', 'otter');
  await f.page.click('[data-act=join]');
  return f;
}
const ana = await join('Ana');
const ben = await join('Ben', { width: 390, height: 844 });
await host.page.waitForFunction(() => document.querySelectorAll('.seat').length === 4 && document.body.innerText.includes('Ana') && document.body.innerText.includes('Ben'), null, { timeout: 20000 }).then(() => check('friends appear in host lobby', true)).catch(() => check('friends appear in host lobby', false));
await ana.page.waitForFunction(() => document.body.innerText.includes('Waiting for the host'), null, { timeout: 10000 }).then(() => check('friend sees lobby', true)).catch(() => check('friend sees lobby', false));
await host.page.screenshot({ path: 'screenshots/online/1-host-lobby.png' });
await ben.page.screenshot({ path: 'screenshots/online/2-friend-lobby-phone.png' });

await host.page.click('[data-act=start]');
const players = [host, ana, ben];
for (const p of players) await p.page.waitForFunction(() => window.__test?.view(), null, { timeout: 20000 });
check('game starts on all screens', true);
await host.page.evaluate(() => { window.__test.host().fastBots = true; });

const snap = (p) => p.page.evaluate(() => { const v = window.__test.view(); return JSON.stringify({ b: v.buildings, r: v.roads, bandit: v.bandit, turn: v.turn, phase: v.phase, cur: v.current }); });
const tap = async (p) => {
  const pos = await p.page.evaluate(() => { const t = window.__test; for (const m of t.markers()) { const s = t.screenOf(m); if (s) return s; } return null; });
  if (pos) await p.page.mouse.click(pos.x, pos.y);
  return !!pos;
};

// Play: every human acts through their own UI until turn 8
let guard = 0;
while (guard++ < 1500) {
  const v = await host.page.evaluate(() => { const v = window.__test.view(); return { phase: v.phase, turn: v.turn }; });
  if (v.turn >= 8 || v.phase === 'ended') break;
  let did = false;
  for (const p of players) {
    const st = await p.page.evaluate(() => { const q = (s) => !!document.querySelector(s); return { markers: window.__test.markers().length, roll: q('[data-act=roll]'), end: q('[data-act=end]'), discard: q('[data-act=discard]'), decline: q('[data-act=decline]'), victim: q('[data-act^=victim]') }; });
    const click = (s) => p.page.click(s, { timeout: 1500 }).then(() => true).catch(() => false);
    if (st.discard) {
      for (let k = 0; k < 20; k++) { if (await p.page.evaluate(() => !document.querySelector('[data-act=discard]')?.hasAttribute('disabled'))) break; const plus = await p.page.$$('[data-ctr^="discard:"][data-ctr$=":1"]:not([disabled])'); if (!plus.length) break; await plus[0].click().catch(() => {}); }
      did = await click('[data-act=discard]');
    } else if (st.victim) did = await click('[data-act^=victim]');
    else if (st.decline) did = await click('[data-act=decline]');
    else if (st.markers) did = await tap(p);
    else if (st.roll) did = await click('[data-act=roll]');
    else if (st.end) did = await click('[data-act=end]');
    if (did) break;
  }
  await host.page.waitForTimeout(did ? 250 : 120);
}
await host.page.waitForTimeout(800);
const [s0, s1, s2] = await Promise.all(players.map(snap));
check('all three screens show the same board', s0 === s1 && s1 === s2);
check('reached turn 8 with friends playing', JSON.parse(s0).turn >= 8);
await host.page.screenshot({ path: 'screenshots/online/3-host-game.png' });
await ana.page.screenshot({ path: 'screenshots/online/4-friend-game.png' });
await ben.page.screenshot({ path: 'screenshots/online/5-friend-phone.png' });

// Hidden information: Ana can't see Ben's cards
const leak = await ana.page.evaluate(() => { const v = window.__test.view(); const me = window.__test.me(); return v.players.some((p) => p.id !== me && Object.values(p.hand).some((n) => n > 0)); });
check('friends cannot see each other’s cards', !leak);

// Ana drops and comes back
const anaSeat = await ana.page.evaluate(() => window.__test.me());
await ana.page.close();
await host.page.waitForFunction((seat) => window.__test.host().seats[seat].online === false, anaSeat, { timeout: 20000 }).then(() => check('host sees friend go offline', true)).catch(() => check('host sees friend go offline', false));
const ana2 = await ana.ctx.newPage();
await ana2.goto(`${base}?room=${code}&${peerQ}`);
await ana2.waitForFunction(() => window.__test?.view(), null, { timeout: 30000 }).catch(() => {});
const back = await ana2.evaluate(() => window.__test?.me?.());
check('friend rejoins the same seat', back === anaSeat);
await host.page.waitForFunction((seat) => window.__test.host().seats[seat].online === true, anaSeat, { timeout: 10000 }).then(() => check('host sees friend back online', true)).catch(() => check('host sees friend back online', false));

console.log(JSON.stringify({ results, errors }, null, 1));
await browser.close();
server.kill();
peerServer.close?.();
process.exit(0);
