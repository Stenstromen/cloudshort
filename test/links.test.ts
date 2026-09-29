import { reset } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, it } from "vitest";

const ORIGIN = "https://cloudshort.test";

interface ShortLink {
  code: string;
  shortUrl: string;
  url: string;
  createdAt: string;
}

interface LinkList {
  count: number;
  links: ShortLink[];
}

interface DeletedLink {
  deleted: boolean;
  code: string;
  url: string;
}

beforeEach(async () => {
  await reset();
});

it("adds a shortened url", async ({ expect }) => {
  const response = await addLink("https://example.com/hello");

  expect(response.status).toBe(201);
  const body = await readJson<ShortLink>(response);
  expect(body.code).toMatch(/^[a-z0-9]{2}$/);
  expect(body.url).toBe("https://example.com/hello");
  expect(body.shortUrl).toBe(`${ORIGIN}/${body.code}`);
  expect(body.createdAt).toEqual(expect.any(String));
  expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
});

it("lists shortened urls", async ({ expect }) => {
  await addLink("https://example.com/one");
  await addLink("https://example.com/two");

  const response = await exports.default.fetch(authedPath("/list"));

  expect(response.status).toBe(200);
  const body = await readJson<LinkList>(response);
  expect(body.count).toBe(2);
  expect(body.links.map((link) => link.url).sort()).toEqual([
    "https://example.com/one",
    "https://example.com/two",
  ]);
  for (const link of body.links) {
    expect(link.code).toMatch(/^[a-z0-9]{2}$/);
    expect(link.shortUrl).toBe(`${ORIGIN}/${link.code}`);
    expect(Number.isNaN(Date.parse(link.createdAt))).toBe(false);
  }
});

it("fetches a shortened url", async ({ expect }) => {
  const created = await readJson<ShortLink>(await addLink("https://example.com/target"));

  const response = await exports.default.fetch(`${ORIGIN}/${created.code}`, {
    redirect: "manual",
  });

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://example.com/target");
});

it("deletes a shortened url", async ({ expect }) => {
  const created = await readJson<ShortLink>(await addLink("https://example.com/gone"));

  const response = await exports.default.fetch(authedPath("/delete", { code: created.code }));

  expect(response.status).toBe(200);
  expect(await readJson<DeletedLink>(response)).toEqual({
    deleted: true,
    code: created.code,
    url: "https://example.com/gone",
  });

  const missing = await exports.default.fetch(`${ORIGIN}/${created.code}`, {
    redirect: "manual",
  });
  expect(missing.status).toBe(404);

  const list = await exports.default.fetch(authedPath("/list"));
  expect(await readJson<LinkList>(list)).toEqual({ count: 0, links: [] });
});

function authedPath(path: string, params: Record<string, string> = {}): string {
  const url = new URL(path, ORIGIN);
  url.searchParams.set("key", env.AUTH_KEY);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

function addLink(target: string): Promise<Response> {
  return exports.default.fetch(authedPath("/add", { url: target }));
}

function readJson<T>(response: Response): Promise<T> {
  return response.json();
}
