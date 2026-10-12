"""Run with: python -m unittest discover tests"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import flagger  # noqa: E402
from flagger import AI, COPY_PASTE, PLAGIARISM  # noqa: E402
from samples import make_samples  # noqa: E402


class SampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        make_samples.build_mixed(ROOT / "samples" / "mixed_paper.docx")
        cls.mixed = flagger.load(ROOT / "samples" / "mixed_paper.docx")
        cls.mixed_report = flagger.analyze(cls.mixed)

    def flagged_text(self, category):
        return [self.mixed.text[f.start:f.end] for f in self.mixed_report.flags if f.category == category]

    def test_ai_paragraph_flagged(self):
        hits = self.flagged_text(AI)
        self.assertTrue(any(t.startswith("Furthermore") for t in hits))
        self.assertFalse(any(t.startswith("I picked") for t in hits))

    def test_verbatim_copy_flagged_with_source(self):
        f = next(f for f in self.mixed_report.flags
                 if f.category == PLAGIARISM and self.mixed.text[f.start:].startswith("During the previous"))
        self.assertEqual(f.source, "dust_bowl_encyclopedia.txt")
        self.assertGreater(f.confidence, 0.9)

    def test_paraphrase_flagged(self):
        self.assertTrue(any(t.startswith("Many of these migrants") for t in self.flagged_text(PLAGIARISM)))

    def test_web_paste_flagged(self):
        hits = self.flagged_text(COPY_PASTE)
        self.assertEqual(len(hits), 1)
        self.assertIn("Black Sunday", hits[0])

    def test_honest_paper_not_flagged(self):
        report = flagger.analyze(flagger.load(ROOT / "samples" / "honest_paper.txt"))
        self.assertFalse(report.is_flagged, [(f.category, f.reason) for f in report.flags])

    def test_quoted_source_is_discounted(self):
        text = ('As the book says, "the exposed soil turned to dust and blew away in enormous clouds '
                'that sometimes blackened the sky for days" (Encyclopedia).')
        report = flagger.analyze(flagger.from_text(text))
        plag = [f for f in report.findings if f.category == PLAGIARISM]
        self.assertTrue(plag)
        self.assertTrue(all(not f.flagged for f in plag))

    def test_threshold_is_strictly_above_half(self):
        self.assertFalse(flagger.Finding(AI, 0, 1, 0.50, "").flagged)
        self.assertTrue(flagger.Finding(AI, 0, 1, 0.51, "").flagged)

    def test_html_export(self):
        from flagger import export
        out = export.to_html(self.mixed_report, self.mixed.text)
        self.assertIn("<mark", out)
        self.assertIn("FLAGGED", out)


if __name__ == "__main__":
    unittest.main()
