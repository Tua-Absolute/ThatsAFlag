"""Result types shared by all the checks."""
from __future__ import annotations

from dataclasses import dataclass, field

AI = "AI-generated"
PLAGIARISM = "Plagiarism"
COPY_PASTE = "Copy-paste"
CATEGORIES = (AI, PLAGIARISM, COPY_PASTE)

FLAG_THRESHOLD = 0.50  # a passage is flagged when confidence is MORE than this


@dataclass
class Finding:
    category: str
    start: int
    end: int
    confidence: float  # 0..1
    reason: str
    source: str | None = None  # matching reference file, for plagiarism

    @property
    def flagged(self) -> bool:
        return self.confidence > FLAG_THRESHOLD


@dataclass
class CategorySummary:
    category: str
    max_confidence: float
    flagged_share: float  # fraction of the paper's words inside a flagged passage
    flagged_count: int


@dataclass
class Report:
    document_name: str
    word_count: int
    findings: list[Finding]  # every finding, flagged or not
    summaries: dict[str, CategorySummary]
    notes: list[str] = field(default_factory=list)

    @property
    def flags(self) -> list[Finding]:
        return [f for f in self.findings if f.flagged]

    @property
    def is_flagged(self) -> bool:
        return bool(self.flags)
