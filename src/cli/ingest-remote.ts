/**
 * ingest-remote — read documents recursively from a local folder and POST them
 * to the remote memory brain (agent-memory-mesh on HQ). No local Ollama needed.
 *
 * Usage:
 *   npm run ingest-remote -- "D:\\OneDrive\\Proposals" [--source onedrive] [--type proposal] [--tags "sap proposal"]
 *
 * Required env vars (set in .env):
 *   MEMORY_URL      e.g. http://100.74.9.120:8377
 *   MEMORY_API_KEY  optional
 */
import "dotenv/config";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { extractDocText, isSupported } from "../sources/documents.js";

const MEMORY_URL = (process.env.MEMORY_URL ?? "").replace(/\/+$/, "");
const MEMORY_API_KEY = process.env.MEMORY_API_KEY ?? "";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await collectFiles(full));
    } else if (e.isFile() && isSupported(e.name) && !e.name.startsWith("~$") && !e.name.startsWith(".")) {
      results.push(full);
    }
  }
  return results;
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

  console.log(`Scanning ${dir} (recursive)...`);
  const files = await collectFiles(dir);
  console.log(`Found ${files.length} supported files`);
  console.log(`Memory brain: ${MEMORY_URL}\n`);

  let ingested = 0;
  let totalChunks = 0;
  let skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const rel = relative(dir, file);
    const name = rel.split("\\").join("/");
    const progress = `[${i + 1}/${files.length}]`;
    try {
      const text = await extractDocText(file);
      if (!text.trim()) {
        console.log(`${progress} skip  ${name} (empty)`);
        skipped++;
        continue;
      }
      const ext = name.lastIndexOf(".");
      const notePath = `${source}/${ext > 0 ? name.slice(0, ext) : name}`;
      const result = await postIngest(text, notePath, source, type, tags);
      console.log(`${progress} ok    ${name}  (${result.chunks} chunks)`);
      ingested++;
      totalChunks += result.chunks;
    } catch (err) {
      console.log(`${progress} error ${name}: ${(err as Error).message}`);
      skipped++;
    }
  }

  console.log(`\nDone. ${ingested} files ingested, ${totalChunks} chunks stored. ${skipped} skipped.`);
}

main().catch(e => { console.error(e); process.exit(1); });
