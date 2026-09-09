import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { UnknownStore } from "../source/core/config/unknown-store";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-unk-"));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("UnknownStore: load returns [] when file missing", async () => {
  await withTempDir(async (dir) => {
    const store = new UnknownStore(path.join(dir, "unknown.json"));
    assert.deepEqual(await store.load(), []);
  });
});

test("UnknownStore: add + load roundtrip", async () => {
  await withTempDir(async (dir) => {
    const store = new UnknownStore(path.join(dir, "unknown.json"));
    const item = await store.add({
      folderName: "Movie A",
      originalPath: "C:\\src\\Movie A",
      reason: "not-found",
      source: "C:\\src",
    });
    assert.ok(item.id);
    assert.ok(item.date);
    const loaded = await store.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.folderName, "Movie A");
  });
});

test("UnknownStore: addMany appends", async () => {
  await withTempDir(async (dir) => {
    const store = new UnknownStore(path.join(dir, "unknown.json"));
    await store.add({ folderName: "A", originalPath: "C:\\a", reason: "not-found", source: "C:\\src" });
    const many = await store.addMany([
      { folderName: "B", originalPath: "C:\\b", reason: "no-rating", source: "C:\\src" },
      { folderName: "C", originalPath: "C:\\c", reason: "low-confidence", source: "C:\\src" },
    ]);
    assert.equal(many.length, 2);
    assert.equal((await store.load()).length, 3);
  });
});

test("UnknownStore: remove by id only", async () => {
  await withTempDir(async (dir) => {
    const store = new UnknownStore(path.join(dir, "unknown.json"));
    const a = await store.add({ folderName: "A", originalPath: "C:\\a", reason: "not-found", source: "C:\\src" });
    const b = await store.add({ folderName: "B", originalPath: "C:\\b", reason: "not-found", source: "C:\\src" });
    assert.equal(await store.remove(a.id), true);
    assert.equal((await store.load()).length, 1);
    assert.equal(await store.remove(a.id), false);
    assert.equal(await store.remove("not-a-uuid"), false);
    assert.equal(await store.remove("C:\\a"), false);
    // b still there
    assert.equal((await store.load())[0]!.id, b.id);
  });
});

test("UnknownStore: clearAll", async () => {
  await withTempDir(async (dir) => {
    const store = new UnknownStore(path.join(dir, "unknown.json"));
    await store.add({ folderName: "A", originalPath: "C:\\a", reason: "not-found", source: "C:\\src" });
    await store.clearAll();
    assert.deepEqual(await store.load(), []);
  });
});

test("UnknownStore: tolerant load on corrupted JSON", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "unknown.json");
    await fsp.writeFile(file, "not json", "utf8");
    const store = new UnknownStore(file);
    assert.deepEqual(await store.load(), []);
    // also invalid shape
    await fsp.writeFile(file, JSON.stringify({ version: 1 }), "utf8");
    assert.deepEqual(await store.load(), []);
  });
});

test("UnknownStore: details optional", async () => {
  await withTempDir(async (dir) => {
    const store = new UnknownStore(path.join(dir, "unknown.json"));
    const item = await store.add({
      folderName: "A",
      originalPath: "C:\\a",
      reason: "tmdb-error",
      details: "Timeout",
      source: "C:\\src",
    });
    assert.equal(item.details, "Timeout");
    const loaded = await store.load();
    assert.equal(loaded[0]!.details, "Timeout");
  });
});
