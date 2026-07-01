/**
 * ingest-remote — read documents from a local folder and POST them to the remote
 * memory brain (agent-memory-mesh running on HQ). No local Ollama needed.
 *
 * Usage:
 *   npm run ingest-remote -- "D:\OneDrive\Proposals" [--source onedrive] [--type proposal] [--tags "sap proposal"]
 *
 * Required env vars (set in .env):
 *   MEMORY_URL      e.g. http://100.74.9.120:8377
 *   MEMORY_API_KEY  optional — only needed if HQ memory service has a key set
 */
import "dotenv/config";
import { readdir } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { extractDocText, isSupported } from "../sources/documents.js";

const MEMORY_URL = (process.env.MEMORY_URL ?? "").replace(/\/$/, "");
const MEMORY_API_KEY = process.env.MEMORY_API_KEY ?? "";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function postIngest(content: string, notePath: string, source: string, type: string, tags: string): Promise<{ ok: boolean; chunks: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MEMORY_API_KEY) headers["X-Api-Key"] = MEMORY_API_KEY;
  const res = await fetch(`${MEMORY_URL}/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content, notePath, source, type, tags }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ ok: boolean; chunks: number }>;
}

async function main() {
  if (!MEMORY_URL) {
    console.error("Error: MEMORY_URL is not set in .env");
    process.exit(1);
  }

  const dir = process.argv[2];
  if (!dir || dir.startsWith("--")) {
    console.error(`Usage: npm run ingest-remote -- "<folder-path>" [--source onedrive] [--type proposal] [--tags "..."]`);
    process.exit(1);
  }

  const source = flag("source") ?? "remote";
  const type   = flag("type")   ?? "document";
  const tags   = flag("tags")   ?? "";

  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile() && isSupported(e.name) && !e.name.startsWith("~$") && !e.name.startsWith("."))
    .map(e => join(dir, e.name));

  console.log(`Found ${files.length} supported files in ${dir}`);
  console.log(`Memory brain: ${MEMORY_URL}\n`);

  let totalChunks = 0;
  let skipped = 0;

  for (const file of files) {
    const name = basename(file);
    try {
      const text = await extractDocText(file);
      if (!text.trim()) { console.log(`  skip  ${name} (empty)`); skipped++; continue; }
      const notePath = `${source}/${name.replace(/\.[^.]+$/, "")}`;
      const result = await postIngest(text, notePath, source, type, tags);
      console.log(`  ok    ${name}  (${result.chunks} chunks)`);
      totalChunks += result.chunks;
    } catch (err) {
      console.log(`  error ${name}: ${(err as Error).message}`);
      skipped++;
    }
  }

  console.log(`\nDone. ${files.length - skipped} files ingested, ${totalChunks} chunks stored.`);
  if (skipped) console.log(`Skipped: ${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });

