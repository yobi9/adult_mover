import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runExecutePhase } from "../source/core/pipeline/orchestrator";
import { createStopSignal } from "../source/core/pipeline/stop";
import { moveFolder, copyFolder, pathExists } from "../source/core/files/mover";
import { Logger } from "../source/core/logging/logger";
import type { PendingAdultItem } from "../source/core/types";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-exec-"));
  try { await fn(dir); } finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

function pending(folder: string, dest: string): PendingAdultItem {
  return {
    id: `00000000-0000-4000-a000-0000000000${Math.floor(Math.random()*9+1)}1`,
    folderName: path.basename(folder),
    originalPath: folder,
    destination: dest,
    rating: "R",
    mediaType: "movie",
    tmdbId: 1,
    confidence: 0.9,
    year: 2000,
    title: path.basename(folder),
    dateScanned: new Date().toISOString(),
    source: path.dirname(folder),
  };
}

test("runExecutePhase move: moves pending items and reports executed", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "a.mp4"), "x");
    const dest = path.join(base, "dest");
    const item = pending(src, dest);
    const logger = new Logger(50);
    const res = await runExecutePhase({
      items: [item],
      mode: "move",
      destination: dest,
      stop: createStopSignal(),
      logger,
      moveFolder,
      copyFolder,
    });
    assert.equal(res.phase, "complete");
    assert.equal(res.executed.length, 1);
    assert.equal(await pathExists(src), false);
    assert.equal(await pathExists(path.join(dest, "Movie A", "a.mp4")), true);
  });
});

test("runExecutePhase copy: keeps source and verifies", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "a.mp4"), "hello");
    const dest = path.join(base, "dest");
    const item = pending(src, dest);
    const res = await runExecutePhase({
      items: [item],
      mode: "copy",
      destination: dest,
      stop: createStopSignal(),
      logger: new Logger(50),
      moveFolder,
      copyFolder,
    });
    assert.equal(res.executed.length, 1);
    assert.equal(await pathExists(src), true);
    assert.equal(await pathExists(path.join(dest, "Movie A", "a.mp4")), true);
  });
});

test("runExecutePhase respects stop", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "a.mp4"), "x");
    const dest = path.join(base, "dest");
    const stop = createStopSignal();
    stop.requestStop();
    const res = await runExecutePhase({
      items: [pending(src, dest)],
      mode: "move",
      destination: dest,
      stop,
      logger: new Logger(10),
      moveFolder,
      copyFolder,
    });
    assert.equal(res.phase, "aborted");
    assert.equal(res.stopped, true);
    assert.equal(res.executed.length, 0);
  });
});

test("runExecutePhase handles missing source as error", async () => {
  await withTempDir(async (base) => {
    const dest = path.join(base, "dest");
    const fake = pending(path.join(base, "missing"), dest);
    const res = await runExecutePhase({
      items: [fake],
      mode: "move",
      destination: dest,
      stop: createStopSignal(),
      logger: new Logger(10),
      moveFolder,
      copyFolder,
    });
    assert.equal(res.errors.length, 1);
    assert.equal(res.executed.length, 0);
  });
});
