// Strips secrets from everything Faro sends to Grafana Cloud (page URLs, resource timings,
// fetch span attributes, error messages). Auth flows carry tokens in query strings and
// fragments (verify-email, reset links, session-bridge #access_token=…).

const SECRET_PATH_SEGMENTS: Array<[RegExp, string]> = [[/(\/webhooks\/mpesa\/)[^/?#\s"']+/g, '$1:token']];

const SECRET_QUERY_PARAM =
  /([?&#](?:token|access_token|refresh_token|id_token|token_hash|code|email|phone|nonce|key|state|signature|password)=)[^&#\s"']+/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER = /(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

function maskPaths(value: string): string {
  return SECRET_PATH_SEGMENTS.reduce((s, [pattern, replacement]) => s.replace(pattern, replacement), value);
}

/** A URL or path loses its query string and fragment; free text only loses the secret parts. */
export function scrubString(value: string): string {
  if (/^(?:https?:)?\/\//i.test(value) || value.startsWith('/')) {
    return maskPaths(value.replace(/[?#].*$/, ''));
  }
  return maskPaths(value)
    .replace(SECRET_QUERY_PARAM, '$1<redacted>')
    .replace(JWT, '<redacted-jwt>')
    .replace(BEARER, '$1<redacted>');
}

/** Returns a deep copy of `value` with every string scrubbed. */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrubString(value) as T;
  if (Array.isArray(value)) return value.map(scrubDeep) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v);
    return out as T;
  }
  return value;
}
