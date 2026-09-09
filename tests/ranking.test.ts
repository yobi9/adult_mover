import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickBest,
  titleSimilarity,
  scoreCandidate,
  normalizeForMatch,
} from "../source/core/tmdb/ranking";

interface Item {
  name: string;
  year: number | null;
}

test("pickBest chooses the exact match", () => {
  const items: Item[] = [
    { name: "Breaking Bad: The Movie", year: 2008 },
    { name: "Breaking Bad", year: 2008 },
  ];
  const best = pickBest("Breaking Bad", 2008, items);
  assert.ok(best);
  assert.equal(best.item.name, "Breaking Bad");
  assert.ok(best.confidence > 0.55);
});

test("pickBest prefers the matching year over the wrong one", () => {
  const items: Item[] = [
    { name: "The Matrix", year: 2003 },
    { name: "The Matrix", year: 1999 },
  ];
  const best = pickBest("The Matrix", 1999, items);
  assert.ok(best);
  assert.equal(best.item.year, 1999);
});

test("pickBest returns null on low confidence", () => {
  const items: Item[] = [{ name: "Toy Story", year: 1995 }];
  const best = pickBest("سلسلة عربية غير موجودة تماماً", null, items);
  assert.equal(best, null);
});

test("pickBest returns null on empty list", () => {
  assert.equal(pickBest("Anything", null, []), null);
});

test("titleSimilarity handles separators (Spider Man vs Spider-Man)", () => {
  const sim = titleSimilarity("Spider Man 2", "Spider-Man 2");
  assert.ok(sim >= 0.85, `got ${sim}`);
});

test("titleSimilarity exact equals 1", () => {
  assert.equal(titleSimilarity("The Matrix", "The Matrix"), 1);
});

test("titleSimilarity unrelated is low", () => {
  const sim = titleSimilarity("Toy Story", "Interstellar");
  assert.ok(sim < 0.4, `got ${sim}`);
});

test("normalizeForMatch keeps Arabic and target language", () => {
  assert.equal(normalizeForMatch("فيلم عربي HD."), "فيلم عربي hd");
  assert.equal(normalizeForMatch("  The..Matrix "), "the matrix");
});

test("scoreCandidate rewards exact name + matching year", () => {
  const exact = scoreCandidate("The Matrix", 1999, { name: "The Matrix", year: 1999 }, { order: 0, total: 1 });
  const wrongYear = scoreCandidate("The Matrix", 1999, { name: "The Matrix", year: 2010 }, { order: 0, total: 1 });
  assert.ok(exact > wrongYear);
  assert.ok(exact - wrongYear > 0.1);
});

test("pickBest returns null when confidence is below threshold for ambiguous names", () => {
  const items: Item[] = [
    { name: "Random unrelated title number forty two", year: 1998 },
    { name: "Completely Different Show", year: 2010 },
  ];
  const best = pickBest("Totally Unknown Query", 2005, items);
  assert.equal(best, null);
});