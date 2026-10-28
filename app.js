import { clamp, noise } from './fx.js';
import { Stage } from './stage3d.js';
import { PERSONAS, FALLBACK_VOICES } from './persona.js';
import { AudioEngine, Recorder, browserRecognize, XAI, Sentencer, cleanForCaption } from './voice.js';

const $ = (s) => document.querySelector(s);
const qs = new URLSearchParams(location.search);

// ---------- settings (localStorage only; URL params override for this visit) ----------
const DEFAULTS = { char: 'crumby', mode: 'single', views: 'angles', mirror: false, flipV: false, guides: false, size: 1, gap: 0, gain: 1,
  jarvisVoice: 'helios', crumbyVoice: 'ursa', stt: 'xai', captions: false, showcase: false };
const LS = 'holo.settings.v2', KEY = 'holo.xaiKey';
const cfg = { ...DEFAULTS, ...safeJSON(localStorage.getItem(LS)) };
const temp = {};
for (const k of Object.keys(DEFAULTS)) if (qs.has(k)) {
  const v = qs.get(k), d = DEFAULTS[k];
  temp[k] = typeof d === 'boolean' ? v === '1' || v === 'true' : typeof d === 'number' ? +v : v;
}
const get = (k) => (k in temp ? temp[k] : cfg[k]);
function set(k, v) { delete temp[k]; cfg[k] = v; localStorage.setItem(LS, JSON.stringify(cfg)); syncUI(); applyFlip(); }
function safeJSON(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }

let proxy = false;   // true when served by proxy/server.mjs (key lives on the Mac, not in the browser)
const apiKey = () => (localStorage.getItem(KEY) || '').trim();
const live = () => proxy || !!apiKey();
const xai = new XAI(() => ({ key: apiKey(), base: proxy ? 'api' : 'https://api.x.ai/v1' }));

// ---------- stage ----------
const canvas = $('#stage');
const guides = $('#guides'), gctx = guides.getContext('2d');
let stage;
try { stage = new Stage(canvas); } catch (e) { document.body.insertAdjacentHTML('beforeend', '<p id="nogl">This browser could not start WebGL.</p>'); throw e; }
let W = 0, H = 0;
function fit() {
  W = innerWidth; H = innerHeight; stage.resize(W, H);
  const d = Math.min(devicePixelRatio || 1, 2); guides.width = W * d; guides.height = H * d;
}
addEventListener('resize', fit); fit();
function applyFlip() {
  const t = `scale(${get('mirror') ? -1 : 1}, ${get('flipV') ? -1 : 1})`;
  canvas.style.transform = t; guides.style.transform = t;
}

// ---------- live state ----------
const S = { state: 'idle', lvl: 0, mic: 0, oo: 0, spectrum: new Float32Array(64), w: { listen: 0, think: 0, talk: 0 } };
let forced = qs.get('state') || null;          // preview a state with synthetic audio
let synthTalk = false;                          // Web Speech playback: no analyser, fake the level
const engine = new AudioEngine();
let recorder = null, recog = null, abort = null, turnId = 0;
const history = [];

function setState(s) { S.state = s; }

// ---------- render loop ----------
let last = performance.now() / 1000, t0 = last;
const tOverride = qs.has('t') ? +qs.get('t') : null;
function frame() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last); last = now;
  const t = tOverride ?? now - t0;
  const st = forced || showcaseState(t) || S.state;
  const prevState = S.state; S.state = st;

  // levels
  let lvl = 0, mic = 0;
  const spec = S.spectrum;
  if (st === 'talking') {
    if (!forced && !showcaseOn() && engine.current) lvl = clamp(engine.read(engine.out, spec) * 3.2);
    else { lvl = synthLevel(t); synthSpectrum(spec, lvl, t); }
  } else if (st === 'listening') {
    if (!forced && !showcaseOn() && recorder?.rec?.state === 'recording') mic = recorder.tick(spec);
    else if (!forced && !showcaseOn() && recog) { mic = recogLevel * (0.6 + 0.4 * Math.abs(noise(t * 9))); synthSpectrum(spec, mic, t); }
    else { mic = clamp(0.25 + 0.5 * Math.abs(noise(t * 5.3, 2)) * (Math.sin(t * 1.7) > -0.3 ? 1 : 0.2)); synthSpectrum(spec, mic, t); }
  } else for (let i = 0; i < spec.length; i++) spec[i] *= 0.85;
  const a = lvl > S.lvl ? 0.5 : 0.18; S.lvl += (lvl - S.lvl) * a;
  S.mic += (mic - S.mic) * 0.3;
  S.oo = 0.5 + 0.5 * noise(t * 2.3, 5);
  const k = 1 - Math.exp(-dt * 7);
  S.w.listen += ((st === 'listening') - S.w.listen) * k;
  S.w.think += ((st === 'thinking') - S.w.think) * k;
  S.w.talk += ((st === 'talking') - S.w.talk) * k;

  if (tOverride === null) stage.adapt(dt);
  stage.render(get('char'), { mode: get('mode'), views: get('views'), size: get('size'), gap: get('gap'), gain: get('gain') }, dt, t, S);
  drawGuides();
  S.state = prevState;
  requestAnimationFrame(frame);
}

