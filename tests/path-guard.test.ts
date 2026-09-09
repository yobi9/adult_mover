import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePath,
  isSamePath,
  isPathInside,
  isUnsafeSourceDestination,
} from "../source/core/files/path-guard";

test("normalizePath unifies separators, case and trailing slashes", () => {
  assert.equal(normalizePath("D:\\Movies\\Sub\\"), normalizePath("d:/movies/sub"));
  assert.equal(normalizePath("d:/movies/sub"), "d:/movies/sub");
});

test("isSamePath matches case-insensitively", () => {
  assert.equal(isSamePath("D:\\Movies", "d:/movies"), true);
  assert.equal(isSamePath("D:\\Movies\\", "d:/movies"), true);
});

test("isSamePath distinguishes different paths", () => {
  assert.equal(isSamePath("D:\\Movies", "D:\\Movies2"), false);
});

test("isPathInside detects nested children", () => {
  assert.equal(isPathInside("D:\\Media\\Movies\\MovieA", "D:\\Media\\Movies"), true);
  assert.equal(isPathInside("D:\\Media\\Movies", "D:\\Media\\Movies"), false);
});

test("isPathInside supports UNC server paths", () => {
  assert.equal(
    isPathInside("\\\\Server\\Share\\Movies\\MovieA", "\\\\Server\\Share\\Movies"),
    true
  );
  assert.equal(
    isPathInside("\\\\Server\\Share\\Movies", "\\\\Server\\Share\\Movies\\X"),
    false
  );
});

test("isUnsafeSourceDestination blocks identical paths", () => {
  assert.equal(isUnsafeSourceDestination("\\\\Server\\Share\\Media", "\\\\Server\\Share\\Media"), true);
  assert.equal(isUnsafeSourceDestination("D:\\Media", "d:/media"), true);
});

test("isUnsafeSourceDestination blocks source inside destination", () => {
  assert.equal(
    isUnsafeSourceDestination("D:\\Media\\Movies", "D:\\Media"),
    true
  );
});

test("isUnsafeSourceDestination blocks destination inside source", () => {
  assert.equal(
    isUnsafeSourceDestination("D:\\Media", "D:\\Media\\Adult"),
    true
  );
});

test("isUnsafeSourceDestination allows sibling volumes", () => {
  assert.equal(
    isUnsafeSourceDestination("\\\\Server\\Share\\Movies", "\\\\Server\\Share\\Adult"),
    false
  );
  assert.equal(isUnsafeSourceDestination("D:\\Media", "E:\\Backup"), false);
});

test("isUnsafeSourceDestination ignores empty paths", () => {
  assert.equal(isUnsafeSourceDestination("", "D:\\Backup"), false);
  assert.equal(isUnsafeSourceDestination("D:\\Media", " "), false);
});