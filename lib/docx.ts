/**
 * Reads a .docx package: the text with per-run formatting, plus the traces
 * Word leaves behind that can show text was pasted in or the file was
 * assembled quickly (editing time, revision count, paste styles, embedded
 * HTML chunks, revision-session ids).
 */
import JSZip from "jszip";
import { DOMParser, type Element as XElement } from "@xmldom/xmldom";
import { PARA_SEP, type FormatRun, type PaperDocument, type Paragraph } from "./text";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export interface DocxTraces {
  creator?: string;
  lastModifiedBy?: string;
  revision?: number;
  created?: string;
  modified?: string;
  application?: string;
  totalEditMinutes?: number;
  wordsFromApp?: number;
  template?: string;
  /** Number of distinct Word editing sessions recorded in settings.xml. */
  editSessions?: number;
  /** Styles used in the body that Word creates when pasting from the web. */
  pasteStyles: string[];
  /** w:altChunk count: embedded HTML/RTF chunks, typically from pasting. */
  altChunks: number;
  hasComments: boolean;
  hasTrackedChanges: boolean;
  customProperties: string[];
}

type Props = { font?: string; size?: number; color?: string; highlighted?: boolean; hidden?: boolean; lang?: string };

const kids = (el: XElement | null | undefined): XElement[] => {
  const out: XElement[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as unknown as XElement);
  return out;
};
const child = (el: XElement | null | undefined, local: string) =>
  kids(el).find((c) => c.localName === local && c.namespaceURI === W);
const wAttr = (el: XElement | undefined, name: string) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? undefined;

function readProps(rPr: XElement | undefined): Props {
  if (!rPr) return {};
  const p: Props = {};
  const fonts = child(rPr, "rFonts");
  if (fonts) {
    const f = wAttr(fonts, "ascii") || wAttr(fonts, "hAnsi");
    const theme = wAttr(fonts, "asciiTheme") || wAttr(fonts, "hAnsiTheme");
    p.font = f || (theme ? `theme:${theme}` : undefined);
  }
  const sz = wAttr(child(rPr, "sz"), "val");
  if (sz) p.size = Number(sz) / 2;
  const color = wAttr(child(rPr, "color"), "val");
  if (color) p.color = color;
  const hl = wAttr(child(rPr, "highlight"), "val");
  const shd = wAttr(child(rPr, "shd"), "fill");
  if ((hl && hl !== "none") || (shd && !/^(auto|FFFFFF)$/i.test(shd))) p.highlighted = true;
  const vanish = child(rPr, "vanish");
  if (vanish && wAttr(vanish, "val") !== "0" && wAttr(vanish, "val") !== "false") p.hidden = true;
  const lang = wAttr(child(rPr, "lang"), "val");
  if (lang) p.lang = lang;
  return p;
}

const merge = (...ps: Props[]): Props => Object.assign({}, ...ps.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))));

interface StyleInfo {
  name: string;
  basedOn?: string;
  props: Props;
}

function parseXml(s: string) {
  return new DOMParser().parseFromString(s, "text/xml");
}

async function readText(zip: JSZip, path: string) {
  const f = zip.file(path);
  return f ? f.async("string") : undefined;
}

function tagText(doc: ReturnType<typeof parseXml>, ns: string | null, local: string): string | undefined {
  const els = ns ? doc.getElementsByTagNameNS(ns, local) : doc.getElementsByTagName(local);
  const t = els.length ? els[0].textContent?.trim() : undefined;
  return t || undefined;
}

