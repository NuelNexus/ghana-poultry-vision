// Start the local Twi services for testing on this PC:
//   - Twi voice (GhanaNLP stable-twi-tts + our NELVIN voice)  http://127.0.0.1:5002   -> TWI_TTS_URL
//   - Twi word helper (DistilABENA v2)                          http://127.0.0.1:5003   -> TWI_NLP_URL
//   - Twi voice for the live site: a worker that takes the live site's Twi replies, speaks
//     them with NELVIN and sends the audio back (the same job queue the farm Pi uses).
//     Needs a device key: PG_DEVICE_ID / PG_DEVICE_API_KEY in the environment or in
//     edge/agent.env. Live site: PG_LIVE_URL, default https://ghana-poultry-vision.vercel.app;
//     PG_LIVE_URL=off turns it off.
// usage: npm run twi     (then run the site with `npm run dev` in another terminal)
//        npm start       does both, and sets up .venv-twi the first time (scripts/start-all.mjs)
//
// .venv-twi by hand, if you prefer:
//   python -m venv .venv-twi
//   .venv-twi\Scripts\python -m pip install "torch==2.4.1" --index-url https://download.pytorch.org/whl/cpu
//   .venv-twi\Scripts\python -m pip install "transformers==4.57.6" "numpy<2" hf_xet "stable-twi-tts[twi,eng]==0.2.1" "africa-g2p==0.3.2"
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const venvPython = path.join(
  root,
  ".venv-twi",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

/** Start the voice and word-helper services. Returns the child processes. */
export function startTwiServices() {
  if (!fs.existsSync(venvPython)) {
    console.error("Missing .venv-twi. Run `npm start` once, or see the steps at the top of scripts/twi-lab.mjs.");
    process.exit(1);
  }
  const services = [
    ["voice", ["edge/twi_tts.py", "serve", "--port", "5002", "--env", "none"], {}],
    ["words", ["edge/twi_nlp.py", "serve", "--port", "5003"], {}],
  ];
  const live = liveVoiceEnv();
  if (live) services.push(["live voice", ["edge/twi_tts.py", "worker", "--env", "none"], live]);
  else
    console.log(
      "[live voice] off: no device key (PG_DEVICE_ID / PG_DEVICE_API_KEY or edge/agent.env).",
    );
  // A local copy of DistilABENA (config.json, vocab.txt, model.safetensors) skips the
  // Hugging Face download, which can stall on slow connections.
  const localModel = path.join(root, ".venv-twi", "models", "distilabena-v2");
  const modelEnv = fs.existsSync(path.join(localModel, "model.safetensors"))
    ? { PG_NLP_MODEL: localModel }
    : {};

  return services.map(([name, args, extraEnv]) => {
    const child = spawn(venvPython, ["-X", "utf8", "-u", ...args], {
      cwd: root,
      env: {
        ...process.env,
        ...modelEnv,
        ...extraEnv,
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
}

/** Settings for the live-site voice worker, or null when there's no device key. */
function liveVoiceEnv() {
  const url = (process.env.PG_LIVE_URL ?? "https://ghana-poultry-vision.vercel.app").trim();
  if (!url || url === "off") return null;
  const file = {};
  const envFile = path.join(root, "edge", "agent.env");
  if (fs.existsSync(envFile))
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m) file[m[1]] = m[2].trim();
    }
  const id = (process.env.PG_DEVICE_ID ?? file.PG_DEVICE_ID ?? "").trim();
  const key = (process.env.PG_DEVICE_API_KEY ?? file.PG_DEVICE_API_KEY ?? "").trim();
  if (!id || !key) return null;
  return { PG_API_URL: url.replace(/\/$/, ""), PG_DEVICE_ID: id, PG_DEVICE_API_KEY: key };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const children = startTwiServices();
  const stop = () => {
    children.forEach((c) => c.kill());
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log("Starting the Twi voice (:5002) and word helper (:5003). Ctrl+C to stop.");
}
