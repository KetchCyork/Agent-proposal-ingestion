/**
 * learn-style-remote — derive a TSP proposal style profile by querying the remote
 * memory brain (HQ) and analyzing the results with Claude via OpenRouter.
 *
 * Usage:
 *   npm run learn-style-remote
 *
 * Required env vars:
 *   MEMORY_URL          e.g. http://100.74.9.120:8377
 *   OPENROUTER_API_KEY  your OpenRouter key
 *
 * Optional:
 *   MEMORY_API_KEY      if memory brain requires auth
 *   STYLE_MODEL         OpenRouter model id (default: anthropic/claude-sonnet-4-6)
 *   STYLE_SAMPLE_K      hits per facet (default 12)
 *   STYLE_POLICY        retrieval policy (default proposal-drafting; "" for none)
 *   STYLE_SAMPLE_CHARS  character budget for the model (default 120000)
 */
import "dotenv/config";

const MEMORY_URL = (process.env.MEMORY_URL ?? "").replace(/\/+$/, "");
const MEMORY_API_KEY = process.env.MEMORY_API_KEY ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";
const STYLE_MODEL = process.env.STYLE_MODEL ?? "anthropic/claude-sonnet-4-6";

/**
 * Hits per facet. Was 5, which took at most 35 chunks from a 3,000-document
 * corpus -- a thin basis for a profile that every proposal is then written
 * against.
 */
const SAMPLE_K = Number(process.env.STYLE_SAMPLE_K ?? 12);

/**
 * Retrieval policy. `proposal-drafting` filters to type = 'proposal', boosts
 * recent documents, and is the same policy the Cowork snapshot uses -- so the
 * profile is derived from the same material a draft will retrieve. Set
 * STYLE_POLICY="" to fall back to plain unfiltered search.
 */
const STYLE_POLICY = process.env.STYLE_POLICY ?? "proposal-drafting";

/**
 * Character budget for the sample sent to the model. Sized to fit what
 * SAMPLE_K=12 across seven facets actually collects (~94k chars measured
 * against the live corpus), so the default does not silently throw away a
 * third of the sample it just gathered. Roughly 30k tokens -- cents per run.
 */
const SAMPLE_CHARS = Number(process.env.STYLE_SAMPLE_CHARS ?? 120000);

const FACETS = [
  "executive summary introduction",
  "scope of work deliverables",
  "approach and methodology",
  "pricing commercial terms fees",
  "about the firm qualifications experience",
  "timeline milestones project plan",
  "assumptions exclusions terms",
];

const STYLE_PROMPT = `You are analyzing a sample of past SAP consulting proposals from The Silicon Partners (TSP).
Produce a concise STYLE PROFILE that a writer could follow to draft a new proposal in the same voice and structure. Cover:
- Standard sections in their usual order
- Tone and language patterns (formality, person, sentence style)
- Recurring boilerplate and stock phrasing (quote short examples)
- Formatting conventions
- How TSP typically positions its SAP expertise and differentiators

Do NOT invent facts, clients, numbers, or quotes that aren't in the sample.
Output Markdown only.`;

async function search(query: string, k = SAMPLE_K): Promise<string[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MEMORY_API_KEY) headers["X-Api-Key"] = MEMORY_API_KEY;
  // A policy search returns the same { hits: [{ score, chunk }] } shape, plus
  // `wikis` and `policy` keys we don't need here.
  const body: Record<string, unknown> = { query, k };
  if (STYLE_POLICY) body.policy = STYLE_POLICY;
  const res = await fetch(`${MEMORY_URL}/search`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return (data.hits ?? [])
    .filter((h: any) => (h.chunk?.text ?? "").trim())
    .map((h: any) => `# from ${h.chunk?.notePath ?? "unknown"}\n${h.chunk?.text ?? ""}`);
}

async function callClaude(content: string): Promise<string> {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY is not set in .env");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: STYLE_MODEL,
      messages: [
        { role: "system", content: STYLE_PROMPT },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const d: any = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function postIngest(content: string): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MEMORY_API_KEY) headers["X-Api-Key"] = MEMORY_API_KEY;
  await fetch(`${MEMORY_URL}/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content,
      notePath: "10-Profiles/proposals-style",
      source: "derived",
      type: "profile",
      tags: "profile proposals style",
    }),
  });
}

async function main() {
  if (!MEMORY_URL) { console.error("MEMORY_URL not set in .env"); process.exit(1); }
  if (!OPENROUTER_KEY) { console.error("OPENROUTER_API_KEY not set in .env"); process.exit(1); }

  console.log(`Querying memory brain for proposal samples...`);
  console.log(`  k=${SAMPLE_K} per facet, policy=${STYLE_POLICY || "(none)"}\n`);
  const seen = new Set<string>();
  const samples: string[] = [];

  for (const facet of FACETS) {
    process.stdout.write(`  ${facet}... `);
    const hits = await search(facet);
    let added = 0;
    for (const h of hits) {
      if (!seen.has(h)) { seen.add(h); samples.push(h); added++; }
    }
    console.log(`${hits.length} hits, ${added} new`);
    if (hits.length === 0) {
      console.log(`    (no hits -- if this persists, the policy filter may be excluding everything)`);
    }
  }

  if (!samples.length) {
    console.error("\nNo samples retrieved. Nothing to derive a profile from -- aborting rather than");
    console.error("overwriting the existing profile with something built from nothing.");
    process.exit(1);
  }

  const joined = samples.join("\n\n---\n\n");
  const sampleText = joined.slice(0, SAMPLE_CHARS);
  console.log(`\nCollected ${samples.length} unique chunks (${joined.length} chars).`);
  if (joined.length > SAMPLE_CHARS) {
    // Say so: a silent truncation looks identical to a smaller corpus.
    console.log(`Truncated to ${SAMPLE_CHARS} chars for the model (raise STYLE_SAMPLE_CHARS to send more).`);
  }
  console.log(`Calling ${STYLE_MODEL}...`);
  const content = `Here is a sample of TSP's past proposals (excerpts):\n\n${sampleText}`;

  const profile = await callClaude(content);
  if (!profile.trim()) {
    console.error("\nThe model returned an empty profile -- aborting rather than storing it.");
    process.exit(1);
  }
  const header = `---\ntype: profile\ntitle: TSP Proposals Style\ntags: [profile, proposals]\nsource: derived\n---\n\n`;
  const full = header + profile.trim() + "\n";

  console.log("\nStoring profile in memory brain...");
  await postIngest(full);

  console.log("\n═══════════════════════════════════════════\n");
  console.log(full);
  console.log("\n═══════════════════════════════════════════");
  console.log("\nProfile stored in memory brain as 10-Profiles/proposals-style.");
  console.log("The brain writes the vault note itself (engine.ingestText -> writeVaultNote),");
  console.log("so there is nothing to copy by hand.");
}

main().catch(e => { console.error(e); process.exit(1); });
