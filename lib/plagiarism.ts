/**
 * Matches the paper against a set of source texts (web pages found by the
 * search, or reference files the user uploads):
 *  1. verbatim: runs of 8+ words that appear word for word in a source;
 *  2. close paraphrase: sentences sharing most of their key words with a
 *     source sentence.
 * Confidence comes from how much actually matches, so a search hit that
 * doesn't really overlap the paper is never flagged.
 */
import { norm, sentences, words, type PaperDocument, type Paragraph, type Span } from "./text";
import { PLAGIARISM, type Finding } from "./types";

export interface Source {
  id: string; // URL or file name
  title?: string;
  text: string;
}

const SHINGLE = 6;
const MIN_RUN = 8;
const MAX_GAP = 2;

const STOP = new Set(
  `a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that
  these those there their they them he she his her we our you your i me my not no do does did has have had will would
  can could should may might must than also which who whom whose what when where why how all any each more most some
  such into out up down over under about after before between through during very just only own same other`.split(/\s+/),
);

const stem = (w: string) => {
  for (const suf of ["ingly", "edly", "ing", "ed", "ly", "es", "s"]) if (w.length > suf.length + 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  return w;
};
const content = (s: Span) => words(s).map((w) => norm(w.text)).filter((w) => !STOP.has(w) && w.length > 2).map(stem);

interface RefSentence { source: number; terms: Set<string>; text: string }

export class Corpus {
  sources: Source[] = [];
  private shingles = new Map<string, number[]>();
  private sents: RefSentence[] = [];
  private termIndex = new Map<string, number[]>();
  private df = new Map<string, number>();

  add(src: Source) {
    const idx = this.sources.push(src) - 1;
    const toks = words({ start: 0, end: src.text.length, text: src.text }).map((w) => norm(w.text));
    for (let i = 0; i + SHINGLE <= toks.length; i++) {
      const k = toks.slice(i, i + SHINGLE).join(" ");
      const l = this.shingles.get(k) ?? [];
      if (!l.includes(idx)) l.push(idx);
      this.shingles.set(k, l);
    }
    for (const para of src.text.split(/\n\s*\n|\n/)) {
      for (const s of sentences({ start: 0, end: para.length, text: para })) {
        const terms = new Set(content(s));
        if (terms.size < 5) continue;
        const sid = this.sents.push({ source: idx, terms, text: s.text }) - 1;
        for (const t of terms) {
          (this.termIndex.get(t) ?? this.termIndex.set(t, []).get(t)!).push(sid);
          this.df.set(t, (this.df.get(t) ?? 0) + 1);
        }
      }
    }
  }

  get size() { return this.sources.length; }
  private idf(t: string) { return Math.log((1 + this.sents.length) / (1 + (this.df.get(t) ?? 0))) + 1; }

  verbatim(doc: PaperDocument): Finding[] {
    const out: Finding[] = [];
    for (const para of doc.paragraphs) {
      const ws = words(para);
      const toks = ws.map((w) => norm(w.text));
      const matched: (number[] | null)[] = ws.map(() => null);
      for (let i = 0; i + SHINGLE <= toks.length; i++) {
        const srcs = this.shingles.get(toks.slice(i, i + SHINGLE).join(" "));
        if (srcs) for (let j = i; j < i + SHINGLE; j++) matched[j] = [...(matched[j] ?? []), ...srcs];
      }
      let i = 0;
      while (i < ws.length) {
        if (!matched[i]) { i++; continue; }
        let j = i;
        for (;;) {
          let nxt = j + 1, gap = 0;
          while (nxt < ws.length && !matched[nxt] && gap < MAX_GAP) { nxt++; gap++; }
          if (nxt < ws.length && matched[nxt]) j = nxt; else break;
        }
        const n = j - i + 1;
        if (n >= MIN_RUN) {
          const counts = new Map<number, number>();
          for (let k = i; k <= j; k++) for (const s of matched[k] ?? []) counts.set(s, (counts.get(s) ?? 0) + 1);
          const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
          const start = ws[i].start;
          let end = ws[j].end;
          while (end < para.end && `.,;:!?”"'’)`.includes(doc.text[end])) end++;
          let confidence = Math.min(0.97, 0.35 + 0.03 * n);
          let reason = `${n} words match the source word for word`;
          if (insideQuotes(doc.text, start, para)) {
            confidence *= 0.5;
            reason += " (inside quotation marks; check that it is cited)";
          }
          out.push({ category: PLAGIARISM, start, end, confidence: round(confidence), reason, source: this.sources[best].id, sourceTitle: this.sources[best].title });
        }
        i = j + 1;
      }
    }
    return out;
  }

  paraphrase(doc: PaperDocument, covered: Finding[]): Finding[] {
    const out: Finding[] = [];
    for (const para of doc.paragraphs) {
      for (const s of sentences(para)) {
        const overlap = covered.reduce((a, f) => a + Math.max(0, Math.min(f.end, s.end) - Math.max(f.start, s.start)), 0);
        if (overlap > 0.5 * (s.end - s.start)) continue;
        const terms = new Set(content(s));
        if (terms.size < 6) continue;
        const cand = new Map<number, number>();
        for (const t of terms) for (const sid of this.termIndex.get(t) ?? []) cand.set(sid, (cand.get(sid) ?? 0) + 1);
        let best: RefSentence | null = null, bestSim = 0;
        for (const [sid, shared] of [...cand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
          if (shared < 4) break;
          const ref = this.sents[sid];
          let inter = 0, na = 0, nb = 0;
          for (const t of terms) { const w = this.idf(t) ** 2; na += w; if (ref.terms.has(t)) inter += w; }
          for (const t of ref.terms) nb += this.idf(t) ** 2;
          const sim = inter / Math.sqrt(na * nb);
          if (sim > bestSim) { best = ref; bestSim = sim; }
        }
        if (!best) continue;
        const confidence = Math.max(0, Math.min(0.95, 1.6 * bestSim - 0.4));
        if (confidence < 0.3) continue;
        const src = this.sources[best.source];
        out.push({
          category: PLAGIARISM, start: s.start, end: s.end, confidence: round(confidence),
          reason: `closely paraphrases the source (similarity ${Math.round(bestSim * 100)}%): “${best.text.slice(0, 160)}”`,
          source: src.id, sourceTitle: src.title,
        });
      }
    }
    return out;
  }

  analyze(doc: PaperDocument): Finding[] {
    if (!this.size) return [];
    const v = this.verbatim(doc);
    const p = this.paraphrase(doc, v);
    // A short verbatim run inside a paraphrased sentence is the same finding.
    const kept: Finding[] = [];
    for (const f of v) {
      const host = p.find((x) => x.start <= f.start && f.end <= x.end);
      if (!host) kept.push(f);
      else {
        host.confidence = Math.max(host.confidence, f.confidence);
        host.reason += `; includes ${f.reason.split(" ")[0]} words copied exactly`;
      }
    }
    return [...kept, ...p];
  }
}

function insideQuotes(text: string, start: number, para: Paragraph) {
  const before = text.slice(para.start, start);
  const count = (c: string) => before.split(c).length - 1;
  return count("“") > count("”") || count('"') % 2 === 1;
}

export const round = (x: number) => Math.round(x * 1000) / 1000;
