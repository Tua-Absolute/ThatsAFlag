/**
 * Copy-paste check: traces that text was pasted in from somewhere else, even
 * when the source is unknown. Per passage: odd characters, web/PDF leftovers,
 * formatting or language tags that differ from the rest of the paper, web
 * paste styles, hidden text, and paragraphs entered in a Word editing session
 * that added nothing else. For the whole file: editing time far too short for
 * the length, very few revisions or sessions, embedded HTML chunks.
 */
import { isHeading, words, type PaperDocument, type Span } from "./text";
import { COPY_PASTE, type Finding, type MetadataItem } from "./types";
import { round } from "./plagiarism";

const ODD: Record<string, string> = {
  " ": "non-breaking space", "​": "zero-width space", "‌": "zero-width character",
  "‍": "zero-width character", "﻿": "invisible byte-order mark", "­": "soft hyphen",
  " ": "thin space", " ": "narrow non-breaking space",
};
const LEFTOVERS: [RegExp, string, number][] = [
  [/\[\d{1,3}(?:[,–-]\d{1,3})*\]/g, "bracketed reference number like [12]", 0.45],
  [/\[(?:citation needed|edit|clarification needed)\]/gi, "Wikipedia-style tag", 0.75],
  [/\bRetrieved (?:from|\w+ \d{1,2}, \d{4})/gi, '"Retrieved from" line', 0.4],
  [/https?:\/\/\S+|www\.\S+/g, "web address", 0.3],
  [/\b(?:Click here|Read more|Share this|Advertisement|Cookie)\b/g, "web page button text", 0.6],
  [/[a-z]{2,}-\s*\n\s*[a-z]{2,}|[a-z]{3,}- [a-z]{3,}/g, "word split across a line break", 0.45],
  [/[a-z,;]\n(?!\n)[a-z]/g, "hard line break in the middle of a sentence", 0.45],
];

const noisyOr = (ps: number[]) => 1 - ps.reduce((a, p) => a * (1 - p), 1);
type Signal = [number, string];

