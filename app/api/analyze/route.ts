import { analyze } from "@/lib/analyze";
import { authorized } from "@/lib/auth";
import { loadUpload, referenceText } from "@/lib/load";
import { fromText, words } from "@/lib/text";

export const runtime = "nodejs";
// Web search plus page downloads can take a minute or two.
export const maxDuration = 300;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_WORDS = 15000;

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Wrong or missing password." }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected a form upload." }, { status: 400 });
  }
  try {
    const file = form.get("file");
    const text = form.get("text");
    let doc;
    if (file instanceof File && file.size) {
      if (file.size > MAX_FILE_BYTES) return Response.json({ error: "File is larger than 10 MB." }, { status: 413 });
      doc = await loadUpload(file);
    } else if (typeof text === "string" && text.trim()) doc = fromText(text);
    else return Response.json({ error: "Upload a paper or paste its text." }, { status: 400 });

    const wordCount = doc.paragraphs.reduce((a, p) => a + words(p).length, 0);
    if (wordCount > MAX_WORDS) return Response.json({ error: `Paper is ${wordCount} words; the limit is ${MAX_WORDS}.` }, { status: 413 });

    const references = [];
    for (const r of form.getAll("refs")) {
      if (r instanceof File && r.size && r.size <= MAX_FILE_BYTES) references.push({ id: r.name, text: await referenceText(r) });
    }
    const report = await analyze(doc, {
      useLlm: form.get("useLlm") !== "false",
      useWebSearch: form.get("useWebSearch") !== "false",
      references,
    });
    return Response.json(report);
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "Analysis failed." }, { status: 500 });
  }
}
