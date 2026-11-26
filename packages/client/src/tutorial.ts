// Guided tutorial: Sly the Bandit coaches you through a real practice game.
// Each step explains one idea, points at the board, and waits for you to do it.
import {
  Action, CharterType, GameState, Hand, PIPS, RESOURCES, Resource, TERRAIN_RESOURCE, nextRandom, vertexValue, legalHamletVertices,
} from '@hexhold/engine';
import type { GameHost } from './controller';
import type { View } from './session';
import type { Marker } from './scene3d';
import { FloatingLabels, Pt } from './fx';
import { icon } from './icons';
import { play } from './sound';

const ME = 0;
const RES_LABEL: Record<Resource, string> = { timber: 'Timber', clay: 'Clay', fleece: 'Fleece', grain: 'Grain', stone: 'Stone' };
const TERRAIN_LABEL: Record<string, string> = { woodland: 'Woodland', claypits: 'Claypits', meadow: 'Meadow', farmland: 'Farmland', highlands: 'Highlands', wastes: 'Wastes' };

export interface TutorialApi {
  host: GameHost;
  renderer: () => { setHighlights(l: Marker[], color?: string): void; hexScreen(id: number): Pt; vertexScreen(id: number): Pt };
  closeDialogs: () => void;
  refresh: () => void;
  finish: (keepPlaying: boolean) => void;
}

interface Step {
  title: string;
  text: (v: View, t: Tutorial) => string;
  next?: string; // label of a Next button (info steps)
  allow?: Action['type'][];
  bots?: boolean; // let the bots play during this step
  enter?: (t: Tutorial, v: View) => void;
  leave?: (t: Tutorial) => void;
  done?: (v: View, t: Tutorial) => boolean;
  highlights?: (v: View, t: Tutorial) => Marker[];
  hlColor?: string;
  topUp?: (v: View, t: Tutorial) => void; // keep the player able to finish the step
}

const mine = (v: GameState) => Object.values(v.buildings).filter((b) => b.owner === ME);
const myRoads = (v: GameState) => Object.values(v.roads).filter((o) => o === ME).length;
const cost = (c: Partial<Hand>) => RESOURCES.flatMap((r) => Array(c[r] ?? 0).fill(icon(r, 'xs'))).join('');

