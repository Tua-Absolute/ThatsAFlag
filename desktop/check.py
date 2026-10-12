"""Command-line version: python check.py paper.docx [--refs folder] [--html report.html] [--no-model]"""
import argparse
import sys
from pathlib import Path

import flagger
from flagger import ai_detector, export


def main() -> int:
    ap = argparse.ArgumentParser(description="Flag AI-written, plagiarized or copy-pasted passages in a paper.")
    ap.add_argument("paper", help=".txt, .md or .docx file")
    ap.add_argument("--refs", default=str(flagger.DEFAULT_REFERENCE_DIR), help="folder of reference texts")
    ap.add_argument("--html", help="also save an HTML report here")
    ap.add_argument("--no-model", action="store_true", help="skip the language-model AI check")
    args = ap.parse_args()

    doc = flagger.load(args.paper)
    model = None
    if not args.no_model:
        model, status = ai_detector.load_model()
        print(f"AI check: {status}", file=sys.stderr)
    report = flagger.analyze(doc, args.refs, model)
    print(export.to_text(report, doc.text))
    if args.html:
        Path(args.html).write_text(export.to_html(report, doc.text), encoding="utf-8")
        print(f"\nHTML report saved to {args.html}")
    return 1 if report.is_flagged else 0


if __name__ == "__main__":
    sys.exit(main())