export async function loadDocx(data: ArrayBuffer | Uint8Array, name: string): Promise<PaperDocument> {
  const zip = await JSZip.loadAsync(data);
  const main = await readText(zip, "word/document.xml");
  if (!main) throw new Error("This .docx has no word/document.xml");
  const xml = parseXml(main);

  // --- styles -------------------------------------------------------------
  const styles = new Map<string, StyleInfo>();
  let defaults: Props = {};
  const stylesXml = await readText(zip, "word/styles.xml");
  if (stylesXml) {
    const sx = parseXml(stylesXml);
    const rPrDefault = sx.getElementsByTagNameNS(W, "rPrDefault")[0] as unknown as XElement | undefined;
    defaults = readProps(child(rPrDefault, "rPr"));
    const list = sx.getElementsByTagNameNS(W, "style");
    for (let i = 0; i < list.length; i++) {
      const s = list[i] as unknown as XElement;
      const id = wAttr(s, "styleId");
      if (!id) continue;
      styles.set(id, {
        name: wAttr(child(s, "name"), "val") ?? id,
        basedOn: wAttr(child(s, "basedOn"), "val"),
        props: readProps(child(s, "rPr")),
      });
    }
  }
  const styleProps = (id: string | undefined, depth = 0): Props => {
    const s = id ? styles.get(id) : undefined;
    if (!s || depth > 10) return {};
    return merge(styleProps(s.basedOn, depth + 1), s.props);
  };
  const defaultParaStyle = [...styles.entries()].find(([, s]) => s.name === "Normal")?.[0];

  // --- body ---------------------------------------------------------------
  const parts: string[] = [];
  const paragraphs: Paragraph[] = [];
  const runs: FormatRun[] = [];
  const usedStyles = new Set<string>();
  let pos = 0;
  let altChunks = 0;
  let tracked = false;

  const body = xml.getElementsByTagNameNS(W, "body")[0] as unknown as XElement;
  const paras: XElement[] = [];
  const walkBody = (el: XElement) => {
    for (const c of kids(el)) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === "p") paras.push(c);
      else if (c.localName === "altChunk") altChunks++;
      else walkBody(c); // tables, rows, cells, content controls
    }
  };
  walkBody(body);

  for (const p of paras) {
    const pPr = child(p, "pPr");
    const pStyleId = wAttr(child(pPr, "pStyle"), "val") ?? defaultParaStyle;
    const pStyle = pStyleId ? styles.get(pStyleId) : undefined;
    if (pStyle) usedStyles.add(pStyle.name);
    const paraProps = merge(defaults, styleProps(pStyleId));
    const pStart = pos;
    let fieldInstr = "";
    let fieldState: "none" | "instr" | "result" = "none";

    const walk = (el: XElement, inLink: boolean) => {
      for (const c of kids(el)) {
        if (c.namespaceURI !== W) continue;
        switch (c.localName) {
          case "r": {
            const rPr = child(c, "rPr");
            const rStyleId = wAttr(child(rPr, "rStyle"), "val");
            if (rStyleId && styles.has(rStyleId)) usedStyles.add(styles.get(rStyleId)!.name);
            const props = merge(paraProps, styleProps(rStyleId), readProps(rPr));
            let t = "";
            for (const x of kids(c)) {
              if (x.localName === "t") t += x.textContent ?? "";
              else if (x.localName === "tab") t += "\t";
              else if (x.localName === "br" || x.localName === "cr") t += "\n";
              else if (x.localName === "noBreakHyphen") t += "‑";
              else if (x.localName === "fldChar") {
                const kind = wAttr(x, "fldCharType");
                if (kind === "begin") { fieldState = "instr"; fieldInstr = ""; }
                else if (kind === "separate") fieldState = "result";
                else if (kind === "end") fieldState = "none";
              } else if (x.localName === "instrText") fieldInstr += x.textContent ?? "";
            }
            if (!t || fieldState === "instr") break;
            const link = inLink || (fieldState === "result" && /HYPERLINK/i.test(fieldInstr));
            runs.push({
              start: pos, end: pos + t.length, font: props.font, size: props.size, color: props.color,
              highlighted: !!props.highlighted, hyperlink: link, hidden: !!props.hidden, lang: props.lang,
              rsid: c.getAttributeNS(W, "rsidR") || c.getAttribute("w:rsidR") || undefined,
            });
            parts.push(t);
            pos += t.length;
            break;
          }
          case "hyperlink":
            walk(c, true);
            break;
          case "ins":
          case "moveTo":
            tracked = true;
            walk(c, inLink);
            break;
          case "del":
          case "moveFrom":
            tracked = true;
            break;
          case "pPr":
            break;
          default: // smartTag, sdt, sdtContent, fldSimple, customXml ...
            walk(c, inLink || (c.localName === "fldSimple" && /HYPERLINK/i.test(wAttr(c, "instr") ?? "")));
        }
      }
    };
    const firstPart = parts.length;
    walk(p, false);
    const paraText = parts.slice(firstPart).join("");
    if (paraText.trim()) paragraphs.push({ start: pStart, end: pos, text: paraText, style: pStyle?.name ?? "Normal" });
    parts.push(PARA_SEP);
    pos += PARA_SEP.length;
  }
  const fullText = parts.join("");

  // --- package metadata ---------------------------------------------------
  const traces: DocxTraces = {
    pasteStyles: [...usedStyles].filter(
      (s) => /\b(web|html)\b|normal \(web\)|^html|apple-|^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(s) && !/^heading/i.test(s),
    ),
    altChunks: altChunks + Object.keys(zip.files).filter((f) => /^word\/afchunk/i.test(f)).length,
    hasComments: !!zip.file("word/comments.xml"),
    hasTrackedChanges: tracked,
    customProperties: [],
  };
  const core = await readText(zip, "docProps/core.xml");
  if (core) {
    const cx = parseXml(core);
    traces.creator = tagText(cx, "http://purl.org/dc/elements/1.1/", "creator");
    const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
    traces.lastModifiedBy = tagText(cx, cp, "lastModifiedBy");
    const rev = tagText(cx, cp, "revision");
    if (rev && !Number.isNaN(Number(rev))) traces.revision = Number(rev);
    traces.created = tagText(cx, "http://purl.org/dc/terms/", "created");
    traces.modified = tagText(cx, "http://purl.org/dc/terms/", "modified");
  }
  const app = await readText(zip, "docProps/app.xml");
  if (app) {
    const ax = parseXml(app);
    const ep = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
    traces.application = [tagText(ax, ep, "Application"), tagText(ax, ep, "AppVersion")].filter(Boolean).join(" ") || undefined;
    const tt = tagText(ax, ep, "TotalTime");
    if (tt && !Number.isNaN(Number(tt))) traces.totalEditMinutes = Number(tt);
    const w = tagText(ax, ep, "Words");
    if (w && !Number.isNaN(Number(w))) traces.wordsFromApp = Number(w);
    traces.template = tagText(ax, ep, "Template");
  }
  const settings = await readText(zip, "word/settings.xml");
  if (settings) {
    const n = parseXml(settings).getElementsByTagNameNS(W, "rsid").length;
    if (n) traces.editSessions = n;
  }
  const custom = await readText(zip, "docProps/custom.xml");
  if (custom) {
    const props = parseXml(custom).getElementsByTagName("property");
    for (let i = 0; i < props.length; i++) {
      const nm = (props[i] as unknown as XElement).getAttribute("name");
      if (nm) traces.customProperties.push(nm);
    }
  }

  return { name, text: fullText, paragraphs, runs, docx: traces };
}
