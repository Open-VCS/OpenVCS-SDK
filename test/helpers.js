const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeTempDir(prefix = "openvcs-sdk-test") {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function cleanupTempDir(rootDir) {
  fs.rmSync(rootDir, { recursive: true, force: true });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

module.exports = {
  cleanupTempDir,
  makeTempDir,
  writeJson,
  writeText,
};
