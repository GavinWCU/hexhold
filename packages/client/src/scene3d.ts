// Low-poly 3D renderer. In "pixel" mode the WebGL canvas is rendered at a small size and
// scaled up with nearest-neighbor (CSS image-rendering: pixelated) for the pixel-art look.
import * as THREE from 'three';
import { GameState, PIPS, TERRAIN_RESOURCE } from '@hexhold/engine';
import { PAL } from './palette';
import { TEX, tinted, domeCanvas, cloudCanvas, tokenCanvas, labelCanvas, reseed } from './textures';

export type CameraPreset = 'board' | 'close' | 'top';
export interface Scene3DOptions { pixel: boolean; pixelHeight?: number; camera?: CameraPreset; focusHex?: number }

let mr = 1;
const modelRand = () => { mr = (mr * 16807) % 2147483647; return mr / 2147483647; };
const texCache = new Map<string, THREE.Texture>();
function tex(key: string, make: () => HTMLCanvasElement, repeat = 1) {
  const k = key + repeat;
  let t = texCache.get(k);
  if (!t) {
    t = new THREE.CanvasTexture(make());
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(k, t);
  }
  return t;
}
const mat = (key: string, make: () => HTMLCanvasElement, repeat = 1) =>
  new THREE.MeshLambertMaterial({ map: tex(key, make, repeat), flatShading: true });
const flat = (color: string) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return o;
}

// ---------- Models ----------

function pine(scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), mat('dirt', TEX.dirt));
  trunk.position.y = 0.06;
  g.add(trunk);
  const m = mat('pine', TEX.pine);
  [[0.2, 0.26, 0.2], [0.16, 0.22, 0.34], [0.11, 0.18, 0.46]].forEach(([r, h, y]) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), m);
    c.position.y = y;
    c.rotation.y = modelRand();
    g.add(c);
  });
  g.scale.setScalar(scale);
  return shadowed(g);
}

function sheep() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.09), mat('wool', TEX.wool));
  body.position.y = 0.08;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), flat(PAL.dark));
  head.position.set(0.09, 0.1, 0);
  g.add(body, head);
  for (const [x, z] of [[-0.04, -0.03], [0.04, -0.03], [-0.04, 0.03], [0.04, 0.03]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), flat(PAL.dark));
    leg.position.set(x, 0.02, z);
    g.add(leg);
  }
  return shadowed(g);
}

function fence(len = 0.5) {
  const g = new THREE.Group();
  const m = mat('plank', TEX.plank);
  const n = Math.max(2, Math.round(len / 0.12));
  for (let i = 0; i <= n; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.11, 0.025), m);
    p.position.set(-len / 2 + (i * len) / n, 0.055, 0);
    g.add(p);
  }
  for (const y of [0.04, 0.085]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.015, 0.012), m);
    rail.position.y = y;
    g.add(rail);
  }
  return shadowed(g);
}

function windmill() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.26, 6), flat(PAL.wool));
  body.position.y = 0.13;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.1, 6), flat(PAL.clay0));
  roof.position.y = 0.31;
  const hub = new THREE.Group();
  hub.position.set(0, 0.24, 0.08);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.008), mat('plank', TEX.plank));
    blade.position.y = 0.09;
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    arm.add(blade);
    hub.add(arm);
  }
  hub.name = 'blades';
  g.add(body, roof, hub);
  return shadowed(g);
}

function rock(s = 1) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0), mat('rock', TEX.rock));
  m.scale.set(s, s * (1.2 + modelRand() * 0.8), s);
  m.rotation.set(modelRand(), modelRand(), modelRand() * 0.3);
  return shadowed(m);
}

function peak() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 5), mat('rock', TEX.rock));
  m.position.y = 0.25;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 5), flat(PAL.snow));
  cap.position.y = 0.43;
  g.add(m, cap);
  return shadowed(g);
}

function clayMound() {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), mat('clay', TEX.clay));
  m.scale.set(1.3, 0.55, 1);
  m.rotation.y = modelRand() * 3;
  m.position.y = 0.04;
  return shadowed(m);
}

function kiln() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.16, 6), mat('clay', TEX.clay));
  b.position.y = 0.08;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 5), flat(PAL.dark));
  top.position.y = 0.2;
  g.add(b, top);
  return shadowed(g);
}

