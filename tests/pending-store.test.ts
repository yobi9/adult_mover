import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PendingStore } from "../source/core/config/pending-store";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-pend-"));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function pendingBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    folderName: "Movie A",
    originalPath: "C:\\src\\Movie A",
    destination: "D:\\Adult",
    rating: "R",
    mediaType: "movie" as const,
    tmdbId: 123,
    confidence: 0.9,
    year: 1994,
    title: "Movie A",
    source: "C:\\src",
    ...overrides,
  };
}

test("PendingStore: load empty when missing", async () => {
  await withTempDir(async (dir) => {
    const s = new PendingStore(path.join(dir, "pending.json"));
    assert.deepEqual(await s.load(), []);
  });
});

test("PendingStore: add + load", async () => {
  await withTempDir(async (dir) => {
    const s = new PendingStore(path.join(dir, "pending.json"));
    const item = await s.add(pendingBase());
    assert.ok(item.id);
    assert.ok(item.dateScanned);
    const loaded = await s.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.rating, "R");
  });
});

test("PendingStore: addMany", async () => {
  await withTempDir(async (dir) => {
    const s = new PendingStore(path.join(dir, "pending.json"));
    const many = await s.addMany([pendingBase(), pendingBase({ folderName: "B", title: "B" })]);
    assert.equal(many.length, 2);
    assert.equal((await s.load()).length, 2);
  });
});

test("PendingStore: remove by id only", async () => {
  await withTempDir(async (dir) => {
    const s = new PendingStore(path.join(dir, "pending.json"));
    const a = await s.add(pendingBase());
    const b = await s.add(pendingBase({ folderName: "B" }));
    assert.equal(await s.remove(a.id), true);
    assert.equal((await s.load()).length, 1);
    assert.equal(await s.remove("not-a-uuid"), false);
    assert.equal(await s.remove(b.originalPath), false);
  });
});

test("PendingStore: clearAll", async () => {
  await withTempDir(async (dir) => {
    const s = new PendingStore(path.join(dir, "pending.json"));
    await s.add(pendingBase());
    await s.clearAll();
    assert.deepEqual(await s.load(), []);
  });
});

test("PendingStore: tolerant on corrupted", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "pending.json");
    await fsp.writeFile(file, "bad", "utf8");
    const s = new PendingStore(file);
    assert.deepEqual(await s.load(), []);
  });
});
