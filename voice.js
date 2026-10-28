// Audio + xAI plumbing: mic capture with simple voice-activity detection, speech-to-text,
// streamed chat, sentence-by-sentence text-to-speech played through an analyser so the
// hologram reacts to the real voice amplitude.
import { clamp } from './fx.js';

const SILENT_MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/84TAAAAAAAAAAAAASW5mbwAAAA8AAAANAAAFoAAzMzMzMzMzRERERERERERVVVVVVVVVVWZmZmZmZmZ3d3d3d3d3d4iIiIiIiIiImZmZmZmZmaqqqqqqqqqqu7u7u7u7u7vMzMzMzMzM3d3d3d3d3d3u7u7u7u7u7v////////8AAAAATGF2YzYxLjE5AAAAAAAAAAAAAAAAJAOQAAAAAAAABaBTBYX9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/80TEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEUwAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEpgAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';

// Playback goes through ONE reusable <audio> element that is primed inside the first tap.
// iOS only lets media play after a user gesture, and <audio> (unlike Web Audio) still plays with
// the ring/silent switch on. The AudioContext is only used for the mic level and to measure the
// reply's loudness envelope (decoding makes no sound), which drives the orb's audio-reactive glow.
export class AudioEngine {
  constructor() {
    this.ctx = null; this.out = null; this.micAn = null; this.stream = null;
    this.freq = new Uint8Array(256); this.time = new Uint8Array(1024);
    this.current = null; this.el = null; this.env = null; this.primed = false; this.blocked = null;
    this.onBlocked = null; this.onError = null;
  }
  // must run synchronously inside a user gesture (click / touchend / keydown)
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx && AC) {
      this.ctx = new AC();
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    }
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    setSession('playback');
    if (!this.el) {
      this.el = new Audio(); this.el.preload = 'auto'; this.el.setAttribute('playsinline', ''); this.el.setAttribute('webkit-playsinline', '');
    }
    if (!this.primed && !this.current) {
      const el = this.el; el.src = SILENT_MP3; el.muted = false; el.volume = 1;
      const p = el.play();
      p?.then?.(() => { this.primed = true; this.blocked = null; }).catch((e) => { this.blocked = e; this.onBlocked?.(e); });
    }
  }
  get audioOK() { return this.primed && !this.blocked; }
  // Plays one MP3 (ArrayBuffer). Resolves when it ends; rejects with a readable error.
  async play(arrayBuffer, rate = 1) {
    if (!this.el) this.unlock();
    this.stop();
    const el = this.el, url = URL.createObjectURL(new Blob([arrayBuffer], { type: 'audio/mpeg' }));
    this.env = null; this.envelope(arrayBuffer.slice(0));
    const job = { el, url };
    this.current = job;
    try {
      await new Promise((resolve, reject) => {
        job.resolve = resolve;
        el.onended = () => resolve();
        el.onerror = () => reject(new Error(`Audio playback error (${el.error?.code || '?'})`));
        el.src = url; el.defaultPlaybackRate = rate; el.playbackRate = rate;
        const p = el.play();
        p?.then?.(() => { this.primed = true; this.blocked = null; }).catch((e) => {
          if (e.name === 'NotAllowedError') { this.blocked = e; this.onBlocked?.(e); }
          reject(e.name === 'NotAllowedError' ? new Error('Sound is blocked: tap the screen once, turn off silent mode and turn the volume up.') : e);
        });
      });
    } finally {
      if (this.current === job) this.current = null;
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  // loudness 0..1 at the current playback position (100 steps per second)
  level() {
    if (!this.current || !this.env) return this.current ? 0.35 : 0;
    const i = Math.floor(this.el.currentTime * 100);
    return this.env[Math.min(this.env.length - 1, i)] || 0;
  }
  async envelope(ab) {
    try {
      if (!this.ctx) return;
      const buf = await new Promise((res, rej) => { const p = this.ctx.decodeAudioData(ab, res, rej); p?.then?.(res, rej); });
      const d = buf.getChannelData(0), step = Math.floor(buf.sampleRate / 100), env = new Float32Array(Math.ceil(d.length / step));
      for (let i = 0; i < env.length; i++) { let s = 0; const o = i * step; for (let j = 0; j < step && o + j < d.length; j++) s += d[o + j] * d[o + j]; env[i] = Math.sqrt(s / step); }
      this.env = env;
    } catch {}
  }
  // Level (0..1) and a 64-bin spectrum from either the mic or the speaker analyser.
  read(an, spectrum) {
    if (!an) return 0;
    an.getByteTimeDomainData(this.time);
    let sum = 0; const n = Math.min(an.fftSize, this.time.length);
    for (let i = 0; i < n; i++) { const v = (this.time[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / n);
    if (spectrum) {
      an.getByteFrequencyData(this.freq);
      const bins = an.frequencyBinCount;
      for (let i = 0; i < spectrum.length; i++) {
        const lo = Math.floor(Math.pow(i / spectrum.length, 1.6) * bins * 0.45) + 1;
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / spectrum.length, 1.6) * bins * 0.45) + 1);
        let m = 0; for (let j = lo; j < hi; j++) m = Math.max(m, this.freq[j]);
        spectrum[i] = m / 255;
      }
    }
    return rms;
  }
  async openMic() {
    if (!this.ctx) this.unlock();
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    setSession('play-and-record');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.micAn = this.ctx.createAnalyser(); this.micAn.fftSize = 1024; this.micAn.smoothingTimeConstant = 0.5;
    src.connect(this.micAn);
    this.micSrc = src;
    return this.stream;
  }
  closeMic() {
    try { this.micSrc?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null; this.micAn = null; this.micSrc = null;
    setSession('playback');
  }
  stop() {
    const j = this.current; this.current = null;
    if (j) { try { j.el.pause(); } catch {} j.resolve?.(); }
    try { speechSynthesis?.cancel?.(); } catch {}
  }
}

function setSession(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} }

