"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORIES, FLAG_THRESHOLD, type Report } from "@/lib/types";
import Results from "./results";
import {
  AlertIcon, COLOR, DocIcon, FlagIcon, GlobeIcon, InfoIcon, LockIcon, SparkIcon, Switch, TextIcon, UploadIcon, XIcon, pct,
} from "./ui";

interface Config { hasApiKey: boolean; needsPassword: boolean; model: string }
type Mode = "upload" | "paste";

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function Home() {
  const [config, setConfig] = useState<Config | null>(null);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<File[]>([]);
  const [useLlm, setUseLlm] = useState(true);
  const [useWeb, setUseWeb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => {});
    try { setPassword(sessionStorage.getItem("taf-pw") ?? ""); } catch {}
  }, []);

  const hasInput = mode === "upload" ? !!file : !!text.trim();
  const canRun = !busy && hasInput && (!config?.needsPassword || !!password);

  async function run() {
    setBusy(true);
    setError("");
    setReport(null);
    const form = new FormData();
    if (mode === "upload" && file) form.append("file", file);
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
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    "Reading the paper and its file details",
    useLlm && config?.hasApiKey ? "Claude is reading each passage" : "Scoring writing style",
    useWeb && config?.hasApiKey ? "Searching the web and comparing pages" : null,
    "Checking for copy-paste traces",
  ].filter(Boolean) as string[];

  return (
    <div className="shell">
      <header className="topbar no-print">
        <div className="brand"><span className="logo"><FlagIcon width={19} height={19} /></span>That&apos;s A Flag</div>
        {config && (
          <span className="pill" title={config.hasApiKey ? "Claude is connected" : "No API key on the server"}>
            <span className="dot" style={{ background: config.hasApiKey ? "var(--ok)" : "var(--text-3)" }} />
            {config.hasApiKey ? `Claude · ${config.model.replace(/^claude-/, "")}` : "Offline checks only"}
          </span>
        )}
      </header>

      <section className="hero">
        <h1>Find the passages that <span>don&apos;t belong.</span></h1>
        <p>
          Drop in a student paper. Anything that looks AI-written, lifted from a source, or pasted in from elsewhere is
          highlighted and explained once the confidence passes {pct(FLAG_THRESHOLD)}.
        </p>
        <div className="legend">
          {CATEGORIES.map((c) => (
            <span key={c} className="pill"><span className="dot" style={{ background: COLOR[c] }} />{c}</span>
          ))}
        </div>
      </section>

      <section className="card card-pad composer no-print" aria-label="Paper to check">
        <div className="row-end">
          <div className="segmented" role="group" aria-label="How to add the paper">
            <button aria-pressed={mode === "upload"} onClick={() => setMode("upload")}><UploadIcon width={16} height={16} />Upload file</button>
            <button aria-pressed={mode === "paste"} onClick={() => setMode("paste")}><TextIcon width={16} height={16} />Paste text</button>
          </div>
          <span className="hint"><InfoIcon width={16} height={16} />A .docx gives the most copy-paste evidence.</span>
        </div>

        {mode === "upload" ? (
          file ? (
            <div className="file-chip">
              <span className="doc-icon"><DocIcon /></span>
              <div><b>{file.name}</b><small>{kb(file.size)} · ready to analyze</small></div>
              <button className="icon-btn" aria-label="Remove file" onClick={() => setFile(null)}><XIcon /></button>
            </div>
          ) : (
            <div
              className={`dropzone ${over ? "over" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            >
              <div>
                <div className="icon-bubble"><UploadIcon width={24} height={24} /></div>
                <strong>Drop a paper here</strong>
                <span>or click to browse · .docx, .txt or .md up to 10 MB</span>
              </div>
            </div>
          )
        ) : (
          <textarea className="paste" value={text} placeholder="Paste the paper's text here…" aria-label="Paper text" onChange={(e) => setText(e.target.value)} />
        )}
        <input ref={fileInput} type="file" accept=".docx,.txt,.md" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />

        <div className="options">
          <label className="option">
            <SparkIcon style={{ color: "var(--ai)" }} />
            <div><b>Claude AI check</b><small>Claude reads every passage</small></div>
            <Switch checked={useLlm} onChange={setUseLlm} label="Claude AI check" />
          </label>
          <label className="option">
            <GlobeIcon style={{ color: "var(--plag)" }} />
            <div><b>Web plagiarism search</b><small>Searches and compares live pages</small></div>
            <Switch checked={useWeb} onChange={setUseWeb} label="Web plagiarism search" />
          </label>
        </div>

        <div className="row-end">
          <div style={{ display: "grid", gap: 8 }}>
            <button className="ghost-btn" onClick={() => refInput.current?.click()}><DocIcon width={16} height={16} />Add reference files</button>
            <input ref={refInput} type="file" multiple accept=".docx,.txt,.md" hidden onChange={(e) => { setRefs([...refs, ...(e.target.files ?? [])]); e.target.value = ""; }} />
            {refs.length > 0 && (
              <div className="ref-list">
                {refs.map((r, i) => (
                  <span key={i} className="pill">{r.name}
                    <button className="icon-btn" style={{ padding: 0 }} aria-label={`Remove ${r.name}`} onClick={() => setRefs(refs.filter((_, j) => j !== i))}><XIcon width={13} height={13} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            {config?.needsPassword && (
              <label className="field"><span style={{ display: "flex", gap: 6, alignItems: "center" }}><LockIcon width={14} height={14} />Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canRun && run()} />
              </label>
            )}
            <button className="primary-btn" onClick={run} disabled={!canRun}>
              {busy ? <><span className="spinner light" />Analyzing…</> : <><FlagIcon width={18} height={18} />Analyze paper</>}
            </button>
          </div>
        </div>

        {config && !config.hasApiKey && <p className="hint"><InfoIcon width={16} height={16} />No Claude API key is set on the server, so only the offline checks will run.</p>}
        {config?.hasApiKey && (useLlm || useWeb) && <p className="hint"><InfoIcon width={16} height={16} />The paper&apos;s text is sent to Anthropic&apos;s API, and short phrases from it go into web searches.</p>}
        {error && <div className="error-box" role="alert"><AlertIcon />{error}</div>}
      </section>

      {busy && (
        <section className="card card-pad loading" aria-live="polite">
          <div className="scan-doc" aria-hidden>
            {["", "", "h-ai", "h-ai", "", "h-pl", "", "", "h-cp", "", "", ""].map((c, i) => <i key={i} className={c} style={{ width: `${70 + ((i * 37) % 30)}%` }} />)}
          </div>
          <div>
            <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Analyzing the paper</h2>
            <ul className="steps">{steps.map((s) => <li key={s}><span className="spinner" />{s}</li>)}</ul>
            {useWeb && config?.hasApiKey && <p className="hint" style={{ marginTop: 14 }}>Web search usually takes one to two minutes.</p>}
          </div>
        </section>
      )}

      <div ref={resultsRef} style={{ scrollMarginTop: 12 }}>
        {report && <Results report={report} />}
      </div>

      <p className="footer no-print">
        Every flag is a reason to look closer, not proof. AI detection in particular is unreliable on short passages, very
        formal writing and non-native English. Talk with the student before drawing conclusions.
      </p>
    </div>
  );
}
