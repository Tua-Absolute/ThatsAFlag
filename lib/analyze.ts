/** Runs every check on a paper and builds the report. */
import type Anthropic from "@anthropic-ai/sdk";
import { passages, styleScore } from "./aiHeuristics";
import { getClient, modelName, scoreAiLikelihood, searchWeb, type SearchHit } from "./claude";
import { analyzeCopyPaste } from "./copyPaste";
import { Corpus, round, type Source } from "./plagiarism";
import { isHeading, sentences, words, type PaperDocument, type Span } from "./text";
import { AI, CATEGORIES, isFlagged, type Category, type CategorySummary, type Finding, type Report } from "./types";
import { fetchPageText } from "./web";

export interface Options {
  useLlm: boolean;
  useWebSearch: boolean;
  references?: Source[];
  maxSearches?: number;
}

/** Hooks so tests can swap out the network. */
export interface Deps {
  client?: Anthropic | null;
  model?: string;
  scoreAi?: typeof scoreAiLikelihood;
  search?: (queries: string[]) => Promise<SearchHit[]>;
  fetchPage?: (url: string) => Promise<string | null>;
}

const QUOTED = /“[^”]*”|"[^"]*"/g;

/** The sentences most worth searching for: long, specific, not quoted, spread across the paper. */
export function pickSearchSentences(doc: PaperDocument, max: number): string[] {
  const candidates: { text: string; score: number; para: number }[] = [];
  doc.paragraphs.forEach((p, pi) => {
    if (isHeading(p)) return;
    for (const s of sentences(p)) {
      const plain = s.text.replace(QUOTED, " ");
      const ws = words({ ...s, text: plain });
      if (ws.length < 12 || plain.length < 0.7 * s.text.length) continue;
      const rare = ws.filter((w) => w.text.length >= 7 || /^[A-Z]/.test(w.text)).length;
      candidates.push({ text: s.text, score: rare + Math.min(ws.length, 35) / 5, para: pi });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  const perPara = new Map<number, number>();
  const picked: string[] = [];
  for (const c of candidates) {
    if (picked.length >= max) break;
    if ((perPara.get(c.para) ?? 0) >= 2) continue;
    perPara.set(c.para, (perPara.get(c.para) ?? 0) + 1);
    picked.push(c.text.length > 300 ? c.text.slice(0, 300) : c.text);
  }
  return picked;
}

export async function analyze(doc: PaperDocument, opts: Options, deps: Deps = {}): Promise<Report> {
  const notes: string[] = [];
  const client = deps.client !== undefined ? deps.client : getClient();
  const model = deps.model ?? modelName();
  const canCallClaude = !!client || !!deps.scoreAi || !!deps.search;
  const findings: Finding[] = [];

  // --- AI-generated -------------------------------------------------------
  const spans: Span[] = passages(doc);
  const heur = spans.map((s) => styleScore(s.text));
  let llm: Awaited<ReturnType<typeof scoreAiLikelihood>> | null = null;
  if (opts.useLlm && canCallClaude && spans.length) {
    try {
      llm = await (deps.scoreAi ?? scoreAiLikelihood)(client!, model, spans);
      notes.push(`AI check: Claude (${model}) read each passage; style heuristics weigh in at 25%.`);
    } catch (e) {
      notes.push(`AI check: Claude call failed (${errText(e)}); style heuristics only.`);
    }
  } else if (opts.useLlm) {
    notes.push("AI check: no ANTHROPIC_API_KEY is set, so only the offline style heuristics ran.");
  } else notes.push("AI check: style heuristics only (Claude turned off).");
  spans.forEach((s, i) => {
    const l = llm?.find((x) => x.index === i);
    const h = heur[i];
    const conf = l ? 0.75 * Math.max(0, Math.min(1, l.ai_probability)) + 0.25 * h.score : h.score;
    const reasons = l ? [...l.signals, ...h.reasons.map((r) => `heuristic: ${r}`)] : h.reasons;
    findings.push({ category: AI, start: s.start, end: s.end, confidence: round(conf), reason: reasons.join("; ") || "no strong AI signals" });
  });

  // --- Plagiarism ---------------------------------------------------------
  const corpus = new Corpus();
  for (const r of opts.references ?? []) corpus.add(r);
  if (opts.references?.length) notes.push(`Compared against ${opts.references.length} uploaded reference file(s).`);
  const sourcesChecked: Report["sourcesChecked"] = [];
  if (opts.useWebSearch && canCallClaude) {
    const queries = pickSearchSentences(doc, opts.maxSearches ?? 8);
    try {
      const hits = await (deps.search ?? ((q: string[]) => searchWeb(client!, model, q)))(queries);
      const top = hits.slice(0, 25);
      const pages = await Promise.all(top.map((h) => (deps.fetchPage ?? fetchPageText)(h.url)));
      top.forEach((h, i) => {
        const text = pages[i];
        sourcesChecked.push({ url: h.url, title: h.title, fetched: !!text });
        if (text) corpus.add({ id: h.url, title: h.title, text });
      });
      const fetched = sourcesChecked.filter((s) => s.fetched).length;
      notes.push(`Web search: ${queries.length} sentence(s) searched, ${hits.length} result(s), ${fetched} page(s) downloaded and compared.`);
    } catch (e) {
      notes.push(`Web search failed (${errText(e)}).`);
    }
  } else if (opts.useWebSearch) notes.push("Web search: needs ANTHROPIC_API_KEY, so it was skipped.");
  findings.push(...corpus.analyze(doc));

  // --- Copy-paste ---------------------------------------------------------
  const cp = analyzeCopyPaste(doc);
  findings.push(...cp.findings);
  if (!doc.docx) notes.push("Formatting and metadata checks need a .docx file; pasted or .txt text only gets character checks.");

  findings.sort((a, b) => a.start - b.start || b.confidence - a.confidence);
  const allWords = doc.paragraphs.flatMap((p) => words(p));
  const summaries = Object.fromEntries(
    CATEGORIES.map((cat): [Category, CategorySummary] => {
      const mine = findings.filter((f) => f.category === cat);
      const flagged = mine.filter(isFlagged);
      const wholeDoc = flagged.some((f) => f.end === 0);
      const inFlag = wholeDoc ? allWords.length : allWords.filter((w) => flagged.some((f) => f.start <= w.start && w.start < f.end)).length;
      return [cat, {
        category: cat,
        maxConfidence: Math.max(0, ...mine.map((f) => f.confidence)),
        flaggedCount: flagged.length,
        flaggedShare: allWords.length ? inFlag / allWords.length : 0,
      }];
    }),
  ) as Record<Category, CategorySummary>;

  return { documentName: doc.name, text: doc.text, wordCount: allWords.length, findings, summaries, metadata: cp.metadata, notes, sourcesChecked };
}

function errText(e: unknown): string {
  if (e && typeof e === "object" && "status" in e) return `HTTP ${(e as { status: unknown }).status}`;
  return e instanceof Error ? e.message : String(e);
}
