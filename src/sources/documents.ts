/**
 * Document text extraction
 * ------------------------
 * Pulls plain text out of the formats proposals actually live in, so they can be
 * chunked, embedded, and indexed alongside your notes. Pure-JS, ESM-friendly:
 *   - .docx via mammoth
 *   - .pdf  via unpdf (pdf.js under the hood)
 *   - .txt / .md read directly
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const SUPPORTED_EXTENSIONS = [".docx", ".pdf", ".txt", ".md"];

export function isSupported(path: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(extname(path).toLowerCase());
}

/** Extract plain text from a supported document. Throws on unsupported types. */
export async function extractDocText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".docx": {
      const result = await mammoth.extractRawText({ path });
      return (result.value ?? "").trim();
    }
    case ".pdf": {
      const buf = await readFile(path);
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return (Array.isArray(text) ? text.join("\n") : String(text ?? "")).trim();
    }
    case ".txt":
    case ".md":
      return (await readFile(path, "utf8")).trim();
    default:
      throw new Error(`Unsupported document type: ${ext}`);
  }
}
