import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRating } from "../source/core/ratings/normalization";
import { isTargetRating, TARGET_RATINGS } from "../source/core/ratings/targets";

test("normalizeRating unifies case and punctuation", () => {
  assert.equal(normalizeRating("TV-MA"), "tvma");
  assert.equal(normalizeRating("tv-ma"), "tvma");
  assert.equal(normalizeRating(" TV-MA "), "tvma");
  assert.equal(normalizeRating("TVMA"), "tvma");
  assert.equal(normalizeRating("tv_ma"), "tvma");
  assert.equal(normalizeRating("NC-17"), "nc17");
  assert.equal(normalizeRating("18+"), "18");
  assert.equal(normalizeRating("R"), "r");
  assert.equal(normalizeRating("ADULT"), "adult");
});

test("normalizeRating handles empty/null input", () => {
  assert.equal(normalizeRating(null), "");
  assert.equal(normalizeRating(undefined), "");
  assert.equal(normalizeRating(""), "");
  assert.equal(normalizeRating("   "), "");
});

test("target ratings list matches the requirements", () => {
  assert.deepEqual(TARGET_RATINGS, ["tvma", "r", "nc17", "x", "18", "adult"]);
});

test("isTargetRating accepts every variant of TV-MA", () => {
  assert.equal(isTargetRating("TV-MA"), true);
  assert.equal(isTargetRating("tv-ma"), true);
  assert.equal(isTargetRating(" TV-MA "), true);
  assert.equal(isTargetRating("TVMA"), true);
});

test("isTargetRating accepts other target values", () => {
  assert.equal(isTargetRating("R"), true);
  assert.equal(isTargetRating("NC-17"), true);
  assert.equal(isTargetRating("X"), true);
  assert.equal(isTargetRating("18+"), true);
  assert.equal(isTargetRating("18"), true);
  assert.equal(isTargetRating("ADULT"), true);
});

test("isTargetRating rejects non-target ratings", () => {
  assert.equal(isTargetRating("PG-13"), false);
  assert.equal(isTargetRating("PG"), false);
  assert.equal(isTargetRating("G"), false);
  assert.equal(isTargetRating("TV-14"), false);
  assert.equal(isTargetRating("TV-PG"), false);
  assert.equal(isTargetRating("NR"), false);
  assert.equal(isTargetRating("Rated T"), false);
});

test("isTargetRating rejects null/empty without throwing", () => {
  assert.equal(isTargetRating(null), false);
  assert.equal(isTargetRating(undefined), false);
  assert.equal(isTargetRating(""), false);
});