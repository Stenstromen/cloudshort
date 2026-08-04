# cloudshort

A tiny URL shortener running on [Cloudflare Workers](https://developers.cloudflare.com/workers/) with **Workers KV** — Cloudflare's native, permanent key-value storage — as the backing store.

Short codes are two characters long, drawn from `a-z` and `0-9` (1,296 possible codes).

## Endpoints

| Method | Path                 | Description                                                       |
| ------ | -------------------- | ----------------------------------------------------------------- |
| `GET`  | `/add?key=&url=`     | Create a short code for `url`. Requires the auth `key`.           |
| `GET`  | `/list?key=`         | List every short URL and the date it was added. Requires `key`.   |
| `GET`  | `/delete?key=&code=` | Delete the short link for `code`. Requires the auth `key`.        |
| `GET`  | `/<code>`            | Redirect (302) to the original URL.                               |

The `key` parameter must match the `AUTH_KEY` configured for the Worker.

### Examples

```bash
# Add a URL
curl "https://your-worker.example.workers.dev/add?key=YOUR_KEY&url=https://example.com"
# -> { "code": "a7", "shortUrl": ".../a7", "url": "https://example.com", "createdAt": "..." }

# List all URLs
curl "https://your-worker.example.workers.dev/list?key=YOUR_KEY"

# Delete a short link
curl "https://your-worker.example.workers.dev/delete?key=YOUR_KEY&code=a7"
# -> { "deleted": true, "code": "a7", "url": "https://example.com" }

# Follow a short link
curl -IL "https://your-worker.example.workers.dev/a7"
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create the KV namespace and copy the returned `id` into `wrangler.toml`
   (replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`):

   ```bash
   npx wrangler kv namespace create LINKS
   ```

3. Set your auth secret for production:

   ```bash
   npx wrangler secret put AUTH_KEY
   ```

## Local development

```bash
npm run dev
```

`wrangler dev` uses a local, simulated KV namespace and the `AUTH_KEY` value from
`wrangler.toml` (`change-me-in-production` by default). Try:

```bash
curl "http://localhost:8787/add?key=change-me-in-production&url=https://example.com"
curl "http://localhost:8787/list?key=change-me-in-production"
```

## Deploy

```bash
npm run deploy
```

## Use with PrivateBin

This worker is compatible with PrivateBin's optional client-side
[`urlshortener`](https://github.com/PrivateBin/PrivateBin/blob/master/cfg/conf.sample.php)
setting. PrivateBin calls the shortener from the browser as
`GET <urlshortener><url-encoded paste link>`, reads the response body, and
picks the shortest `http(s)` URL it finds as the new link.

Configure it in PrivateBin's `conf.php` so the encoded paste URL lands in the
`url` parameter, with your auth key baked into the prefix:

```ini
urlshortener = "https://your-worker.example.workers.dev/add?key=YOUR_KEY&url="
```

Why it works:

- The worker returns `Access-Control-Allow-Origin: *`, so PrivateBin's
  cross-origin `fetch` can read the JSON response.
- The response contains the (short) `shortUrl` and the (long) original paste
  URL; PrivateBin's "shortest URL wins" rule always selects the short one.
- The redirect preserves the URL fragment (`#...`), so PrivateBin's decryption
  key survives the round-trip.

Security caveats (inherent to this PrivateBin feature):

- The paste URL **includes the decryption key** in its fragment. Storing it
  here means anyone with the `/list` auth key can read every paste's key, and
  PrivateBin itself warns that client-side shorteners leak the key. Only use
  this with a shortener you trust/self-host.
- The auth `key` is embedded in PrivateBin's client-side config and is visible
  in browser requests. Treat it as low-secrecy; it only gates who can create
  and list short links.

## Notes

- With only two characters there are 1,296 possible codes; `/add` retries on
  collisions and returns `503` if it can't find a free code.
- Records are stored in KV as `{ "url": string, "createdAt": ISO-8601 string }`.
