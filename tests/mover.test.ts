import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  moveFolder,
  uniqueTargetPath,
  ensureDirectoryExists,
  pathExists,
} from "../source/core/files/mover";

/** مجلد مؤقت ومُطهَّر تلقائياً. */
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-move-"));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** برمجة خطأ EXDEV (عبور بين مجلدات). */
function exdevError(): NodeJS.ErrnoException {
  const err = new Error("Cross-device link not permitted") as NodeJS.ErrnoException;
  err.code = "EXDEV";
  return err;
}

test("uniqueTargetPath returns base name when not taken", async () => {
  await withTempDir(async (dir) => {
    const target = await uniqueTargetPath(dir, "Movie A");
    assert.equal(target, path.join(dir, "Movie A"));
  });
});

test("uniqueTargetPath increments suffix when name exists", async () => {
  await withTempDir(async (dir) => {
    await fsp.mkdir(path.join(dir, "Movie A"));
    await fsp.mkdir(path.join(dir, "Movie A_1"));
    const target = await uniqueTargetPath(dir, "Movie A");
    assert.equal(target, path.join(dir, "Movie A_2"));
  });
});

test("moveFolder renames a folder within the same volume", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "data");
    const dest = path.join(dir, "dest");

    const outcome = await moveFolder(src, dest, "Movie A");
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.movedTo, path.join(dest, "Movie A"));
    }
    assert.equal(await pathExists(src), false);
    assert.equal(await pathExists(path.join(dest, "Movie A", "film.mp4")), true);
  });
});

test("moveFolder never overwrites an existing destination folder", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "new");
    const dest = path.join(dir, "dest");
    await fsp.mkdir(path.join(dest, "Movie A"), { recursive: true });
    await fsp.writeFile(path.join(dest, "Movie A", "old.txt"), "keep me");

    const outcome = await moveFolder(src, dest, "Movie A");
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.movedTo, path.join(dest, "Movie A_1"));
    }
    assert.equal(await pathExists(path.join(dest, "Movie A", "old.txt")), true);
    assert.equal(await pathExists(path.join(dest, "Movie A_1", "film.mp4")), true);
  });
});

test("moveFolder auto-creates the destination directory", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Series A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "ep.mkv"), "x");
    const dest = path.join(dir, "not-there-yet", "nested");

    const outcome = await moveFolder(src, dest, "Series A");
    assert.equal(outcome.ok, true);
    assert.equal(await pathExists(path.join(dest, "Series A", "ep.mkv")), true);
  });
});

test("moveFolder rejects unsafe source/destination nesting", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "Media");
    await fsp.mkdir(path.join(src, "Movie A"), { recursive: true });
    await fsp.writeFile(path.join(src, "Movie A", "film.mp4"), "x");

    const outcome = await moveFolder(src, path.join(src, "Adult"), "Movie A");
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, "unsafe-paths");
    }
  });
});

test("moveFolder reports missing source without touching destination", async () => {
  await withTempDir(async (dir) => {
    const outcome = await moveFolder(path.join(dir, "missing"), path.join(dir, "dest"), "Movie A");
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, "source-missing");
    }
  });
});

test("moveFolder refuses cross-volume moves (EXDEV) and leaves source intact", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "x");
    const dest = path.join(dir, "dest");

    const outcome = await moveFolder(src, dest, "Movie A", {
      rename: async () => {
        throw exdevError();
      },
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, "cross-volume");
    }
    assert.equal(await pathExists(src), true);
    assert.equal(await pathExists(path.join(src, "film.mp4")), true);
  });
});

test("moveFolder maps other IO errors to io-error and keeps source", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "x");
    const dest = path.join(dir, "dest");

    const outcome = await moveFolder(src, dest, "Movie A", {
      rename: async () => {
        throw new Error("Access is denied");
      },
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, "io-error");
    }
    assert.equal(await pathExists(src), true);
  });
});

test("moveFolder honours a stop request before starting", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "film.mp4"), "x");
    const dest = path.join(dir, "dest");

    const outcome = await moveFolder(src, dest, "Movie A", {
      isStopping: () => true,
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, "aborted");
    }
    assert.equal(await pathExists(src), true);
  });
});

test("ensureDirectoryExists validates creation", async () => {
  await withTempDir(async (dir) => {
    const deep = path.join(dir, "a", "b", "c");
    await ensureDirectoryExists(deep);
    assert.equal(await pathExists(deep), true);
  });
});