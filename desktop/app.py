"""That's A Flag desktop app (Tkinter).

Run:  python app.py
"""
from __future__ import annotations

import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import flagger
from flagger import ai_detector, export, plagiarism
from flagger.report import AI, CATEGORIES, COPY_PASTE, FLAG_THRESHOLD, PLAGIARISM

COLORS = export.COLORS
CHIP = {AI: "#7a4fd1", PLAGIARISM: "#c62828", COPY_PASTE: "#c77700"}


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("That's A Flag")
        root.geometry("1200x780")
        root.minsize(900, 560)

        self.loaded_doc: flagger.Document | None = None
        self.report: flagger.Report | None = None
        self.report_text = ""
        self.ref_dir = tk.StringVar(value=str(flagger.DEFAULT_REFERENCE_DIR))
        self.use_model = tk.BooleanVar(value=False)
        self.status = tk.StringVar(value="Open a paper (.docx, .txt) or paste text on the left, then press Analyze.")
        self._model = None
        self._model_tried = False
        self._corpus_cache: tuple[str, plagiarism.ReferenceCorpus] | None = None

        self._build()

    # --- layout ---------------------------------------------------------
    def _build(self):
        bar = ttk.Frame(self.root, padding=(10, 8))
        bar.pack(fill="x")
        ttk.Button(bar, text="Open paper…", command=self.open_file).pack(side="left")
        ttk.Button(bar, text="Clear", command=self.clear).pack(side="left", padx=(6, 0))
        self.analyze_btn = ttk.Button(bar, text="Analyze", command=self.analyze)
        self.analyze_btn.pack(side="left", padx=(14, 0))
        ttk.Checkbutton(bar, text="Use language model for AI check (slower)",
                        variable=self.use_model).pack(side="left", padx=(14, 0))
        ttk.Button(bar, text="Save report…", command=self.save_report).pack(side="right")
        ttk.Button(bar, text="Reference folder…", command=self.pick_refs).pack(side="right", padx=(0, 6))

        ttk.Label(self.root, text="Rough heuristics, not verdicts. A flag is a reason to look closer, never proof. "
                  "Plagiarism can only be found against files in the reference folder.",
                  foreground="#666", padding=(10, 0)).pack(fill="x")

        summary = ttk.Frame(self.root, padding=(10, 8))
        summary.pack(fill="x")
        self.verdict = tk.Label(summary, text="Not analyzed yet", font=("TkDefaultFont", 14, "bold"),
                                anchor="w", width=26)
        self.verdict.pack(side="left")
        self.cards = {}
        for cat in CATEGORIES:
            f = tk.Frame(summary, bg=COLORS[cat], padx=10, pady=4)
            f.pack(side="left", padx=6)
            tk.Label(f, text=cat, bg=COLORS[cat], fg=CHIP[cat], font=("TkDefaultFont", 10, "bold")).pack(anchor="w")
            lbl = tk.Label(f, text="–", bg=COLORS[cat], justify="left")
            lbl.pack(anchor="w")
            self.cards[cat] = lbl

        panes = ttk.PanedWindow(self.root, orient="horizontal")
        panes.pack(fill="both", expand=True, padx=10, pady=(0, 4))

        left = ttk.Frame(panes)
        self.text = tk.Text(left, wrap="word", undo=True, font=("Georgia", 12), padx=12, pady=10,
                            spacing2=3, relief="flat", borderwidth=1)
        sb = ttk.Scrollbar(left, command=self.text.yview)
        self.text.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.text.pack(side="left", fill="both", expand=True)
        for cat in (AI, COPY_PASTE, PLAGIARISM):  # later tags draw on top
            self.text.tag_configure(cat, background=COLORS[cat])
        self.text.tag_configure("focus", underline=True, borderwidth=1, relief="solid")
        self.text.bind("<ButtonRelease-1>", self._on_text_click)
        panes.add(left, weight=3)

        right = ttk.Frame(panes)
        ttk.Label(right, text="Flagged passages (confidence above 50%)").pack(anchor="w")
        cols = ("category", "confidence", "excerpt")
        self.tree = ttk.Treeview(right, columns=cols, show="headings", selectmode="browse")
        for c, w in zip(cols, (110, 80, 260)):
            self.tree.heading(c, text=c.capitalize())
            self.tree.column(c, width=w, stretch=(c == "excerpt"))
        for cat in CATEGORIES:
            self.tree.tag_configure(cat, background=COLORS[cat])
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_select)
        ttk.Label(right, text="Details").pack(anchor="w", pady=(8, 0))
        self.details = tk.Text(right, height=9, wrap="word", state="disabled", relief="flat",
                               background="#f6f6f6", padx=8, pady=6)
        self.details.pack(fill="x")
        panes.add(right, weight=2)

        ttk.Label(self.root, textvariable=self.status, padding=(10, 4), foreground="#444").pack(fill="x")

    # --- actions --------------------------------------------------------
    def open_file(self):
        path = filedialog.askopenfilename(
            title="Open paper", filetypes=[("Papers", "*.docx *.txt *.md"), ("All files", "*.*")])
        if not path:
            return
        try:
            doc = flagger.load(path)
        except Exception as e:
            messagebox.showerror("Could not open file", f"{type(e).__name__}: {e}")
            return
        self.loaded_doc = doc
        self._clear_results()
        self.text.delete("1.0", "end")
        self.text.insert("1.0", doc.text)
        self.status.set(f"Loaded {doc.source_name}. Press Analyze.")

    def clear(self):
        self.loaded_doc = None
        self.text.delete("1.0", "end")
        self._clear_results()
        self.status.set("Cleared. Paste text or open a paper.")

    def pick_refs(self):
        folder = filedialog.askdirectory(title="Folder of reference texts (.txt, .md, .docx)",
                                         initialdir=self.ref_dir.get())
        if folder:
            self.ref_dir.set(folder)
            self._corpus_cache = None
            self.status.set(f"Reference folder: {folder}")

    def analyze(self):
        current = self.text.get("1.0", "end-1c")
        if not current.strip():
            self.status.set("Nothing to analyze yet.")
            return
        if self.loaded_doc is not None and self.loaded_doc.text == current:
            doc = self.loaded_doc  # unchanged file keeps its .docx formatting info
        else:
            doc = flagger.from_text(current, self.loaded_doc.source_name + " (edited)"
                                    if self.loaded_doc else "pasted text")
        self.analyze_btn.state(["disabled"])
        self.text.configure(state="disabled")  # no edits while the checks run
        self.status.set("Analyzing…")
        threading.Thread(target=self._run, args=(doc, self.use_model.get(), self.ref_dir.get()),
                         daemon=True).start()

    def _run(self, doc, want_model, ref_dir):
        try:
            model = None
            if want_model:
                if not self._model_tried:
                    self.root.after(0, self.status.set,
                                    "Loading language model (first time downloads ~350 MB)…")
                    self._model, msg = ai_detector.load_model()
                    self._model_tried = True
                    if self._model is None:
                        self.root.after(0, messagebox.showwarning, "Language model unavailable", msg)
                model = self._model
            if self._corpus_cache is None or self._corpus_cache[0] != ref_dir:
                self._corpus_cache = (ref_dir, plagiarism.ReferenceCorpus(ref_dir))
            report = flagger.analyze(doc, ref_dir, model, corpus=self._corpus_cache[1])
            self.root.after(0, self._show, doc, report)
        except Exception as e:
            self.root.after(0, messagebox.showerror, "Analysis failed", f"{type(e).__name__}: {e}")
        finally:
            self.root.after(0, self._done)

    def _done(self):
        self.analyze_btn.state(["!disabled"])
        self.text.configure(state="normal")

    def save_report(self):
        if self.report is None:
            self.status.set("Analyze a paper first.")
            return
        path = filedialog.asksaveasfilename(
            title="Save report", defaultextension=".html",
            initialfile=Path(self.report.document_name).stem + " - flags.html",
            filetypes=[("Web page", "*.html"), ("Plain text", "*.txt")])
        if not path:
            return
        out = (export.to_text if path.lower().endswith(".txt") else export.to_html)(self.report, self.report_text)
        Path(path).write_text(out, encoding="utf-8")
        self.status.set(f"Report saved to {path}")

    # --- results --------------------------------------------------------
    def _clear_results(self):
        self.report = None
        for tag in (*CATEGORIES, "focus"):
            self.text.tag_remove(tag, "1.0", "end")
        self.tree.delete(*self.tree.get_children())
        self._set_details("")
        self.verdict.configure(text="Not analyzed yet", fg="black")
        for lbl in self.cards.values():
            lbl.configure(text="–")

    def _show(self, doc, report):
        self._clear_results()
        self.report, self.report_text = report, doc.text
        for i, f in enumerate(report.flags):
            self.text.tag_add(f.category, self._idx(f.start), self._idx(f.end))
            excerpt = " ".join(doc.text[f.start:f.end].split())
            self.tree.insert("", "end", iid=str(i), tags=(f.category,),
                             values=(f.category, f"{f.confidence:.0%}", excerpt[:90]))
        for cat, s in report.summaries.items():
            self.cards[cat].configure(
                text=f"highest {s.max_confidence:.0%}\n{s.flagged_count} flagged · {s.flagged_share:.0%} of words")
        if report.is_flagged:
            self.verdict.configure(text=f"FLAGGED ({len(report.flags)} passage{'s' * (len(report.flags) != 1)})",
                                   fg="#c62828")
        else:
            self.verdict.configure(text=f"Nothing above {FLAG_THRESHOLD:.0%}", fg="#2e7d32")
        self.status.set(" ".join(report.notes))

    def _idx(self, offset: int) -> str:
        return f"1.0 + {offset} chars"

    def _on_select(self, _event=None):
        sel = self.tree.selection()
        if not sel or self.report is None:
            return
        f = self.report.flags[int(sel[0])]
        self.text.tag_remove("focus", "1.0", "end")
        self.text.tag_add("focus", self._idx(f.start), self._idx(f.end))
        self.text.see(self._idx(f.start))
        lines = [f"{f.category}: {f.confidence:.0%} confidence", "", f"Why: {f.reason}"]
        if f.source:
            lines.append(f"Matching reference file: {f.source}")
        lines += ["", "Passage:", " ".join(self.report_text[f.start:f.end].split())]
        self._set_details("\n".join(lines))

    def _on_text_click(self, _event=None):
        if self.report is None:
            return
        pos = len(self.text.get("1.0", "insert"))
        hits = [i for i, f in enumerate(self.report.flags) if f.start <= pos < f.end]
        if hits:
            best = max(hits, key=lambda i: self.report.flags[i].confidence)
            self.tree.selection_set(str(best))
            self.tree.see(str(best))

    def _set_details(self, s: str):
        self.details.configure(state="normal")
        self.details.delete("1.0", "end")
        self.details.insert("1.0", s)
        self.details.configure(state="disabled")


def main():
    root = tk.Tk()
    try:
        ttk.Style().theme_use("clam")
    except tk.TclError:
        pass
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
