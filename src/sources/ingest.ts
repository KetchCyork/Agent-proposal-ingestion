/**
 * Directory ingestion
 * -------------------
 * Index an arbitrary folder of documents (e.g. your OneDrive-synced proposals)
 * into the memory brain, tagged so it's retrievable as that kind of source.
 *
 * Run this ON the machine where the files live (the work node), so client/work
 * content is read and embedded locally and never copied to the personal Mac.
 * Embeddings are computed locally via Ollama.
 */
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { Embedder } from "../memory/embeddings.js";
import { MemoryStore, type Chunk } from "../memory/store.js";
import { chunkText } from "../memory/vault.js";
import { extractDocText, isSupported } from "./documents.js";

export interface IngestOptions {
  /** Frontmatter-style type, e.g. "proposal". */
  type?: string;
  /** Provenance, e.g. "onedrive". Also namespaces stored ids to avoid collisions. */
  source?: string;
  /** Space-joined tags. */
  tags?: string;
}

export interface IngestResult {
  files: number;
  chunks: number;
  skipped: { file: string; reason: string }[];
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try { entries = await readdir(dir); } catch { return out; }
  for (const name of entries) {
    if (name.startsWith(".") || name.startsWith("~$")) continue; // skip dotfiles + Office lock files
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) out.push(...(await walk(full)));
    else if (isSupported(full)) out.push(full);
  }
  return out;
}

export async function ingestDirectory(
  dir: string,
  store: MemoryStore,
  embedder: Embedder,
  opts: IngestOptions = {},
  onProgress?: (msg: string) => void
): Promise<IngestResult> {
  const source = opts.source ?? "import";
  const type = opts.type ?? "document";
  const tags = opts.tags ?? "";
  const skipped: { file: string; reason: string }[] = [];

  const files = await walk(dir);

  // Open the store, sizing the table from a probe embedding on first run.
  const probe = await embedder.embed("dimension probe");
  await store.open(probe.length);

  let totalChunks = 0;
  for (const file of files) {
    let text: string;
    try {
      text = await extractDocText(file);
    } catch (err) {
      skipped.push({ file, reason: String(err) });
      continue;
    }
    const chunks = chunkText(text);
    if (!chunks.length) { skipped.push({ file, reason: "no extractable text" }); continue; }

    const vectors = await embedder.embedMany(chunks.map((c) => c.text));
    // Namespace the path by source so different sources can't collide on dedup.
    const notePath = `${source}/${relative(dir, file)}`;
    const st = await stat(file);
    const rows: Chunk[] = chunks.map((c, i) => ({
      id: `${notePath}#${c.index}`,
      text: c.text,
      vector: vectors[i],
      notePath,
      type,
      tags,
      source,
      updated: st.mtime.toISOString(),
    }));
    await store.putNoteChunks(notePath, rows);
    totalChunks += rows.length;
    onProgress?.(`indexed ${notePath} (${rows.length} chunks)`);
  }

  return { files: files.length, chunks: totalChunks, skipped };
}
