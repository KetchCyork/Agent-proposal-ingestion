/**
 * Style learning
 * --------------
 * Reads a representative sample of your indexed proposals from the brain and asks
 * a model to distill recurring structure, tone, and boilerplate into a
 * `10-Profiles/proposals-style.md` profile. That profile is then always-on
 * context when drafting new proposals.
 *
 * This is the one place the memory repo talks to a chat model, and it's optional:
 * it uses a local Ollama model by default (private), or an OpenRouter model if
 * configured. Plain fetch, no SDK.
 */
import { Embedder } from "../memory/embeddings.js";
import { MemoryStore } from "../memory/store.js";

export interface StyleModelConfig {
  /** "ollama" (local) or "openrouter". */
  provider: "ollama" | "openrouter";
  model: string;
  ollamaUrl: string;
  openrouterKey?: string;
}

// Representative facets of a proposal; each seeds a retrieval against the brain.
const FACETS = [
  "executive summary", "scope of work", "approach and methodology",
  "pricing and commercial terms", "about the firm / qualifications",
  "timeline and milestones", "assumptions and exclusions",
];

/** Gather a de-duplicated sample of proposal chunks across common sections. */
export async function sampleProposals(
  store: MemoryStore, embedder: Embedder, perFacet = 4
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  await store.open((await embedder.embed("dimension probe")).length);
  for (const facet of FACETS) {
    const qvec = await embedder.embed(facet);
    const hits = await store.retrieve(facet, qvec, perFacet, "type = 'proposal'");
    for (const h of hits) {
      if (seen.has(h.chunk.id)) continue;
      seen.add(h.chunk.id);
      out.push(`# from ${h.chunk.notePath}\n${h.chunk.text}`);
    }
  }
  return out;
}

const PROMPT = `You are analyzing a sample of an organization's past proposals.
Produce a concise STYLE PROFILE that a writer could follow to draft a new proposal
in the same voice and structure. Cover:
- Standard sections, in their usual order
- Tone and language patterns (formality, person, sentence style)
- Recurring boilerplate / stock phrasing (quote short examples)
- Formatting conventions
Do NOT invent facts, clients, numbers, or quotes that aren't in the sample.
Output Markdown only.`;

async function callModel(cfg: StyleModelConfig, content: string): Promise<string> {
  if (cfg.provider === "ollama") {
    const res = await fetch(`${cfg.ollamaUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model, stream: false,
        messages: [{ role: "system", content: PROMPT }, { role: "user", content }],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const d: any = await res.json();
    return d.message?.content ?? "";
  }
  if (!cfg.openrouterKey) throw new Error("OPENROUTER_API_KEY required for provider=openrouter.");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.openrouterKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: PROMPT }, { role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const d: any = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

/** Build the style profile markdown from indexed proposals. */
export async function learnProposalStyle(
  store: MemoryStore, embedder: Embedder, model: StyleModelConfig
): Promise<string> {
  const samples = await sampleProposals(store, embedder);
  if (!samples.length) {
    throw new Error("No indexed proposals found (type='proposal'). Run `npm run ingest` first.");
  }
  const content =
    `Here is a sample of past proposals (excerpts):\n\n${samples.join("\n\n---\n\n").slice(0, 24000)}`;
  const profile = await callModel(model, content);
  const header =
    `---\ntype: profile\ntitle: Proposals Style\ntags: [profile, proposals]\nsource: derived\n---\n\n`;
  return header + profile.trim() + "\n";
}
