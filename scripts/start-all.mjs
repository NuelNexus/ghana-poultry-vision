// One command for everything on this PC:  npm start
//   1. installs the site's packages and the Twi Python environment (.venv-twi) the first time
//   2. fetches the NELVIN voice model from Git LFS if only its pointer was cloned
//   3. starts the Twi voice (:5002), the Twi word helper (:5003) and the website (vite dev)
// Ctrl+C stops all of them.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { root, startTwiServices, venvPython } from "./twi-lab.mjs";

const win = process.platform === "win32";
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: win && !path.isAbsolute(cmd), ...opts });
  if (r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")}`);
    process.exit(1);
  }
};

// On Vercel (or any CI) `npm start` must only build the site: the voice services and
// the dev server are for this PC and would never finish there.
if (process.env.VERCEL || process.env.CI) {
  console.log("==> Build server: building the site only (npm run build)");
  run("npm", ["run", "build"]);
  process.exit(0);
}

// 1. Site packages
if (!fs.existsSync(path.join(root, "node_modules", "vite"))) {
  console.log("==> Installing the site's packages (first run only)");
  run("npm", ["install"]);
}

// 1b. Twi Python environment
if (!fs.existsSync(venvPython)) {
  const candidates = win ? [["py", ["-3.11"]], ["py", ["-3"]], ["python", []]] : [["python3", []], ["python", []]];
  const found = candidates.find(([c, a]) => spawnSync(c, [...a, "--version"], { shell: win }).status === 0);
  if (!found) {
    console.error("Python 3.10-3.12 is needed for the Twi voice: https://www.python.org/downloads/");
    process.exit(1);
  }
  const [py, pyArgs] = found;
  console.log("==> Creating the Twi Python environment (.venv-twi, first run only, a few minutes)");
  run(py, [...pyArgs, "-m", "venv", ".venv-twi"]);
  run(venvPython, ["-m", "pip", "install", "-q", "--upgrade", "pip"]);
  run(venvPython, ["-m", "pip", "install", "-q", "torch==2.4.1", "--index-url", "https://download.pytorch.org/whl/cpu"]);
  run(venvPython, [
    "-m", "pip", "install", "-q",
    "transformers==4.57.6", "numpy<2", "hf_xet", "stable-twi-tts[twi,eng]==0.2.1", "africa-g2p==0.3.2",
  ]);
}

// 2. NELVIN model: a fresh clone without Git LFS has a 130-byte pointer instead of the model
const model = path.join(root, "edge", "voices", "nelvin", "model.onnx");
if (fs.existsSync(model) && fs.statSync(model).size < 10_000) {
  console.log("==> Downloading the NELVIN voice model (Git LFS)");
  const r = spawnSync("git", ["lfs", "pull"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) console.warn("Couldn't fetch it (install Git LFS). The male voice falls back to stock twi-6.");
}

if (!fs.existsSync(path.join(root, ".env"))) {
  console.warn("\nNo .env file: the site needs DATABASE_URL (and OPENAI_API_KEY for the assistant). See README.md.\n");
}

// 3. Everything at once
const children = startTwiServices();
const site = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "dev"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    TWI_TTS_URL: process.env.TWI_TTS_URL || "http://127.0.0.1:5002",
    TWI_NLP_URL: process.env.TWI_NLP_URL || "http://127.0.0.1:5003",
  },
});
children.push(site);
site.on("exit", () => stop());

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  children.forEach((c) => c.kill());
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log("Starting the Twi voice (:5002), Twi word helper (:5003) and the website. Ctrl+C stops everything.");
