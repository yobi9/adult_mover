import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runScanPhase } from "../source/core/pipeline/orchestrator";
import { createStopSignal } from "../source/core/pipeline/stop";
import { scanSource } from "../source/core/files/scanner";
import { Logger } from "../source/core/logging/logger";
import { TmdbApiError } from "../source/core/tmdb/client";
import type { RatingResult } from "../source/core/types";

function fakeRating(suffix: "adult" | "pg" | "low" | "none" | "missing"): RatingResult {
  switch (suffix) {
    case "adult": return { rating: "R", mediaType: "movie", tmdbId: 1, confidence: 0.95, state: "found" };
    case "pg": return { rating: "TV-PG", mediaType: "series", tmdbId: 2, confidence: 0.9, state: "found" };
    case "low": return { rating: "R", mediaType: "movie", tmdbId: 3, confidence: 0.3, state: "found" };
    case "none": return { rating: null, mediaType: "movie", tmdbId: 4, confidence: 0.9, state: "no-rating" };
    case "missing": return { rating: null, mediaType: "movie", tmdbId: null, confidence: 0, state: "not-found" };
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-scan-"));
  try { await fn(dir); } finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

function makeGateway(spec: (title: string) => RatingResult | "throw") {
  return {
    getRating: async (title: string): Promise<RatingResult> => {
      const v = spec(title.toLowerCase());
      if (v === "throw") throw new TmdbApiError("network", "reset", undefined, true);
      return v;
    },
  };
}

test("runScanPhase: collects knownAdult without moving files", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    const dest = path.join(base, "dest");
    for (const n of ["Movie A", "Series A"]) {
      await fsp.mkdir(path.join(src, n), { recursive: true });
      await fsp.writeFile(path.join(src, n, "a.mp4"), "x");
    }
    const logger = new Logger(200);
    const result = await runScanPhase({
      config: { sources: [src], destination: dest, recursive: true },
      stop: createStopSignal(),
      logger,
      getRating: makeGateway(() => fakeRating("adult")),
      scanSource,
    });
    assert.equal(result.phase, "scan-complete");
    assert.equal(result.summary.knownAdultCount, 2);
    assert.equal(result.knownAdult.length, 2);
    assert.equal(result.unknown.length, 0);
    // لا نقل
    assert.equal(await fsp.access(path.join(src, "Movie A")).then(() => true).catch(() => false), true);
    assert.equal(await fsp.access(path.join(dest, "Movie A")).then(() => true).catch(() => false), false);
  });
});

test("runScanPhase: unknown reasons collected separately from skipped", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    for (const n of ["NotFound", "NoRating", "LowConf", "Family"]) {
      await fsp.mkdir(path.join(src, n), { recursive: true });
      await fsp.writeFile(path.join(src, n, "a.mp4"), "x");
    }
    const logger = new Logger(200);
    const result = await runScanPhase({
      config: { sources: [src], destination: path.join(base, "dest"), recursive: true },
      stop: createStopSignal(),
      logger,
      getRating: makeGateway((t) => {
        if (t === "notfound") return fakeRating("missing");
        if (t === "norating") return fakeRating("none");
        if (t === "lowconf") return fakeRating("low");
        return fakeRating("pg");
      }),
      scanSource,
    });
    assert.equal(result.summary.unknownCount, 3);
    assert.equal(result.summary.skippedCount, 1);
    assert.equal(result.unknown.length, 3);
    assert.ok(result.unknown.some((u) => u.reason === "not-found"));
    assert.ok(result.unknown.some((u) => u.reason === "no-rating"));
    assert.ok(result.unknown.some((u) => u.reason === "low-confidence"));
  });
});

test("runScanPhase: does not call move, respects stop", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    await fsp.mkdir(path.join(src, "Movie A"), { recursive: true });
    await fsp.writeFile(path.join(src, "Movie A", "a.mp4"), "x");
    await fsp.mkdir(path.join(src, "Movie B"), { recursive: true });
    await fsp.writeFile(path.join(src, "Movie B", "a.mp4"), "x");
    const stop = createStopSignal();
    stop.requestStop();
    const result = await runScanPhase({
      config: { sources: [src], destination: path.join(base, "dest"), recursive: true },
      stop,
      logger: new Logger(10),
      getRating: makeGateway(() => fakeRating("adult")),
      scanSource,
    });
    assert.equal(result.phase, "aborted");
    assert.equal(result.stopped, true);
  });
});

test("runScanPhase: series root is single knownAdult", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    const series = path.join(src, "Station 19");
    for (const s of ["الموسم 01", "الموسم 02"]) {
      await fsp.mkdir(path.join(series, s), { recursive: true });
      await fsp.writeFile(path.join(series, s, "e.mkv"), "x");
    }
    const result = await runScanPhase({
      config: { sources: [src], destination: path.join(base, "dest"), recursive: true },
      stop: createStopSignal(),
      logger: new Logger(50),
      getRating: makeGateway(() => ({ rating: "TV-MA", mediaType: "series", tmdbId: 9, confidence: 0.95, state: "found" })),
      scanSource,
    });
    assert.equal(result.summary.knownAdultCount, 1);
    assert.equal(result.knownAdult[0]!.folderName, "Station 19");
    assert.equal(result.knownAdult[0]!.rating, "TV-MA");
  });
});
