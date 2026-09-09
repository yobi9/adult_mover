import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runScanPhase, runExecutePhase } from "../source/core/pipeline/orchestrator";
import { createStopSignal } from "../source/core/pipeline/stop";
import { scanSource } from "../source/core/files/scanner";
import { moveFolder, copyFolder, pathExists } from "../source/core/files/mover";
import { PendingStore } from "../source/core/config/pending-store";
import { UnknownStore } from "../source/core/config/unknown-store";
import { CopiedStore } from "../source/core/config/copied-store";
import { Logger } from "../source/core/logging/logger";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-int-"));
  try { await fn(dir); } finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

test("integration: scan → pending save → execute copy → copied record", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    for (const n of ["Movie A", "Movie B"]) {
      await fsp.mkdir(path.join(src, n), { recursive: true });
      await fsp.writeFile(path.join(src, n, "a.mp4"), "x");
    }
    await fsp.mkdir(path.join(src, "Family"), { recursive: true });
    await fsp.writeFile(path.join(src, "Family", "a.mp4"), "x");
    const dest = path.join(base, "dest");

    const pendingStore = new PendingStore(path.join(base, "pending.json"));
    const unknownStore = new UnknownStore(path.join(base, "unknown.json"));
    const copiedStore = new CopiedStore(path.join(base, "copied.json"));

    const scan = await runScanPhase({
      config: { sources: [src], destination: dest, recursive: true },
      stop: createStopSignal(),
      logger: new Logger(50),
      getRating: { getRating: async (title: string) => title.toLowerCase().includes("family")
        ? { rating: "PG", mediaType: "movie", tmdbId: 2, confidence: 0.9, state: "found" }
        : { rating: "R", mediaType: "movie", tmdbId: 1, confidence: 0.95, state: "found" } },
      scanSource,
    });

    assert.equal(scan.summary.knownAdultCount, 2);
    assert.equal(scan.unknown.length, 0);

    // save as pending
    await pendingStore.addMany(scan.knownAdult.map((it) => ({
      folderName: it.folderName, originalPath: it.originalPath, destination: it.destination,
      rating: it.rating, mediaType: it.mediaType, tmdbId: it.tmdbId, confidence: it.confidence,
      year: it.year, title: it.title, source: it.source,
    })));
    assert.equal((await pendingStore.load()).length, 2);

    // execute copy
    const pending = await pendingStore.load();
    const exec = await runExecutePhase({
      items: pending, mode: "copy", destination: dest,
      stop: createStopSignal(), logger: new Logger(50), moveFolder, copyFolder,
    });
    assert.equal(exec.executed.length, 2);
    // source kept
    assert.equal(await pathExists(path.join(src, "Movie A")), true);
    assert.equal(await pathExists(path.join(dest, "Movie A")), true);
    // simulate controller copied record
    for (const e of exec.executed) {
      await copiedStore.add({ folderName: e.item.folderName, originalPath: e.item.originalPath, copiedPath: e.target, destination: dest });
    }
    assert.equal((await copiedStore.load()).length, 2);
    // pending would be cleared by controller after success — simulate
    for (const e of exec.executed) await pendingStore.remove(e.item.id);
    assert.equal((await pendingStore.load()).length, 0);

    // unknown still empty
    assert.equal((await unknownStore.load()).length, 0);
  });
});

test("integration: unknown collected for not-found", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    await fsp.mkdir(path.join(src, "GarbageXyz"), { recursive: true });
    await fsp.writeFile(path.join(src, "GarbageXyz", "a.mp4"), "x");
    const scan = await runScanPhase({
      config: { sources: [src], destination: path.join(base, "dest"), recursive: true },
      stop: createStopSignal(),
      logger: new Logger(10),
      getRating: { getRating: async () => ({ rating: null, mediaType: "unknown", tmdbId: null, confidence: 0, state: "not-found" }) },
      scanSource,
    });
    assert.equal(scan.summary.unknownCount, 1);
    assert.equal(scan.unknown[0]!.reason, "not-found");
  });
});
