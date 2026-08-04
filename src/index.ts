export interface Env {
  /** Cloudflare Workers KV namespace holding code -> link mappings. */
  LINKS: KVNamespace;
  /** Shared secret required to call /add and /list. */
  AUTH_KEY: string;
}

/** Value stored in KV for each short code. */
interface LinkRecord {
  url: string;
  createdAt: string;
}

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 2;
/** How many times to retry generating a non-colliding code before giving up. */
const MAX_CODE_ATTEMPTS = 20;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === "/add") {
      return handleAdd(url, env);
    }

    if (path === "/list") {
      return handleList(url, env);
    }

    if (path === "/delete") {
      return handleDelete(url, env);
    }

    if (path === "/" || path === "") {
      return text("cloudshort — a tiny URL shortener on Cloudflare Workers.\n");
    }

    return handleRedirect(path, env);
  },
} satisfies ExportedHandler<Env>;

async function handleAdd(url: URL, env: Env): Promise<Response> {
  const unauthorized = requireAuth(url, env);
  if (unauthorized) return unauthorized;

  const target = url.searchParams.get("url");
  if (!target) {
    return text("Missing required 'url' parameter.\n", 400);
  }

  const normalized = normalizeUrl(target);
  if (!normalized) {
    return text("The 'url' parameter must be a valid http(s) URL.\n", 400);
  }

  const code = await generateUniqueCode(env);
  if (!code) {
    return text("Unable to allocate a short code; the namespace may be full.\n", 503);
  }

  const record: LinkRecord = {
    url: normalized,
    createdAt: new Date().toISOString(),
  };
  await env.LINKS.put(code, JSON.stringify(record));

  const shortUrl = `${url.origin}/${code}`;
  return json({ code, shortUrl, url: record.url, createdAt: record.createdAt }, 201);
}

async function handleList(url: URL, env: Env): Promise<Response> {
  const unauthorized = requireAuth(url, env);
  if (unauthorized) return unauthorized;

  const links: Array<{ code: string; url: string; createdAt: string; shortUrl: string }> = [];

  let cursor: string | undefined;
  do {
    const page = await env.LINKS.list({ cursor });
    for (const key of page.keys) {
      const raw = await env.LINKS.get(key.name);
      if (!raw) continue;
      const record = JSON.parse(raw) as LinkRecord;
      links.push({
        code: key.name,
        url: record.url,
        createdAt: record.createdAt,
        shortUrl: `${url.origin}/${key.name}`,
      });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  links.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return json({ count: links.length, links });
}

async function handleDelete(url: URL, env: Env): Promise<Response> {
  const unauthorized = requireAuth(url, env);
  if (unauthorized) return unauthorized;

  const code = url.searchParams.get("code");
  if (!code) {
    return text("Missing required 'code' parameter.\n", 400);
  }

  const raw = await env.LINKS.get(code);
  if (raw === null) {
    return text(`No short link found for code '${code}'.\n`, 404);
  }

  await env.LINKS.delete(code);

  const record = JSON.parse(raw) as LinkRecord;
  return json({ deleted: true, code, url: record.url });
}

async function handleRedirect(path: string, env: Env): Promise<Response> {
  const code = path.slice(1);
  const raw = await env.LINKS.get(code);
  if (!raw) {
    return text("Not found.\n", 404);
  }

  const record = JSON.parse(raw) as LinkRecord;
  return Response.redirect(record.url, 302);
}

/** Returns a 401 Response when the request's key doesn't match AUTH_KEY, else null. */
function requireAuth(url: URL, env: Env): Response | null {
  const key = url.searchParams.get("key");
  if (!key || key !== env.AUTH_KEY) {
    return text("Unauthorized: a valid 'key' parameter is required.\n", 401);
  }
  return null;
}

/** Generates a random 2-character code that isn't already used in KV. */
async function generateUniqueCode(env: Env): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = randomCode();
    const existing = await env.LINKS.get(code);
    if (existing === null) {
      return code;
    }
  }
  return null;
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Validates and normalizes a user-supplied URL. Schemeless input such as
 * "google.se" is assumed to be https. Returns the canonical URL string, or
 * null if it can't be parsed as an http(s) URL.
 */
function normalizeUrl(value: string): string | null {
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)
    ? value
    : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname.includes(".")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * CORS headers so browser-side callers (e.g. PrivateBin's client-side URL
 * shortener) can read the response cross-origin. Credentials are never used,
 * so a wildcard origin is safe.
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS_HEADERS },
  });
}
