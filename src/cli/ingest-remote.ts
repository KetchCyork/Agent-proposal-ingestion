/**
 * ingest-remote — read documents recursively from a local folder and POST them
 * to the remote memory brain (agent-memory-mesh on HQ). No local Ollama needed.
 *
 * Usage:
 *   npm run ingest-remote -- "D:\\OneDrive\\Proposals" [--source onedrive] [--type proposal] [--tags "sap proposal"]
 *   npm run ingest-remote -- "D:\\OneDrive\\Proposals" --changed-only
 *
 * A full pass re-embeds every document and takes the better part of an hour on
 * a corpus this size. --changed-only consults a manifest and sends just what is
 * new or modified, which is cheap enough to run daily (or at every logon) so the
 * brain actually stays current between full passes.
 *
 * Required env vars (set in .env):
 *   MEMORY_URL      e.g. http://100.74.9.120:8377
 *   MEMORY_API_KEY  optional
 *   INGEST_MANIFEST optional; default <home>/.cowork-memory/ingest-manifest.json
 */
import "dotenv/config";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { extractDocText, isSupported } from "../sources/documents.js";
import {
  classify,
  findDeleted,
  loadManifest,
  manifestKey,
  saveManifest,
  type Manifest,
} from "../sources/manifest.js";

const MEMORY_URL = (process.env.MEMORY_URL ?? "").replace(/\/+$/, "");
const MEMORY_API_KEY = process.env.MEMORY_API_KEY ?? "";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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

function defaultManifestPath(): string {
  return join(homedir(), ".cowork-memory", "ingest-manifest.json");
}

async function main() {
  if (!MEMORY_URL) {
    console.error("Error: MEMORY_URL is not set in .env");
    process.exit(1);
  }

  const dir = process.argv[2];
  if (!dir || dir.startsWith("--")) {
    console.error(`Usage: npm run ingest-remote -- "<folder-path>" [--changed-only] [--source onedrive] [--type proposal] [--tags "..."]`);
    process.exit(1);
  }

  const source = flag("source") ?? "remote";
  const type   = flag("type")   ?? "document";
  const tags   = flag("tags")   ?? "";
  const changedOnly = hasFlag("changed-only");
  const manifestPath = flag("manifest") ?? process.env.INGEST_MANIFEST ?? defaultManifestPath();
  const root = resolve(dir);

  console.log(`Scanning ${dir} (recursive)...`);
  const files = await collectFiles(dir);
  console.log(`Found ${files.length} supported files`);
  console.log(`Memory brain: ${MEMORY_URL}`);

  // The manifest is loaded even for a full pass, so a full run leaves it
  // accurate and the next --changed-only run has a correct baseline.
  const loaded = await loadManifest(manifestPath, root);
  const manifest: Manifest = loaded.manifest;
  if (changedOnly) {
    console.log(`Mode: changed-only (manifest: ${manifestPath})`);
    if (loaded.reason) console.log(`  ${loaded.reason} -- this run will behave like a full pass`);
  } else {
    console.log(`Mode: full pass (manifest will be refreshed at ${manifestPath})`);
  }
  console.log();

  let ingested = 0;
  let totalChunks = 0;
  let skipped = 0;
  let unchanged = 0;
  const seenKeys = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const rel = relative(dir, file);
    const name = rel.split("\\").join("/");
    const key = manifestKey(rel);
    seenKeys.add(key);
    const progress = `[${i + 1}/${files.length}]`;

    try {
      const state = await classify(manifest, key, file);

      if (changedOnly && state.kind === "unchanged") {
        unchanged++;
        continue;
      }

      const text = await extractDocText(file);
      if (!text.trim()) {
        console.log(`${progress} skip  ${name} (empty)`);
        // Record it, or every run re-extracts the same empty files forever.
        manifest.entries[key] = {
          mtimeMs: state.mtimeMs,
          size: state.size,
          ingestedAt: new Date().toISOString(),
          empty: true,
        };
        skipped++;
        continue;
      }

      const ext = name.lastIndexOf(".");
      const notePath = `${source}/${ext > 0 ? name.slice(0, ext) : name}`;
      const result = await postIngest(text, notePath, source, type, tags);
      const label = state.kind === "modified" ? "upd  " : "ok   ";
      console.log(`${progress} ${label} ${name}  (${result.chunks} chunks)`);

      manifest.entries[key] = {
        mtimeMs: state.mtimeMs,
        size: state.size,
        ingestedAt: new Date().toISOString(),
        chunks: result.chunks,
      };
      ingested++;
      totalChunks += result.chunks;

      // Checkpoint periodically: an interrupted run (laptop closed, network
      // dropped) then resumes where it left off instead of starting over.
      if (ingested % 25 === 0) await saveManifest(manifestPath, manifest);
    } catch (err) {
      // Leave the manifest entry alone on failure so the file is retried next run.
      console.log(`${progress} error ${name}: ${(err as Error).message}`);
      skipped++;
    }
  }

  const deleted = findDeleted(manifest, seenKeys);
  if (deleted.length) {
    console.log(`\n${deleted.length} previously-ingested file(s) no longer on disk:`);
    for (const d of deleted.slice(0, 20)) console.log(`  gone  ${d}`);
    if (deleted.length > 20) console.log(`  ... and ${deleted.length - 20} more`);
    console.log(`  Note: the brain has no delete endpoint, so their chunks remain searchable`);
    console.log(`  until the index is rebuilt.`);
    for (const d of deleted) delete manifest.entries[d];
  }

  await saveManifest(manifestPath, manifest);

  // Keep this line's shape stable: refresh-proposal-memory.ps1 parses it to
  // decide whether the run succeeded, rather than trusting the exit code.
  console.log(`\nDone. ${ingested} files ingested, ${totalChunks} chunks stored. ${skipped} skipped.`);
  if (changedOnly) console.log(`${unchanged} unchanged files skipped via manifest.`);
}

main().catch(e => { console.error(e); process.exit(1); });
