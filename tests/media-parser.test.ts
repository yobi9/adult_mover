import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMediaName } from "../source/core/media-parser/parser";

test("TV: Breaking.Bad.S05.1080p.WEB-DL", () => {
  const parsed = parseMediaName("Breaking.Bad.S05.1080p.WEB-DL");
  assert.equal(parsed.title, "Breaking Bad");
  assert.equal(parsed.season, 5);
  assert.equal(parsed.isSeriesHint, true);
  assert.equal(parsed.year, null);
});

test("Movie: The.Matrix.1999.2160p.BluRay", () => {
  const parsed = parseMediaName("The.Matrix.1999.2160p.BluRay");
  assert.equal(parsed.title, "The Matrix");
  assert.equal(parsed.year, 1999);
  assert.equal(parsed.isSeriesHint, false);
});

test("TV season word: Game.of.Thrones.Season.01.1080p", () => {
  const parsed = parseMediaName("Game.of.Thrones.Season.01.1080p");
  assert.equal(parsed.title, "Game of Thrones");
  assert.equal(parsed.season, 1);
  assert.equal(parsed.isSeriesHint, true);
});

test("Movie with year and quality: Movie.Name.2024.4K.WEB-DL", () => {
  const parsed = parseMediaName("Movie.Name.2024.4K.WEB-DL");
  assert.equal(parsed.title, "Movie Name");
  assert.equal(parsed.year, 2024);
});

test("Long technical triple removed: The.Matrix.1999.REMASTERED.1080p.DTS-HD.MA.TrueHD", () => {
  const parsed = parseMediaName("The.Matrix.1999.REMASTERED.1080p.DTS-HD.MA.TrueHD");
  assert.equal(parsed.title, "The Matrix");
  assert.equal(parsed.year, 1999);
});

test("Arabic name: فيلم.عربي.2023.1080p", () => {
  const parsed = parseMediaName("فيلم.عربي.2023.1080p");
  assert.equal(parsed.title, "فيلم عربي");
  assert.equal(parsed.year, 2023);
});

test("Episode range: Series.Name.S01E01E02.720p.WEBRip", () => {
  const parsed = parseMediaName("Series.Name.S01E01E02.720p.WEBRip");
  assert.equal(parsed.title, "Series Name");
  assert.equal(parsed.season, 1);
  assert.deepEqual(parsed.episodes, [1, 2]);
  assert.equal(parsed.isSeriesHint, true);
});

test("Release group brackets removed: [YTS.AG] Spider.Man.2.2004.1080p", () => {
  const parsed = parseMediaName("[YTS.AG] Spider.Man.2.2004.1080p");
  assert.equal(parsed.title, "Spider Man 2");
  assert.equal(parsed.year, 2004);
});

test("WEB.DL phrase split across tokens is removed", () => {
  const parsed = parseMediaName("Breaking.Bad.S01E01.WEB.DL");
  assert.equal(parsed.title, "Breaking Bad");
});

test("Arabic season word with ordinal is recognized", () => {
  const parsed = parseMediaName("مسلسل.موسم.الثاني.1080p");
  assert.equal(parsed.title, "مسلسل");
  assert.equal(parsed.season, 2);
  assert.equal(parsed.isSeriesHint, true);
});

test("Film titled with a number-only name is not treated as year", () => {
  const parsed = parseMediaName("1917");
  assert.equal(parsed.title, "1917");
  assert.equal(parsed.year, null);
});

test("Resolution numbers are not picked as year", () => {
  assert.equal(parseMediaName("Dune.Part.Two.2024.1080p").title, "Dune Part Two");
  assert.equal(parseMediaName("Dune.Part.Two.2024.1080p").year, 2024);
  assert.equal(parseMediaName("Dune.Part.Two.2024.2160p").year, 2024);
  assert.equal(parseMediaName("Inception.2010.1080p").title, "Inception");
});

