const fs = require("node:fs");
const path = require("node:path");

function binaryName() {
  return process.platform === "win32" ? "openvcs-sdk.exe" : "openvcs-sdk";
}

function resolveBinaryPath() {
  const explicit = process.env.OPENVCS_SDK_BINARY;
  if (explicit && explicit.trim().length > 0) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`OPENVCS_SDK_BINARY does not exist: ${explicit}`);
    }
    return explicit;
  }

  const vendorPath = path.join(__dirname, "..", "vendor", binaryName());
  if (fs.existsSync(vendorPath)) {
    return vendorPath;
  }

  throw new Error(
    "OpenVCS SDK native binary is missing. Reinstall @openvcs/sdk or set OPENVCS_SDK_BINARY."
  );
}

module.exports = {
  resolveBinaryPath,
};
