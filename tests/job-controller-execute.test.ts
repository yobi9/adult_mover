import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JobController } from "../source/main/job-controller";
import { AppConfigStore } from "../source/core/config/store";
import { PendingStore } from "../source/core/config/pending-store";
import { CopiedStore } from "../source/core/config/copied-store";
import { UnknownStore } from "../source/core/config/unknown-store";
import { Logger } from "../source/core/logging/logger";
import { pathExists } from "../source/core/files/mover";
import type { PendingAdultItem } from "../source/core/types";
import type { JobEvent } from "../source/core/ipc-contracts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-ctrl-"));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function pending(folder: string, dest: string): PendingAdultItem {
  return {
    id: `00000000-0000-4000-a000-000000000${String(1)}0`,
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

async function makeController(base: string): Promise<{
  controller: JobController;
  events: JobEvent[];
}> {
  const events: JobEvent[] = [];
  const controller = new JobController(
    new AppConfigStore(path.join(base, "settings.json")),
    new Logger(100),
    (event: JobEvent) => events.push(event),
    new UnknownStore(path.join(base, "unknown.json")),
    new PendingStore(path.join(base, "pending.json")),
    new CopiedStore(path.join(base, "copied.json"))
  );
  await controller.init();
  return { controller, events };
}

test("JobController: executePending copy succeeds and clears pending + records copied", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src", "Movie A");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "a.mp4"), "hello");
    const dest = path.join(base, "dest");
    const { controller } = await makeController(base);
    await controller.saveSettings({ sources: [path.join(base, "src")], destination: dest, apiKey: "k" });

    const item = pending(src, dest);
    const pendingStore = new PendingStore(path.join(base, "pending.json"));
    await pendingStore.addMany([item]);

    const res = await controller.executePending("copy");
    assert.equal(res.ok, true);
    assert.equal(res.stopped, false);
    assert.equal(res.executed, 1);
    assert.equal(res.errors.length, 0);
    assert.equal(await pathExists(path.join(dest, "Movie A", "a.mp4")), true);
    assert.equal(await pathExists(src), true); // copy keeps source
    assert.equal((await pendingStore.load()).length, 0);

    const copiedStore = new CopiedStore(path.join(base, "copied.json"));
    const copied = await copiedStore.load();
    assert.equal(copied.length, 1);
    assert.equal(copied[0]!.folderName, "Movie A");
  });
});

test("JobController: executePending on empty pending returns clear Arabic message (no \"empty\")", async () => {
  await withTempDir(async (base) => {
    const dest = path.join(base, "dest");
    const { controller } = await makeController(base);
    await controller.saveSettings({ sources: [], destination: dest, apiKey: "k" });

    const res = await controller.executePending("copy");
    assert.equal(res.ok, false);
    assert.equal(res.stopped, false);
    assert.equal(res.executed, 0);
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0]!.includes("لا توجد عناصر"), true);
  });
});