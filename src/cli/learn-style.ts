/**
 * learn-style — derive 10-Profiles/proposals-style.md from your indexed proposals.
 *   npm run learn-style
 * Uses a local Ollama model by default; set STYLE_PROVIDER=openrouter + STYLE_MODEL
 * + OPENROUTER_API_KEY to use a cloud model instead.
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "../config.js";
import { Embedder } from "../memory/embeddings.js";
import { MemoryStore } from "../memory/store.js";
import { learnProposalStyle, type StyleModelConfig } from "../style/learn.js";

async function main() {
  const cfg = loadConfig();
  const embedder = new Embedder({ ollamaUrl: cfg.ollamaUrl, model: cfg.embedModel });
  const store = new MemoryStore(cfg.dbPath);

  const provider = (process.env.STYLE_PROVIDER ?? "ollama") as "ollama" | "openrouter";
  const model: StyleModelConfig = {
    provider,
    model: process.env.STYLE_MODEL ?? (provider === "ollama" ? "llama3.1" : "anthropic/claude-sonnet-4-6"),
    ollamaUrl: cfg.ollamaUrl,
    openrouterKey: process.env.OPENROUTER_API_KEY,
  };

  console.log(`Learning proposal style via ${provider}:${model.model} ...`);
  const md = await learnProposalStyle(store, embedder, model);
  const out = join(cfg.vaultPath, "10-Profiles", "proposals-style.md");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, md, "utf8");
  console.log(`Wrote ${out}`);
  console.log("Review it, then re-index your vault so it's retrievable.");
}
main().catch((e) => { console.error(e); process.exit(1); });
