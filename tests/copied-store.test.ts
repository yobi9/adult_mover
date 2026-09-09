import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CopiedStore } from "../source/core/config/copied-store";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-cop-"));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("CopiedStore: load empty", async () => {
  await withTempDir(async (dir) => {
    const s = new CopiedStore(path.join(dir, "copied.json"));
    assert.deepEqual(await s.load(), []);
  });
});

test("CopiedStore: add + load", async () => {
  await withTempDir(async (dir) => {
    const s = new CopiedStore(path.join(dir, "copied.json"));
    const item = await s.add({
      folderName: "Movie A",
      originalPath: "C:\\src\\Movie A",
      copiedPath: "D:\\Adult\\Movie A",
      destination: "D:\\Adult",
    });
    assert.ok(item.id);
    assert.ok(item.date);
    const loaded = await s.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.copiedPath, "D:\\Adult\\Movie A");
  });
});

test("CopiedStore: addMany", async () => {
  await withTempDir(async (dir) => {
    const s = new CopiedStore(path.join(dir, "copied.json"));
    const many = await s.addMany([
      { folderName: "A", originalPath: "C:\\a", copiedPath: "D:\\Adult\\A", destination: "D:\\Adult" },
      { folderName: "B", originalPath: "C:\\b", copiedPath: "D:\\Adult\\B", destination: "D:\\Adult" },
    ]);
    assert.equal(many.length, 2);
    assert.equal((await s.load()).length, 2);
  });
});

test("CopiedStore: remove by id only, rejects path", async () => {
  await withTempDir(async (dir) => {
    const s = new CopiedStore(path.join(dir, "copied.json"));
    const a = await s.add({ folderName: "A", originalPath: "C:\\a", copiedPath: "D:\\Adult\\A", destination: "D:\\Adult" });
    await s.add({ folderName: "B", originalPath: "C:\\b", copiedPath: "D:\\Adult\\B", destination: "D:\\Adult" });
    assert.equal(await s.remove(a.id), true);
    assert.equal((await s.load()).length, 1);
    assert.equal(await s.remove("not-a-uuid"), false);
    assert.equal(await s.remove("D:\\Adult\\A"), false);
  });
});

test("CopiedStore: clearAll", async () => {
  await withTempDir(async (dir) => {
    const s = new CopiedStore(path.join(dir, "copied.json"));
    await s.add({ folderName: "A", originalPath: "C:\\a", copiedPath: "D:\\Adult\\A", destination: "D:\\Adult" });
    await s.clearAll();
    assert.deepEqual(await s.load(), []);
  });
});

test("CopiedStore: sizeBytes and pendingId optional", async () => {
  await withTempDir(async (dir) => {
    const s = new CopiedStore(path.join(dir, "copied.json"));
    const item = await s.add({
      folderName: "A",
      originalPath: "C:\\a",
      copiedPath: "D:\\Adult\\A",
      destination: "D:\\Adult",
      sizeBytes: 12345,
      pendingId: "00000000-0000-4000-a000-000000000001",
    });
    assert.equal(item.sizeBytes, 12345);
    assert.equal(item.pendingId, "00000000-0000-4000-a000-000000000001");
  });
});

test("CopiedStore: tolerant on corrupted", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "copied.json");
    await fsp.writeFile(file, "bad", "utf8");
    const s = new CopiedStore(file);
    assert.deepEqual(await s.load(), []);
  });
});
