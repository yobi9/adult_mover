import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  { src: join(root, "source", "renderer", "index.html"), dest: join(root, "dist", "renderer", "index.html") },
  { src: join(root, "source", "renderer", "styles.css"), dest: join(root, "dist", "renderer", "styles.css") },
];

for (const iconName of ["icon.png", "icon.ico"]) {
  const iconPath = join(root, "assets", iconName);
  if (existsSync(iconPath)) {
    targets.push({ src: iconPath, dest: join(root, "dist", iconName) });
  }
}

for (const { src, dest } of targets) {
  if (!existsSync(src)) {
    console.log(`SKIP missing: ${src}`);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { force: true });
  console.log(`COPIED: ${dest}`);
}

/**
 * تطهير مخرجات الواجهة: سكربت المتصفح يجب ألا يتضمن أي آليات CommonJS/modules
 * (لا require ولا exports ولا export {}) حتى يعمل تحت sandbox في <script> عادي.
 * في حالة فشل التحقق يُفشل البناء (قرار قاطع بدل سكربت مكسور صامت).
 */
const esmOut = join(root, ".build-tmp", "renderer-esm", "renderer", "renderer.js");
const rendererJs = join(root, "dist", "renderer", "renderer.js");
if (existsSync(esmOut)) {
  let code = readFileSync(esmOut, "utf8");
  code = code.replace(/\nexport \{\};\s*$/g, "\n");
  mkdirSync(dirname(rendererJs), { recursive: true });
  writeFileSync(rendererJs, code);
  const leftovers = /(^|\n)(import |export |require\(|__esModule|module\.exports)/.exec(code);
  if (leftovers) {
    throw new Error(
      `مخرج الواجهة يحتوي أثر وحدة/CommonJS غير مسموح به: ${JSON.stringify(leftovers[0].trim())}`
    );
  }
  console.log(`TIDIED: ${rendererJs}`);
}