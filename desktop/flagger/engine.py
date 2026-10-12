"""Runs every check on a document and builds the report."""
from __future__ import annotations

from pathlib import Path

from . import ai_detector, copy_paste, plagiarism
from . import document as d
from .report import CATEGORIES, CategorySummary, Report

DEFAULT_REFERENCE_DIR = Path(__file__).resolve().parent.parent / "reference_corpus"


def analyze(doc: d.Document, reference_dir: str | Path | None = DEFAULT_REFERENCE_DIR,
            model: ai_detector.PerplexityModel | None = None,
            corpus: plagiarism.ReferenceCorpus | None = None) -> Report:
    notes = []
    if corpus is None:
        corpus = plagiarism.ReferenceCorpus(reference_dir)
    if len(corpus):
        notes.append(f"Plagiarism compared against {len(corpus)} reference file(s) in {corpus.folder}.")
    else:
        notes.append("No reference files found, so the plagiarism check was skipped.")
    notes.append("AI check: " + (f"language model '{model.name}' + style heuristics" if model
                                 else "style heuristics only"))
    if not doc.format_runs:
        notes.append("Formatting checks need a .docx file; pasted or .txt text only gets character checks.")

    findings = (ai_detector.analyze(doc, model)
                + plagiarism.analyze(doc, corpus)
                + copy_paste.analyze(doc))
    findings.sort(key=lambda f: (f.start, -f.confidence))

    all_words = [w for p in doc.paragraphs for w in d.words(p)]
    summaries = {}
    for cat in CATEGORIES:
        mine = [f for f in findings if f.category == cat]
        flagged = [f for f in mine if f.flagged]
        in_flag = sum(1 for w in all_words if any(f.start <= w.start < f.end for f in flagged))
        summaries[cat] = CategorySummary(
            cat,
            max((f.confidence for f in mine), default=0.0),
            in_flag / max(len(all_words), 1),
            len(flagged),
        )
    return Report(doc.source_name, len(all_words), findings, summaries, notes)
