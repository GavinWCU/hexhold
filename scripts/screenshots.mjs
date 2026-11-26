// Captures every render mode at several game moments, desktop + phone, and writes a contact sheet.
// Usage: npm run build && npm run screenshots   (uses CHROME env var or Playwright's Chromium)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const MODES = (process.env.MODES ?? 'pixel3d,smooth3d,iso2d,top2d').split(',');
const MOMENTS = (process.env.MOMENTS ?? 'empty,setup,mid,seven,trade,end').split(',');
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
const PORT = 4173;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: 'packages/client', stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const shots = [];
async function shot(mode, moment, size, extra = '') {
  const [w, h] = SIZES[size];
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.error(mode, moment, e.message));
  await page.goto(`http://localhost:${PORT}/?mode=${mode}&moment=${moment}&seed=${process.env.SEED ?? 5}${extra}`);
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const dir = `screenshots/${mode}`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${moment}-${size}.png`;
  await page.screenshot({ path: file });
  shots.push({ mode, moment, size, file: file.replace('screenshots/', '') });
  console.log('saved', file);
  await page.close();
}
try {
  for (const size of ['desktop', 'phone']) await shot('pixel3d', 'style', size);
  for (const mode of MODES) for (const moment of MOMENTS) for (const size of Object.keys(SIZES)) await shot(mode, moment, size);
} finally {
  await browser.close();
  server.kill();
}
const html = `<!doctype html><meta charset=utf-8><title>Hexhold screenshots</title>
<style>body{background:#241c2b;color:#fff;font-family:sans-serif}figure{display:inline-block;margin:8px;vertical-align:top}img{max-height:340px;border:2px solid #555}</style>
${[...new Set(shots.map((s) => s.mode))].map((m) => `<h2>${m}</h2>` + shots.filter((s) => s.mode === m).map((s) => `<figure><img src="${s.file}"><figcaption>${s.moment} · ${s.size}</figcaption></figure>`).join('')).join('')}`;
writeFileSync('screenshots/index.html', html);
console.log('contact sheet: screenshots/index.html');
