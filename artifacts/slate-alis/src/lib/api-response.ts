// A JSON API can still answer with something that is not JSON. When the
// platform, a proxy or a crash produces the response — a 500 error page, a
// maintenance page, or the SPA's own index.html fallback — the body is HTML.
// Feeding that to JSON.parse throws "Unexpected token '<'", which is both
// alarming and useless to the person reading it. Parse defensively so the
// caller can fall back to a readable message and the status code.
export function parseJsonBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
