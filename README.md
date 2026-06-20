# Agent Memory Mesh

This repository provides the shared memory brain and remote ingestion support for the cross-machine Agent OS ecosystem.

It is designed to make memory available across machines using a local-first hybrid architecture, with Obsidian for durable notes, LanceDB for hybrid retrieval, and Ollama for local embeddings.

## What this repo does

- Loads content from an Obsidian vault.
- Indexes documents, proposals, and connector-derived source content.
- Builds local embeddings and stores them in LanceDB.
- Serves memory via HTTP and MCP so any agent can query the shared brain.
- Supports remote memory ingestion from other machines over a secure mesh.
- Includes Tailscale integration for secure cross-machine connectivity.

## Capabilities

- Vault indexing and hybrid search.
- Remote source ingestion support.
- Memory search API for agents and dashboards.
- HTTP and MCP access for agent integration.
- Provenance metadata for auditability.

## Installation

```bash
cd "Mesh runner proposal ingestion"
cp .env.example .env
npm install
```

Configure `.env` with your Obsidian vault path and optional `MEMORY_HOST` / `MEMORY_API_KEY` values.

```bash
npm run index
npm run serve
```

To run the MCP server locally:

```bash
npm run serve:mcp
```

## Documentation

- `docs/TAILSCALE.md` — secure mesh setup and ACLs.
- `docs/INTEGRATION.md` — how agents connect via HTTP and MCP.
- `INGESTION.md` — document ingestion patterns and remote source workflows.

## Usage

Use this service as the shared brain for Agent OS and remote nodes. Remote machines can ingest OneDrive/M365 and other source metadata into the brain without copying raw files to the host.

## Notes

This repo is part of the broader cross-machine solution:
- `Agent OS` hosts the dashboard and agent runtime.
- `Agent Memory` is the shared memory brain.
- `paperclip-mesh-runner` handles remote capability nodes.
