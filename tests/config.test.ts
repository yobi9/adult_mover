import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppConfigStore, defaultSettings } from "../source/core/config/store";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-config-"));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("load returns defaults when file is missing", async () => {
  await withTempDir(async (dir) => {
    const store = new AppConfigStore(path.join(dir, "settings.json"));
    const settings = await store.load();
    assert.deepEqual(settings, defaultSettings());
  });
});

test("save then load round-trips settings", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "settings.json");
    const store = new AppConfigStore(file);
    await store.save({
      sources: ["D:\\Media\\Movies", "\\\\server\\share\\videos"],
      destination: "D:\\Adult",
      recursive: false,
      keepApiKey: false,
      apiKey: "",
    });
    const loaded = await store.load();
    assert.deepEqual(loaded.sources, ["D:\\Media\\Movies", "\\\\server\\share\\videos"]);
    assert.equal(loaded.destination, "D:\\Adult");
    assert.equal(loaded.recursive, false);
    assert.equal(loaded.keepApiKey, false);
  });
});

test("api key persists only when keepApiKey is explicitly true", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "settings.json");
    const store = new AppConfigStore(file);

    await store.save({ sources: [], destination: "", recursive: true, keepApiKey: false, apiKey: "SECRET_KEY" });
    const unpersistedRaw = await fsp.readFile(file, "utf8");
    assert.equal(unpersistedRaw.includes("SECRET_KEY"), false);

    await store.save({ sources: [], destination: "", recursive: true, keepApiKey: true, apiKey: "SECRET_KEY" });
    const persistedRaw = await fsp.readFile(file, "utf8");
    assert.equal(persistedRaw.includes("SECRET_KEY"), true);
    const loaded = await store.load();
    assert.equal(loaded.apiKey, "SECRET_KEY");
  });
});

test("load tolerates corrupted json and falls back to defaults", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "settings.json");
    await fsp.writeFile(file, "{not valid json", "utf8");
    const store = new AppConfigStore(file);
    assert.deepEqual(await store.load(), defaultSettings());
  });
});

test("load fills missing fields with defaults but keeps valid ones", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "settings.json");
    await fsp.writeFile(file, JSON.stringify({ version: 1, sources: ["X"], keepApiKey: true }), "utf8");
    const store = new AppConfigStore(file);
    const settings = await store.load();
    assert.deepEqual(settings.sources, ["X"]);
    assert.equal(settings.destination, "");
    assert.equal(settings.recursive, true);
    assert.equal(settings.keepApiKey, true);
  });
});

test("reset removes the settings file", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "settings.json");
    const store = new AppConfigStore(file);
    await store.save(defaultSettings());
    assert.equal(await fsp.stat(file).then(() => true).catch(() => false), true);
    await store.reset();
    assert.equal(await fsp.stat(file).then(() => true).catch(() => false), false);
  });
});