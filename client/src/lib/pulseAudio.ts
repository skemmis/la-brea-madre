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

// ─────────────────────────────────────────────────────────────────────────────
// THE DIALS — everything tunable lives here, named and commented. To change
// the sound, just tell me e.g. "DIALS.masterGain to 0.6", "reverbWet to 0.4",
// "noteRelease to 7", "drone louder", "permit note to G3 (196)". I'll edit
// these numbers. (Hz cheat-sheet, D-major pentatonic: D 146.83 / E 164.81 /
// F# 185 / A 220 / B 246.94 / D4 293.66 / E4 329.63 / F#4 369.99 / A4 440.)
// ─────────────────────────────────────────────────────────────────────────────
export const DIALS = {
  masterGain: 0.5, // overall volume (0–1)

  // Each violation family's note, in Hz. Order = FAMILIES order:
  // [street_clean, meter, permit, plates, overtime, forbidden, sundry].
  notes: [
    220.0, // A3  — street cleaning: the grounding heartbeat you hear most
    293.66, // D4 — meter
    164.81, // E3 — permit
    369.99, // F#4 — plates
    329.63, // E4 — overtime
    246.94, // B3 — forbidden zones: the brightest, most plaintive tone
    185.0, // F#3 — sundry
  ],
  shimmerFineThreshold: 150, // fines above this sound an octave up
  noteAttack: 1.6, // seconds for a note to swell in
  noteRelease: 4.5, // seconds for a note to fade out
  notePeak: 0.22, // per-note loudness ceiling (before velocity)
  voiceCap: 10, // max simultaneous notes (drops extras when busy)

  reverbWet: 0.6, // how much reverb (0 dry … 1 drenched)
  reverbSeconds: 5, // length of the reverb tail
  reverbDecay: 3, // shape of the tail (higher = faster decay)

  droneGainMin: 0.1, // bass loudness at zero violations/hour
  droneGainMax: 0.65, // bass loudness at full intensity
  droneCutoffMin: 120, // bass filter (Hz) when quiet — muffled
  droneCutoffMax: 400, // bass filter (Hz) when busy — opens up
  densityFull: 500, // violations/hour that counts as "full intensity"
  droneGlide: 5, // seconds the drone takes to follow a density change

  breathRate: 0.05, // Hz of the slow volume "breathing" on the whole bed
  breathDepth: 0.05, // how deep the breath swells
};

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
  private wet!: GainNode;
  private lfo!: OscillatorNode;
  private lfoGain!: GainNode;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array | null = null;
  private voices = 0;
  private lastDensity = 0;
  private lastReverb = { s: 0, d: 0 };
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

    // A tap on the master, so the visuals can vibrate with the sound.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    master.connect(analyser);
    this.analyser = analyser;
    this.buf = new Uint8Array(analyser.fftSize);

    // The long reverb tail every voice and the drone share.
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, DIALS.reverbSeconds, DIALS.reverbDecay);
    const wet = ctx.createGain();
    wet.gain.value = DIALS.reverbWet;
    reverb.connect(wet);
    wet.connect(master);
    this.reverb = reverb;
    this.wet = wet;
    this.lastReverb = { s: DIALS.reverbSeconds, d: DIALS.reverbDecay };

    // The drone: D1 + A1 sines under a lowpass, gain/cutoff driven by density.
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowpass";
    bassFilter.frequency.value = DIALS.droneCutoffMin;
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
    lfo.frequency.value = DIALS.breathRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = DIALS.breathDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(master.gain);
    lfo.start();
    this.lfo = lfo;
    this.lfoGain = lfoGain;

    master.gain.setTargetAtTime(DIALS.masterGain, t, 2); // fade in
    this.running = true;
  }

  /** Push the current DIALS into the live graph — for in-app tuning. */
  applyDials() {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const now = ctx.currentTime;
    this.master.gain.setTargetAtTime(DIALS.masterGain, now, 0.15);
    this.wet.gain.setTargetAtTime(DIALS.reverbWet, now, 0.15);
    this.lfo.frequency.setTargetAtTime(DIALS.breathRate, now, 0.15);
    this.lfoGain.gain.setTargetAtTime(DIALS.breathDepth, now, 0.15);
    // Rebuilding the impulse is the one expensive change — only on demand.
    if (this.lastReverb.s !== DIALS.reverbSeconds || this.lastReverb.d !== DIALS.reverbDecay) {
      this.reverb.buffer = impulse(ctx, DIALS.reverbSeconds, DIALS.reverbDecay);
      this.lastReverb = { s: DIALS.reverbSeconds, d: DIALS.reverbDecay };
    }
    this.setDensity(this.lastDensity); // re-apply drone gain/cutoff
  }

  /** Sound one ticket: its family's note, as a slow reverberant pad. */
  note(family: number, fine: number) {
    const ctx = this.ctx;
    if (!ctx || !this.running || this.voices > DIALS.voiceCap) return;
    const now = ctx.currentTime;
    let freq = DIALS.notes[family] ?? 220;
    if (fine > DIALS.shimmerFineThreshold) freq *= 2; // a shimmer an octave up

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

    const peak = Math.min(0.9, 0.35 + fine / 400) * DIALS.notePeak;
    const A = DIALS.noteAttack;
    const R = DIALS.noteRelease;
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
    this.lastDensity = perHour;
    if (!ctx || !this.running) return;
    const d = Math.min(1, perHour / DIALS.densityFull);
    const gain = DIALS.droneGainMin + d * (DIALS.droneGainMax - DIALS.droneGainMin);
    const cutoff = DIALS.droneCutoffMin + d * (DIALS.droneCutoffMax - DIALS.droneCutoffMin);
    this.bassGain.gain.setTargetAtTime(gain, ctx.currentTime, DIALS.droneGlide);
    this.bassFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, DIALS.droneGlide);
  }

  /** Current output level, 0..1 (RMS of the master tap) — for the visuals. */
  level(): number {
    if (!this.running || !this.analyser || !this.buf) return 0;
    this.analyser.getByteTimeDomainData(this.buf as any);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 3);
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
