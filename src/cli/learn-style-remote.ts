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
 */
import "dotenv/config";

const MEMORY_URL = (process.env.MEMORY_URL ?? "").replace(/\/+$/, "");
const MEMORY_API_KEY = process.env.MEMORY_API_KEY ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";
const STYLE_MODEL = process.env.STYLE_MODEL ?? "anthropic/claude-sonnet-4-6";

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

async function search(query: string, k = 5): Promise<string[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MEMORY_API_KEY) headers["X-Api-Key"] = MEMORY_API_KEY;
  const res = await fetch(`${MEMORY_URL}/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, k }),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return (data.hits ?? []).map((h: any) => `# from ${h.notePath ?? "unknown"}\n${h.text ?? ""}`);
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

  console.log("Querying memory brain for proposal samples...");
  const seen = new Set<string>();
  const samples: string[] = [];

  for (const facet of FACETS) {
    process.stdout.write(`  searching: ${facet}... `);
    const hits = await search(facet, 5);
    let added = 0;
    for (const h of hits) {
      if (!seen.has(h)) { seen.add(h); samples.push(h); added++; }
    }
    console.log(`${added} new chunks`);
  }

  console.log(`\nCollected ${samples.length} unique chunks. Calling ${STYLE_MODEL}...`);
  const sampleText = samples.join("\n\n---\n\n").slice(0, 24000);
  const content = `Here is a sample of TSP's past proposals (excerpts):\n\n${sampleText}`;

  const profile = await callClaude(content);
  const header = `---\ntype: profile\ntitle: TSP Proposals Style\ntags: [profile, proposals]\nsource: derived\n---\n\n`;
  const full = header + profile.trim() + "\n";

  console.log("\nStoring profile in memory brain...");
  await postIngest(full);

  console.log("\n═══════════════════════════════════════════\n");
  console.log(full);
  console.log("\n═══════════════════════════════════════════");
  console.log("\nProfile stored in memory brain as 10-Profiles/proposals-style.");
  console.log("Also save it manually to your Obsidian vault at:");
  console.log("  /Users/chrisyork/AI/York1963/10-Profiles/proposals-style.md");
}

main().catch(e => { console.error(e); process.exit(1); });
