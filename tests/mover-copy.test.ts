import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyFolder, verifyCopy, pathExists } from "../source/core/files/mover";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-copy-"));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("copyFolder copies recursively and keeps source", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "hello");
    await fsp.mkdir(path.join(src, "subs"), { recursive: true });
    await fsp.writeFile(path.join(src, "subs", "en.srt"), "sub");
    const dest = path.join(dir, "dest");

    const out = await copyFolder(src, dest, "Movie A");
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.copiedTo, path.join(dest, "Movie A"));
    assert.equal(await pathExists(src), true);
    assert.equal(await pathExists(path.join(dest, "Movie A", "film.mp4")), true);
    assert.equal(await pathExists(path.join(dest, "Movie A", "subs", "en.srt")), true);
  });
});

test("copyFolder uses uniqueTargetPath when dest exists", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "new");
    const dest = path.join(dir, "dest");
    await fsp.mkdir(path.join(dest, "Movie A"), { recursive: true });
    await fsp.writeFile(path.join(dest, "Movie A", "old.txt"), "keep");

    const out = await copyFolder(src, dest, "Movie A");
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.copiedTo, path.join(dest, "Movie A_1"));
    assert.equal(await pathExists(path.join(dest, "Movie A", "old.txt")), true);
    assert.equal(await pathExists(path.join(dest, "Movie A_1", "film.mp4")), true);
  });
});

test("copyFolder reports missing source", async () => {
  await withTempDir(async (dir) => {
    const out = await copyFolder(path.join(dir, "missing"), path.join(dir, "dest"), "Movie A");
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "source-missing");
  });
});

test("copyFolder rejects unsafe paths", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "Media");
    await fsp.mkdir(path.join(src, "Movie A"), { recursive: true });
    await fsp.writeFile(path.join(src, "Movie A", "film.mp4"), "x");
    const out = await copyFolder(src, path.join(src, "Adult"), "Movie A");
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "unsafe-paths");
  });
});

test("copyFolder honours stop request", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "x");
    const dest = path.join(dir, "dest");
    const out = await copyFolder(src, dest, "Movie A", { isStopping: () => true });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "aborted");
  });
});

test("copyFolder maps cp errors to io-error and keeps source", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "x");
    const dest = path.join(dir, "dest");
    const out = await copyFolder(src, dest, "Movie A", {
      cp: async () => {
        throw new Error("Access denied");
      },
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "io-error");
    assert.equal(await pathExists(src), true);
  });
});

test("verifyCopy returns true when sizes match", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "hello world");
    const dst = path.join(dir, "dst", "Movie A");
    await fsp.mkdir(dst, { recursive: true });
    await fsp.writeFile(path.join(dst, "film.mp4"), "hello world");
    assert.equal(await verifyCopy(src, dst), true);
  });
});

test("verifyCopy returns false when sizes differ", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "hello world");
    const dst = path.join(dir, "dst", "Movie A");
    await fsp.mkdir(dst, { recursive: true });
    await fsp.writeFile(path.join(dst, "film.mp4"), "hi");
    assert.equal(await verifyCopy(src, dst), false);
  });
});

test("copyFolder leaves source even after successful copy (no delete)", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "data");
    const dest = path.join(dir, "dest");
    const out = await copyFolder(src, dest, "Movie A");
    assert.equal(out.ok, true);
    assert.equal(await pathExists(src), true);
    assert.equal(await pathExists(path.join(src, "film.mp4")), true);
  });
});
