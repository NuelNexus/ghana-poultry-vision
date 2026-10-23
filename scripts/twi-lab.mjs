// Start the local Twi services for testing on this PC:
//   - Twi voice (GhanaNLP stable-twi-tts)     http://127.0.0.1:5002   -> TWI_TTS_URL
//   - Twi word helper (DistilABENA v2)          http://127.0.0.1:5003   -> TWI_NLP_URL
// usage: npm run twi     (then run the site with `npm run dev` in another terminal)
//
// First time only, create the Python environment:
//   python -m venv .venv-twi
//   .venv-twi\Scripts\python -m pip install "torch==2.4.1" --index-url https://download.pytorch.org/whl/cpu
//   .venv-twi\Scripts\python -m pip install "transformers==4.57.6" "numpy<2" hf_xet "stable-twi-tts[twi,eng]==0.2.1"
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const py = path.join(root, ".venv-twi", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!fs.existsSync(py)) {
  console.error("Missing .venv-twi. See the setup steps at the top of scripts/twi-lab.mjs.");
  process.exit(1);
}

const services = [
  ["voice", ["edge/twi_tts.py", "serve", "--port", "5002", "--env", "none"]],
  ["words", ["edge/twi_nlp.py", "serve", "--port", "5003"]],
];
// A local copy of DistilABENA (config.json, vocab.txt, model.safetensors) skips the
// Hugging Face download, which can stall on slow connections.
const localModel = path.join(root, ".venv-twi", "models", "distilabena-v2");
const modelEnv = fs.existsSync(path.join(localModel, "model.safetensors"))
  ? { PG_NLP_MODEL: localModel }
  : {};

const children = services.map(([name, args]) => {
  const child = spawn(py, ["-X", "utf8", "-u", ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...modelEnv,
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      PYTHONWARNINGS: "ignore",
    },
  });
  const out = (d) =>
    String(d)
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/Warning|warn\(/.test(l))
      .forEach((l) => console.log(`[${name}] ${l}`));
  child.stdout.on("data", out);
  child.stderr.on("data", out);
  child.on("exit", (code) => console.log(`[${name}] stopped (${code})`));
  return child;
});

const stop = () => {
  children.forEach((c) => c.kill());
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log("Starting the Twi voice (:5002) and word helper (:5003). Ctrl+C to stop.");
