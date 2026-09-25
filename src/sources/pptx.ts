/**
 * PowerPoint text extraction
 * --------------------------
 * A .pptx is a ZIP of XML parts. Slide text lives in <a:t> elements inside
 * ppt/slides/slideN.xml; speaker notes live in ppt/notesSlides/notesSlideN.xml.
 *
 * Parsed with a targeted regex rather than a full XML parser: the shapes we care
 * about are flat runs of text, and pulling in an XML stack to read <a:t> would
 * cost more than it returns. Anything malformed simply yields no text for that
 * slide rather than failing the document.
 *
 * Notes are included by default. For proposal decks the speaker notes often
 * carry the actual narrative -- the reasoning behind a slide that the slide
 * itself only gestures at -- which is exactly the material worth retrieving.
 */
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const NOTES_RE = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;

/** Decode the five XML predefined entities plus numeric character references. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" survives as "&lt;"
}

/**
 * Pull readable text out of one slide/notes XML part.
 * Runs (<a:t>) are joined within a paragraph; paragraphs (<a:p>) become lines.
 */
function textFromSlideXml(xml: string): string {
  const paragraphs: string[] = [];
  // Split on paragraph ends so we keep line structure; a deck with every run
  // concatenated into one line chunks badly and reads worse.
  for (const block of xml.split("</a:p>")) {
    const runs: string[] = [];
    const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) runs.push(decodeEntities(m[1]));
    const line = runs.join("").replace(/\s+/g, " ").trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join("\n");
}

function partNumber(name: string, re: RegExp): number {
  const m = name.match(re);
  return m ? parseInt(m[1], 10) : 0;
}

export interface PptxExtractOptions {
  /** Include speaker notes under each slide. Default true. */
  includeNotes?: boolean;
}

/**
 * Extract the text of a .pptx as plain text, slide by slide.
 * Returns "" for a deck with no readable text (image-only decks, say) so the
 * caller can skip it the same way it skips an empty .docx.
 */
export async function extractPptxText(
  path: string,
  opts: PptxExtractOptions = {}
): Promise<string> {
  const includeNotes = opts.includeNotes !== false;
  const buf = await readFile(path);
  const zip = await JSZip.loadAsync(buf);

  const names = Object.keys(zip.files);

  // Numeric sort: a plain string sort puts slide10 between slide1 and slide2,
  // which silently scrambles the deck's order.
  const slideNames = names
    .filter((n) => SLIDE_RE.test(n))
    .sort((a, b) => partNumber(a, SLIDE_RE) - partNumber(b, SLIDE_RE));

  const notesByNumber = new Map<number, string>();
  if (includeNotes) {
    for (const n of names.filter((x) => NOTES_RE.test(x))) {
      notesByNumber.set(partNumber(n, NOTES_RE), n);
    }
  }

  const out: string[] = [];
  for (const name of slideNames) {
    const num = partNumber(name, SLIDE_RE);
    const file = zip.file(name);
    if (!file) continue;

    const body = textFromSlideXml(await file.async("string"));
    const section: string[] = [`## Slide ${num}`];
    if (body) section.push(body);

    const notesName = notesByNumber.get(num);
    if (notesName) {
      const notesFile = zip.file(notesName);
      if (notesFile) {
        let notes = textFromSlideXml(await notesFile.async("string"));
        // PowerPoint stamps the slide number into the notes part; drop it so a
        // notes-free slide doesn't come back holding just "7".
        notes = notes
          .split("\n")
          .filter((l) => l.trim() !== String(num))
          .join("\n")
          .trim();
        if (notes) section.push(`Notes: ${notes}`);
      }
    }

    // Only keep slides that actually said something.
    if (section.length > 1) out.push(section.join("\n"));
  }

  return out.join("\n\n").trim();
}