let guidesKey = '';
function drawGuides() {
  const pyr = get('mode') === 'pyramid', key = [get('guides'), pyr, W, H].join();
  if (key === guidesKey) return; guidesKey = key;
  const d = guides.width / W, w = guides.width, h = guides.height;
  gctx.clearRect(0, 0, w, h);
  if (!get('guides')) return;
  gctx.strokeStyle = '#1c2a30'; gctx.lineWidth = Math.max(1, d);
  const L = Math.min(w, h), x = w / 2, y = h / 2;
  gctx.beginPath();
  if (pyr) {
    const c = L / 3; gctx.rect(x - c / 6, y - c / 6, c / 3, c / 3); gctx.rect(x - L / 2, y - L / 2, L, L);
    gctx.moveTo(x - L / 2, y - L / 2); gctx.lineTo(x + L / 2, y + L / 2); gctx.moveTo(x + L / 2, y - L / 2); gctx.lineTo(x - L / 2, y + L / 2);
  } else { gctx.moveTo(0, y); gctx.lineTo(w, y); gctx.moveTo(x, 0); gctx.lineTo(x, h); }
  gctx.stroke();
}

function synthLevel(t) {
  const syll = Math.max(0, Math.sin(t * 9.1) * 0.6 + Math.sin(t * 5.3 + 1) * 0.4);
  const phrase = Math.sin(t * 0.9) > -0.75 ? 1 : 0.1;
  return clamp((0.12 + 0.75 * syll + 0.12 * noise(t * 23)) * phrase);
}
function synthSpectrum(spec, lvl, t) {
  for (let i = 0; i < spec.length; i++) {
    const f = i / spec.length, shape = Math.exp(-Math.pow((f - 0.18) / 0.22, 2)) + 0.35 * Math.exp(-Math.pow((f - 0.55) / 0.2, 2));
    spec[i] = clamp(lvl * shape * (0.65 + 0.35 * noise(t * 11 + i * 0.7, i)));
  }
}

// ---------- showcase loop (silent attract mode) ----------
const showcaseOn = () => get('showcase') && S.state === 'idle' && !forced;
function showcaseState(t) {
  if (!showcaseOn()) return null;
  const p = t % 16;
  return p < 4 ? 'idle' : p < 7 ? 'listening' : p < 9.5 ? 'thinking' : p < 15 ? 'talking' : 'idle';
}

// ---------- conversation ----------
let recogLevel = 0;
async function onTap() {
  engine.unlock(); hint(false); wakeLock();
  if (forced) { forced = null; toast('Live mode'); return; }
  if (S.state === 'listening') { recorder?.stop(true); recog?.stop(); return; }
  if (S.state === 'thinking' || S.state === 'talking') { interrupt(); }   // barge in, then listen
  else S.waveReq = true;                     // a new conversation starts with a wave
  const id = ++turnId;
  try { await (live() ? liveTurn(id) : demoTurn(id)); }
  catch (e) { if (id === turnId && e.name !== 'AbortError') { console.error(e); toast(friendly(e)); } }
  finally { if (id === turnId) { setState('idle'); caption(''); } }
}

function interrupt() { turnId++; abort?.abort(); engine.stop(); recorder?.stop(); recog?.stop(); synthTalk = false; setState('idle'); }

async function listen() {
  setState('listening');
  const useBrowser = get('stt') === 'browser' || !Recorder.supported();
  if (useBrowser) {
    recog = browserRecognize((l) => (recogLevel = l)); recogLevel = 0.2;
    if (!recog) throw new Error('This browser has no microphone recording or speech recognition.');
    const text = await recog.promise; recog = null; return { text };
  }
  recorder = new Recorder(engine);
  const blob = await recorder.start(); recorder = null;
  return { blob };
}

