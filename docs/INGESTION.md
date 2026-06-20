# Ingesting proposals (and other documents)

Goal: make your past proposals part of the brain so an agent can (a) retrieve your
real templates and sections when drafting, and (b) learn your house style.

## The OneDrive path (no API needed)

OneDrive's desktop client already syncs your proposal folder to a local path on the
work machine. So the simplest, most robust approach is to point the ingester at that
**local synced folder** — no Graph calls, no re-downloading. Run it **on the work
node**, so client content is read and embedded locally and never copied to your
personal Mac. Embeddings are computed locally via Ollama.

## 1. Ingest the folder

```bash
npm run ingest -- "C:\\Users\\you\\OneDrive - TSP\\Proposals" --type proposal --source onedrive --tags "sap proposal"
```

- Supported formats: `.docx`, `.pdf`, `.txt`, `.md` (extensible in `src/sources/documents.ts`).
- Re-running is safe: each file's chunks are replaced, not duplicated.
- Office lock files (`~$...`) and dotfiles are skipped automatically.

## 2. Learn your style

```bash
npm run learn-style
```

This samples your indexed proposals across common sections (executive summary, scope,
pricing, approach, ...) and asks a model to distill the recurring structure, tone, and
boilerplate into `10-Profiles/proposals-style.md`. It uses a **local Ollama model by
default** (private); set `STYLE_PROVIDER=openrouter`, `STYLE_MODEL`, and
`OPENROUTER_API_KEY` to use a cloud model instead. Review the profile — it never
invents facts, but you should sanity-check it.

## 3. Re-index so the profile is retrievable

```bash
npm run index
```

## Drafting with it

Once proposals are ingested and the style profile exists, drafting a new proposal
becomes: the agent pulls your closest existing templates/sections from the brain plus
the always-on `proposals-style.md`, and writes in your voice against the new brief.

## Keeping it fresh

Schedule ingestion as a Paperclip routine on the work node (via the runner's `shell`
executor) so new proposals are picked up automatically, e.g. nightly:
`npm run ingest -- "<proposals path>" --type proposal --source onedrive`.

## Data boundary

Ingest where the files live. The work index stays on the work node; only retrieved
snippets — not raw files — ever travel, and only to agents you point at it.