test("Empty and edge input does not crash", () => {
  assert.equal(parseMediaName("").title, "");
  assert.equal(parseMediaName("  . . . ").title, "");
  assert.equal(parseMediaName("...").title, "");
});

test("Movie: Pulp Fiction (1994) parenthesized year", () => {
  const parsed = parseMediaName("Pulp Fiction (1994)");
  assert.equal(parsed.title, "Pulp Fiction");
  assert.equal(parsed.year, 1994);
});

test("Movie: Pulp.Fiction.1994 dot style", () => {
  const parsed = parseMediaName("Pulp.Fiction.1994");
  assert.equal(parsed.title, "Pulp Fiction");
  assert.equal(parsed.year, 1994);
});

test("Movie: Pulp Fiction 1994 space style", () => {
  const parsed = parseMediaName("Pulp Fiction 1994");
  assert.equal(parsed.title, "Pulp Fiction");
  assert.equal(parsed.year, 1994);
});

test("Parenthesized year with quality suffix is extracted", () => {
  const parsed = parseMediaName("Pulp.Fiction.(1994).1080p.BluRay");
  assert.equal(parsed.title, "Pulp Fiction");
  assert.equal(parsed.year, 1994);
});

test("Parentheses WITHOUT a year are preserved", () => {
  const parsed = parseMediaName("True.Romance.(Special.Edition).1993");
  assert.equal(parsed.title, "True Romance (Special Edition)");
  assert.equal(parsed.year, 1993);
});

test("Arabic name with parenthesized year", () => {
  const parsed = parseMediaName("فيلم عربي (2023)");
  assert.equal(parsed.title, "فيلم عربي");
  assert.equal(parsed.year, 2023);
});

test("No-year name is unchanged", () => {
  const parsed = parseMediaName("True Romance");
  assert.equal(parsed.title, "True Romance");
  assert.equal(parsed.year, null);
});

test("TV series with parenthesized year keeps season", () => {
  const parsed = parseMediaName("The.Wire.S01.(2002).1080p");
  assert.equal(parsed.title, "The Wire");
  assert.equal(parsed.season, 1);
  assert.equal(parsed.year, 2002);
  assert.equal(parsed.isSeriesHint, true);
});

test("Curly-brace year is extracted", () => {
  const parsed = parseMediaName("Drive {2011}");
  assert.equal(parsed.title, "Drive");
  assert.equal(parsed.year, 2011);
});

test("Numbered film wrapped in parens keeps its title", () => {
  const parsed = parseMediaName("1917 (2019)");
  assert.equal(parsed.title, "1917");
  assert.equal(parsed.year, 2019);
});

test("season container names parse to empty title with a season hint", () => {
  const cases: Array<[string, number]> = [
    ["الموسم 01", 1],
    ["الموسم الثاني", 2],
    ["Season 1", 1],
    ["Season 01", 1],
    ["S02", 2],
  ];
  for (const [name, season] of cases) {
    const parsed = parseMediaName(name);
    assert.equal(parsed.title, "", `title for ${name}`);
    assert.equal(parsed.season, season, `season for ${name}`);
    assert.equal(parsed.isSeriesHint, true, `isSeriesHint for ${name}`);
  }
});

test("episode-only names are containers too (never a TMDB title)", () => {
  for (const name of ["S01E01", "S01E01E02", "E02", "episode1"]) {
    const parsed = parseMediaName(name);
    assert.equal(parsed.title, "", `title for ${name}`);
    assert.equal(parsed.isSeriesHint, true, `isSeriesHint for ${name}`);
  }
});

test("media names with a season token but a real title are NOT containers", () => {
  assert.equal(parseMediaName("Game of Thrones Season 1").title, "Game of Thrones");
  assert.equal(parseMediaName("Game.of.Thrones.S01").title, "Game of Thrones");
  assert.equal(parseMediaName("Breaking Bad S05").title, "Breaking Bad");
  assert.equal(parseMediaName("Station 19").title, "Station 19");
  assert.equal(parseMediaName("Movie Name").title, "Movie Name");
});