async function liveTurn(id) {
  const P = PERSONAS[get('char')] || PERSONAS.crumby;
  const heard = await listen();
  if (id !== turnId) return;
  if (!heard.blob && !heard.text) { toast("Didn't catch that. Tap and try again."); return; }
  setState('thinking');
  abort = new AbortController();
  let text = heard.text, lang = 'en';
  if (heard.blob) { const r = await xai.transcribe(heard.blob, abort.signal); text = r.text; lang = r.language === 'id' ? 'id' : 'en'; }
  if (id !== turnId) return;
  if (!text) { toast("Didn't catch that. Tap and try again."); return; }
  if (get('captions')) caption(`“${text}”`);
  history.push({ role: 'user', content: text });
  while (history.length > 16) history.shift();

  const voice = get(P.voiceKey) || P.defaultVoice;
  const queue = []; let streamDone = false, wake = null, said = '';
  const sentencer = new Sentencer((s) => {
    const item = { text: s, audio: xai.tts(s, voice, { language: lang, speed: P.speed, higherPitch: P.higherPitch }, abort.signal) };
    item.audio.catch(() => {}); queue.push(item); wake?.();
  });
  const chatP = xai.chat([{ role: 'system', content: P.system }, ...history], (d) => {
    said += d; sentencer.push(d); if (get('captions')) caption(cleanForCaption(said));
  }, abort.signal).then((full) => { sentencer.flush(); return full; }).finally(() => { streamDone = true; wake?.(); });
  chatP.catch(() => {});

  // play sentences in order while later ones are still being generated
  for (let i = 0; ; i++) {
    while (i >= queue.length && !streamDone) await new Promise((r) => (wake = r));
    if (i >= queue.length) break;
    if (id !== turnId) return;
    let ab = null;
    try { ab = await queue[i].audio; } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
    if (id !== turnId) return;
    setState('talking');
    if (ab) await engine.play(ab, P.rate); else await speakBrowser(queue[i].text, P);
  }
  const full = await chatP;
  history.push({ role: 'assistant', content: full });
}

let demoIdx = { orb: 0, crumby: 0 };
async function demoTurn(id) {
  const c = get('char'), P = PERSONAS[c] || PERSONAS.crumby;
  if (Recorder.supported()) {
    try { await listen(); } catch (e) { console.warn('mic', e); setState('listening'); await sleep(1400); }
  } else { setState('listening'); await sleep(1400); }
  if (id !== turnId) return;
  setState('thinking'); await sleep(900);
  if (id !== turnId) return;
  const line = P.demo[demoIdx[c]++ % P.demo.length];
  setState('talking');
  if (get('captions')) caption(line);
  await speakBrowser(line, P);
}

function speakBrowser(text, P) {
  return new Promise((res) => {
    if (!window.speechSynthesis) { synthTalk = true; setTimeout(() => { synthTalk = false; res(); }, 2500); return; }
    const u = new SpeechSynthesisUtterance(cleanForCaption(text));
    const voices = speechSynthesis.getVoices();
    if (P === PERSONAS.orb) {
      u.voice = voices.find((v) => /Daniel|Arthur|Oliver|George|Google UK English Male/i.test(v.name)) || voices.find((v) => v.lang === 'en-GB') || null;
      u.pitch = 0.85; u.rate = 0.98;
    } else {
      u.voice = voices.find((v) => /Samantha|Karen|Moira|Google US English/i.test(v.name)) || null;
      u.pitch = 1.6; u.rate = 1.08;
    }
    synthTalk = true;
    const end = () => { synthTalk = false; res(); };
    u.onend = end; u.onerror = end;
    speechSynthesis.speak(u);
    setTimeout(() => synthTalk && end(), 20000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function friendly(e) {
  const m = String(e?.message || e);
  if (/NotAllowed|Permission|denied/i.test(m)) return 'Microphone blocked. Allow it in Settings › Safari › Microphone (or the browser address bar).';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Network error reaching xAI.';
  return m.slice(0, 180);
}

// talking level when using Web Speech (no analyser available)
setInterval(() => { if (synthTalk && !forced) S.state = 'talking'; }, 100);

// ---------- UI ----------
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input,select,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); onTap(); }
  else if (e.key === 'c') set('char', get('char') === 'crumby' ? 'orb' : 'crumby');
  else if (e.key === 'p') set('mode', get('mode') === 'pyramid' ? 'single' : 'pyramid');
  else if (e.key === 'm') set('mirror', !get('mirror'));
  else if (e.key === 'f') fullscreen();
  else if (e.key === 's' || e.key === 'Escape') togglePanel();
});
$('#gear').addEventListener('click', () => togglePanel(true));
$('#close').addEventListener('click', () => togglePanel(false));
$('#panel').addEventListener('pointerdown', (e) => { if (e.target.id === 'panel') togglePanel(false); });
function togglePanel(open) { const p = $('#panel'); p.hidden = open === undefined ? !p.hidden : !open; if (!p.hidden) syncUI(); }

