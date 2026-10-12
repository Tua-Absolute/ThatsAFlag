"""Plain-text and HTML versions of a report."""
from __future__ import annotations

import html

from .report import AI, COPY_PASTE, FLAG_THRESHOLD, PLAGIARISM, Report

COLORS = {AI: "#d9c8f5", PLAGIARISM: "#f7c1c1", COPY_PASTE: "#fbe1a6"}

DISCLAIMER = ("These are rough, automated heuristics, not verdicts. AI detectors in particular are "
              "often wrong, especially on short passages and on writing by non-native English "
              "speakers. Use a flag as a reason to look closer and talk to the student, never as proof.")


def to_text(report: Report, doc_text: str) -> str:
    lines = [f"That's A Flag report: {report.document_name} ({report.word_count} words)", ""]
    verdict = "FLAGGED" if report.is_flagged else "Nothing above the 50% threshold"
    lines.append(f"Result: {verdict}")
    for s in report.summaries.values():
        lines.append(f"  {s.category:<13} highest {s.max_confidence:4.0%}   "
                     f"{s.flagged_count} flagged passage(s), {s.flagged_share:.0%} of words")
    lines.append("")
    for f in report.flags:
        excerpt = " ".join(doc_text[f.start:f.end].split())
        if len(excerpt) > 160:
            excerpt = excerpt[:157] + "..."
        src = f" [source: {f.source}]" if f.source else ""
        lines.append(f"- {f.category} {f.confidence:.0%}{src}: {f.reason}")
        lines.append(f'    "{excerpt}"')
    lines += ["", *report.notes, "", DISCLAIMER]
    return "\n".join(lines)


def to_html(report: Report, doc_text: str) -> str:
    flags = sorted(report.flags, key=lambda f: f.start)
    # Paint each character with the highest-confidence flag covering it.
    owner: list[int | None] = [None] * len(doc_text)
    for i, f in sorted(enumerate(flags), key=lambda x: x[1].confidence):
        for c in range(f.start, min(f.end, len(doc_text))):
            owner[c] = i
    body, i = [], 0
    while i < len(doc_text):
        j = i
        while j < len(doc_text) and owner[j] == owner[i]:
            j += 1
        chunk = html.escape(doc_text[i:j]).replace("\n", "<br>")
        if owner[i] is None:
            body.append(chunk)
        else:
            f = flags[owner[i]]
            tip = html.escape(f"{f.category} {f.confidence:.0%}: {f.reason}"
                              + (f" (source: {f.source})" if f.source else ""))
            body.append(f'<mark style="background:{COLORS[f.category]}" title="{tip}">{chunk}</mark>')
        i = j

    rows = "".join(
        f"<tr><td>{s.category}</td><td>{s.max_confidence:.0%}</td><td>{s.flagged_count}</td>"
        f"<td>{s.flagged_share:.0%}</td></tr>" for s in report.summaries.values())
    items = "".join(
        f'<li><b style="background:{COLORS[f.category]}">{f.category} {f.confidence:.0%}</b> '
        f'{html.escape(f.reason)}{" (source: " + html.escape(f.source) + ")" if f.source else ""}</li>'
        for f in flags)
    verdict = "FLAGGED" if report.is_flagged else f"Nothing above {FLAG_THRESHOLD:.0%}"
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>That's A Flag: {html.escape(report.document_name)}</title>
<style>body{{font-family:Georgia,serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.6}}
table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:.2rem .6rem;text-align:left}}
.note{{background:#f3f3f3;padding:.6rem 1rem;font-size:.9rem}}mark{{padding:0 .1rem}}</style></head><body>
<h1>{html.escape(report.document_name)}</h1>
<p><b>Result: {verdict}</b> ({report.word_count} words)</p>
<table><tr><th>Category</th><th>Highest confidence</th><th>Flagged passages</th><th>Share of words</th></tr>{rows}</table>
<p class="note">{html.escape(DISCLAIMER)}<br>{'<br>'.join(html.escape(n) for n in report.notes)}</p>
<h2>Flags</h2><ul>{items or '<li>None</li>'}</ul>
<h2>Paper</h2><div>{''.join(body)}</div></body></html>"""
