#!/usr/bin/env node
/**
 * توليد أيقونة التطبيق برمجياً دون أي تبعيات (PNG ثم ICO).
 *
 * - يرسم في مربع RGBAt بسيط: خلفية داكنة مربّعة بزوايا دائرية + مثلث تشغيل برتقالي.
 * - يضغط مع الصفوف عبر zlib (node:zlib) ويكتب PNG يدوياً (IHDR/IDAT/IEND + CRC32).
 * - يغلّف PNG داخل ICO (تنسيق Vista+ الذي يدعم PNG المضغوط) لمتطلبات electron-builder.
 *
 * الاستخدام: node scripts/make-icon.mjs [outputDir]
 */

import { deflateSync } from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "../assets");
const SIZE = 256;

/* ------------------------- أدوات PNG ------------------------- */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

/** تحويل مصفوفة BGRA (كما في <canvas>) إلى وحدات PNG مع صفوف مرشحة. */
function rgbaToPng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter "None"
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      raw[offset++] = rgba[p + 0];
      raw[offset++] = rgba[p + 1];
      raw[offset++] = rgba[p + 2];
      raw[offset++] = rgba[p + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** تغليف PNG داخل ملف ICO بطلب واحد 256×256. */
function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256 → 0
  entry[1] = 0; // height 256 → 0
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8); // bytes in resource
  entry.writeUInt32LE(22, 12); // offset to PNG data
  return Buffer.concat([header, entry, png]);
}

/* ------------------------- الرسم ------------------------- */

/** تعبئة زوايا دائرية. */
function roundedRect(x, y, w, h, r) {
  if (x < r || y < r || x > w - r || y > h - r) return false;
  if (x < r && y < r) return (x - r) * (x - r) + (y - r) * (y - r) <= r * r;
  if (x > w - r && y < r) return (x - (w - r)) * (x - (w - r)) + (y - r) * (y - r) <= r * r;
  if (x < r && y > h - r) return (x - r) * (x - r) + (y - (h - r)) * (y - (h - r)) <= r * r;
  if (x > w - r && y > h - r)
    return (x - (w - r)) * (x - (w - r)) + (y - (h - r)) * (y - (h - r)) <= r * r;
  return true;
}

/** بناء بكسل (r,g,b,a). */
function rgba(r, g, b, a = 255) {
  return [r, g, b, a];
}

function buildPixels() {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  const radius = SIZE * 0.16;
  const bg = rgba(31, 41, 55); // #1f2937
  const accent = rgba(245, 158, 11); // #f59e0b

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (!roundedRect(x, y, SIZE - 1, SIZE - 1, radius)) {
        px[i + 3] = 0; // خارج الحواف → شفاف.
        continue;
      }
      px.set(bg, i);

      // مثلث تشغيل برتقالي في المنتصف.
      const cx = SIZE / 2;
      const cy = SIZE / 2;
      const w = SIZE * 0.32;
      const h = SIZE * 0.36;
      const dx = x - cx + w * 0.25;
      const dy = y - cy;
      const inTriangle = dx >= 0 && Math.abs(dy) <= h / 2 && dx * (h / 2) + w * Math.abs(dy) <= w * (h / 2);
      if (inTriangle) {
        px.set(accent, i);
      }
    }
  }
  return px;
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  const png = rgbaToPng(SIZE, SIZE, buildPixels());
  const ico = pngToIco(png);
  await writeFile(path.join(OUTPUT, "icon.png"), png);
  await writeFile(path.join(OUTPUT, "icon.ico"), ico);
  console.log(`ICON: assets/icon.png (${png.length} bytes)`);
  console.log(`ICON: assets/icon.ico (${ico.length} bytes)`);
}

main().catch((error) => {
  console.error("[make-icon] فشل:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});