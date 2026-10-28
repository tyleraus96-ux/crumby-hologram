// Renders preview PNGs with headless Chrome: node tools/previews.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://localhost:8090/';
const out = process.argv[3] || 'previews';
const shots = [
  ['orb-idle', 'char=orb&state=idle', 430, 932],
  ['orb-listening', 'char=orb&state=listening', 430, 932],
  ['orb-thinking', 'char=orb&state=thinking', 430, 932],
  ['orb-talking', 'char=orb&state=talking', 430, 932],
  ['crumby-idle', 'char=crumby&state=idle', 430, 932],
  ['crumby-listening', 'char=crumby&state=listening', 430, 932],
  ['crumby-talking', 'char=crumby&state=talking', 430, 932],
  ['pyramid-orb', 'char=orb&mode=pyramid&state=talking', 1000, 1000],
  ['pyramid-crumby', 'char=crumby&mode=pyramid&state=talking', 1000, 1000],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
for (const [name, q, w, h] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error(name, 'pageerror', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error(name, m.text()));
  await page.goto(`${base}?clean=1&${q}&t=${name.includes('talking') || name.includes('pyramid') ? 3.05 : 2.2}`);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
  console.log('saved', name);
}
await browser.close();
