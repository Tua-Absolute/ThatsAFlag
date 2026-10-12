import type { SVGProps } from "react";
import { AI, COPY_PASTE, PLAGIARISM, type Category } from "@/lib/types";

/** CSS class suffix per category (`c-ai`, `mark.ai`, ...). */
export const CLS: Record<Category, string> = { [AI]: "ai", [PLAGIARISM]: "plag", [COPY_PASTE]: "cp" };
export const COLOR: Record<Category, string> = { [AI]: "var(--ai)", [PLAGIARISM]: "var(--plag)", [COPY_PASTE]: "var(--cp)" };
export const BLURB: Record<Category, string> = {
  [AI]: "Reads like a language model wrote it",
  [PLAGIARISM]: "Matches a web page or reference file",
  [COPY_PASTE]: "Carries traces of being pasted in",
};
export const pct = (x: number) => `${Math.round(x * 100)}%`;

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({ width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });

export const FlagIcon = (p: P) => <svg {...base(p)}><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" fill="currentColor" fillOpacity=".25" /></svg>;
export const UploadIcon = (p: P) => <svg {...base(p)}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" /></svg>;
export const DocIcon = (p: P) => <svg {...base(p)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>;
export const TextIcon = (p: P) => <svg {...base(p)}><path d="M4 6h16M4 12h16M4 18h10" /></svg>;
export const XIcon = (p: P) => <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const SparkIcon = (p: P) => <svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>;
export const GlobeIcon = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
export const AlertIcon = (p: P) => <svg {...base(p)}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></svg>;
export const CheckIcon = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>;
export const InfoIcon = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
export const ChevronIcon = (p: P) => <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>;
export const PrintIcon = (p: P) => <svg {...base(p)}><path d="M7 9V3h10v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 14h10v7H7z" /></svg>;
export const LockIcon = (p: P) => <svg {...base(p)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const ExternalIcon = (p: P) => <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>;
export const RefreshIcon = (p: P) => <svg {...base(p)}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>;

export function Ring({ value, color, size = 58 }: { value: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="gauge-ring" style={{ width: size, height: size }} title="Highest confidence in this category">
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-2)" strokeWidth="7" fill="none" />
        {value > 0.005 && (
          <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="7" fill="none" strokeLinecap="round"
            strokeDasharray={`${c * Math.min(1, value)} ${c}`} style={{ transition: "stroke-dasharray .6s ease" }} />
        )}
      </svg>
      <b>{pct(value)}</b>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  );
}
