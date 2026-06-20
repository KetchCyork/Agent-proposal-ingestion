/**
 * ingest — index a folder of documents (e.g. OneDrive-synced proposals) into the brain.
 *   npm run ingest -- "/path/to/Proposals" --type proposal --source onedrive --tags "sap proposal"
 * Run on the machine where the files live so content stays local.
 */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { Embedder } from "../memory/embeddings.js";
import { MemoryStore } from "../memory/store.js";
import { ingestDirectory } from "../sources/ingest.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dir = process.argv[2];
  if (!dir || dir.startsWith("--")) throw new Error('Usage: ingest -- "<dir>" [--type proposal] [--source onedrive] [--tags "..."]');
  const cfg = loadConfig();
  const embedder = new Embedder({ ollamaUrl: cfg.ollamaUrl, model: cfg.embedModel });
  const store = new MemoryStore(cfg.dbPath);
  console.log(`Ingesting ${dir}\nIndex: ${cfg.dbPath}`);
  const res = await ingestDirectory(
    dir, store, embedder,
    { type: flag("type"), source: flag("source"), tags: flag("tags") },
    (m) => console.log("  " + m)
  );
  console.log(`\nDone: ${res.files} files, ${res.chunks} chunks.`);
  if (res.skipped.length) {
    console.log(`Skipped ${res.skipped.length}:`);
    for (const s of res.skipped) console.log(`  - ${s.file}: ${s.reason}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
