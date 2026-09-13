export type RecognitionResult = { isFinal: boolean; length: number; [i: number]: { transcript: string; confidence: number } };
export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: { length: number; [i: number]: RecognitionResult } }) => void) | null;
  onspeechstart: (() => void) | null; onspeechend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition; webkitAudioContext?: typeof AudioContext };
export const recognitionClass = () => (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
export class Sound {
  context: AudioContext | null = null;
  enabled = true;
  async unlock() {
    const Ctx = window.AudioContext ?? (window as SpeechWindow).webkitAudioContext;
    if (!Ctx) return;
    this.context ??= new Ctx();
    if (this.context.state === 'suspended') await this.context.resume();
  }
  cue(kind: 'tick' | 'win' | 'sad') {
    if (!this.enabled || !this.context) return;
    const ctx = this.context;
    // Android can suspend audio after speech recognition used the microphone.
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    const notes = kind === 'sad' ? [233.08, 220, 207.65, 196] : kind === 'win' ? [523.25,659.25,783.99,1046.5] : [680];
    const step = kind === 'sad' ? 0.43 : 0.13;
    notes.forEach((freq,i) => {
      const start = ctx.currentTime + i*step;
      const duration = kind === 'sad' && i === 3 ? 1.15 : step*0.9;
      const osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
      osc.type = kind === 'sad' ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(freq,start);
      if (kind === 'sad' && i === 3) osc.frequency.linearRampToValueAtTime(freq*0.84,start+duration);
      filter.type = 'lowpass'; filter.frequency.value = kind === 'sad' ? 850 : 2400;
      gain.gain.setValueAtTime(0,start); gain.gain.linearRampToValueAtTime(kind === 'sad' ? .1 : .035,start+.02);
      gain.gain.setValueAtTime(kind === 'sad' ? .1 : .035,start+duration*.65);
      gain.gain.exponentialRampToValueAtTime(.001,start+duration);
      osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      osc.start(start); osc.stop(start+duration+.02);
    });
  }
}

// Local audio energy complements recognition speech events: network transcription
// delay must not be mistaken for silence. No audio is recorded by this application.
export class MicMeter {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer = 0;
  private generation = 0;
  async start(context: AudioContext, onEnergy: (level: number) => void) {
    this.stop();
    const generation = this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream;
    const analyser = context.createAnalyser(); analyser.fftSize = 1024;
    this.source = context.createMediaStreamSource(stream); this.source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((sum,n) => sum+n*n,0)/data.length);
      onEnergy(rms);
    },80);
    return true;
  }
  stop() { this.generation++; clearInterval(this.timer); this.source?.disconnect(); this.source = null; this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
}

export class Voice {
  private sequence = 0;
  private pending: ((success: boolean) => void) | null = null;
  voiceURI = '';
  language = 'en-US';
  voices() { return 'speechSynthesis' in window ? speechSynthesis.getVoices().filter(v => v.lang.startsWith('en')) : []; }
  cancel() { this.sequence++; if ('speechSynthesis' in window) speechSynthesis.cancel(); this.pending?.(false); this.pending = null; }
  warmup() {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
  }
  speak(word: string): Promise<boolean> {
    this.cancel();
    if (!('speechSynthesis' in window)) return Promise.resolve(false);
    const seq = this.sequence;
    return new Promise(resolve => {
      let ended = false;
      const finish = (ok: boolean) => { if (ended) return; ended = true; clearTimeout(timeout); if (seq === this.sequence) this.pending = null; resolve(ok); };
      this.pending = finish;
      const u = new SpeechSynthesisUtterance(word);
      const available = this.voices();
      u.voice = available.find(v => v.voiceURI === this.voiceURI) ?? available.find(v => v.lang === this.language) ?? available[0] ?? null;
      u.lang = this.language; u.rate = .82; u.pitch = 1.1; u.volume = 1;
      u.onend = () => finish(true); u.onerror = () => finish(false);
      const timeout = setTimeout(() => { finish(false); speechSynthesis.cancel(); },15000);
      try { speechSynthesis.resume(); speechSynthesis.speak(u); } catch { finish(false); }
    });
  }
}
