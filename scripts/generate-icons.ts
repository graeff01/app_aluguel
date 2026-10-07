/** Gera ícones PNG locais (monograma genérico "VL" — não é logotipo da imobiliária). Rodar: npm run icons */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const COLOR = "#1f5f8b";
function svg(size: number, padding: number) {
  const r = Math.round(size * 0.22);
  const inner = size - padding * 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${padding ? COLOR : "none"}"/>
  <rect x="${padding}" y="${padding}" width="${inner}" height="${inner}" rx="${padding ? 0 : r}" fill="${COLOR}"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(inner * 0.42)}" fill="#ffffff">VL</text>
</svg>`);
}

mkdirSync("public/icons", { recursive: true });
const jobs: [string, number, number][] = [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["maskable-512.png", 512, 64],
  ["apple-touch-icon.png", 180, 18],
];
for (const [name, size, pad] of jobs) {
  await sharp(svg(size, pad)).png().toFile(`public/icons/${name}`);
  console.log("ok", name);
}
