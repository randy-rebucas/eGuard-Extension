/** A scripted fetch for tests: each handler answers one path; calls are recorded. */
export type Handler = (req: {
  body: unknown;
  headers: Record<string, string>;
}) => { status: number; json?: unknown } | "network-error";

export function fakeFetch(routes: Record<string, Handler | Handler[]>) {
  const calls: { path: string; body: unknown; headers: Record<string, string> }[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, body, headers });
    const route = queues.get(url.pathname);
    const handler = Array.isArray(route) ? route.shift() : route;
    if (!handler) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    const out = handler({ body, headers });
    if (out === "network-error") throw new TypeError("Failed to fetch");
    return new Response(out.json === undefined ? null : JSON.stringify(out.json), {
      status: out.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}
