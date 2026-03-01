const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { URL } = require("node:url");

const packageJson = require("../package.json");

function targetAssetName() {
  const { platform, arch } = process;
  if (platform === "linux" && arch === "x64") {
    return "openvcs-sdk-linux-x64";
  }
  if (platform === "darwin" && arch === "x64") {
    return "openvcs-sdk-darwin-x64";
  }
  if (platform === "darwin" && arch === "arm64") {
    return "openvcs-sdk-darwin-arm64";
  }
  if (platform === "win32" && arch === "x64") {
    return "openvcs-sdk-win32-x64.exe";
  }
  throw new Error(`Unsupported platform/arch for @openvcs/sdk: ${platform}/${arch}`);
}

function vendorBinaryPath() {
  return path.join(
    __dirname,
    "..",
    "vendor",
    process.platform === "win32" ? "openvcs-sdk.exe" : "openvcs-sdk"
  );
}

function releaseDownloadUrl() {
  const envUrl = process.env.OPENVCS_SDK_BINARY_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl;
  }

  const tag = `v${packageJson.version}`;
  const asset = targetAssetName();
  return `https://github.com/Open-VCS/OpenVCS-SDK/releases/download/${tag}/${asset}`;
}

function download(urlString, destinationPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = https.get(
      url,
      { headers: { "user-agent": "@openvcs/sdk-postinstall" } },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          download(response.headers.location, destinationPath)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with status ${response.statusCode} for ${urlString}`));
          return;
        }

        const file = fs.createWriteStream(destinationPath);
        response.pipe(file);
        file.on("finish", () => {
          file.close((closeError) => {
            if (closeError) {
              reject(closeError);
              return;
            }
            resolve();
          });
        });
        file.on("error", (error) => {
          response.destroy();
          reject(error);
        });
      }
    );

    request.on("error", reject);
  });
}

async function main() {
  const destination = vendorBinaryPath();
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const localBinary = process.env.OPENVCS_SDK_LOCAL_BINARY;
  if (localBinary && localBinary.trim().length > 0) {
    fs.copyFileSync(localBinary, destination);
  } else {
    const url = releaseDownloadUrl();
    process.stdout.write(`@openvcs/sdk downloading ${url}\n`);
    await download(url, destination);
  }

  if (process.platform !== "win32") {
    fs.chmodSync(destination, 0o755);
  }
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`@openvcs/sdk postinstall failed: ${detail}\n`);
  process.exit(1);
});
