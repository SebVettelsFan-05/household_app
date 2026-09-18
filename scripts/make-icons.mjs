// Renders the PNG icons from public/icon.svg. Run after editing the SVG:
//   node scripts/make-icons.mjs
// iOS ignores SVG home-screen icons and Android wants a maskable PNG, so the
// SVG alone is not enough. The PNGs are committed; this is not a build step.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile("public/icon.svg", "utf8");

// Full-bleed variant: home screens apply their own corner mask, so the
// rounded corners of the tab icon must become a square of the same colour.
const square = svg.replace(/(<rect width="512" height="512") rx="\d+"/, "$1");
if (square === svg) throw new Error("icon.svg: background rect not found");

// Maskable: launchers may crop to the middle 80 percent, so the art is
// scaled into that zone over the same background.
const maskable = square
  .replace('<g id="art">', '<g id="art" transform="translate(256 256) scale(0.8) translate(-256 -256)">');
if (maskable === square) throw new Error('icon.svg: <g id="art"> not found');

const png = (source, size) =>
  sharp(Buffer.from(source), { density: 72 * (size / 512) * 4 })
    .resize(size, size)
    .png()
    .toBuffer();

await writeFile("public/apple-touch-icon.png", await png(square, 180));
await writeFile("public/icon-192.png", await png(square, 192));
await writeFile("public/icon-512.png", await png(square, 512));
await writeFile("public/icon-maskable-512.png", await png(maskable, 512));
console.log("icons written");
