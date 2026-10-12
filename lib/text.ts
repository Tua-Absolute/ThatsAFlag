/** Paragraphs, sentences and words, all with character offsets into the paper. */

export interface Span {
  start: number;
  end: number;
  text: string;
}

export interface FormatRun {
  start: number;
  end: number;
  font?: string;
  size?: number;
  color?: string;
  highlighted: boolean;
  hyperlink: boolean;
  hidden: boolean;
  lang?: string;
  /** Word's revision-session id for when this run was inserted. */
  rsid?: string;
}

export interface Paragraph extends Span {
  style: string;
}

export interface PaperDocument {
  name: string;
  text: string;
  paragraphs: Paragraph[];
  runs: FormatRun[]; // only for .docx
  /** Package-level traces (.docx only); filled by docx.ts. */
  docx?: import("./docx").DocxTraces;
}

export const PARA_SEP = "\n\n";

export function isHeading(p: Paragraph): boolean {
  const s = p.style.toLowerCase();
  return s.startsWith("heading") || s === "title" || s === "subtitle";
}

export function fromText(raw: string, name = "pasted text"): PaperDocument {
  const text = raw.replace(/\r\n?/g, "\n");
  const paragraphs: Paragraph[] = [];
  // Blank lines separate paragraphs; a single newline stays inside one.
  const re = /[^\n](?:.|\n(?!\s*\n))*/g;
  for (const m of text.matchAll(re)) {
    const chunk = m[0].trimEnd();
    if (chunk.trim()) paragraphs.push({ start: m.index!, end: m.index! + chunk.length, text: chunk, style: "Normal" });
  }
  return { name, text, paragraphs, runs: [] };
}

const SENT_END = /(?<=[.!?]["'”’)\]]*)\s+(?=["'“‘(\[]?[A-Z0-9])/g;
const WORD = /[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g;

export function sentences(span: Span): Span[] {
  const out: Span[] = [];
  let start = 0;
  const push = (from: number, to: number) => {
    const piece = span.text.slice(from, to);
    const lead = piece.length - piece.trimStart().length;
    const t = piece.trim();
    if (t) out.push({ start: span.start + from + lead, end: span.start + from + lead + t.length, text: t });
  };
  for (const m of span.text.matchAll(SENT_END)) {
    push(start, m.index!);
    start = m.index! + m[0].length;
  }
  push(start, span.text.length);
  return out;
}

export function words(span: Span): Span[] {
  return [...span.text.matchAll(WORD)].map((m) => ({
    start: span.start + m.index!,
    end: span.start + m.index! + m[0].length,
    text: m[0],
  }));
}

export const norm = (w: string) => w.toLowerCase().replace(/’/g, "'");

export const clamp = (x: number) => Math.max(0, Math.min(1, x));
