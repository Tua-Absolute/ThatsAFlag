"""Rough AI-writing likelihood per paragraph.

Two signals, both local and free:

1. Style heuristics (always on): how uniform the sentence lengths are
   ("burstiness"), how often stock AI phrases show up, word length, and the
   absence of contractions / first person.
2. Language-model perplexity (optional): a small GPT-2 model scores how
   predictable the text is. AI text tends to be very predictable (low
   perplexity). Needs `torch` and `transformers`; the model downloads once
   from Hugging Face and then runs offline.

Neither signal is reliable on its own. Treat scores as "worth a closer look",
never as proof.
"""
from __future__ import annotations

import math
import re
import statistics

from . import document as d
from .report import AI, Finding

MIN_WORDS = 40  # shorter paragraphs are scored together with their neighbours
# Perplexity at which the language model alone would say 50/50. Uncalibrated
# guess for distilgpt2: lower it if honest papers get flagged, raise it if
# AI text slips through.
PPL_MIDPOINT = 40.0

# Phrases that show up far more in chatbot output than in student writing.
AI_MARKERS = [
    "delve", "delves", "delving", "tapestry", "testament to", "multifaceted",
    "it is important to note", "it's important to note", "it is worth noting",
    "plays a crucial role", "plays a pivotal role", "plays a vital role",
    "a crucial role", "pivotal", "underscores", "underscore the",
    "in today's fast-paced", "in today's world", "in the realm of",
    "navigating the complexities", "navigate the complexities", "ever-evolving",
    "fostering", "foster a", "nuanced", "intricate", "intricacies",
    "furthermore", "moreover", "additionally", "in conclusion", "overall,",
    "landscape", "holistic", "seamless", "seamlessly", "robust", "leverage",
    "leveraging", "paramount", "myriad", "a wide range of", "shed light on",
    "sheds light on", "serves as a", "stands as a", "not only", "embark",
    "harness", "harnessing", "transformative", "in summary", "ultimately,",
    "valuable insights", "key role", "rich history", "dynamic", "realm",
]
_MARKER_RES = [re.compile(r"\b" + re.escape(m).replace(r"\ ", r"\s+")) for m in AI_MARKERS]
_CONTRACTION = re.compile(r"\b\w+['’](?:t|s|re|ve|ll|d|m)\b", re.I)
_FIRST_PERSON = re.compile(r"\b(?:I|me|my|mine|we|our|us)\b")


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def style_score(text: str) -> tuple[float, list[str]]:
    span = d.Span(0, len(text), text)
    ws = d.words(span)
    n = len(ws)
    reasons = []
    sent_lens = [len(d.words(s)) for s in d.sentences(span)]
    sent_lens = [x for x in sent_lens if x > 0]

    burst = 0.0
    if len(sent_lens) >= 3:
        cv = statistics.pstdev(sent_lens) / statistics.mean(sent_lens)
        burst = _clamp((0.55 - cv) / 0.35)
        if burst > 0.5:
            reasons.append(f"very even sentence lengths (variation {cv:.2f})")

    low = text.lower()
    hits = sorted({AI_MARKERS[i] for i, r in enumerate(_MARKER_RES) if r.search(low)})
    count = sum(len(r.findall(low)) for r in _MARKER_RES)
    marker = _clamp((count / max(n, 1) * 100) / 2.0)
    if hits:
        reasons.append("stock AI phrasing: " + ", ".join(f'"{h}"' for h in hits[:5]))

    avg_len = sum(len(w.text) for w in ws) / max(n, 1)
    wordy = _clamp((avg_len - 4.6) / 1.0)
    if wordy > 0.5:
        reasons.append(f"long average word length ({avg_len:.1f} letters)")

    casual = 0.0 if (_CONTRACTION.search(text) or _FIRST_PERSON.search(text)) else 1.0

    score = 0.10 + 0.32 * burst + 0.38 * marker + 0.12 * wordy + 0.10 * casual
    return _clamp(score), reasons


class PerplexityModel:
    """Small causal LM used to measure how predictable text is."""

    def __init__(self, name: str = "distilbert/distilgpt2"):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.torch = torch
        self.name = name
        self.tok = AutoTokenizer.from_pretrained(name)
        self.model = AutoModelForCausalLM.from_pretrained(name)
        self.model.eval()

    def perplexity(self, text: str) -> float:
        torch = self.torch
        ids = self.tok(text, return_tensors="pt").input_ids[:, :512]
        if ids.shape[1] < 2:
            return float("nan")
        with torch.no_grad():
            loss = self.model(ids, labels=ids).loss
        return math.exp(loss.item())

    @staticmethod
    def to_probability(ppl: float) -> float:
        # Lower perplexity means more predictable text, which is more AI-like.
        if math.isnan(ppl):
            return 0.5
        return 1 / (1 + math.exp(3.0 * (math.log(ppl) - math.log(PPL_MIDPOINT))))


def load_model(name: str = "distilbert/distilgpt2") -> tuple[PerplexityModel | None, str]:
    """Try to load the optional model. Returns (model or None, status text)."""
    try:
        return PerplexityModel(name), f"language model '{name}' loaded"
    except ImportError:
        return None, "style heuristics only (install torch + transformers for the language-model check)"
    except Exception as e:  # no network on first run, corrupt cache, ...
        return None, f"style heuristics only (could not load '{name}': {type(e).__name__})"


def _passages(doc: d.Document) -> list[d.Span]:
    """Body paragraphs, with short ones merged into the next so every passage
    has enough words to score."""
    out: list[d.Span] = []
    pending: d.Span | None = None
    for p in doc.paragraphs:
        if p.is_heading:
            continue
        cur = p if pending is None else d.Span(pending.start, p.end, doc.text[pending.start:p.end])
        if len(d.words(cur)) >= MIN_WORDS:
            out.append(cur)
            pending = None
        else:
            pending = cur
    if pending is not None:
        if out and len(d.words(pending)) < MIN_WORDS:
            last = out.pop()
            pending = d.Span(last.start, pending.end, doc.text[last.start:pending.end])
        out.append(pending)
    return out


def analyze(doc: d.Document, model: PerplexityModel | None = None) -> list[Finding]:
    findings = []
    for span in _passages(doc):
        if len(d.words(span)) < 15:
            continue
        style, reasons = style_score(span.text)
        if model is not None:
            ppl = model.perplexity(span.text)
            lm = model.to_probability(ppl)
            conf = 0.65 * lm + 0.35 * style
            reasons = [f"low perplexity ({ppl:.0f})" if lm > 0.5 else f"perplexity {ppl:.0f}"] + reasons
        else:
            conf = min(style, 0.9)  # heuristics alone never justify near-certainty
        reason = "; ".join(reasons) if reasons else "no strong AI signals"
        findings.append(Finding(AI, span.start, span.end, round(conf, 3), reason))
    return findings
