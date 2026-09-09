import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger, maskSensitive, formatTimestamp } from "../source/core/logging/logger";

test("maskSensitive hides the api_key value in a URL", () => {
  const masked = maskSensitive(
    "https://api.themoviedb.org/3/search/tv?api_key=abc123SECRET&query=test"
  );
  assert.equal(masked.includes("abc123SECRET"), false);
  assert.ok(masked.includes("api_key=***"));
});

test("maskSensitive leaves unrelated Arabic text unchanged", () => {
  const input = "مسار مجلد عربي بلا مفاتيح //Server/Share";
  assert.equal(maskSensitive(input), input);
});

test("maskSensitive masks all occurrences, not just the first", () => {
  const masked = maskSensitive("k=%2Ffirst ab%2Fke&api_key=ONE x=1&api_key=TWO");
  assert.equal(masked.includes("ONE"), false);
  assert.equal(masked.includes("TWO"), false);
});

test("formatTimestamp produces YYYY-MM-DD HH:mm:ss", () => {
  const formatted = formatTimestamp(new Date(2026, 0, 5, 9, 3, 8));
  assert.equal(formatted, "2026-01-05 09:03:08");
});

test("logger never stores a secret key in entries", () => {
  const logger = new Logger();
  logger.info("نقل فاشل: https://api.themoviedb.org/3/movie/1?api_key=SECRETKEY123");
  const entry = logger.entries[0];
  assert.ok(entry);
  assert.equal(entry.message.includes("SECRETKEY123"), false);
  assert.ok(entry.message.includes("api_key=***"));
});

test("logger ring buffer is bounded to maxEntries", () => {
  const logger = new Logger(3);
  for (let i = 0; i < 10; i++) {
    logger.info(`msg-${i}`);
  }
  assert.equal(logger.entries.length, 3);
  assert.equal(logger.entries[0]?.message, "msg-7");
});

test("logger supports subscribe and unsubscribe", () => {
  const logger = new Logger();
  const seen: string[] = [];
  const off = logger.onLog((entry) => seen.push(entry.message));

  logger.info("a");
  off();
  logger.info("b");

  assert.deepEqual(seen, ["a"]);
});

test("logger clear empties the in-memory buffer", () => {
  const logger = new Logger();
  logger.info("x");
  logger.clear();
  assert.equal(logger.entries.length, 0);
});