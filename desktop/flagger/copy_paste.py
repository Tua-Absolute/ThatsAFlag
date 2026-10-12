"""Copy-paste check: traces that text was pasted in from somewhere else,
even when the original source is unknown.

Signals (combined so that several weak ones add up):
- .docx formatting that doesn't match the rest of the paper: a different
  font or size, coloured or highlighted text, leftover hyperlinks.
- Invisible or unusual characters that web pages and PDFs carry along:
  non-breaking spaces, zero-width characters, soft hyphens.
- Web and PDF leftovers: bracketed reference numbers like [12],
  "[citation needed]", "Retrieved from", bare URLs, hard line breaks in the
  middle of a sentence, words split across lines ("infor- mation").
- Quote style that differs from the rest of the paper (curly vs straight).
"""
from __future__ import annotations

import re
from collections import Counter

from . import document as d
from .report import COPY_PASTE, Finding

ODD_CHARS = {
    " ": "non-breaking space", "​": "zero-width space", "‌": "zero-width character",
    "‍": "zero-width character", "﻿": "invisible byte-order mark", "­": "soft hyphen",
    " ": "thin space", " ": "narrow non-breaking space",
}
WEB_LEFTOVERS = [
    (re.compile(r"\[\d{1,3}(?:[,–-]\d{1,3})*\]"), "bracketed reference number like [12]", 0.45),
    (re.compile(r"\[(?:citation needed|edit|clarification needed)\]", re.I), "Wikipedia-style tag", 0.75),
    (re.compile(r"\bRetrieved (?:from|\w+ \d{1,2}, \d{4})", re.I), '"Retrieved from" line', 0.4),
    (re.compile(r"https?://\S+|www\.\S+"), "web address", 0.3),
    (re.compile(r"\b(?:Click here|Read more|Share this|Advertisement|Cookie)\b"), "web page button text", 0.6),
    (re.compile(r"[a-z]{2,}-\s*\n\s*[a-z]{2,}|[a-z]{3,}- [a-z]{3,}"), "word split across a line break", 0.45),
    (re.compile(r"[a-z,;]\n(?!\n)[a-z]"), "hard line break in the middle of a sentence", 0.45),
]


def _noisy_or(probs: list[float]) -> float:
    p = 1.0
    for x in probs:
        p *= 1 - x
    return 1 - p


def _format_signals(doc: d.Document) -> list[tuple[int, int, float, str]]:
    """Spans whose formatting differs from the paper's main body text."""
    if not doc.format_runs:
        return []
    body = [p for p in doc.paragraphs if not p.is_heading]
    in_body = lambda r: any(p.start <= r.start < p.end for p in body)  # noqa: E731
    runs = [r for r in doc.format_runs if in_body(r)]
    if not runs:
        return []
    weight = Counter()
    for r in runs:
        weight[(r.font, r.size)] += r.end - r.start
    main_font, main_size = weight.most_common(1)[0][0]

    marked: list[tuple[int, int, set[str]]] = []
    for r in runs:
        why = set()
        if r.font != main_font:
            why.add(f"font {r.font or 'default'} vs {main_font or 'default'}")
        if r.size != main_size:
            why.add(f"size {r.size or '?'}pt vs {main_size or '?'}pt")
        if r.color and r.color not in ("000000", "auto"):
            why.add(f"coloured text (#{r.color})")
        if r.highlighted:
            why.add("highlight/shading")
        if r.hyperlink:
            why.add("embedded hyperlink")
        if not why or not doc.text[r.start:r.end].strip():
            continue
        if marked and r.start - marked[-1][1] <= 1:
            marked[-1] = (marked[-1][0], r.end, marked[-1][2] | why)
        else:
            marked.append((r.start, r.end, why))

    out = []
    for start, end, why in marked:
        n = len(d.words(d.Span(start, end, doc.text[start:end])))
        if n < 4:
            continue
        strength = 0.45 + 0.12 * len(why) + 0.15 * min(1.0, n / 40)
        out.append((start, end, min(0.92, strength), "formatting differs from the rest of the paper: " + ", ".join(sorted(why))))
    return out


def analyze(doc: d.Document) -> list[Finding]:
    findings: list[Finding] = []
    body = [p for p in doc.paragraphs if not p.is_heading]

    # Dominant quote style across the paper.
    all_text = "".join(p.text for p in body)
    curly_total = sum(all_text.count(c) for c in "“”’")
    straight_total = sum(all_text.count(c) for c in "\"'")
    main_curly = curly_total > straight_total

    fmt = _format_signals(doc)
    for p in body:
        signals: list[tuple[float, str]] = []
        # Formatting oddities inside this paragraph become one more signal for it.
        inside = [x for x in fmt if p.start <= x[0] < p.end]
        fmt = [x for x in fmt if x not in inside]
        for start, end, strength, reason in inside:
            if (end - start) < 0.5 * (p.end - p.start):
                findings.append(Finding(COPY_PASTE, start, end, round(strength, 3), reason))
            else:
                signals.append((strength, reason))
        odd = Counter(ODD_CHARS[c] for c in p.text if c in ODD_CHARS)
        for name, count in odd.items():
            signals.append((min(0.6, 0.3 + 0.05 * count), f"{count} × {name}"))
        for rx, name, strength in WEB_LEFTOVERS:
            hits = rx.findall(p.text)
            if hits:
                signals.append((min(0.85, strength + 0.05 * (len(hits) - 1)), f"{name} ({len(hits)}×)"))
        curly = sum(p.text.count(c) for c in "“”’")
        straight = sum(p.text.count(c) for c in "\"'")
        if curly_total and straight_total and curly + straight >= 2:
            if (main_curly and straight > curly) or (not main_curly and curly > straight):
                signals.append((0.3, "quote style differs from the rest of the paper"))
        if signals:
            conf = _noisy_or([s for s, _ in signals])
            findings.append(Finding(COPY_PASTE, p.start, p.end, round(conf, 3),
                                    "; ".join(r for _, r in signals)))

    for start, end, conf, reason in fmt:  # anything left, e.g. spanning paragraphs
        findings.append(Finding(COPY_PASTE, start, end, round(conf, 3), reason))
    return findings