function cactus() {
  const g = new THREE.Group();
  const m = flat('#4f9a45');
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), m);
  t.position.y = 0.11;
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), m);
  a.position.set(0.05, 0.14, 0);
  g.add(t, a);
  return shadowed(g);
}

function dune() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), mat('sand', TEX.sand));
  m.scale.set(1.3, 0.35, 0.9);
  return shadowed(m);
}

function wheatTuft() {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 4), flat(PAL.wheat0));
  m.position.y = 0.06;
  return shadowed(m);
}

export function hamlet(color: string) {
  const g = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.16), new THREE.MeshLambertMaterial({ map: tex('wall' + color, () => tinted(color)), flatShading: true }));
  walls.position.y = 0.07;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 4), mat('plank', TEX.plank));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.2;
  roof.scale.set(1.05, 1, 0.85);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.01), flat(PAL.wood0));
  door.position.set(0, 0.035, 0.081);
  g.add(walls, roof, door);
  return shadowed(g);
}

export function keep(color: string) {
  const g = new THREE.Group();
  const wm = new THREE.MeshLambertMaterial({ map: tex('wall' + color, () => tinted(color)), flatShading: true });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.2), wm);
  base.position.y = 0.07;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.13), wm);
  tower.position.set(0.05, 0.15, 0);
  g.add(base, tower);
  const stone = mat('rock', TEX.rock);
  for (const [x, z] of [[-0.01, -0.05], [0.11, -0.05], [-0.01, 0.05], [0.11, 0.05]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.04), stone);
    c.position.set(x, 0.32, z);
    g.add(c);
  }
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.01), flat(PAL.wood0));
  pole.position.set(0.05, 0.4, 0);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.008), flat(color));
  flag.position.set(0.09, 0.43, 0);
  g.add(pole, flag);
  return shadowed(g);
}

/** The Bandit: an original masked fox in a hooded purple cloak, carrying a loot sack. */
export function bandit() {
  const g = new THREE.Group();
  const cloakM = new THREE.MeshLambertMaterial({ map: tex('cloak', () => tinted(PAL.purple)), flatShading: true });
  const furM = new THREE.MeshLambertMaterial({ map: tex('fur', () => tinted(PAL.fox)), flatShading: true });
  const whiteM = flat(PAL.white), darkM = flat(PAL.dark), goldM = flat('#f2c14e');
  const add = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); g.add(m); return m; };

  // feet + cloak + hood
  add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.09), darkM), -0.05, 0.02, 0.04);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.09), darkM), 0.05, 0.02, 0.04);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.18, 0.32, 7), cloakM), 0, 0.18, 0);
  const trim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.176, 0.025, 7), flat(PAL.purple2)), 0, 0.04, 0);
  trim.castShadow = true;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.05, 7), flat(PAL.purple2)), 0, 0.33, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), goldM), 0, 0.33, 0.105); // clasp
  const hood = add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.6), cloakM), 0, 0.42, -0.05);
  hood.rotation.x = -0.5;

  // paws: one tucked, one holding the loot sack
  add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), furM), 0.13, 0.2, 0.06);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), furM), -0.14, 0.22, 0.05);
  const sack = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), flat('#c9a26b')), -0.19, 0.15, 0.07);
  sack.scale.set(1, 1.15, 1);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.03, 5), flat(PAL.wood1)), -0.2, 0.24, 0.06); // tie
  add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), goldM), -0.2, 0.16, 0.135); // coin mark

  // head
  const head = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), furM), 0, 0.47, 0.02);
  head.scale.set(1.15, 0.95, 1);
  for (const sx of [-1, 1]) {
    const cheek = add(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 4), whiteM), sx * 0.115, 0.41, 0.06);
    cheek.rotation.z = sx * 2.5;
    const ear = add(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), furM), sx * 0.08, 0.6, 0.0);
    ear.rotation.z = -sx * 0.25;
    const inner = add(new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 4), darkM), sx * 0.078, 0.59, 0.03);
    inner.rotation.z = -sx * 0.25;
    // eye-mask patches (separate per eye, joined over the nose) with white eyes and dark pupils
    const patch = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.03), darkM), sx * 0.06, 0.485, 0.122);
    patch.rotation.z = -sx * 0.35; // slanted, sly bandit mask
    const eye = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.01), goldM), sx * 0.058, 0.488, 0.14);
    eye.rotation.z = -sx * 0.35;
    add(new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.018, 0.01), darkM), sx * 0.05, 0.488, 0.146);
  }
  add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), darkM), 0, 0.5, 0.125); // mask bridge
  const muzzle = add(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 5), whiteM), 0, 0.43, 0.16);
  muzzle.rotation.x = Math.PI / 2;
  add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.03), darkM), 0, 0.43, 0.24);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), darkM), 0, 0.392, 0.19); // grin

  // fluffy tail with white tip
  const tail = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), furM), 0.12, 0.12, -0.17);
  tail.scale.set(0.9, 0.9, 1.6);
  const tip = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.05, 0), whiteM), 0.15, 0.16, -0.29);
  tip.scale.set(1, 1, 1.2);
  return shadowed(g);
}

