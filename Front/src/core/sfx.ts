// All sound is synthesized locally with the Web Audio API — no assets, no services.
import { settings } from './settings';

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

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
    this.tone(880, 0.06, 'square', 0.12, 660);
  }
  hit(): void {
    this.tone(220, 0.12, 'square', 0.2, 90);
    this.noise(0.15, 0.25, 2500);
  }
  bigHit(): void {
    this.tone(140, 0.25, 'sawtooth', 0.28, 50);
    this.noise(0.35, 0.4, 1800);
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
    this.tone(988, 0.05, 'square', 0.14);
    setTimeout(() => this.tone(1319, 0.12, 'square', 0.14), 55);
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
}

export const sfx = new SfxEngine();
