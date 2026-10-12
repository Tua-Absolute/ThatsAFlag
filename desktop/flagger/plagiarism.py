"""Plagiarism check against a local folder of reference texts.

Two passes:

1. Verbatim overlap: the paper and every reference file are cut into
   overlapping 6-word "shingles". Runs of matching shingles are copied
   wording. Longer runs mean higher confidence.
2. Close paraphrase: each sentence is compared with every reference
   sentence by shared content words (stop words removed, light stemming).
   Catches copying with a few words swapped.

Only sources you put in the reference folder can be found. There is no
internet search in this proof of concept.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

from . import document as d
from .report import PLAGIARISM, Finding

SHINGLE = 6
MIN_RUN_WORDS = 8
MAX_GAP = 2  # matched runs separated by this many words or fewer are joined

STOP = set("""a an the and or but if then so of to in on at by for with from as is are was were be been
being it its this that these those there their they them he she his her we our you your i me my
not no do does did has have had will would can could should may might must than also which who
whom whose what when where why how all any each more most some such into out up down over under
about after before between through during very just only own same other""".split())


def _stem(w: str) -> str:
    for suf in ("ingly", "edly", "ing", "ed", "ly", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def _content(span: d.Span) -> list[str]:
    return [_stem(w) for w in (d.norm(x.text) for x in d.words(span)) if w not in STOP and len(w) > 2]


@dataclass
class _RefSentence:
    source: str
    terms: set[str]
    text: str


class ReferenceCorpus:
    def __init__(self, folder: str | Path | None):
        self.folder = Path(folder) if folder else None
        self.files: list[str] = []
        self.shingles: dict[tuple[str, ...], list[int]] = defaultdict(list)  # -> file indexes
        self.sentences: list[_RefSentence] = []
        self.term_index: dict[str, list[int]] = defaultdict(list)
        self.df: Counter[str] = Counter()
        if self.folder and self.folder.is_dir():
            for path in sorted(self.folder.rglob("*")):
                if path.suffix.lower() in (".txt", ".md", ".docx") and path.is_file():
                    try:
                        self._add(path.name, d.load(path))
                    except Exception:
                        continue

    def _add(self, name: str, doc: d.Document) -> None:
        idx = len(self.files)
        self.files.append(name)
        toks = [d.norm(w.text) for w in d.words(d.Span(0, len(doc.text), doc.text))]
        for i in range(len(toks) - SHINGLE + 1):
            lst = self.shingles[tuple(toks[i:i + SHINGLE])]
            if idx not in lst:
                lst.append(idx)
        for p in doc.paragraphs:
            for s in d.sentences(p):
                terms = set(_content(s))
                if len(terms) < 5:
                    continue
                sid = len(self.sentences)
                self.sentences.append(_RefSentence(name, terms, s.text))
                for t in terms:
                    self.term_index[t].append(sid)
                self.df.update(terms)

    def __len__(self) -> int:
        return len(self.files)

    def idf(self, term: str) -> float:
        return math.log((1 + len(self.sentences)) / (1 + self.df.get(term, 0))) + 1


def _inside_quotes(text: str, start: int, end: int, para: d.Paragraph) -> bool:
    """True when the passage starts inside an open quotation in its paragraph."""
    before = text[para.start:start]
    return before.count("“") > before.count("”") or before.count('"') % 2 == 1


def verbatim(doc: d.Document, corpus: ReferenceCorpus) -> list[Finding]:
    findings = []
    for para in doc.paragraphs:
        ws = d.words(para)
        toks = [d.norm(w.text) for w in ws]
        matched: list[list[int] | None] = [None] * len(ws)
        for i in range(len(toks) - SHINGLE + 1):
            srcs = corpus.shingles.get(tuple(toks[i:i + SHINGLE]))
            if srcs:
                for j in range(i, i + SHINGLE):
                    matched[j] = (matched[j] or []) + srcs
        # collect runs
        runs: list[tuple[int, int]] = []
        i = 0
        while i < len(ws):
            if matched[i] is None:
                i += 1
                continue
            j = i
            while j + 1 < len(ws):
                nxt = j + 1
                gap = 0
                while nxt < len(ws) and matched[nxt] is None and gap < MAX_GAP:
                    nxt += 1
                    gap += 1
                if nxt < len(ws) and matched[nxt] is not None:
                    j = nxt
                else:
                    break
            runs.append((i, j))
            i = j + 1
        for a, b in runs:
            n = b - a + 1
            if n < MIN_RUN_WORDS:
                continue
            src_counts = Counter(s for k in range(a, b + 1) if matched[k] for s in matched[k])
            source = corpus.files[src_counts.most_common(1)[0][0]]
            start, end = ws[a].start, ws[b].end
            # extend to the closing punctuation of the last word, if any
            while end < para.end and doc.text[end] in ".,;:!?”\"'’)":
                end += 1
            conf = min(0.97, 0.35 + 0.03 * n)
            reason = f"{n} words match the reference text word for word"
            if _inside_quotes(doc.text, start, end, para):
                conf *= 0.5
                reason += " (inside quotation marks; check that it is cited)"
            findings.append(Finding(PLAGIARISM, start, end, round(conf, 3), reason, source))
    return findings


def paraphrase(doc: d.Document, corpus: ReferenceCorpus, already: list[Finding]) -> list[Finding]:
    covered = [(f.start, f.end) for f in already]
    findings = []
    for para in doc.paragraphs:
        for s in d.sentences(para):
            overlap = sum(max(0, min(e, s.end) - max(b, s.start)) for b, e in covered)
            if overlap > 0.5 * (s.end - s.start):
                continue
            terms = set(_content(s))
            if len(terms) < 6:
                continue
            cand = Counter(sid for t in terms for sid in corpus.term_index.get(t, ()))
            best, best_sim = None, 0.0
            for sid, shared in cand.most_common(30):
                if shared < 4:
                    break
                ref = corpus.sentences[sid]
                inter = sum(corpus.idf(t) ** 2 for t in terms & ref.terms)
                na = math.sqrt(sum(corpus.idf(t) ** 2 for t in terms))
                nb = math.sqrt(sum(corpus.idf(t) ** 2 for t in ref.terms))
                sim = inter / (na * nb)
                if sim > best_sim:
                    best, best_sim = ref, sim
            if best is None:
                continue
            conf = max(0.0, min(0.95, 1.6 * best_sim - 0.4))
            if conf < 0.3:
                continue
            reason = f"closely paraphrases a reference sentence (similarity {best_sim:.0%}): “{best.text[:120]}”"
            findings.append(Finding(PLAGIARISM, s.start, s.end, round(conf, 3), reason, best.source))
    return findings


def analyze(doc: d.Document, corpus: ReferenceCorpus) -> list[Finding]:
    if not len(corpus):
        return []
    v = verbatim(doc, corpus)
    para = paraphrase(doc, corpus, v)
    # A short verbatim run inside a paraphrased sentence is the same finding:
    # fold it into the paraphrase instead of listing it twice.
    kept = []
    for f in v:
        host = next((p for p in para if p.start <= f.start and f.end <= p.end), None)
        if host is None:
            kept.append(f)
        else:
            host.confidence = max(host.confidence, f.confidence)
            host.reason += f"; includes {f.reason.split(' ')[0]} words copied exactly"
    return kept + para
