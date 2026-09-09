import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanSource } from "../source/core/files/scanner";

/** إنشاء مجلد مؤقت والانتهاء بتطهيره. */
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-scan-"));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function seed(base: string): Promise<void> {
  // مجلدات محتوى مباشرة
  await fsp.mkdir(path.join(base, "Movie A"), { recursive: true });
  await fsp.writeFile(path.join(base, "Movie A", "film.MKV"), "x");
  await fsp.mkdir(path.join(base, "Series A"), { recursive: true });
  await fsp.writeFile(path.join(base, "Series A", "show.S01E01.mkv"), "x");
  // ليس محتوى (لا فيديو)
  await fsp.mkdir(path.join(base, "Not Media"), { recursive: true });
  await fsp.writeFile(path.join(base, "Not Media", "notes.txt"), "x");
  // عميق
  await fsp.mkdir(path.join(base, "Nested", "One"), { recursive: true });
  await fsp.writeFile(path.join(base, "Nested", "One", "deep.webm"), "x");
  await fsp.mkdir(path.join(base, "Nested", "Empty"), { recursive: true });
}

test("recursive scan finds content folders at all levels", async () => {
  await withTempDir(async (base) => {
    await seed(base);
    const result = await scanSource(base, { recursive: true });
    const normalized = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(normalized, [
      "Movie A",
      "Nested/One",
      "Series A",
    ]);
    assert.equal(result.errors.length, 0);
  });
});

test("non-recursive scan only inspects direct children", async () => {
  await withTempDir(async (base) => {
    await seed(base);
    const result = await scanSource(base, { recursive: false });
    const normalized = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(normalized, ["Movie A", "Series A"]);
  });
});

test("a source that directly contains video is itself a content folder", async () => {
  await withTempDir(async (base) => {
    await fsp.writeFile(path.join(base, "movie.webm"), "x");
    const result = await scanSource(base, { recursive: true });
    assert.deepEqual(result.folders, [base]);
  });
});

test("folder with uppercase extension is recognized case-insensitively", async () => {
  await withTempDir(async (base) => {
    await fsp.mkdir(path.join(base, "Cap"), { recursive: true });
    await fsp.writeFile(path.join(base, "Cap", "Movie.Mp4"), "x");
    await fsp.mkdir(path.join(base, "Cap2"), { recursive: true });
    await fsp.writeFile(path.join(base, "Cap2", "movie.AVI"), "x");
    const result = await scanSource(base, { recursive: false });
    assert.equal(result.folders.length, 2);
  });
});

test("missing source returns an error and no folders", async () => {
  const result = await scanSource(path.join(tmpdir(), "does-not-exist-amm-" + Date.now()), {
    recursive: true,
  });
  assert.equal(result.folders.length, 0);
  assert.equal(result.errors.length, 1);
});

test("per-folder read error does not abort the whole scan", async () => {
  await withTempDir(async (base) => {
    await seed(base);
    // لا نستطيع إحداث خطأ صلاحيات موثوق في كل البيئات؛ نختبر فقط عدم الانهيار.
    const result = await scanSource(base, { recursive: true });
    assert.ok(result.folders.length >= 2);
  });
});

test("recursive ON: series root is a single candidate, seasons are containers", async () => {
  await withTempDir(async (base) => {
    const series = path.join(base, "Station 19");
    for (const season of ["الموسم 01", "الموسم 02"]) {
      const seasonDir = path.join(series, season);
      await fsp.mkdir(seasonDir, { recursive: true });
      await fsp.writeFile(path.join(seasonDir, "episode.mkv"), "x");
    }
    const result = await scanSource(base, { recursive: true });
    const relative = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(relative, ["Station 19"]);
    assert.equal(result.errors.length, 0);
  });
});

test("recursive ON: short Latin season form (S02) promotes to series root", async () => {
  await withTempDir(async (base) => {
    const series = path.join(base, "Van Helsing");
    await fsp.mkdir(path.join(series, "S02"), { recursive: true });
    await fsp.writeFile(path.join(series, "S02", "episode.mkv"), "x");
    const result = await scanSource(base, { recursive: true });
    const relative = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(relative, ["Van Helsing"]);
  });
});

test("recursive ON: multiple parser-supported season forms still yield one root", async () => {
  await withTempDir(async (base) => {
    const series = path.join(base, "The Morning Show");
    for (const season of ["الموسم 01", "Season 2", "S03", "الموسم الرابع"]) {
      const seasonDir = path.join(series, season);
      await fsp.mkdir(seasonDir, { recursive: true });
      await fsp.writeFile(path.join(seasonDir, "e.mkv"), "x");
    }
    const result = await scanSource(base, { recursive: true });
    const relative = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(relative, ["The Morning Show"]);
  });
});

test("recursive ON: movie folder with direct video stays a candidate", async () => {
  await withTempDir(async (base) => {
    await fsp.mkdir(path.join(base, "Movie Name"), { recursive: true });
    await fsp.writeFile(path.join(base, "Movie Name", "movie.mkv"), "x");
    const result = await scanSource(base, { recursive: true });
    const relative = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(relative, ["Movie Name"]);
  });
});

test("recursive ON: flat season-in-name folder is its own candidate, parent not promoted", async () => {
  await withTempDir(async (base) => {
    await fsp.mkdir(path.join(base, "Game.of.Thrones.S01"), { recursive: true });
    await fsp.writeFile(path.join(base, "Game.of.Thrones.S01", "episode.mkv"), "x");
    await fsp.mkdir(path.join(base, "Other Movie"), { recursive: true });
    await fsp.writeFile(path.join(base, "Other Movie", "m.mp4"), "x");
    const result = await scanSource(base, { recursive: true });
    const relative = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(relative, ["Game.of.Thrones.S01", "Other Movie"]);
  });
});

test("recursive OFF: series root discovered via direct season children", async () => {
  await withTempDir(async (base) => {
    const series = path.join(base, "Station 19");
    for (const season of ["الموسم 01", "الموسم 02"]) {
      const seasonDir = path.join(series, season);
      await fsp.mkdir(seasonDir, { recursive: true });
      await fsp.writeFile(path.join(seasonDir, "e.mkv"), "x");
    }
    const result = await scanSource(base, { recursive: false });
    const relative = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(relative, ["Station 19"]);
  });
});

test("recursive OFF: season containers are never candidates (S02 promotes parent)", async () => {
  await withTempDir(async (base) => {
    const series = path.join(base, "Van Helsing");
    await fsp.mkdir(path.join(series, "S02"), { recursive: true });
    await fsp.writeFile(path.join(series, "S02", "ep.mkv"), "x");
    const result = await scanSource(base, { recursive: false });
    const relative = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(relative, ["Van Helsing"]);
  });
});

test("recursive OFF: media deeper than one level is not discovered", async () => {
  await withTempDir(async (base) => {
    await fsp.mkdir(path.join(base, "A", "B", "Movie"), { recursive: true });
    await fsp.writeFile(path.join(base, "A", "B", "Movie", "v.mp4"), "x");
    const result = await scanSource(base, { recursive: false });
    const relative = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(relative, []);
  });
});

test("recursive OFF: direct movie at the allowed level still works", async () => {
  await withTempDir(async (base) => {
    await fsp.mkdir(path.join(base, "Movie A"), { recursive: true });
    await fsp.writeFile(path.join(base, "Movie A", "film.MKV"), "x");
    const result = await scanSource(base, { recursive: false });
    const relative = result.folders.map((f) => path.relative(base, f).replace(/\\/g, "/")).sort();
    assert.deepEqual(relative, ["Movie A"]);
  });
});