// Tiny synthesized sound effects (WebAudio, no audio files).
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem('hexhold.muted') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('hexhold.muted', m ? '1' : '0'); } catch { /* ignore */ }
}

function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.08) {
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(vol, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.02);
}

function noise(start: number, dur: number, vol = 0.12) {
  const a = ac();
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  const g = a.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g).connect(a.destination);
  src.start(a.currentTime + start);
}

export function play(name: string) {
  if (muted) return;
  try {
    switch (name) {
      case 'dice': for (let i = 0; i < 5; i++) noise(i * 0.06, 0.04, 0.15); tone(660, 0.32, 0.08); break;
      case 'seven': for (let i = 0; i < 5; i++) noise(i * 0.06, 0.04, 0.15); tone(220, 0.32, 0.25, 'sawtooth', 0.06); tone(165, 0.45, 0.3, 'sawtooth', 0.06); break;
      case 'build': tone(392, 0, 0.08); tone(523, 0.08, 0.12); break;
      case 'road': tone(330, 0, 0.06, 'triangle', 0.12); break;
      case 'steal': tone(300, 0, 0.1, 'sawtooth', 0.05); tone(200, 0.1, 0.15, 'sawtooth', 0.05); break;
      case 'trade': tone(659, 0, 0.08, 'triangle', 0.1); tone(880, 0.08, 0.12, 'triangle', 0.1); break;
      case 'offer': tone(587, 0, 0.1, 'triangle', 0.1); break;
      case 'collect': [784, 988, 1175].forEach((f, i) => tone(f, 0.25 + i * 0.07, 0.07, 'triangle', 0.07)); break;
      case 'coach': tone(660, 0, 0.06, 'triangle', 0.06); tone(880, 0.06, 0.08, 'triangle', 0.06); break;
      case 'card': tone(784, 0, 0.05, 'triangle', 0.08); tone(988, 0.05, 0.08, 'triangle', 0.08); break;
      case 'turn': tone(523, 0, 0.06, 'triangle', 0.06); break;
      case 'yourturn': tone(523, 0, 0.08); tone(659, 0.08, 0.08); tone(784, 0.16, 0.12); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.2)); break;
      case 'error': tone(140, 0, 0.12, 'square', 0.05); break;
      default: tone(880, 0, 0.03, 'triangle', 0.04);
    }
  } catch { /* audio not available */ }
}
