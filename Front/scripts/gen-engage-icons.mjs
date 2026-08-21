import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const OUT = new URL('../public/icons', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const S = 2; // stroke width in the 24-unit viewbox
const wrap = (inner) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96">
  <g fill="none" stroke="#ffffff" stroke-width="${S}" stroke-linecap="round" stroke-linejoin="round">
    ${inner}
  </g>
</svg>`;

const icons = {
  'engage-reply': wrap(`
    <path d="M4 5.5 h16 a1.5 1.5 0 0 1 1.5 1.5 v9 a1.5 1.5 0 0 1 -1.5 1.5 H9.5 L5 21 v-3.5 H4 A1.5 1.5 0 0 1 2.5 16 V7 A1.5 1.5 0 0 1 4 5.5 Z"/>
  `),
  'engage-retweet': wrap(`
    <path d="M6.5 7 H16 a2 2 0 0 1 2 2 v3"/>
    <path d="M9 4.3 6.5 7 9 9.7"/>
    <path d="M17.5 17 H8 a2 2 0 0 1 -2 -2 V12"/>
    <path d="M15 14.3 17.5 17 15 19.7"/>
  `),
  'engage-heart': wrap(`
    <path d="M12 20.2 4.6 13c-1.9-1.9-1.9-5 0-6.9 1.9-1.9 5-1.9 6.9 0l.5.5.5-.5c1.9-1.9 5-1.9 6.9 0 1.9 1.9 1.9 5 0 6.9L12 20.2Z"/>
  `),
  'engage-analytics': wrap(`
    <path d="M4 19 V13"/>
    <path d="M10.5 19 V8"/>
    <path d="M17 19 V4.5"/>
  `),
  'engage-share': wrap(`
    <path d="M14 4.5 H19.5 V10"/>
    <path d="M19.2 4.8 10 14"/>
    <path d="M15.5 12.5 V18 a1.5 1.5 0 0 1 -1.5 1.5 H6 A1.5 1.5 0 0 1 4.5 18 V9.5 A1.5 1.5 0 0 1 6 8 h5.5"/>
  `)
};

for (const [name, svg] of Object.entries(icons)) {
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/${name}.png`);
  console.log('wrote', name);
}