/** Find an RNG seed whose next two dice add up to `total`. */
function seedFor(total: number) {
  for (let seed = 1; seed < 200000; seed++) {
    const h = { rng: seed };
    const d = Math.floor(nextRandom(h) * 6) + 1 + Math.floor(nextRandom(h) * 6) + 1;
    if (d === total) return seed;
  }
  return 1;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to the Isle!',
    text: () => `I'm <b>Sly</b>, the Bandit. Yes, the one who'll be stealing your cards later. Fair's fair, so I'll teach you how to play first.<br><br>This is a practice game against three easy bots. You'll do every move yourself.`,
    next: "Let's go",
  },
  {
    title: 'How to win',
    text: () => `Be the first to <b>10 renown <span class="st">★</span></b> on your turn.<br><br><span class="tline">${hamletIcon()} Hamlet = 1<span class="st">★</span></span><span class="tline">${keepIcon()} Keep = 2<span class="st">★</span></span><span class="tline">+ a few bonuses I'll show you at the end.</span>`,
    next: 'Next',
  },
  {
    title: 'Tiles make resources',
    text: () => `Each tile produces one resource:<br>${RESOURCES.map((r) => `<span class="tline">${icon(r)} ${RES_LABEL[r]} from ${TERRAIN_LABEL[Object.keys(TERRAIN_RESOURCE).find((k) => TERRAIN_RESOURCE[k as keyof typeof TERRAIN_RESOURCE] === r)!]}</span>`).join('')}<span class="tline dim">The Wastes make nothing. That's where I live.</span>`,
    next: 'Next',
    enter: (t, v) => {
      for (const h of v.geo.hexes) {
        const r = TERRAIN_RESOURCE[v.terrains[h.id]];
        t.labels.add(r ? `${icon(r)}<span>${RES_LABEL[r]}</span>` : '<span>nothing</span>', () => t.api.renderer().hexScreen(h.id), r ? '' : 'dim');
      }
    },
    leave: (t) => t.labels.clear(),
  },
  {
    title: 'Numbers and dice',
    text: () => `<div class="tdice"><b>3</b><b>5</b></div>Every turn the player rolls two dice. Every tile showing that number pays out, to <b>everyone</b> with a building touching it.<br><br>The <b class="red">red 6 and 8</b> come up most. The dots under a number show how often it rolls: more dots, more cards.`,
    next: 'Got it',
    highlights: (v) => v.geo.hexes.filter((h) => v.numbers[h.id] === 6 || v.numbers[h.id] === 8).map((h) => ({ kind: 'hex' as const, id: h.id })),
    hlColor: '#ff6b6b',
  },
  {
    title: 'Place your first Hamlet',
    text: () => `Tap a <b class="gold">glowing corner</b> to place a Hamlet. Hamlets sit where tiles meet and collect from every tile they touch.<br><br>Hamlets can't be right next to another one. The <b class="cyan">blue ring</b> marks a strong spot: lots of dots and different resources.`,
    allow: ['PLACE_HAMLET'],
    done: (v) => mine(v).length >= 1,
    highlights: (v, t) => t.bestSpot(v),
  },
  {
    title: 'Now a Road',
    text: () => `Every Hamlet gets a Road. Tap a glowing edge.<br><br>Roads are how you reach new places to build.`,
    allow: ['PLACE_ROAD'],
    done: (v) => myRoads(v) >= 1,
  },
  {
    title: 'Everyone places',
    text: () => `Watch the bots place theirs. The second round goes in <b>reverse order</b>, so the last player gets two picks in a row.`,
    bots: true,
    done: (v) => v.phase === 'setup' && v.setup!.order[v.setup!.index] === ME,
  },
  {
    title: 'Your second Hamlet',
    text: () => `Place your second Hamlet. This one pays you <b>right away</b>: one card from each tile it touches.<br><br>Tip: pick resources your first Hamlet doesn't get.`,
    allow: ['PLACE_HAMLET'],
    done: (v) => mine(v).length >= 2,
    highlights: (v, t) => t.bestSpot(v),
  },
  {
    title: 'Starting hand',
    text: () => `See the cards fly into your hand? Those are your starting resources. Now place its Road.`,
    allow: ['PLACE_ROAD'],
    done: (v) => myRoads(v) >= 2 && v.phase === 'preRoll',
  },
  {
    title: 'Roll the dice',
    text: () => `It's your turn. Tap <b>Roll dice</b> and watch which tiles pay you.`,
    allow: ['ROLL'],
    enter: (t, v) => t.rig(t.goodRoll(v)),
    done: (v) => !!v.dice && v.phase === 'main',
  },
  {
    title: 'Collecting',
    text: (v) => `You rolled <b>${v.dice ? v.dice[0] + v.dice[1] : ''}</b>. The highlighted tiles paid out to every Hamlet touching them, including other players'.<br><br>That's the rhythm of the game: roll, collect, then trade and build.`,
    next: 'Next',
    highlights: (v) => v.dice ? v.geo.hexes.filter((h) => v.numbers[h.id] === v.dice![0] + v.dice![1]).map((h) => ({ kind: 'hex' as const, id: h.id })) : [],
  },
  {
    title: 'Building costs',
    text: () => `<span class="tline"><b>Road</b> ${cost({ clay: 1, timber: 1 })}</span><span class="tline"><b>Hamlet</b> ${cost({ clay: 1, timber: 1, fleece: 1, grain: 1 })}</span><span class="tline"><b>Keep</b> ${cost({ stone: 3, grain: 2 })} (upgrades a Hamlet)</span><span class="tline"><b>Charter</b> ${cost({ stone: 1, fleece: 1, grain: 1 })}</span>The buttons show the cost too.`,
    next: 'Next',
  },
  {
    title: 'Build a Road',
    text: () => `I've slipped you some cards. Tap <b>Road</b>, then a glowing edge that touches your pieces.`,
    allow: ['BUILD_ROAD'],
    enter: (t) => t.give({ clay: 1, timber: 1 }),
    done: (v) => myRoads(v) >= 3,
  },
  {
    title: 'Build a Hamlet',
    text: (v) => legalHamletVertices(v, ME).length
      ? `There's an open corner at the end of your road. Tap <b>Hamlet</b>, then the glowing corner.`
      : `New Hamlets must be on your road and two steps from any other building. Keep building <b>Roads</b> until a corner glows, then tap <b>Hamlet</b>.`,
    allow: ['BUILD_ROAD', 'BUILD_HAMLET'],
    enter: (t) => t.give({ clay: 2, timber: 2, fleece: 1, grain: 1 }),
    topUp: (v, t) => {
      const h = v.players[ME].hand;
      if (!legalHamletVertices(v, ME).length && (h.clay < 1 || h.timber < 1)) t.give({ clay: 2, timber: 2, fleece: 1, grain: 1 });
      if (legalHamletVertices(v, ME).length && (h.clay < 1 || h.timber < 1 || h.fleece < 1 || h.grain < 1)) t.give({ clay: 1, timber: 1, fleece: 1, grain: 1 });
    },
    done: (v) => mine(v).length >= 3,
  },
  {
    title: 'Upgrade to a Keep',
    text: () => `Keeps are worth <b>2<span class="st">★</span></b> and collect <b>2 cards</b> instead of 1. Tap <b>Keep</b>, then one of your Hamlets.`,
    allow: ['BUILD_KEEP'],
    enter: (t) => t.give({ stone: 3, grain: 2 }),
    done: (v) => mine(v).some((b) => b.kind === 'keep'),
  },
  {
    title: 'Trading',
    text: () => `Missing something? Trade for it. Tap <b>Trade</b>, choose <b>Bank & ports</b>, then swap some Timber for 1 card of anything. The bank's normal rate is 4 for 1.<br><br>Building on a <b>port</b> by the coast gives better rates (3:1 or 2:1). On your turn you can also offer trades to other players.`,
    allow: ['BANK_TRADE'],
    enter: (t) => { t.give({ timber: 4 }); t.mark(); },
    done: (v, t) => t.since(v).some((l) => l.includes('with the bank')),
  },
  {
    title: 'Charters',
    text: () => `Charters are special cards. Tap <b>Charter</b> to buy one for ${cost({ stone: 1, fleece: 1, grain: 1 })}.<br><br>There are five kinds: Warden, Monument (1<span class="st">★</span>, secret), Pathmakers (2 free roads), Windfall (2 free cards) and Embargo (take everyone's cards of one kind).`,
    allow: ['BUY_CHARTER'],
    enter: (t) => { t.give({ stone: 1, fleece: 1, grain: 1 }); t.topCard('warden'); },
    done: (v) => v.players[ME].charters.length >= 1,
  },
  {
    title: 'End your turn',
    text: () => `You got a <b>Warden</b>! Charters can't be played the turn you buy them, so save it.<br><br>Tap <b>End turn</b>.`,
    allow: ['END_TURN'],
    done: (v) => v.current !== ME,
  },
  {
    title: "Others' turns",
    text: () => `The bots take their turns now. You still collect when their rolls hit your tiles.`,
    bots: true,
    done: (v) => v.current === ME && v.phase === 'preRoll',
  },
  {
    title: 'Uh oh, a 7',
    text: (v) => v.phase === 'discard' && v.pendingDiscards[ME] !== undefined
      ? `A <b>7</b>! Nobody collects on a 7. Anyone holding <b>more than 7 cards</b> must discard half, and that's you. Choose ${v.pendingDiscards[ME]} cards to drop.`
      : v.phase === 'discard' ? 'Waiting for the others to discard…' : `Roll again. (Psst: it's going to be a 7. Holding lots of cards is risky!)`,
    allow: ['ROLL', 'DISCARD'],
    bots: true,
    enter: (t) => { t.setHand({ timber: 2, clay: 2, fleece: 2, grain: 2, stone: 1 }); t.rig(7); },
    done: (v) => v.phase === 'bandit',
  },
  {
    title: 'Move me!',
    text: () => `Whoever rolls a 7 moves me, the Bandit. Tap any glowing tile.<br><br>My tile <b>stops producing</b> until I'm moved again, and you <b>steal a random card</b> from a player with a building there. Pick a rival's best tile!`,
    allow: ['MOVE_BANDIT'],
    done: (v) => v.phase === 'main',
  },
  {
    title: 'Play your Warden',
    text: (v) => v.phase === 'bandit'
      ? `Now pick a tile for me again.`
      : `Your Warden moves me too, and no 7 is needed. Tap <b>Charters</b> and play it.<br><br>The first player to play <b>3 Wardens</b> becomes <b>Watch Captain</b>: +2<span class="st">★</span>.`,
    allow: ['PLAY_WARDEN', 'MOVE_BANDIT'],
    done: (v) => v.players[ME].wardensPlayed >= 1 && v.phase === 'main',
  },
  {
    title: 'Bonus renown',
    text: () => `<span class="tline"><b>Grand Road</b>: first to build a 5-road chain gets +2<span class="st">★</span>. A longer road steals it.</span><span class="tline"><b>Watch Captain</b>: first to play 3 Wardens gets +2<span class="st">★</span>.</span><span class="tline"><b>Monuments</b>: secret charters worth 1<span class="st">★</span> each.</span>Only one charter per turn, and it can be before you roll.`,
    next: 'Next',
  },
  {
    title: "You're ready!",
    text: () => `That's everything. Roll, collect, trade, build, and race to <b>10<span class="st">★</span></b>.<br><br>Keep playing this game against the bots, or head to the menu to start fresh or invite friends.`,
  },
];

