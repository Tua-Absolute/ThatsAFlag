export const AI = "AI-generated";
export const PLAGIARISM = "Plagiarism";
export const COPY_PASTE = "Copy-paste";
export const CATEGORIES = [AI, PLAGIARISM, COPY_PASTE] as const;
export type Category = (typeof CATEGORIES)[number];

/** A passage is flagged when confidence is MORE than this. */
export const FLAG_THRESHOLD = 0.5;

export interface Finding {
  category: Category;
  /** Character offsets into Report.text. Both 0 for whole-document findings. */
  start: number;
  end: number;
  confidence: number; // 0..1
  reason: string;
  /** Where the text was found, for plagiarism: a URL or reference file name. */
  source?: string;
  sourceTitle?: string;
}

export interface CategorySummary {
  category: Category;
  maxConfidence: number;
  flaggedCount: number;
  /** Share of the paper's words inside a flagged passage. */
  flaggedShare: number;
}

export interface MetadataItem {
  label: string;
  value: string;
}

export interface Report {
  documentName: string;
  text: string;
  wordCount: number;
  findings: Finding[];
  summaries: Record<Category, CategorySummary>;
  /** Facts read from the .docx package (author, edit time, revisions, ...). */
  metadata: MetadataItem[];
  notes: string[];
  /** Pages the web search found and compared against. */
  sourcesChecked: { url: string; title?: string; fetched: boolean }[];
}

export const isFlagged = (f: Finding) => f.confidence > FLAG_THRESHOLD;
