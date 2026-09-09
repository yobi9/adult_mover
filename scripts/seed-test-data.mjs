#!/usr/bin/env node
/**
 * إنشاء بيانات تجريبية آمنة للتشغيل اليدوي (Sandbox).
 *
 * AMÁN: لا يلمس أي مجلد مستخدم حقيقي؛ ينشئ كل شيء داخل test-data/
 * تحت مجلد العمل فقط، ويُعيد إنشاءها من الصفر في كل تشغيل (idempotent).
 *
 * الاستخدام:
 *   node scripts/seed-test-data.mjs [baseDir]
 */

import { promises as fsp } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve("test-data");

const SOURCES = path.join(BASE, "sources");
const DESTINATION = path.join(BASE, "destination");

/** ملفات فيديو فارغة (Placeholder صغير) داخل مجلد. */
const CONTENT = {
  "Movie A": [["movie.mp4"], ["movie.nfo"]],
  "Series A - Season 1": [["ShowA.S01E01.mkv"], ["ShowA.S01E02.mkv"]],
  "Movie B (2019)": [["film.mkv"]],
  "Family Movie": [["pg_film.webm"]],
  "Musalsal Season 2": [["s2e1.mp4"]],
  "Not Media": [["readme.txt"], ["cover.jpg"]],
  "Low Confidence Stuff": [["clip.avi"]],
};

async function main() {
  await fsp.rm(BASE, { recursive: true, force: true });

  await fsp.mkdir(DESTINATION, { recursive: true });

  for (const [folder, files] of Object.entries(CONTENT)) {
    const dir = path.join(SOURCES, folder);
    await fsp.mkdir(dir, { recursive: true });
    for (const [file, content = "x"] of files) {
      await fsp.writeFile(path.join(dir, file), content);
    }
  }

  // مجلد محتوى مباشر في جذر المصدر (لاختبار مستوى المصدر).
  await fsp.writeFile(path.join(SOURCES, "direct-video.mp4"), "x");

  const lines = [
    "تم إنشاء بيانات تجريبية (Sandbox) بنجاح.",
    `  المصادر:   ${SOURCES}`,
    `  الوجهة:    ${DESTINATION}`,
    "",
    "ملاحظة: ملفات الفيديو هنا فارغة (Placeholder) للاختبار فقط.",
    "لتشغيل فحص حقيقي يحتاج التطبيق لمفتاح TMDB صالح.",
    "",
    "أضف المصادر والوجهة داخل التطبيق ثم اضغط «ابدأ الفحص والنقل».",
  ];
  for (const line of lines) {
    console.log(line);
  }
}

main().catch((error) => {
  console.error("[seed-test-data] فشل:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});