function mostCommon<T>(items: [T, number][]): T | undefined {
  const m = new Map<T, number>();
  for (const [k, w] of items) m.set(k, (m.get(k) ?? 0) + w);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function analyzeCopyPaste(doc: PaperDocument): { findings: Finding[]; metadata: MetadataItem[] } {
  const findings: Finding[] = [];
  const body = doc.paragraphs.filter((p) => !isHeading(p));
  const allText = body.map((p) => p.text).join("");
  const curlyTotal = (allText.match(/[“”’]/g) ?? []).length;
  const straightTotal = (allText.match(/["']/g) ?? []).length;
  const mainCurly = curlyTotal > straightTotal;

  // Dominant formatting across body text.
  const bodyRuns = doc.runs.filter((r) => body.some((p) => p.start <= r.start && r.start < p.end));
  const mainFont = mostCommon(bodyRuns.map((r) => [`${r.font}|${r.size}`, r.end - r.start] as [string, number]));
  const mainLang = mostCommon(bodyRuns.filter((r) => r.lang).map((r) => [r.lang!, r.end - r.start] as [string, number]));
  // Which paragraphs each Word editing session (rsid) touched.
  const rsidParas = new Map<string, Set<number>>();
  body.forEach((p, i) => {
    for (const r of bodyRuns) if (r.rsid && p.start <= r.start && r.start < p.end) (rsidParas.get(r.rsid) ?? rsidParas.set(r.rsid, new Set()).get(r.rsid)!).add(i);
  });

  body.forEach((p) => {
    const signals: Signal[] = [];
    const odd = new Map<string, number>();
    for (const ch of p.text) if (ODD[ch]) odd.set(ODD[ch], (odd.get(ODD[ch]) ?? 0) + 1);
    for (const [name, c] of odd) signals.push([Math.min(0.6, 0.3 + 0.05 * c), `${c} × ${name}`]);
    for (const [re, name, s] of LEFTOVERS) {
      const hits = p.text.match(re)?.length ?? 0;
      if (hits) signals.push([Math.min(0.85, s + 0.05 * (hits - 1)), `${name} (${hits}×)`]);
    }
    const curly = (p.text.match(/[“”’]/g) ?? []).length;
    const straight = (p.text.match(/["']/g) ?? []).length;
    if (curlyTotal && straightTotal && curly + straight >= 2 && ((mainCurly && straight > curly) || (!mainCurly && curly > straight)))
      signals.push([0.3, "quote style differs from the rest of the paper"]);

    // .docx traces inside this paragraph
    const runs = bodyRuns.filter((r) => p.start <= r.start && r.start < p.end && doc.text.slice(r.start, r.end).trim());
    if (runs.length) {
      const chars = (pred: (r: (typeof runs)[number]) => boolean) => runs.filter(pred).reduce((a, r) => a + r.end - r.start, 0);
      const total = chars(() => true);
      const odds: { span: Span; why: Set<string> }[] = [];
      for (const r of runs) {
        const why = new Set<string>();
        if (mainFont && `${r.font}|${r.size}` !== mainFont) {
          const [mf, ms] = mainFont.split("|");
          if (String(r.font) !== mf) why.add(`font ${r.font ?? "default"} vs ${mf}`);
          if (String(r.size) !== ms) why.add(`size ${r.size ?? "?"}pt vs ${ms}pt`);
        }
        if (r.color && !/^(000000|auto)$/i.test(r.color)) why.add(`coloured text (#${r.color})`);
        if (r.highlighted) why.add("highlight/shading");
        if (r.hyperlink) why.add("embedded hyperlink");
        if (r.lang && mainLang && r.lang !== mainLang) why.add(`language tag ${r.lang} vs ${mainLang}`);
        if (!why.size) continue;
        const last = odds[odds.length - 1];
        if (last && r.start - last.span.end <= 1) {
          last.span = { ...last.span, end: r.end };
          why.forEach((w) => last.why.add(w));
        } else odds.push({ span: { start: r.start, end: r.end, text: "" }, why });
      }
      for (const o of odds) {
        const n = words({ ...o.span, text: doc.text.slice(o.span.start, o.span.end) }).length;
        if (n < 4) continue;
        const strength = Math.min(0.92, 0.45 + 0.12 * o.why.size + 0.15 * Math.min(1, n / 40));
        const reason = "formatting differs from the rest of the paper: " + [...o.why].sort().join(", ");
        if (o.span.end - o.span.start < 0.5 * (p.end - p.start))
          findings.push({ category: COPY_PASTE, start: o.span.start, end: o.span.end, confidence: round(strength), reason });
        else signals.push([strength, reason]);
      }
      const hidden = chars((r) => r.hidden);
      if (hidden) signals.push([0.6, `${hidden} characters of hidden text`]);
      // Whole paragraph typed or pasted in one editing session that added nothing else.
      const rs = mostCommon(runs.filter((r) => r.rsid).map((r) => [r.rsid!, r.end - r.start] as [string, number]));
      if (rs && body.length >= 4 && words(p).length >= 40 && chars((r) => r.rsid === rs) >= 0.9 * total && rsidParas.get(rs)?.size === 1)
        signals.push([0.25, "entire paragraph added in a single Word editing session that changed nothing else"]);
    }
    if (doc.docx?.pasteStyles.includes(p.style)) signals.push([0.6, `uses the "${p.style}" style Word creates when pasting from a web page`]);

    if (signals.length)
      findings.push({ category: COPY_PASTE, start: p.start, end: p.end, confidence: round(noisyOr(signals.map((s) => s[0]))), reason: signals.map((s) => s[1]).join("; ") });
  });

  const { finding, metadata } = documentTraces(doc, body.reduce((a, p) => a + words(p).length, 0));
  if (finding) findings.push(finding);
  return { findings, metadata };
}

function documentTraces(doc: PaperDocument, wordCount: number): { finding?: Finding; metadata: MetadataItem[] } {
  const t = doc.docx;
  const metadata: MetadataItem[] = [];
  if (!t) return { metadata };
  const add = (label: string, value: unknown) => value !== undefined && value !== "" && metadata.push({ label, value: String(value) });
  add("Author (created by)", t.creator);
  add("Last modified by", t.lastModifiedBy);
  add("Created", t.created);
  add("Last modified", t.modified);
  add("Revision number", t.revision);
  add("Total editing time", t.totalEditMinutes !== undefined ? `${t.totalEditMinutes} min` : undefined);
  add("Word editing sessions", t.editSessions);
  add("Application", t.application);
  add("Template", t.template);
  if (t.pasteStyles.length) add("Web-paste styles used", t.pasteStyles.join(", "));
  if (t.altChunks) add("Embedded HTML/RTF chunks", t.altChunks);
  if (t.hasTrackedChanges) add("Tracked changes", "yes");
  if (t.hasComments) add("Comments", "yes");
  if (t.customProperties.length) add("Custom properties", t.customProperties.join(", "));

  const signals: Signal[] = [];
  // Only Word keeps a trustworthy editing clock; Google Docs/LibreOffice exports don't.
  const word = /microsoft/i.test(t.application ?? "");
  if (t.totalEditMinutes !== undefined && word && wordCount >= 150) {
    const wpm = wordCount / Math.max(t.totalEditMinutes, 1);
    // Drafting an essay usually runs well under 20 words per minute of editing time.
    if (wpm > 25) signals.push([Math.min(0.85, 0.2 + (wpm - 25) / 60), `${wordCount} words but only ${t.totalEditMinutes} min of total editing time (${Math.round(wpm)} words/min)`]);
  }
  if (t.revision !== undefined && t.revision <= 2 && wordCount >= 500) signals.push([0.35, `only ${t.revision} saved revision(s) for a ${wordCount}-word paper`]);
  if (t.editSessions !== undefined && t.editSessions <= 2 && wordCount >= 500) signals.push([0.3, `only ${t.editSessions} Word editing session(s) recorded`]);
  if (t.created && t.modified && word) {
    const mins = (Date.parse(t.modified) - Date.parse(t.created)) / 60000;
    if (mins >= 0 && mins < 20 && wordCount >= 150) signals.push([0.4, `created and last saved ${Math.round(mins)} min apart`]);
  }
  if (t.altChunks) signals.push([0.7, `contains ${t.altChunks} embedded HTML/RTF chunk(s), which Word adds when content is pasted or inserted from another file`]);
  if (t.pasteStyles.length) signals.push([0.45, `uses web-paste styles: ${t.pasteStyles.join(", ")}`]);
  if (!signals.length) return { metadata };
  return {
    metadata,
    finding: {
      category: COPY_PASTE, start: 0, end: 0,
      confidence: round(Math.min(0.8, noisyOr(signals.map((s) => s[0])))),
      reason:
        "Whole file: " + signals.map((s) => s[1]).join("; ") +
        ". This also happens when a student drafts somewhere else (for example Google Docs) and pastes the finished paper into Word, so ask before assuming.",
    },
  };
}
