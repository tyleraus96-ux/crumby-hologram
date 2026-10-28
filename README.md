# Crumby Hologram · Jarvis & Crumby

A desk "hologram" assistant for a **Pepper's ghost** display: a phone, tablet or monitor lies
flat and face-up, and a clear acrylic sheet (or a 4-sided pyramid) above it reflects the glowing
character so it seems to float. Black pixels show up as see-through, so everything is drawn on
pure black.

**Live:** https://tyleraus96-ux.github.io/crumby-hologram/

| Crumby idle | Listening | Thinking | Talking | Pyramid (4 cameras) |
|---|---|---|---|---|
| ![](previews/crumby-idle.png) | ![](previews/crumby-listening.png) | ![](previews/crumby-thinking.png) | ![](previews/crumby-talking.png) | ![](previews/pyramid-crumby.png) |

Everything is real-time 3D (three.js r186, vendored in `vendor/`, no CDN).

## Characters
- **Crumby 3D (default):** a thick, rounded 3D cookie built from the official Island Crumbs art.
  The watch face art (`assets/crumby/face_base.png`, plain forehead) is projected onto the domed
  front, and his original eye and mouth layers sit on top, so his face and proportions match the
  brand. The rounded side wraps baked dough, the back is plain dough with chips, and glossy 3D
  chocolate chips sit around the rim, side and back (none on the forehead or face). He bobs,
  slowly turns, blinks, and his mouth follows the real TTS volume. Key, two rim lights and a soft
  fill, plus a fresnel hologram edge, a warm halo and sparkles. Nothing else is lit.
- **Jarvis orb 3D:** a glowing core in a plasma shell, tilted gyroscope rings with dashed HUD
  arcs, a voice waveform ring and a particle cloud.

## States
| State | Look |
|---|---|
| Idle | slow breathing glow |
| Listening | Crumby leans in, cyan glow, ring and ripples that follow your mic level |
| Thinking | Crumby looks up and tilts with spinning arcs; the orb turns gold and spins up |
| Talking | reacts to the actual audio amplitude of the voice |

## Display modes (gear icon, bottom right, or press `s`)
- **Single sheet:** one big image, for a flat sheet of acrylic tilted at 45°. A reflection is
  flipped, so use **Mirror ↔** (and **Flip ↕** if it appears upside down) until it reads right.
- **Pyramid (4 sides):** four views around the centre, tops pointing outward, for the classic
  upside-down pyramid placed point-down on the middle of the screen. **4 camera angles** renders
  the model from the front, both sides and the back (walk around it and he's really 3D);
  **Front on all sides** shows his face on every side. Use **Size** and **Pyramid gap**
  to match your pyramid. **Guides** draws faint alignment lines.
- **Brightness** boosts the glow (reflections lose a lot of light).

## Talking
Tap anywhere (or press **Space** on a Mac) to talk; it stops by itself when you pause, or tap
again. Tapping while it speaks interrupts it.

- **Demo mode (no key):** listens, then answers with scripted lines in the device's own voice.
- **Live mode:** open settings and paste your xAI API key. It's stored **only in that browser's
  localStorage** and is sent only to `api.x.ai`. Then:
  speech → `grok-voice-transcribe-2.0` (`/v1/stt`) → `grok-4.20-0309-non-reasoning` (streamed
  `/v1/chat/completions`) → `/v1/tts`, spoken sentence by sentence as it streams.
  Crumby uses the **Ursa** voice, Jarvis the deep **Helios** voice (change either in settings;
  the list comes from `/v1/tts/voices`). Speech recognition can be switched to the browser's
  Web Speech engine.

## iPhone setup
1. Open the live link in **Safari**, tap **Share › Add to Home Screen**, and launch it from the
   home screen icon (full screen, no browser bars).
2. Brightness to max, turn on **Do Not Disturb** / a Focus, turn off Auto-Lock if the screen
   still dims (the app also asks the screen to stay awake).
3. Allow the microphone when asked. Flip the **ring/silent switch** to ring: in silent mode iOS
   can mute web audio.
4. Lay the phone flat, face up, under the acrylic (45° sheet) or pyramid, in a dim room.

## Mac Mini setup
Plug in a monitor (or small HDMI screen) lying flat and facing up, open the live link in Safari or
Chrome, press **f** (or the Full screen button) and set the acrylic above it. Keys: `Space` talk,
`c` switch character, `p` pyramid, `m` mirror, `s` settings.

### Optional local proxy (keeps the key off the browser)
xAI's API allows browser calls (CORS), so the proxy isn't required. On the Mac Mini you can still
keep the key in the environment instead of the browser:

```sh
git clone https://github.com/tyleraus96-ux/crumby-hologram && cd crumby-hologram
XAI_API_KEY=your-key-here node proxy/server.mjs     # Node 18+, no installs
open http://localhost:8787
```
The page detects the proxy and switches to live mode without asking for a key. It listens on
`127.0.0.1` only; set `HOST=0.0.0.0` to reach it from your phone on a trusted home network
(note: browsers only allow the mic on `https` or `localhost`, so the phone should use the
GitHub Pages link).

## URL options
`?char=crumby|orb&mode=single|pyramid&views=angles|front&mirror=1&state=talking&showcase=1&clean=1` for presets
(`state=` previews a state with a synthetic voice; `showcase=1` loops all states silently).
`node tools/previews.mjs` re-renders the preview images (needs `playwright-core` and Chrome).

## Limits
- iOS asks for the microphone again after the app is relaunched from the home screen.
- iOS silent mode can mute audio; Low Power Mode may cap the frame rate at 30 fps.
- No wake word yet: it's tap (or Space) to talk.
- Jarvis has no access to calendars, email or smart-home devices yet.
- Needs WebGL. If a phone gets hot or drops frames, the app lowers its resolution automatically
  (pixel ratio is capped at 2).

Crumby and Island Crumbs art © Island Crumbs. Code: MIT. three.js © three.js authors (MIT, `vendor/three.LICENSE`).
