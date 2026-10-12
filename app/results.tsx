"use client";

import { useMemo, useState } from "react";
import { CATEGORIES, FLAG_THRESHOLD, isFlagged, type Category, type Finding, type Report } from "@/lib/types";
import { AlertIcon, BLURB, CLS, COLOR, CheckIcon, ChevronIcon, ExternalIcon, InfoIcon, PrintIcon, Ring, pct } from "./ui";

const domain = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export default function Results({ report }: { report: Report }) {
  const flags = useMemo(() => report.findings.filter(isFlagged), [report]);
  const spanFlags = useMemo(() => flags.filter((f) => f.end > 0), [flags]);
  const [shown, setShown] = useState<Record<Category, boolean>>(() => Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>);
  const [active, setActive] = useState<Finding | null>(null);
  const visible = useMemo(() => spanFlags.filter((f) => shown[f.category]), [spanFlags, shown]);
  const segments = useMemo(() => paint(report.text, visible), [report.text, visible]);
  const fetched = report.sourcesChecked.filter((s) => s.fetched).length;

  const choose = (f: Finding) => {
    setActive((cur) => (cur === f ? null : f));
    if (f.end > 0) {
      if (!shown[f.category]) setShown({ ...shown, [f.category]: true });
      requestAnimationFrame(() => document.getElementById(`f-${spanFlags.indexOf(f)}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  };

  return (
    <section aria-label="Results">
      <div className="results-head">
        <div className="verdict">
          <span className={`verdict-icon ${flags.length ? "flagged" : "clean"}`}>{flags.length ? <AlertIcon width={26} height={26} /> : <CheckIcon width={26} height={26} />}</span>
          <div>
            <h2>{flags.length ? `${flags.length} item${flags.length === 1 ? "" : "s"} flagged` : "Nothing flagged"}</h2>
            <p>{report.documentName} · {report.wordCount.toLocaleString()} words{flags.length ? "" : ` · nothing above ${pct(FLAG_THRESHOLD)}`}</p>
          </div>
        </div>
        <div className="gauges">
          {CATEGORIES.map((c) => {
            const s = report.summaries[c];
            return (
              <div key={c} className={`card gauge c-${CLS[c]}`}>
                <Ring value={s.maxConfidence} color={COLOR[c]} />
                <div>
                  <div className="gauge-label"><span className="dot" style={{ background: COLOR[c] }} />{c}</div>
                  <small>{s.flaggedCount ? `${s.flaggedCount} flagged · ${pct(s.flaggedShare)} of words` : "Nothing flagged"}</small>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="workspace">
        <article className="card paper-card">
          <div className="paper-toolbar no-print">
            <div className="filters" role="group" aria-label="Show highlights">
              {CATEGORIES.map((c) => (
                <button key={c} className="filter" aria-pressed={shown[c]} onClick={() => setShown({ ...shown, [c]: !shown[c] })} title={BLURB[c]}>
                  <span className="dot" style={{ background: COLOR[c] }} />{c}<span className="count">{spanFlags.filter((f) => f.category === c).length}</span>
                </button>
              ))}
            </div>
            <button className="ghost-btn" onClick={() => window.print()}><PrintIcon width={16} height={16} />Print / PDF</button>
          </div>
          <div className="paper">
            {segments.map((s, i) => {
              if (s.flag === null) return <span key={i}>{s.text}</span>;
              const f = visible[s.flag];
              return (
                <mark key={i} id={s.first ? `f-${spanFlags.indexOf(f)}` : undefined} className={`${CLS[f.category]} ${active === f ? "active" : ""}`}
                  title={`${f.category} · ${pct(f.confidence)}`} onClick={() => choose(f)}>{s.text}</mark>
              );
            })}
          </div>
        </article>

        <aside className="sidebar">
          <div className="card card-pad">
            <h3 className="card-title">Flagged passages <span>{flags.length}</span></h3>
            {flags.length ? (
              <ul className="flag-list">
                {flags.map((f, i) => {
                  const open = active === f;
                  return (
                    <li key={i} className={`flag-item c-${CLS[f.category]}`} aria-expanded={open} tabIndex={0}
                      onClick={() => choose(f)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), choose(f))}>
                      <div className="flag-top"><span className="tag">{f.category}</span>{f.end === 0 && <span style={{ color: "var(--text-2)" }}>Whole file</span>}<span className="pct">{pct(f.confidence)}</span></div>
                      <div className="bar"><i style={{ width: pct(f.confidence) }} /></div>
                      {!open && <span className="flag-excerpt">{f.end === 0 ? f.reason.replace(/^Whole file: /, "") : excerpt(report.text, f)}</span>}
                      {open && (
                        <div className="flag-detail" onClick={(e) => e.stopPropagation()}>
                          <span className="label">Why</span>
                          <ul className="reasons">{splitReasons(f.reason).map((r, j) => <li key={j}>{r}</li>)}</ul>
                          {f.source && (
                            <>
                              <span className="label">Source</span>
                              {/^https?:/.test(f.source)
                                ? <a className="source-link" href={f.source} target="_blank" rel="noreferrer noopener">{f.sourceTitle || domain(f.source)}<ExternalIcon width={14} height={14} /></a>
                                : <span>{f.source}</span>}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="empty"><CheckIcon width={18} height={18} style={{ color: "var(--ok)" }} />No passage went above {pct(FLAG_THRESHOLD)}.</p>}
          </div>

          {report.metadata.length > 0 && (
            <details className="card" open>
              <summary>File details<ChevronIcon className="chev" width={16} height={16} /></summary>
              <div className="body">
                <dl className="meta">{report.metadata.map((m) => <Pair key={m.label} k={m.label} v={m.value} />)}</dl>
              </div>
            </details>
          )}

          {report.sourcesChecked.length > 0 && (
            <details className="card">
              <summary>Web pages compared · {fetched}<ChevronIcon className="chev" width={16} height={16} /></summary>
              <div className="body">
                <ul className="sources">
                  {report.sourcesChecked.map((s) => (
                    <li key={s.url}>
                      <span className={`fav ${s.fetched ? "" : "missing"}`}>{domain(s.url)[0]}</span>
                      <span><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || domain(s.url)}</a>
                        <span className="domain">{domain(s.url)}{s.fetched ? "" : " · couldn't download"}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}

          <div className="card card-pad notes">
            <h3 className="card-title" style={{ marginBottom: 4 }}>How this ran</h3>
            {report.notes.map((n, i) => <p key={i}><InfoIcon width={15} height={15} style={{ flex: "none", marginTop: 2 }} />{n}</p>)}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

function excerpt(text: string, f: Finding) {
  return text.slice(f.start, f.end).replace(/\s+/g, " ").trim();
}

function splitReasons(reason: string) {
  return reason.replace(/^Whole file: /, "").split(/;\s+(?![^“”]*”)/).map((r) => r.trim()).filter(Boolean)
    .map((r) => r[0].toUpperCase() + r.slice(1));
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
