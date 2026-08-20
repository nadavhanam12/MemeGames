// All sound is synthesized locally with the Web Audio API — no assets, no services.
import { settings } from './settings';

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  // ambient bed: looping ocean noise + a tension drone whose gain follows danger
  private oceanGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneOsc: OscillatorNode | null = null;

  /** ±amt random detune so repeated one-shots never sound identical. */
  private j(freq: number, amt = 0.06): number {
    return freq * (1 + (Math.random() * 2 - 1) * amt);
  }

  /** Must be called from a user gesture to satisfy autoplay policies. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private get on(): boolean {
    return settings.sound && !!this.ctx && !!this.master;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'square',
    vol = 0.25,
    slideTo?: number
  ): void {
    if (!this.on) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.3, filterFreq = 1200): void {
    if (!this.on || !this.noiseBuf) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(filterFreq, t);
    filt.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // ---- game vocabulary ----
  tap(): void {
    const f = this.j(880, 0.08);
    this.tone(f, 0.06, 'square', 0.12, f * 0.75);
  }
  hit(): void {
    this.tone(this.j(220), 0.12, 'square', 0.2, 90);
    this.noise(0.15, 0.25, this.j(2500, 0.15));
  }
  bigHit(): void {
    this.tone(this.j(140), 0.25, 'sawtooth', 0.28, 50);
    this.noise(0.35, 0.4, this.j(1800, 0.15));
  }
  splash(): void {
    this.noise(0.3, 0.22, 700);
  }
  disarm(): void {
    this.tone(520, 0.07, 'square', 0.15);
    setTimeout(() => this.tone(700, 0.07, 'square', 0.15), 70);
    setTimeout(() => this.tone(950, 0.1, 'square', 0.15), 140);
  }
  retreat(): void {
    this.tone(400, 0.25, 'triangle', 0.18, 180);
  }
  coin(): void {
    const f = this.j(988, 0.04);
    this.tone(f, 0.05, 'square', 0.14);
    setTimeout(() => this.tone(f * 1.335, 0.12, 'square', 0.14), 55);
  }
  priceDown(): void {
    this.tone(660, 0.1, 'triangle', 0.16, 440);
  }
  priceUp(): void {
    this.tone(330, 0.12, 'sawtooth', 0.18, 520);
  }
  alarm(): void {
    this.tone(620, 0.15, 'square', 0.16, 660);
    setTimeout(() => this.tone(620, 0.15, 'square', 0.16, 660), 190);
  }
  horn(): void {
    this.tone(140, 0.5, 'sawtooth', 0.3, 138);
    this.tone(180, 0.5, 'sawtooth', 0.2, 178);
  }
  comboSting(level: number): void {
    const base = 520 + level * 60;
    this.tone(base, 0.08, 'square', 0.16);
    setTimeout(() => this.tone(base * 1.25, 0.08, 'square', 0.16), 80);
    setTimeout(() => this.tone(base * 1.5, 0.14, 'square', 0.18), 160);
  }
  upgrade(): void {
    this.tone(392, 0.09, 'square', 0.18);
    setTimeout(() => this.tone(523, 0.09, 'square', 0.18), 90);
    setTimeout(() => this.tone(659, 0.09, 'square', 0.18), 180);
    setTimeout(() => this.tone(784, 0.18, 'square', 0.2), 270);
  }
  eventCard(): void {
    this.tone(196, 0.3, 'sawtooth', 0.22, 196);
    setTimeout(() => this.tone(261, 0.35, 'sawtooth', 0.22), 200);
  }
  tick(urgent: boolean): void {
    this.tone(urgent ? 1200 : 900, 0.04, 'square', urgent ? 0.14 : 0.08);
  }
  fanfare(): void {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'square', 0.18), i * 110));
  }
  whoosh(): void {
    this.noise(0.2, 0.15, 3000);
  }
  /** Streak lost — descending womp, deliberately the inverse of comboSting. */
  comboBreak(): void {
    this.tone(440, 0.18, 'sawtooth', 0.16, 180);
    setTimeout(() => this.tone(300, 0.22, 'sawtooth', 0.14, 110), 110);
  }
  /** Quiet air-rush cue when a new threat enters the map. */
  spawnCue(): void {
    this.noise(0.14, 0.07, this.j(3600, 0.2));
  }
  /** TV-static crackle for the broadcast channel-cut transitions. */
  staticBurst(): void {
    this.noise(0.16, 0.14, 6000);
  }

  // ---- ambient bed ----
  /** Looping ocean-noise bed + silent tension drone; safe to call repeatedly. */
  startAmbient(): void {
    if (!this.ctx || !this.master || !this.noiseBuf || this.oceanGain) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 320;
    // slow LFO on the filter so the wash swells like surf
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.13;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 140;
    lfo.connect(lfoAmt).connect(filt.frequency);
    this.oceanGain = ctx.createGain();
    this.oceanGain.gain.value = 0;
    src.connect(filt).connect(this.oceanGain).connect(this.master);
    src.start();
    lfo.start();
    // tension drone: two detuned saws through a lowpass, gain driven by setTension
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const dFilt = ctx.createBiquadFilter();
    dFilt.type = 'lowpass';
    dFilt.frequency.value = 400;
    for (const f of [55, 55.7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(dFilt);
      o.start();
      if (!this.droneOsc) this.droneOsc = o;
    }
    dFilt.connect(this.droneGain).connect(this.master);
  }

  /** 0..1 danger level — raises the drone (and keeps the ocean bed alive).
   *  Called on a throttle from the game loop; also handles the mute toggle. */
  setTension(level: number): void {
    if (!this.ctx) return;
    if (!this.oceanGain) this.startAmbient();
    if (!this.oceanGain || !this.droneGain) return;
    const t = this.ctx.currentTime;
    const on = settings.sound;
    this.oceanGain.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.4);
    this.droneGain.gain.setTargetAtTime(on ? level * 0.12 : 0, t, 0.3);
    // the drone also creeps up in pitch as things get dire
    this.droneOsc?.frequency.setTargetAtTime(55 + level * 18, t, 0.5);
  }

  /** Fade the bed out (run over / left the game scene). */
  stopAmbient(): void {
    if (!this.ctx || !this.oceanGain || !this.droneGain) return;
    const t = this.ctx.currentTime;
    this.oceanGain.gain.setTargetAtTime(0, t, 0.5);
    this.droneGain.gain.setTargetAtTime(0, t, 0.3);
  }
}

export const sfx = new SfxEngine();
