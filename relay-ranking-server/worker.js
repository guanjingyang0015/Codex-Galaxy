const ORIGIN = "https://api.vx314490015.cn";
const ALLOWED_PATHS = new Set(["/", "/health", "/api/v1/rankings", "/api/v1/audits"]);

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Content-Type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    if (!ALLOWED_PATHS.has(incoming.pathname)) return json(404, { error: "not found" });
    if (!["GET", "POST", "OPTIONS"].includes(request.method)) return json(405, { error: "method not allowed" });
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "Content-Type",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        },
      });
    }

    const length = Number(request.headers.get("content-length") || 0);
    if (length > 65536) return json(413, { error: "request too large" });

    const target = new URL(incoming.pathname + incoming.search, ORIGIN);
    const headers = new Headers(request.headers);
    for (const name of ["host", "cf-connecting-ip", "cf-ray", "x-forwarded-for"]) headers.delete(name);
    headers.set("accept", "application/json");

    try {
      const response = await fetch(target, {
        method: request.method,
        headers,
        body: request.method === "POST" ? request.body : undefined,
        redirect: "manual",
      });
      const outgoing = new Headers(response.headers);
      outgoing.set("cache-control", "no-store");
      outgoing.set("access-control-allow-origin", "*");
      outgoing.set("access-control-allow-headers", "Content-Type");
      outgoing.set("access-control-allow-methods", "GET,POST,OPTIONS");
      outgoing.set("x-content-type-options", "nosniff");
      return new Response(response.body, { status: response.status, headers: outgoing });
    } catch {
      return json(502, { error: "ranking origin unavailable" });
    }
  },
};