document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) set(seg.dataset.setting, b.dataset.v);
}));
document.querySelectorAll('input[type=checkbox][data-setting]').forEach((el) => el.addEventListener('change', () => set(el.dataset.setting, el.checked)));
document.querySelectorAll('input[type=range][data-setting]').forEach((el) => el.addEventListener('input', () => set(el.dataset.setting, +el.value)));
document.querySelectorAll('select[data-setting]').forEach((el) => el.addEventListener('change', () => set(el.dataset.setting, el.value)));
document.querySelectorAll('[data-state]').forEach((b) => b.addEventListener('click', () => { interrupt(); forced = b.dataset.state === 'idle' ? null : b.dataset.state; togglePanel(false); }));
$('#saveKey').addEventListener('click', () => {
  const v = $('#key').value.trim(); if (!v) return;
  localStorage.setItem(KEY, v); $('#key').value = ''; toast('Key saved on this device only.'); loadVoices(); syncUI();
});
$('#clearKey').addEventListener('click', () => { localStorage.removeItem(KEY); toast('Key removed.'); syncUI(); });
$('#testKey').addEventListener('click', async () => {
  try { const v = await xai.voices(); toast(`Connected to xAI · ${v.length} voices`); fillVoices(v.map((x) => x.voice_id)); }
  catch (e) { toast(friendly(e)); }
});
$('#resetChat').addEventListener('click', () => { history.length = 0; toast('Conversation cleared.'); });
$('#fullscreen').addEventListener('click', fullscreen);

function syncUI() {
  document.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', get(seg.dataset.setting) === b.dataset.v)));
  document.querySelectorAll('[data-setting]').forEach((el) => {
    const v = get(el.dataset.setting);
    if (el.type === 'checkbox') el.checked = !!v; else if (el.type === 'range' || el.tagName === 'SELECT') el.value = v;
  });
  document.querySelectorAll('[data-only]').forEach((el) => (el.hidden = get('mode') !== el.dataset.only));
  $('#modeNote').textContent = proxy ? 'Live mode via the local proxy on this Mac (key stays on the Mac).'
    : apiKey() ? 'Live mode: talking to xAI directly from this browser.'
      : 'Demo mode: scripted lines with the device voice. Paste an xAI key for real conversation.';
  $('#key').placeholder = apiKey() ? 'Key saved ✓ (paste a new one to replace)' : 'xai-…  (stored only on this device)';
}

function fillVoices(ids) {
  for (const sel of document.querySelectorAll('select[data-setting$="Voice"]')) {
    const cur = get(sel.dataset.setting);
    const list = [...new Set([cur, ...ids])].filter(Boolean);
    sel.innerHTML = list.map((v) => `<option value="${v}">${v[0].toUpperCase() + v.slice(1)}</option>`).join('');
    sel.value = cur;
  }
}
async function loadVoices() { if (!live()) return; try { fillVoices((await xai.voices()).map((v) => v.voice_id)); } catch {} }

let toastTimer;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3800); }
function caption(s) { const el = $('#caption'); el.textContent = s; el.hidden = !s || !get('captions'); }
function hint(show) { $('#hint').classList.toggle('gone', !show); }
setTimeout(() => hint(false), 5000);

function fullscreen() {
  const d = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  else (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d)?.catch?.(() => toast('On iPhone: Share › Add to Home Screen for full screen.'));
}
let lock = null;
async function wakeLock() { try { if (!lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => (lock = null)); } } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && lock === null) wakeLock(); });

// ---------- boot ----------
if (qs.get('clean') === '1') document.body.classList.add('clean');
fillVoices(FALLBACK_VOICES);
syncUI();
(async () => {
  if (location.protocol.startsWith('http') && !location.hostname.endsWith('github.io')) {
    try { const r = await fetch('api/health', { cache: 'no-store' }); if (r.ok && (await r.json()).ok) proxy = true; } catch {}
  }
  syncUI(); loadVoices();
})();
applyFlip();
await stage.ready;
if (tOverride === null) setTimeout(() => (S.waveReq = true), 900);   // hello!
window.__holo = { S, stage, ready: true };
requestAnimationFrame(frame);
