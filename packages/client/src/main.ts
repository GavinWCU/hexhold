import '@fontsource/lilita-one';
import '@fontsource/press-start-2p';
import './style.css';
import { Scene3D } from './scene3d';
import { Render2D } from './render2d';
import { demoState, Moment } from './demo';
import { renderHud } from './hud';

// Preview page. URL params: mode=pixel3d|smooth3d|top2d|iso2d, moment=empty|setup|mid|seven|trade|end|style,
// camera=board|close|top, seed=N, players=3..6, hud=0|1
const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'pixel3d';
const moment = (q.get('moment') ?? 'mid') as Moment;
const seed = Number(q.get('seed') ?? 5);
const players = Number(q.get('players') ?? 4);
const showHud = q.get('hud') !== '0' && moment !== 'style';

import { startApp } from './app';

async function main() {
  if (!q.get('moment')) {
    await document.fonts.load('10px "Press Start 2P"').catch(() => {});
    await document.fonts.load('20px "Lilita One"').catch(() => {});
    startApp();
    return;
  }
  await document.fonts.load('10px "Press Start 2P"');
  await document.fonts.load('20px "Lilita One"');
  const state = demoState(moment, seed, players);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const W = window.innerWidth, H = window.innerHeight;

  let frame: () => void;
  if (mode === 'top2d' || mode === 'iso2d') {
    const r = new Render2D(canvas, mode === 'iso2d', H < W ? 300 : 420);
    r.resize(W, H);
    frame = () => r.draw(state);
  } else {
    const pixel = mode === 'pixel3d';
    const camera = (q.get('camera') ?? (moment === 'style' ? 'close' : 'board')) as 'board' | 'close' | 'top';
    const sc = new Scene3D(canvas, { pixel, pixelHeight: Number(q.get('ph') ?? (H < W ? 270 : 420)), camera, focusHex: (state as { focusHex?: number }).focusHex });
    sc.resize(W, H);
    sc.build(state);
    (window as unknown as { __sc: Scene3D }).__sc = sc;
    frame = () => sc.render();
  }
  if (showHud) renderHud(hud, state, 0, `${mode} · ${moment}`);
  let n = 0;
  const loop = () => { frame(); if (++n === 3) (window as unknown as { __READY: boolean }).__READY = true; requestAnimationFrame(loop); };
  loop();
}

main().catch((e) => { document.body.innerHTML = `<pre style="color:white">${e.stack}</pre>`; (window as unknown as { __READY: boolean }).__READY = true; });
