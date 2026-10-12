/**
 * Offline fallback for the AI check: style heuristics per passage. Used when
 * no API key is configured, and shown alongside the LLM's reading otherwise.
 */
import { clamp, isHeading, sentences, words, type PaperDocument, type Span } from "./text";

const MARKERS = [
  "delve", "delves", "delving", "tapestry", "testament to", "multifaceted", "it is important to note",
  "it's important to note", "it is worth noting", "plays a crucial role", "plays a pivotal role",
  "plays a vital role", "pivotal", "underscores", "in today's fast-paced", "in the realm of",
  "navigating the complexities", "ever-evolving", "fostering", "nuanced", "intricate", "furthermore",
  "moreover", "additionally", "in conclusion", "landscape", "holistic", "seamless", "robust", "leverage",
  "paramount", "myriad", "shed light on", "sheds light on", "serves as a", "transformative", "in summary",
  "ultimately,", "valuable insights", "rich history", "realm",
];
const markerRes = MARKERS.map((m) => new RegExp("\\b" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"), "g"));
const CONTRACTION = /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/i;
const FIRST_PERSON = /\b(?:I|me|my|mine|we|our|us)\b/;
export const MIN_WORDS = 40;

export function styleScore(text: string): { score: number; reasons: string[] } {
  const span = { start: 0, end: text.length, text };
  const ws = words(span);
  const n = ws.length;
  const reasons: string[] = [];
  const lens = sentences(span).map((s) => words(s).length).filter((x) => x > 0);
  let burst = 0;
  if (lens.length >= 3) {
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    const cv = sd / mean;
    burst = clamp((0.55 - cv) / 0.35);
    if (burst > 0.5) reasons.push(`very even sentence lengths (variation ${cv.toFixed(2)})`);
  }
  const low = text.toLowerCase();
  let count = 0;
  const hits: string[] = [];
  markerRes.forEach((r, i) => {
    const c = low.match(r)?.length ?? 0;
    if (c) hits.push(MARKERS[i]);
    count += c;
  });
  const marker = clamp(((count / Math.max(n, 1)) * 100) / 2);
  if (hits.length) reasons.push("stock AI phrasing: " + hits.slice(0, 5).map((h) => `"${h}"`).join(", "));
  const avg = ws.reduce((a, w) => a + w.text.length, 0) / Math.max(n, 1);
  const wordy = clamp((avg - 4.6) / 1.0);
  if (wordy > 0.5) reasons.push(`long average word length (${avg.toFixed(1)} letters)`);
  const casual = CONTRACTION.test(text) || FIRST_PERSON.test(text) ? 0 : 1;
  const score = clamp(0.1 + 0.32 * burst + 0.38 * marker + 0.12 * wordy + 0.1 * casual);
  return { score: Math.min(score, 0.9), reasons };
}

/** Body paragraphs, short ones merged with the next so each passage can be scored. */
export function passages(doc: PaperDocument): Span[] {
  const out: Span[] = [];
  let pending: Span | null = null;
  for (const p of doc.paragraphs) {
    if (isHeading(p)) continue;
    const cur: Span = pending ? { start: pending.start, end: p.end, text: doc.text.slice(pending.start, p.end) } : p;
    if (words(cur).length >= MIN_WORDS) {
      out.push(cur);
      pending = null;
    } else pending = cur;
  }
  if (pending) {
    if (out.length && words(pending).length < MIN_WORDS) {
      const last = out.pop()!;
      pending = { start: last.start, end: pending.end, text: doc.text.slice(last.start, pending.end) };
    }
    out.push(pending);
  }
  return out.filter((s) => words(s).length >= 15);
}
