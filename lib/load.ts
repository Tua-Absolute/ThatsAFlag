import { loadDocx } from "./docx";
import { fromText, type PaperDocument } from "./text";

export async function loadUpload(file: File): Promise<PaperDocument> {
  const name = file.name || "upload";
  if (/\.docx$/i.test(name)) return loadDocx(new Uint8Array(await file.arrayBuffer()), name);
  if (/\.(txt|md)$/i.test(name) || file.type.startsWith("text/")) return fromText(await file.text(), name);
  throw new Error(`Unsupported file type: ${name} (use .docx, .txt or .md)`);
}

/** Plain text of a reference file, for the plagiarism comparison. */
export async function referenceText(file: File): Promise<string> {
  const doc = await loadUpload(file);
  return doc.text;
}
