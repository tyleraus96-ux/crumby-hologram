import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=/tmp/mic.wav%noloop', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone'] });
const p = await ctx.newPage();
p.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)));
p.on('pageerror', (e) => console.log('pageerror', e.message));
p.on('request', (r) => r.url().includes('/api/') && console.log('req', r.method(), r.url()));
await p.goto('http://localhost:8787/?char=crumby&captions=1');
await p.waitForTimeout(1500);
await p.mouse.click(200, 400);
const seen = new Set();
for (let i = 0; i < 120; i++) { const s = await p.evaluate(() => window.__holo.S.state); if (!seen.has(s)) { console.log('t', i * 0.25, s); seen.add(s); } await p.waitForTimeout(250); }
console.log('caption:', await p.textContent('#caption'));
await b.close();
