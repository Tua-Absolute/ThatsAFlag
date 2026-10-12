"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AI, COPY_PASTE, FLAG_THRESHOLD, PLAGIARISM, isFlagged, type Category, type Finding, type Report } from "@/lib/types";

const CLS: Record<Category, string> = { [AI]: "ai", [PLAGIARISM]: "plag", [COPY_PASTE]: "cp" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Config { hasApiKey: boolean; needsPassword: boolean; model: string }

export default function Home() {
  const [config, setConfig] = useState<Config | null>(null);
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<File[]>([]);
  const [useLlm, setUseLlm] = useState(true);
  const [useWeb, setUseWeb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => {});
    try { setPassword(sessionStorage.getItem("taf-pw") ?? ""); } catch {}
  }, []);

  async function run() {
    setBusy(true);
    setError("");
    setReport(null);
    setActive(null);
    const form = new FormData();
    if (file) form.append("file", file);
    else form.append("text", text);
    refs.forEach((r) => form.append("refs", r));
    form.append("useLlm", String(useLlm));
    form.append("useWebSearch", String(useWeb));
    try {
      try { sessionStorage.setItem("taf-pw", password); } catch {}
      const res = await fetch("/api/analyze", { method: "POST", body: form, headers: { "x-app-password": password } });
      const body = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      setReport(body as Report);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const flags = useMemo(() => (report ? report.findings.filter(isFlagged) : []), [report]);
  const canRun = !busy && (file || text.trim()) && (!config?.needsPassword || password);

  return (
    <main>
      <h1>That&apos;s A Flag</h1>
      <p className="sub">
        Checks a student paper for passages that look AI-generated, plagiarized, or copy-pasted, and flags anything above {pct(FLAG_THRESHOLD)} confidence.
        These are signals worth a closer look, never proof on their own.
      </p>

      <section className="panel no-print">
        <div className="input-grid">
          <div>
            <label className="title">Upload a paper</label>
            <div
              className={`drop ${over ? "over" : ""}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            >
              {file ? <><strong>{file.name}</strong><span>Click to choose a different file</span></> : <><strong>Drop a .docx or .txt file here</strong><span>or click to browse. A .docx gives the most copy-paste evidence.</span></>}
              <input ref={fileInput} type="file" accept=".docx,.txt,.md" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            {file && <button className="secondary" style={{ marginTop: 8 }} onClick={() => setFile(null)}>Remove file</button>}
          </div>
          <div>
            <label className="title" htmlFor="paste">…or paste the text</label>
            <textarea id="paste" value={text} disabled={!!file} placeholder={file ? "Using the uploaded file" : "Paste the paper here"} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        <div className="options">
          <label><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} /> Use Claude for the AI check</label>
          <label><input type="checkbox" checked={useWeb} onChange={(e) => setUseWeb(e.target.checked)} /> Search the web for plagiarism</label>
          <label>Reference files (optional): <input type="file" multiple accept=".docx,.txt,.md" onChange={(e) => setRefs([...(e.target.files ?? [])])} /></label>
          {config?.needsPassword && <label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
          <button onClick={run} disabled={!canRun}>{busy ? "Analyzing…" : "Analyze"}</button>
        </div>
        {busy && useWeb && <p className="notice">Searching the web and downloading matching pages can take a minute or two.</p>}
        {config && !config.hasApiKey && <p className="notice">No Claude API key is configured on the server, so only the offline checks will run.</p>}
        {config?.hasApiKey && <p className="notice">Model: {config.model}. The paper&apos;s text is sent to Anthropic&apos;s API for the AI check and web search.</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {report && <Results report={report} flags={flags} active={active} setActive={setActive} />}
    </main>
  );
}

function Results({ report, flags, active, setActive }: { report: Report; flags: Finding[]; active: number | null; setActive: (i: number | null) => void }) {
  const docFlags = flags.filter((f) => f.end === 0);
  const spanFlags = flags.filter((f) => f.end > 0);
  const segments = useMemo(() => paint(report.text, spanFlags), [report.text, spanFlags]);
  const sel = active !== null ? flags[active] : null;

  const choose = (f: Finding) => {
    const i = flags.indexOf(f);
    setActive(i);
    if (f.end > 0) document.getElementById(`flag-${spanFlags.indexOf(f)}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <>
      <div className="summary">
        <div className="verdict" style={{ color: flags.length ? "var(--plag-ink)" : "var(--ok)" }}>
          {flags.length ? `FLAGGED (${flags.length} item${flags.length === 1 ? "" : "s"})` : `Nothing above ${pct(FLAG_THRESHOLD)}`}
        </div>
        {[AI, PLAGIARISM, COPY_PASTE].map((c) => {
          const s = report.summaries[c as Category];
          return (
            <div key={c} className={`card ${CLS[c as Category]}`}>
              <b>{c}</b>
              highest {pct(s.maxConfidence)}<br />
              {s.flaggedCount} flagged · {pct(s.flaggedShare)} of words
            </div>
          );
        })}
        <button className="secondary no-print" onClick={() => window.print()} style={{ alignSelf: "center" }}>Print / save PDF</button>
      </div>

      <div className="results">
        <div className="panel paper">
          {segments.map((s, i) =>
            s.flag === null ? <span key={i}>{s.text}</span> : (
              <mark
                key={i}
                id={s.first ? `flag-${s.flag}` : undefined}
                className={`${CLS[spanFlags[s.flag].category]} ${sel === spanFlags[s.flag] ? "active" : ""}`}
                title={`${spanFlags[s.flag].category} ${pct(spanFlags[s.flag].confidence)}`}
                onClick={() => choose(spanFlags[s.flag!])}
              >{s.text}</mark>
            ),
          )}
        </div>

        <div className="side">
          <div className="panel">
            <h2>Flagged ({flags.length})</h2>
            {flags.length ? (
              <ul className="flags">
                {flags.map((f, i) => (
                  <li key={i} className={active === i ? "active" : ""} onClick={() => choose(f)}>
                    <span className={`tag ${CLS[f.category]}`}>{f.category} {pct(f.confidence)}</span>
                    {f.end === 0 ? "Whole file" : ""}
                    <span className="excerpt">{f.end === 0 ? f.reason.slice(0, 110) : excerpt(report.text, f)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="small">No passage went above {pct(FLAG_THRESHOLD)}.</p>}
          </div>

          {sel && (
            <div className="panel details">
              <h2><span className={`tag ${CLS[sel.category]}`}>{sel.category} {pct(sel.confidence)}</span></h2>
              <p><b>Why:</b> {sel.reason}</p>
              {sel.source && (
                <p><b>Source:</b> {/^https?:/.test(sel.source) ? <a href={sel.source} target="_blank" rel="noreferrer noopener">{sel.sourceTitle || sel.source}</a> : sel.source}</p>
              )}
            </div>
          )}

          {report.metadata.length > 0 && (
            <div className="panel">
              <h2>File metadata</h2>
              <dl className="meta">
                {report.metadata.map((m) => <FragmentPair key={m.label} k={m.label} v={m.value} />)}
              </dl>
              {docFlags.length === 0 && <p className="small">No whole-file copy-paste signals.</p>}
            </div>
          )}

          {report.sourcesChecked.length > 0 && (
            <div className="panel">
              <h2>Web pages compared ({report.sourcesChecked.filter((s) => s.fetched).length})</h2>
              <ol className="sources">
                {report.sourcesChecked.map((s) => (
                  <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>{s.fetched ? "" : " (couldn't download)"}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="panel small">
            {report.notes.map((n, i) => <p key={i} style={{ margin: "4px 0" }}>{n}</p>)}
            <p style={{ margin: "4px 0" }}>AI detection is unreliable on its own, especially for short passages, very formal writing, and non-native English writers. Talk with the student before drawing conclusions.</p>
          </div>
        </div>
      </div>
    </>
  );
}

function FragmentPair({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

function excerpt(text: string, f: Finding) {
  const s = text.slice(f.start, f.end).replace(/\s+/g, " ").trim();
  return s.length > 110 ? s.slice(0, 107) + "…" : s;
}

/** Splits the paper into runs owned by the highest-confidence flag covering them. */
function paint(text: string, flags: Finding[]) {
  const owner = new Int32Array(text.length).fill(-1);
  [...flags.keys()].sort((a, b) => flags[a].confidence - flags[b].confidence).forEach((i) => {
    for (let c = flags[i].start; c < Math.min(flags[i].end, text.length); c++) owner[c] = i;
  });
  const out: { text: string; flag: number | null; first: boolean }[] = [];
  const seen = new Set<number>();
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && owner[j] === owner[i]) j++;
    const f = owner[i] === -1 ? null : owner[i];
    out.push({ text: text.slice(i, j), flag: f, first: f !== null && !seen.has(f) });
    if (f !== null) seen.add(f);
    i = j;
  }
  return out;
}
