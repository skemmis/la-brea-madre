/**
 * The sound of the Parking Pulse — generative ambient, Eno by way of the DMV.
 *
 * A single fixed chord (D major pentatonic, so any combination of notes is
 * consonant — there are no wrong notes), with each violation family assigned
 * one tone within it. Every ticket sounds its family's note as a slow pad —
 * long attack, long release, heavy reverb tail. Underneath, a low drone thrums
 * and opens up as violations/hour climbs, so the city's busyness IS the bass.
 *
 * All Web Audio; no samples, no dependencies. Must be started from a user
 * gesture (browsers block autoplay).
 */

// D major pentatonic across a warm register, indexed to FAMILIES order
// (street_clean, meter, permit, plates, overtime, forbidden, sundry).
const NOTES = [
  220.0, // A3  — street cleaning: the grounding heartbeat you hear most
  293.66, // D4 — meter
  164.81, // E3 — permit
  369.99, // F#4 — plates
  329.63, // E4 — overtime
  246.94, // B3 — forbidden zones: the brightest, most plaintive tone
  185.0, // F#3 — sundry
];

/** A synthetic reverb impulse: noise with an exponential decay tail. */
function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export class PulseAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private bassGain!: GainNode;
  private bassFilter!: BiquadFilterNode;
  private voices = 0;
  running = false;

  start() {
    if (this.running) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    this.ctx = ctx;
    const t = ctx.currentTime;

    // Master chain: a gentle compressor catches any pile-ups.
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    // The long reverb tail every voice and the drone share.
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 5, 3);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    reverb.connect(wet);
    wet.connect(master);
    this.reverb = reverb;

    // The drone: D1 + A1 sines under a lowpass, gain/cutoff driven by density.
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowpass";
    bassFilter.frequency.value = 140;
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0;
    bassFilter.connect(bassGain);
    bassGain.connect(master);
    bassGain.connect(reverb);
    for (const f of [36.71, 55.0]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f < 40 ? 0.7 : 0.45;
      o.connect(g);
      g.connect(bassFilter);
      o.start();
    }
    this.bassGain = bassGain;
    this.bassFilter = bassFilter;

    // A slow breath on the whole bed, so it never sits perfectly still.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain);
    lfoGain.connect(master.gain);
    lfo.start();

    master.gain.setTargetAtTime(0.5, t, 2); // fade in
    this.running = true;
  }

  /** Sound one ticket: its family's note, as a slow reverberant pad. */
  note(family: number, fine: number) {
    const ctx = this.ctx;
    if (!ctx || !this.running || this.voices > 10) return;
    const now = ctx.currentTime;
    let freq = NOTES[family] ?? 220;
    if (fine > 150) freq *= 2; // a shimmer an octave up on the heavy ones

    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = freq;
    o2.detune.value = -6; // a hair of chorus

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2000;

    const g = ctx.createGain();
    g.gain.value = 0;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(this.master); // dry
    g.connect(this.reverb); // and into the tail

    const peak = Math.min(0.9, 0.35 + fine / 400) * 0.22;
    const A = 1.6;
    const R = 4.5;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + A);
    g.gain.exponentialRampToValueAtTime(0.0001, now + A + R);

    o1.start(now);
    o2.start(now);
    o1.stop(now + A + R + 0.1);
    o2.stop(now + A + R + 0.1);
    this.voices++;
    o1.onended = () => {
      this.voices--;
    };
  }

  /** The drone follows the day's intensity: violations/hour → bass presence. */
  setDensity(perHour: number) {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const d = Math.min(1, perHour / 500);
    this.bassGain.gain.setTargetAtTime(0.1 + d * 0.55, ctx.currentTime, 5);
    this.bassFilter.frequency.setTargetAtTime(120 + d * 280, ctx.currentTime, 5);
  }

  stop() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.running = false;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    setTimeout(() => {
      ctx.close();
      this.ctx = null;
    }, 1200);
  }
}