// Records one utterance. Resolves with a Blob (or null if nothing was said).
// Stops on ~1.1 s of silence after speech, a manual stop(), or a 15 s cap.
export class Recorder {
  constructor(engine) { this.engine = engine; this.level = 0; }
  static supported() { return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder); }
  async start() {
    const stream = await this.engine.openMic();
    const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    this.rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.chunks = []; this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.heard = false; this.t0 = performance.now(); this.lastLoud = this.t0; this.floor = 0.01;
    this.done = new Promise((res) => { this.rec.onstop = () => {
      this.engine.closeMic();
      const blob = new Blob(this.chunks, { type: this.rec.mimeType || mimeType || 'audio/webm' });
      res(this.heard || this.manual ? blob : null);
    }; });
    this.rec.start(250);
    return this.done;
  }
  // called every frame while listening; returns 0..1 level for the visuals
  tick(spectrum) {
    if (!this.rec || this.rec.state !== 'recording') return 0;
    const rms = this.engine.read(this.engine.micAn, spectrum);
    const now = performance.now(), el = now - this.t0;
    if (el < 400) this.floor = Math.max(this.floor * 0.9 + rms * 0.1, 0.004);
    const thr = Math.max(0.02, this.floor * 2.6);
    if (rms > thr) { this.lastLoud = now; if (el > 150) this.heard = true; }
    if ((this.heard && now - this.lastLoud > 1100) || el > 15000 || (!this.heard && el > 7000)) this.stop();
    this.level = clamp(rms * 7);
    return this.level;
  }
  stop(manual = false) { if (manual) this.manual = true; if (this.rec?.state === 'recording') this.rec.stop(); }
}

