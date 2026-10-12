"""That's A Flag: rough, local checks for AI-written, plagiarized and copy-pasted text."""
from .document import Document, from_text, load
from .engine import DEFAULT_REFERENCE_DIR, analyze
from .report import AI, CATEGORIES, COPY_PASTE, FLAG_THRESHOLD, PLAGIARISM, Finding, Report

__all__ = ["Document", "from_text", "load", "analyze", "DEFAULT_REFERENCE_DIR", "AI", "PLAGIARISM",
           "COPY_PASTE", "CATEGORIES", "FLAG_THRESHOLD", "Finding", "Report"]