export class Tutorial {
  i = -1;
  labels = new FloatingLabels();
  private el: HTMLElement;
  private logMark = 0;
  private lastHtml = '';
  private view: View | null = null;

  constructor(public api: TutorialApi) {
    this.el = document.createElement('div');
    this.el.id = 'coach';
    document.getElementById('app')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('[data-coach]')?.getAttribute('data-coach');
      if (act === 'next') { play('click'); this.go(this.i + 1); }
      if (act === 'skip') this.end(true);
      if (act === 'keep') this.end(true);
      if (act === 'menu') this.end(false);
      if (act === 'min') { this.el.classList.toggle('min'); }
    });
    api.host.paused = true;
    api.host.botDelay = 450;
  }

  get step() { return STEPS[this.i]; }
  get total() { return STEPS.length; }

  start(v: View) { this.view = v; this.go(0); }

  private go(n: number) {
    if (this.i >= 0) STEPS[this.i]?.leave?.(this);
    this.i = n;
    const st = this.step;
    if (!st) return;
    this.api.host.paused = !st.bots;
    if (st.bots) this.api.host.schedule();
    const v = this.view!;
    st.enter?.(this, (this.api.host.state as View));
    play('coach');
    this.lastHtml = '';
    this.render(this.view ?? v);
    setTimeout(() => this.api.refresh(), 0); // update banner and clickable spots for the new step
  }

  /** Called by the game screen after every state change. */
  refresh(v: View) {
    this.view = v;
    const st = this.step;
    if (!st) return;
    if (st.done?.(v, this)) { this.go(this.i + 1); return; }
    if (st.topUp && v.phase === 'main' && v.current === ME) setTimeout(() => this.step === st && st.topUp!(this.api.host.state as View, this), 300);
    this.render(v);
  }

  private render(v: View) {
    const st = this.step;
    if (!st) return;
    this.api.renderer().setHighlights(st.highlights?.(v, this) ?? [], st.hlColor);
    const last = this.i === STEPS.length - 1;
    const html = `
      <div class="coach-head"><canvas class="fox" width="10" height="12"></canvas><div><div class="coach-title">${st.title}</div><div class="coach-prog">Step ${this.i + 1} of ${STEPS.length}</div></div>
        <button class="coach-min" data-coach="min" aria-label="Minimize">–</button></div>
      <div class="coach-text">${st.text(v, this)}</div>
      <div class="coach-btns">
        ${st.next ? `<button class="btn go" data-coach="next">${st.next}</button>` : ''}
        ${last ? '<button class="btn go" data-coach="keep">Keep playing</button><button class="btn alt" data-coach="menu">Main menu</button>' : '<button class="linkbtn" data-coach="skip">Skip tutorial</button>'}
      </div>
      <div class="coach-bar"><i style="width:${((this.i + 1) / STEPS.length) * 100}%"></i></div>`;
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    this.el.innerHTML = html;
    drawFox(this.el.querySelector('canvas.fox') as HTMLCanvasElement);
  }

  /** Should this action go through right now? */
  allows(a: Action) {
    if (a.type === 'DISCARD' || a.type === 'RESPOND_TRADE') return true;
    const st = this.step;
    if (!st) return true;
    return !!st.allow?.includes(a.type);
  }
  blockedMessage() { return this.step?.next ? `Read Sly's tip, then tap ${this.step.next}.` : 'Follow the tip from Sly first.'; }

  // ---- helpers used by steps ----
  give(h: Partial<Hand>) {
    const p = this.api.host.state.players[ME];
    for (const r of RESOURCES) p.hand[r] = Math.max(p.hand[r], h[r] ?? 0);
    this.api.host.touch();
  }
  setHand(h: Hand) { this.api.host.state.players[ME].hand = { ...h }; this.api.host.touch(); }
  rig(total: number) { this.api.host.state.rng = seedFor(total); }
  topCard(t: CharterType) {
    const d = this.api.host.state.deck;
    const i = d.lastIndexOf(t);
    if (i >= 0) d.splice(i, 1);
    d.push(t);
  }
  mark() { this.logMark = this.api.host.state.log.length; }
  since(v: View) { return v.log.slice(this.logMark); }
  bestSpot(v: View): Marker[] {
    const spots = legalHamletVertices(v, ME, true);
    if (!spots.length) return [];
    const best = spots.sort((a, b) => vertexValue(v, b, ME) - vertexValue(v, a, ME))[0];
    return [{ kind: 'vertex', id: best }];
  }
  /** A roll that pays the player something (the best-producing number they touch). */
  goodRoll(v: GameState) {
    let best = 8, score = -1;
    for (const [vx, b] of Object.entries(v.buildings)) {
      if (b.owner !== ME) continue;
      for (const h of v.geo.vertices[Number(vx)].hexes) {
        const n = v.numbers[h];
        if (n != null && h !== v.bandit && PIPS[n] > score) { score = PIPS[n]; best = n; }
      }
    }
    return best;
  }

  end(keepPlaying: boolean) {
    this.step?.leave?.(this);
    this.labels.clear();
    this.api.renderer().setHighlights([]);
    this.i = STEPS.length;
    this.el.remove();
    this.api.host.paused = false;
    this.api.host.botDelay = null;
    this.api.closeDialogs();
    this.api.host.schedule();
    this.api.finish(keepPlaying);
  }
  get active() { return this.i >= 0 && this.i < STEPS.length; }
  /** Info-only steps: no clickable spots, no action prompts. */
  get quiet() { const st = this.step; return !!st && (!!st.next || this.i === STEPS.length - 1); }
}

export function attachTutorial(api: TutorialApi, v: View) {
  const t = new Tutorial(api);
  t.start(v);
  return t;
}

// little pixel portraits
function drawFox(c: HTMLCanvasElement | null) {
  if (!c) return;
  const g = c.getContext('2d')!;
  const rows = ['..o....o..', '.oo....oo.', '.oooooooo.', 'kkykkkkykk', '.oowwwwoo.', '..owwkwo..', '...pppp...', '..pppppp..', '.pppqpppp.', '.pppqppppy', 'pppppppppy', 'pppppppppp'];
  const col: Record<string, string> = { o: '#e0742f', k: '#241c2b', y: '#f2c14e', w: '#fffaf2', p: '#5b3a7a', q: '#7a4f9c' };
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') { g.fillStyle = col[ch]; g.fillRect(x, y, 1, 1); } }));
}
function hamletIcon() { return '<i class="mini hamlet"></i>'; }
function keepIcon() { return '<i class="mini keep"></i>'; }