// Browser speech recognition (fallback / optional).
export function browserRecognize(onLevel) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR(); r.lang = navigator.language || 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
  const promise = new Promise((res) => {
    let text = '';
    r.onresult = (e) => { text = Array.from(e.results).map((x) => x[0].transcript).join(' '); };
    r.onspeechstart = () => onLevel?.(0.6); r.onspeechend = () => onLevel?.(0.1);
    r.onerror = () => res(''); r.onend = () => res(text.trim());
  });
  r.start();
  return { promise, stop: () => { try { r.stop(); } catch {} } };
}

// ---- xAI ----
export class XAI {
  constructor(getCfg) { this.getCfg = getCfg; }
  headers(json = true) {
    const { key, base } = this.getCfg();
    const h = {}; if (json) h['Content-Type'] = 'application/json';
    if (key && !base.startsWith('api')) h.Authorization = `Bearer ${key}`;
    return h;
  }
  url(p) { return `${this.getCfg().base}/${p}`; }
  async check(r) {
    if (r.ok) return r;
    let msg = ''; try { msg = (await r.text()).slice(0, 160); } catch {}
    throw new Error(`xAI ${r.status}${r.status === 401 || r.status === 403 ? ' (check your API key)' : ''}: ${msg}`);
  }
  async voices() {
    const r = await this.check(await fetch(this.url('tts/voices'), { headers: this.headers(false) }));
    return (await r.json()).voices || [];
  }
  async transcribe(blob, signal) {
    const fd = new FormData();
    fd.append('model', 'grok-voice-transcribe-2.0');
    for (const k of ['Crumby', 'Island Crumbs', 'Jarvis', 'Tyler']) fd.append('keyterm', k);
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    fd.append('file', blob, `speech.${ext}`); // file must be the last field
    const r = await this.check(await fetch(this.url('stt'), { method: 'POST', headers: this.headers(false), body: fd, signal }));
    const j = await r.json();
    return { text: (j.text || '').trim(), language: j.language };
  }
  // Streams the reply; calls onDelta(textSoFarDelta). Resolves with full text.
  async chat(messages, onDelta, signal) {
    const r = await this.check(await fetch(this.url('chat/completions'), {
      method: 'POST', headers: this.headers(), signal,
      body: JSON.stringify({ model: 'grok-4.20-0309-non-reasoning', stream: true, temperature: 0.8, max_tokens: 300, messages }),
    }));
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try { const d = JSON.parse(data).choices?.[0]?.delta?.content; if (d) { full += d; onDelta(d); } } catch {}
      }
    }
    return full;
  }
  async tts(text, voice, { language = 'en', speed = 1, higherPitch = false } = {}, signal) {
    const body = { text: higherPitch ? `<higher-pitch>${text}</higher-pitch>` : text, voice_id: voice, language, speed,
      output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 64000 } };
    const r = await this.check(await fetch(this.url('tts'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal }));
    const ab = await r.arrayBuffer();
    if (ab.byteLength < 512) throw new Error('xAI TTS returned no audio');
    return ab;
  }
}

// Splits a growing text stream into speakable sentences.
export class Sentencer {
  constructor(onSentence) { this.buf = ''; this.on = onSentence; this.count = 0; }
  push(d) {
    this.buf += d;
    for (;;) {
      const min = this.count === 0 ? 12 : 30;
      const re = /[.!?…]+["')\]]?\s+|\n+/g; let m, cut = -1;
      while ((m = re.exec(this.buf))) { if (m.index + m[0].length >= min) { cut = m.index + m[0].length; break; } }
      if (cut < 0) break;
      this.emit(this.buf.slice(0, cut)); this.buf = this.buf.slice(cut);
    }
  }
  flush() { this.emit(this.buf); this.buf = ''; }
  emit(s) { s = cleanForSpeech(s); if (s) { this.count++; this.on(s); } }
}

export function cleanForSpeech(s) {
  return s.replace(/[*_#`>]+/g, '').replace(/\[(?!giggle|laugh|sigh)[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();
}
export function cleanForCaption(s) { return s.replace(/\[[^\]]*\]|<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
