/** Gera os ícones do app a partir do símbolo da Auxiliadora Predial (public/brand). Rodar: npm run icons */
import sharp from "sharp";
import { mkdirSync, readFileSync } from "node:fs";

const symbol = readFileSync("public/brand/auxiliadora-simbolo.svg");
mkdirSync("public/icons", { recursive: true });

async function icon(name: string, size: number, padRatio: number, radius: number) {
  const inner = Math.round(size * (1 - padRatio * 2));
  const mark = await sharp(symbol, { density: 600 }).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff"/></svg>`);
  await sharp(bg)
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(`public/icons/${name}`);
  console.log("ok", name);
}

await icon("icon-192.png", 192, 0.16, 0);
await icon("icon-512.png", 512, 0.16, 0);
await icon("maskable-512.png", 512, 0.24, 0); // área segura para recorte circular
await icon("apple-touch-icon.png", 180, 0.16, 0);
await icon("favicon-32.png", 32, 0.06, 0);
