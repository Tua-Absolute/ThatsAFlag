/** Fetches search-result pages and reduces them to plain text for matching. */

const MAX_BYTES = 2_000_000;

/** Refuse anything that isn't a public http(s) host (no localhost, private IPs). */
export function isPublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.includes(":")) return !/^(::1?$|f[cd]|fe80)/.test(h); // IPv6 loopback / private
  return true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export async function fetchPageText(url: string, timeoutMs = 8000): Promise<string | null> {
  if (!isPublicUrl(url)) return null;
  try {
    // Follow redirects by hand so every hop is checked against isPublicUrl.
    let res: Response | null = null;
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(current, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 (compatible; ThatsAFlag/0.1; plagiarism check)", accept: "text/html,text/plain;q=0.9" },
      });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!next) break;
      current = new URL(next, current).toString();
      if (!isPublicUrl(current)) return null;
    }
    if (!res || !res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks));
    return type.includes("text/plain") ? body : htmlToText(body);
  } catch {
    return null;
  }
}
