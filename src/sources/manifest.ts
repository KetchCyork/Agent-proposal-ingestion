/**
 * Ingest manifest
 * ---------------
 * Remembers what has already been sent to the memory brain, so a run can skip
 * documents that have not changed. A full pass over the proposal corpus takes
 * the better part of an hour -- almost all of it re-embedding text the brain
 * already holds -- which is too slow to run often enough to stay current.
 *
 * Identity is the path RELATIVE to the scanned root, because that is exactly
 * what ingest-remote derives notePath from. Re-ingesting a file under the same
 * relative path replaces its chunks (the brain deletes by notePath before
 * writing), so the manifest key and the brain's key agree by construction.
 *
 * That also means the manifest is only valid for the root it was built against.
 * Scan a different folder and the relative paths mean something else, so the
 * root is recorded and a mismatch invalidates the whole manifest rather than
 * silently skipping files that were never actually ingested.
 *
 * Change detection is mtime + size. Not a hash: hashing every file means
 * reading all of them, which is most of the cost we are trying to avoid. The
 * failure mode -- an edit that preserves both mtime and size -- is not
 * something Word or PowerPoint produce in practice, and the weekly full pass
 * is the backstop for it.
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export const MANIFEST_VERSION = 1;

export interface ManifestEntry {
  /** Modification time in ms, as reported when the file was last ingested. */
  mtimeMs: number;
  /** Size in bytes at that time. */
  size: number;
  /** When we ingested it. */
  ingestedAt: string;
  /** Chunks the brain reported storing. Absent for files that yielded no text. */
  chunks?: number;
  /** True when the document produced no text (image-only deck, empty file). */
  empty?: boolean;
}

export interface Manifest {
  version: number;
  /** Absolute, normalised scan root this manifest describes. */
  root: string;
  /** Last time a run completed against this manifest. */
  updatedAt: string;
  /** Keyed by path relative to `root`, always with forward slashes. */
  entries: Record<string, ManifestEntry>;
}

/** Normalise a root path so Windows drive-letter and separator noise can't cause false mismatches. */
export function normaliseRoot(root: string): string {
  return resolve(root).split(sep).join("/").replace(/\/+$/, "").toLowerCase();
}

/** Relative path in the canonical form used as a manifest key. */
export function manifestKey(relativePath: string): string {
  return relativePath.split("\\").join("/");
}

export function emptyManifest(root: string): Manifest {
  return {
    version: MANIFEST_VERSION,
    root: normaliseRoot(root),
    updatedAt: new Date().toISOString(),
    entries: {},
  };
}

/**
 * Load the manifest for `root`. Returns a fresh empty manifest -- rather than
 * throwing -- when the file is missing, unreadable, from a future version, or
 * was built against a different root. Each of those means "we cannot trust it",
 * and the safe response is a full pass, not a crash or a silent skip.
 */
export async function loadManifest(
  path: string,
  root: string
): Promise<{ manifest: Manifest; reason?: string }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { manifest: emptyManifest(root), reason: "no manifest yet" };
  }

  let parsed: Manifest;
  try {
    parsed = JSON.parse(raw) as Manifest;
  } catch {
    return { manifest: emptyManifest(root), reason: "manifest unreadable" };
  }

  if (parsed.version !== MANIFEST_VERSION) {
    return { manifest: emptyManifest(root), reason: `manifest version ${parsed.version} != ${MANIFEST_VERSION}` };
  }
  if (normaliseRoot(root) !== parsed.root) {
    return {
      manifest: emptyManifest(root),
      reason: `manifest was built for a different folder (${parsed.root})`,
    };
  }
  if (!parsed.entries || typeof parsed.entries !== "object") {
    return { manifest: emptyManifest(root), reason: "manifest has no entries" };
  }
  return { manifest: parsed };
}

export async function saveManifest(path: string, manifest: Manifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true });
  // Write-then-rename would be tidier, but a torn manifest is already handled:
  // it fails to parse and the next run does a full pass.
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
}

export type ChangeKind = "new" | "modified" | "unchanged";

/** Has this file changed since we last ingested it? */
export async function classify(
  manifest: Manifest,
  key: string,
  absolutePath: string
): Promise<{ kind: ChangeKind; mtimeMs: number; size: number }> {
  const s = await stat(absolutePath);
  const prev = manifest.entries[key];
  if (!prev) return { kind: "new", mtimeMs: s.mtimeMs, size: s.size };
  // Round to the second: some filesystems and sync clients round mtime, and a
  // sub-millisecond difference would mark every file modified on every run.
  const sameTime = Math.floor(prev.mtimeMs / 1000) === Math.floor(s.mtimeMs / 1000);
  const sameSize = prev.size === s.size;
  return {
    kind: sameTime && sameSize ? "unchanged" : "modified",
    mtimeMs: s.mtimeMs,
    size: s.size,
  };
}

/**
 * Manifest keys that no longer exist on disk.
 *
 * The brain has no delete endpoint, so these cannot be removed remotely -- their
 * chunks stay searchable until someone rebuilds the index. Surfacing them is
 * still worth it: a retired proposal quietly remaining retrievable is exactly
 * the kind of thing that turns up in a draft months later.
 */
export function findDeleted(manifest: Manifest, seenKeys: Set<string>): string[] {
  return Object.keys(manifest.entries).filter((k) => !seenKeys.has(k)).sort();
}
