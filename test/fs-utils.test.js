const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  copyDirectoryRecursiveStrict,
  copyFileStrict,
  ensureDirectory,
  isPathInside,
  rejectSymlinksRecursive,
} = require("../lib/fs-utils");
const { cleanupTempDir, makeTempDir, writeText } = require("./helpers");

test("isPathInside returns true for descendants", () => {
  const root = "/tmp/root";
  assert.equal(isPathInside(root, "/tmp/root/a/b"), true);
});

test("isPathInside returns true for root itself", () => {
  const root = "/tmp/root";
  assert.equal(isPathInside(root, "/tmp/root"), true);
});

test("isPathInside returns false for parent escape", () => {
  const root = "/tmp/root";
  assert.equal(isPathInside(root, "/tmp/other/file"), false);
});

test("ensureDirectory creates nested directories", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const target = path.join(root, "a", "b", "c");
  ensureDirectory(target);
  assert.equal(fs.existsSync(target), true);
  assert.equal(fs.lstatSync(target).isDirectory(), true);
  cleanupTempDir(root);
});

test("copyFileStrict copies regular files", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const src = path.join(root, "src.txt");
  const dst = path.join(root, "nested", "dst.txt");
  writeText(src, "hello");
  copyFileStrict(src, dst);
  assert.equal(fs.readFileSync(dst, "utf8"), "hello");
  cleanupTempDir(root);
});

test("copyFileStrict rejects non-files", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const src = path.join(root, "src-dir");
  fs.mkdirSync(src, { recursive: true });
  const dst = path.join(root, "dst.txt");
  assert.throws(() => copyFileStrict(src, dst), /expected file/);
  cleanupTempDir(root);
});

test("copyFileStrict rejects file symlinks", () => {
  if (process.platform === "win32") {
    return;
  }
  const root = makeTempDir("openvcs-sdk-test");
  const target = path.join(root, "target.txt");
  const link = path.join(root, "link.txt");
  writeText(target, "target");
  fs.symlinkSync(target, link);

  assert.throws(() => copyFileStrict(link, path.join(root, "out.txt")), /symlink/);
  cleanupTempDir(root);
});

test("copyDirectoryRecursiveStrict copies nested trees", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const src = path.join(root, "src");
  const dst = path.join(root, "dst");
  writeText(path.join(src, "a.txt"), "a");
  writeText(path.join(src, "nested", "b.txt"), "b");

  copyDirectoryRecursiveStrict(src, dst);

  assert.equal(fs.readFileSync(path.join(dst, "a.txt"), "utf8"), "a");
  assert.equal(fs.readFileSync(path.join(dst, "nested", "b.txt"), "utf8"), "b");
  cleanupTempDir(root);
});

test("copyDirectoryRecursiveStrict is no-op for missing source", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const src = path.join(root, "missing");
  const dst = path.join(root, "dst");
  copyDirectoryRecursiveStrict(src, dst);
  assert.equal(fs.existsSync(dst), false);
  cleanupTempDir(root);
});

test("copyDirectoryRecursiveStrict errors when source is file", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const src = path.join(root, "file.txt");
  writeText(src, "x");
  const dst = path.join(root, "dst");
  assert.throws(() => copyDirectoryRecursiveStrict(src, dst), /expected directory/);
  cleanupTempDir(root);
});

test("copyDirectoryRecursiveStrict rejects source directory symlink", () => {
  if (process.platform === "win32") {
    return;
  }
  const root = makeTempDir("openvcs-sdk-test");
  const targetDir = path.join(root, "target");
  const link = path.join(root, "link");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.symlinkSync(targetDir, link);

  assert.throws(() => copyDirectoryRecursiveStrict(link, path.join(root, "dst")), /symlink/);
  cleanupTempDir(root);
});

test("copyDirectoryRecursiveStrict skips special non-file entries", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const src = path.join(root, "src");
  const dst = path.join(root, "dst");
  fs.mkdirSync(path.join(src, "fifo-like"), { recursive: true });
  writeText(path.join(src, "file.txt"), "ok");

  copyDirectoryRecursiveStrict(src, dst);

  assert.equal(fs.readFileSync(path.join(dst, "file.txt"), "utf8"), "ok");
  cleanupTempDir(root);
});

test("rejectSymlinksRecursive allows regular trees", () => {
  const root = makeTempDir("openvcs-sdk-test");
  writeText(path.join(root, "a.txt"), "a");
  writeText(path.join(root, "nested", "b.txt"), "b");
  assert.doesNotThrow(() => rejectSymlinksRecursive(root));
  cleanupTempDir(root);
});

test("rejectSymlinksRecursive rejects file symlink", () => {
  if (process.platform === "win32") {
    return;
  }
  const root = makeTempDir("openvcs-sdk-test");
  const target = path.join(root, "target.txt");
  const link = path.join(root, "link.txt");
  writeText(target, "target");
  fs.symlinkSync(target, link);

  assert.throws(() => rejectSymlinksRecursive(root), /symlink/);
  cleanupTempDir(root);
});

test("rejectSymlinksRecursive rejects directory symlink", () => {
  if (process.platform === "win32") {
    return;
  }
  const root = makeTempDir("openvcs-sdk-test");
  const targetDir = path.join(root, "target-dir");
  const link = path.join(root, "link-dir");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.symlinkSync(targetDir, link);

  assert.throws(() => rejectSymlinksRecursive(root), /symlink/);
  cleanupTempDir(root);
});
