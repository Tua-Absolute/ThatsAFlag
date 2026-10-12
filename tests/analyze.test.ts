import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, pickSearchSentences } from "@/lib/analyze";
import { loadDocx } from "@/lib/docx";
import { fromText } from "@/lib/text";
import { AI, COPY_PASTE, PLAGIARISM, isFlagged, type Finding } from "@/lib/types";
import { htmlToText, isPublicUrl } from "@/lib/web";

const fx = (f: string) => path.join(import.meta.dirname, "fixtures", f);
const reference = readFileSync(fx("dust_bowl_encyclopedia.txt"), "utf8");
const offline = { client: null };
const flaggedText = (text: string, fs: Finding[], cat: string) => fs.filter((f) => f.category === cat && isFlagged(f)).map((f) => text.slice(f.start, f.end));

describe("offline checks on the mixed sample paper", async () => {
  const doc = await loadDocx(readFileSync(fx("mixed_paper.docx")), "mixed_paper.docx");
  const report = await analyze(doc, { useLlm: false, useWebSearch: false, references: [{ id: "encyclopedia", text: reference }] }, offline);

  it("reads the docx text and heading", () => {
    expect(doc.paragraphs[0].style.toLowerCase()).toBe("heading 1");
    expect(doc.text).toContain("Black Sunday");
  });
  it("flags the AI-style paragraph but not the student's", () => {
    const hits = flaggedText(report.text, report.findings, AI);
    expect(hits.some((t) => t.startsWith("Furthermore"))).toBe(true);
    expect(hits.some((t) => t.startsWith("I picked"))).toBe(false);
  });
  it("flags copied and paraphrased text against a reference", () => {
    const hits = flaggedText(report.text, report.findings, PLAGIARISM);
    expect(hits.some((t) => t.startsWith("During the previous decades"))).toBe(true);
    expect(hits.some((t) => t.startsWith("Many of these migrants"))).toBe(true);
  });
  it("flags the web-pasted paragraph from its formatting and leftovers", () => {
    const f = report.findings.find((x) => x.category === COPY_PASTE && x.end > 0 && isFlagged(x));
    expect(report.text.slice(f!.start, f!.end)).toContain("Black Sunday");
    expect(f!.reason).toMatch(/font Arial/);
    expect(f!.reason).toMatch(/Wikipedia-style tag/);
  });
});

describe("docx metadata traces", async () => {
  const doc = await loadDocx(readFileSync(fx("pasted_paper.docx")), "pasted_paper.docx");
  const report = await analyze(doc, { useLlm: false, useWebSearch: false }, offline);

  it("reads package metadata", () => {
    expect(doc.docx?.totalEditMinutes).toBe(4);
    expect(doc.docx?.revision).toBe(1);
    expect(doc.docx?.pasteStyles).toContain("Normal (Web)");
    expect(report.metadata.find((m) => m.label === "Total editing time")?.value).toBe("4 min");
  });
  it("flags the whole file for an impossible editing time", () => {
    const whole = report.findings.find((f) => f.category === COPY_PASTE && f.end === 0);
    expect(whole && isFlagged(whole)).toBe(true);
    expect(whole!.reason).toMatch(/min of total editing time/);
  });
  it("flags the paragraph pasted with a web style and other language tag", () => {
    const f = report.findings.find((x) => x.category === COPY_PASTE && x.end > 0 && isFlagged(x));
    expect(report.text.slice(f!.start, f!.end)).toMatch(/^Farmers on the southern plains/);
    expect(f!.reason).toMatch(/Normal \(Web\)/);
    expect(f!.reason).toMatch(/language tag en-GB/);
  });
});

describe("honest paper", () => {
  it("flags nothing", async () => {
    const doc = fromText(readFileSync(fx("honest_paper.txt"), "utf8"));
    const report = await analyze(doc, { useLlm: false, useWebSearch: false, references: [{ id: "encyclopedia", text: reference }] }, offline);
    expect(report.findings.filter(isFlagged)).toEqual([]);
  });
});

describe("Claude-backed checks (stubbed)", async () => {
  const doc = await loadDocx(readFileSync(fx("mixed_paper.docx")), "mixed_paper.docx");
  const searched: string[][] = [];
  const report = await analyze(doc, { useLlm: true, useWebSearch: true }, {
    client: null,
    scoreAi: async (_c, _m, passages) => passages.map((p, index) => ({
      index, ai_probability: p.text.startsWith("Furthermore") ? 0.95 : 0.05, signals: ["stub signal"],
    })),
    search: async (q) => { searched.push(q); return [{ url: "https://example.edu/dust-bowl", title: "Dust Bowl" }, { url: "https://example.com/404" }]; },
    fetchPage: async (url) => (url.includes("example.edu") ? `<html><body><p>${reference.replace(/\n/g, "</p><p>")}</p></body></html>` : null),
  });

  it("blends Claude's score with the heuristics", () => {
    const ai = report.findings.filter((f) => f.category === AI);
    const fur = ai.find((f) => report.text.slice(f.start).startsWith("Furthermore"))!;
    expect(fur.confidence).toBeGreaterThan(0.9);
    expect(fur.reason).toContain("stub signal");
    expect(ai.filter(isFlagged)).toHaveLength(1);
  });
  it("searches distinctive sentences and matches the downloaded page", () => {
    expect(searched[0].length).toBeGreaterThan(0);
    const plag = report.findings.filter((f) => f.category === PLAGIARISM && isFlagged(f));
    expect(plag.some((f) => f.source === "https://example.edu/dust-bowl")).toBe(true);
    expect(report.sourcesChecked).toEqual([
      { url: "https://example.edu/dust-bowl", title: "Dust Bowl", fetched: true },
      { url: "https://example.com/404", title: undefined, fetched: false },
    ]);
  });
});

describe("helpers", () => {
  it("skips quoted and short sentences when picking searches", () => {
    const doc = fromText('Short one. "This entire sentence is a direct quotation from a book that the student cited properly." The Homestead Act encouraged settlement across the Great Plains during the late nineteenth century, transforming grasslands.');
    expect(pickSearchSentences(doc, 5)).toEqual(["The Homestead Act encouraged settlement across the Great Plains during the late nineteenth century, transforming grasslands."]);
  });
  it("blocks private and local URLs", () => {
    expect(isPublicUrl("https://en.wikipedia.org/wiki/Dust_Bowl")).toBe(true);
    for (const u of ["http://localhost:3000", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1", "http://169.254.169.254/latest", "file:///etc/passwd", "http://[::1]/"]) expect(isPublicUrl(u)).toBe(false);
  });
  it("turns HTML into text", () => {
    expect(htmlToText("<style>x{}</style><p>Black&nbsp;Sunday &amp; dust</p><script>1</script>")).toBe("Black Sunday & dust");
  });
});