function road(color: string) {
  const g = new THREE.Group();
  const plank = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.09), new THREE.MeshLambertMaterial({ map: tex('wall' + color, () => tinted(color)), flatShading: true }));
  plank.position.y = 0.03;
  g.add(plank);
  return shadowed(g);
}

function cloud() {
  const t = new THREE.CanvasTexture(cloudCanvas());
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, fog: false }));
  s.scale.set(8, 2, 1);
  return s;
}

function sprite(canvas: HTMLCanvasElement, w: number, h: number) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true }));
  s.scale.set(w, h, 1);
  return s;
}

// ---------- Scene ----------

const TERRAIN_TOP: Record<string, [string, () => HTMLCanvasElement, number]> = {
  woodland: ['forestFloor', TEX.forestFloor, 0.16],
  meadow: ['meadow', TEX.meadow, 0.12],
  farmland: ['field', TEX.field, 0.12],
  claypits: ['clay', TEX.clay, 0.14],
  highlands: ['rock', TEX.rock, 0.22],
  wastes: ['sand', TEX.sand, 0.1],
};

export interface Marker { kind: 'vertex' | 'edge' | 'hex'; id: number }

export class Scene3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  animated: { obj: THREE.Object3D; kind: string; base: number }[] = [];
  water?: THREE.Texture;
  clouds: THREE.Sprite[] = [];
  onPick: ((m: Marker) => void) | null = null;
  private t0 = performance.now();
  private dynamic = new THREE.Group();
  private markerGroup = new THREE.Group();
  private hitTargets: THREE.Object3D[] = [];
  private known = new Set<string>();
  private drops: { obj: THREE.Object3D; y: number; t: number }[] = [];
  private banditObj: THREE.Object3D | null = null;
  private banditHop: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  private lastBandit = -1;
  private geoState: GameState | null = null;
  private basePos = new THREE.Vector3();
  private baseLook = new THREE.Vector3();
  private pan = new THREE.Vector2();
  private zoom = 1;
  private markerList: Marker[] = [];

  constructor(private canvas: HTMLCanvasElement, private opts: Scene3DOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.pixel, preserveDrawingBuffer: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = opts.pixel ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(opts.camera === 'close' ? 32 : 38, 1, 0.1, 200);
    this.installControls();
  }

  resize(w: number, h: number) {
    const ph = this.opts.pixel ? this.opts.pixelHeight ?? 270 : h;
    const scale = ph / h;
    this.renderer.setPixelRatio(this.opts.pixel ? 1 : Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(Math.round(w * scale), Math.round(h * scale), false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.style.imageRendering = this.opts.pixel ? 'pixelated' : 'auto';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.geoState) this.placeCamera(this.geoState);
  }

  /** Board, scenery, sky: built once per game. */
  buildStatic(s: GameState) {
    reseed(99);
    const sc = this.scene;
    sc.clear();
    this.animated = [];
    this.geoState = s;

    sc.add(new THREE.HemisphereLight('#bfd4ff', '#5c7a3a', 1.1));
    const sun = new THREE.DirectionalLight('#ffe1b8', 2.2);
    sun.position.set(-6, 10, 6);
    sun.castShadow = true;
    const sz = this.opts.pixel ? 512 : 2048;
    sun.shadow.mapSize.set(sz, sz);
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -10; cam.right = 10; cam.top = 10; cam.bottom = -10;
    sun.shadow.bias = -0.002;
    sc.add(sun);

    const skyT = new THREE.CanvasTexture(domeCanvas(160));
    skyT.magFilter = skyT.minFilter = THREE.NearestFilter;
    skyT.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(90, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, fog: false }));
    sc.add(dome);
    sc.background = new THREE.Color(PAL.sky4);

    this.water = tex('water', TEX.water, 14).clone();
    this.water.needsUpdate = true;
    this.water.repeat.set(42, 42);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshLambertMaterial({ map: this.water }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.12;
    sea.receiveShadow = true;
    sc.add(sea);

    const rand = mulberry(7);
    const sandMat = mat('sand', TEX.sand);
    const dirtMat = mat('dirt', TEX.dirt);

    for (const hx of s.geo.hexes) {
      const terrain = s.terrains[hx.id];
      const [key, make, height] = TERRAIN_TOP[terrain];
      const g = new THREE.Group();
      g.position.set(hx.x, 0, hx.y);
      const beach = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.18, 0.12, 6), sandMat);
      beach.position.y = -0.07;
      beach.receiveShadow = true;
      g.add(beach);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.98, height, 6), dirtMat);
      body.position.y = height / 2 - 0.02;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.96, 0.03, 6), mat(key, make, 2));
      top.position.y = height;
      body.receiveShadow = top.receiveShadow = true;
      g.add(body, top);

      const deco = new THREE.Group();
      deco.position.y = height + 0.015;
      g.add(deco);
      const spot = (minR = 0.45, maxR = 0.75) => {
        const a = rand() * Math.PI * 2, r = minR + rand() * (maxR - minR);
        return [Math.cos(a) * r, Math.sin(a) * r] as const;
      };
      const put = (o: THREE.Object3D, minR?: number, maxR?: number) => {
        const [x, z] = spot(minR, maxR);
        o.position.x = x; o.position.z = z;
        o.rotation.y += rand() * Math.PI;
        deco.add(o);
        return o;
      };
      if (terrain === 'woodland') for (let i = 0; i < 6; i++) put(pine(0.8 + rand() * 0.5), 0.38, 0.78);
      if (terrain === 'meadow') {
        for (let i = 0; i < 3; i++) { const sh = put(sheep()); this.animated.push({ obj: sh, kind: 'bob', base: sh.position.y }); }
        const f = fence(0.6); f.position.set(-0.2, 0, -0.62); deco.add(f);
        put(pine(0.7), 0.6, 0.8);
      }
      if (terrain === 'farmland') {
        for (let i = 0; i < 10; i++) put(wheatTuft(), 0.4, 0.8);
        const wm = put(windmill(), 0.55, 0.65);
        this.animated.push({ obj: wm.getObjectByName('blades')!, kind: 'spin', base: 0 });
      }
      if (terrain === 'claypits') { for (let i = 0; i < 3; i++) put(clayMound(), 0.4, 0.75); put(kiln(), 0.55, 0.7); }
      if (terrain === 'highlands') { const p = peak(); p.position.set(0.3, 0, -0.45); deco.add(p); for (let i = 0; i < 4; i++) put(rock(0.6 + rand() * 0.5), 0.45, 0.8); }
      if (terrain === 'wastes') { for (let i = 0; i < 3; i++) put(dune(), 0.2, 0.7); for (let i = 0; i < 2; i++) put(cactus(), 0.3, 0.7); }

      const n = s.numbers[hx.id];
      if (n != null) {
        const token = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.31, 0.05, 12), flat(PAL.tokenEdge));
        const ft = new THREE.CanvasTexture(tokenCanvas(n, PIPS[n]));
        ft.magFilter = ft.minFilter = THREE.NearestFilter; ft.colorSpace = THREE.SRGBColorSpace;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshLambertMaterial({ map: ft, transparent: true }));
        face.rotation.x = -Math.PI / 2;
        face.position.y = 0.026;
        token.add(disc, face);
        token.position.y = height + 0.04;
        disc.castShadow = true;
        g.add(token);
      }
      sc.add(g);
    }

    for (const p of s.ports) {
      const out = new THREE.Vector2(p.x, p.y).normalize();
      const g = new THREE.Group();
      g.position.set(p.x + out.x * 0.35, 0, p.y + out.y * 0.35);
      g.rotation.y = -Math.atan2(out.y, out.x);
      const dock = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.22), mat('plank', TEX.plank));
      dock.position.y = -0.03;
      const label = sprite(labelCanvas(p.kind === 'any' ? '3:1' : '2:1', p.kind === 'any' ? PAL.token : RES_COLOR[p.kind]), 0.5, 0.25);
      label.position.set(0.2, 0.45, 0);
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.1), mat('plank', TEX.plank));
      const sail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 3), flat(PAL.white));
      sail.position.y = 0.14;
      boat.add(hull, sail);
      boat.position.set(0.35, -0.06, 0.2);
      this.animated.push({ obj: boat, kind: 'float', base: -0.06 });
      g.add(shadowed(dock), label, shadowed(boat));
      sc.add(g);
    }

    this.clouds = [];
    for (let i = 0; i < 12; i++) {
      const c = cloud();
      const a = -Math.PI / 2 + (rand() - 0.5) * 2.4;
      c.position.set(Math.cos(a) * 55, 4 + rand() * 9, Math.sin(a) * 55);
      c.scale.multiplyScalar(1.6 + rand() * 1.4);
      this.clouds.push(c);
      sc.add(c);
    }
    sc.fog = new THREE.Fog(PAL.sky4, 25, 85);

    this.dynamic = new THREE.Group();
    this.markerGroup = new THREE.Group();
    this.hlGroup = new THREE.Group();
    sc.add(this.dynamic, this.markerGroup, this.hlGroup);
    this.known.clear();
    this.lastBandit = -1;
    this.placeCamera(s);
  }

  private vHeight(s: GameState, v: number) { return Math.max(...s.geo.vertices[v].hexes.map((h) => TERRAIN_TOP[s.terrains[h]][2])); }
  private eHeight(s: GameState, e: number) { return Math.max(...s.geo.edges[e].hexes.map((h) => TERRAIN_TOP[s.terrains[h]][2])); }

  /** Pieces and the Bandit: rebuilt on every state change; new pieces drop in. */
  update(s: GameState) {
    const g = this.dynamic;
    g.clear();
    const rand = mulberry(11);
    const now = performance.now();
    const seen = new Set<string>();
    const firstBuild = this.known.size === 0 && this.lastBandit === -1;
    for (const [eid, owner] of Object.entries(s.roads)) {
      const e = s.geo.edges[Number(eid)];
      const a = s.geo.vertices[e.a], b = s.geo.vertices[e.b];
      const r = road(s.players[owner].color);
      const y = this.eHeight(s, e.id);
      r.position.set((a.x + b.x) / 2, y, (a.y + b.y) / 2);
      r.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
      g.add(r);
      const key = `r${eid}`;
      seen.add(key);
      if (!this.known.has(key) && !firstBuild) this.drops.push({ obj: r, y, t: now });
    }
    for (const [vid, bld] of Object.entries(s.buildings)) {
      const v = s.geo.vertices[Number(vid)];
      const m = bld.kind === 'keep' ? keep(s.players[bld.owner].color) : hamlet(s.players[bld.owner].color);
      const y = this.vHeight(s, v.id);
      m.position.set(v.x, y, v.y);
      m.rotation.y = rand() * Math.PI;
      m.scale.setScalar(1.25);
      g.add(m);
      const key = `b${vid}${bld.kind}`;
      seen.add(key);
      if (!this.known.has(key) && !firstBuild) this.drops.push({ obj: m, y, t: now });
    }
    this.known = seen;
    // Drops reference objects from the previous build; keep only the new ones.
    this.drops = this.drops.filter((d) => d.obj.parent === g);

    const bh = s.geo.hexes[s.bandit];
    const bd = bandit();
    bd.scale.setScalar(this.opts.camera === 'close' ? 1.7 : 2.1);
    const to = new THREE.Vector3(bh.x + 0.35, TERRAIN_TOP[s.terrains[bh.id]][2], bh.y + 0.25);
    if (this.banditObj && this.lastBandit !== -1 && this.lastBandit !== s.bandit) {
      this.banditHop = { from: this.banditObj.position.clone(), to, t: now };
      bd.position.copy(this.banditObj.position);
    } else bd.position.copy(to);
    bd.rotation.y = -0.4;
    this.banditObj = bd;
    this.lastBandit = s.bandit;
    g.add(bd);
  }

  build(s: GameState) { this.buildStatic(s); this.update(s); }

  // ---------- markers & picking ----------

  setMarkers(list: Marker[]) {
    this.markerList = list;
    const s = this.geoState;
    const g = this.markerGroup;
    g.clear();
    this.hitTargets = [];
    if (!s) return;
    const glow = new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.9, fog: false });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    for (const m of list) {
      let vis: THREE.Mesh, hit: THREE.Mesh;
      if (m.kind === 'vertex') {
        const v = s.geo.vertices[m.id];
        const y = this.vHeight(s, m.id);
        vis = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8), glow);
        vis.position.set(v.x, y + 0.08, v.y);
        hit = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 4), hidden);
        hit.position.copy(vis.position);
      } else if (m.kind === 'edge') {
        const e = s.geo.edges[m.id];
        const a = s.geo.vertices[e.a], b = s.geo.vertices[e.b];
        vis = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.08), glow);
        vis.position.set((a.x + b.x) / 2, this.eHeight(s, m.id) + 0.06, (a.y + b.y) / 2);
        vis.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
        hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.32), hidden);
        hit.position.copy(vis.position);
        hit.rotation.copy(vis.rotation);
      } else {
        const h = s.geo.hexes[m.id];
        const y = TERRAIN_TOP[s.terrains[m.id]][2];
        vis = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.04, 3, 6), glow);
        vis.rotation.x = Math.PI / 2;
        vis.rotation.z = Math.PI / 6;
        vis.position.set(h.x, y + 0.06, h.y);
        hit = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.6, 6), hidden);
        hit.position.set(h.x, y, h.y);
      }
      hit.userData.marker = m;
      vis.userData.pulse = true;
      g.add(vis, hit);
      this.hitTargets.push(hit);
    }
  }

  private installControls() {
    const el = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number } | null = null;
    let moved = 0;
    let pinch = 0;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      downAt = { x: e.clientX, y: e.clientY };
      moved = 0;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.setZoom(this.zoom * (pinch / d));
        pinch = d;
      } else if (moved > 6) {
        const k = (this.camera.position.distanceTo(this.baseLook) / el.clientHeight) * 1.1;
        this.pan.x -= dx * k;
        this.pan.y -= dy * k;
        const lim = 6;
        this.pan.clampScalar(-lim, lim);
        this.applyCamera();
      }
    });
    const up = (e: PointerEvent) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (wasSingle && downAt && moved <= 6) this.pick(e.clientX, e.clientY);
      downAt = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.setZoom(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9)); }, { passive: false });
  }

  private setZoom(z: number) { this.zoom = Math.min(1.6, Math.max(0.45, z)); this.applyCamera(); }
  resetView() { this.pan.set(0, 0); this.zoom = 1; this.applyCamera(); }

  private pick(cx: number, cy: number) {
    if (!this.onPick || !this.hitTargets.length) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.hitTargets, false);
    if (hits.length) this.onPick(hits[0].object.userData.marker as Marker);
  }

  /** Screen position (CSS px) of a marker — used by tests and tooltips. */
  screenOf(m: Marker): { x: number; y: number } | null {
    const t = this.hitTargets.find((h) => { const mm = h.userData.marker as Marker; return mm.kind === m.kind && mm.id === m.id; });
    if (!t) return null;
    const p = t.position.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }
  markers() { return this.markerList; }

  /** Screen position (CSS px) of a board point. */
  project(x: number, z: number, y = 0.2): { x: number; y: number } {
    const p = new THREE.Vector3(x, y, z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }
  hexScreen(id: number) { const s = this.geoState!; const h = s.geo.hexes[id]; return this.project(h.x, h.y, TERRAIN_TOP[s.terrains[id]][2] + 0.1); }
  vertexScreen(id: number) { const s = this.geoState!; const v = s.geo.vertices[id]; return this.project(v.x, v.y, this.vHeight(s, id) + 0.15); }
  edgeScreen(id: number) { const s = this.geoState!; const e = s.geo.edges[id]; const a = s.geo.vertices[e.a], b = s.geo.vertices[e.b]; return this.project((a.x + b.x) / 2, (a.y + b.y) / 2, this.eHeight(s, id) + 0.1); }

  private hlGroup = new THREE.Group();
  /** Non-clickable rings that point things out (tutorial). */
  setHighlights(list: Marker[], color = '#5ff2ff') {
    const s = this.geoState;
    this.hlGroup.clear();
    if (!this.hlGroup.parent) this.scene.add(this.hlGroup);
    if (!s) return;
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false });
    for (const h of list) {
      let o: THREE.Mesh;
      if (h.kind === 'hex') {
        const hx = s.geo.hexes[h.id];
        o = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 3, 6), m);
        o.rotation.x = Math.PI / 2; o.rotation.z = Math.PI / 6;
        o.position.set(hx.x, TERRAIN_TOP[s.terrains[h.id]][2] + 0.08, hx.y);
      } else if (h.kind === 'vertex') {
        const v = s.geo.vertices[h.id];
        o = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 3, 10), m);
        o.rotation.x = Math.PI / 2;
        o.position.set(v.x, this.vHeight(s, h.id) + 0.1, v.y);
      } else {
        const e = s.geo.edges[h.id]; const a = s.geo.vertices[e.a], b = s.geo.vertices[e.b];
        o = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.12), m);
        o.position.set((a.x + b.x) / 2, this.eHeight(s, h.id) + 0.1, (a.y + b.y) / 2);
        o.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
      }
      o.userData.pulse = true;
      this.hlGroup.add(o);
    }
  }

  placeCamera(s: GameState) {
    const preset = this.opts.camera ?? 'board';
    const span = Math.max(...s.geo.hexes.map((h) => Math.hypot(h.x, h.y))) + 1;
    if (preset === 'top') {
      this.basePos.set(0, span * 2.6, span * 0.6);
      this.baseLook.set(0, 0, 0.2);
    } else if (preset === 'close') {
      const h = s.geo.hexes[this.opts.focusHex ?? 0];
      this.basePos.set(h.x - 0.2, 0.95, h.y + 2.7);
      this.baseLook.set(h.x + 0.1, 0.72, h.y - 0.1);
    } else {
      const portrait = this.camera.aspect < 1;
      const dist = span * (portrait ? 2.9 / this.camera.aspect * 0.7 : 1.95);
      this.basePos.set(0, dist * 0.78, dist * 0.82);
      this.baseLook.set(0, -0.2, portrait ? 0.3 : 0.35);
    }
    this.applyCamera();
  }

  private applyCamera() {
    const off = new THREE.Vector3(this.pan.x, 0, this.pan.y);
    const look = this.baseLook.clone().add(off);
    const pos = this.basePos.clone().sub(this.baseLook).multiplyScalar(this.zoom).add(look);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
  }

  render() {
    const now = performance.now();
    const t = (now - this.t0) / 1000;
    for (const a of this.animated) {
      if (a.kind === 'spin') a.obj.rotation.z = t * 1.5;
      if (a.kind === 'bob') a.obj.position.y = a.base + Math.abs(Math.sin(t * 3 + a.obj.id)) * 0.02;
      if (a.kind === 'float') a.obj.position.y = a.base + Math.sin(t * 2 + a.obj.id) * 0.015;
    }
    if (this.banditObj) {
      this.banditObj.rotation.z = Math.sin(t * 2) * 0.05;
      if (this.banditHop) {
        const k = Math.min(1, (now - this.banditHop.t) / 500);
        this.banditObj.position.lerpVectors(this.banditHop.from, this.banditHop.to, k);
        this.banditObj.position.y += Math.sin(k * Math.PI) * 0.8;
        if (k >= 1) this.banditHop = null;
      }
    }
    this.drops = this.drops.filter((d) => {
      const k = Math.min(1, (now - d.t) / 350);
      const ease = 1 - Math.pow(1 - k, 3);
      d.obj.position.y = d.y + (1 - ease) * 0.9;
      return k < 1;
    });
    const pulse = 0.55 + Math.abs(Math.sin(t * 4)) * 0.45;
    this.markerGroup.children.forEach((c) => { if (c.userData.pulse) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = pulse; });
    this.hlGroup.children.forEach((c) => { (c as THREE.Mesh).position.y += Math.sin(t * 5) * 0.0015; ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.4 + pulse * 0.6; });
    if (this.water) { this.water.offset.x = (t * 0.02) % 1; this.water.offset.y = Math.sin(t * 0.5) * 0.01; }
    for (const c of this.clouds) c.position.x += 0.003;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); }
}

export const RES_COLOR: Record<string, string> = {
  timber: PAL.pine2, clay: PAL.clay2, fleece: PAL.wool, grain: PAL.wheat1, stone: PAL.rock2,
};

function mulberry(a: number) {
  return () => { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export { TERRAIN_RESOURCE };
