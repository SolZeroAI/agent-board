import { createMiddleware, createStart } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

const proxied = (pathname: string) =>
  pathname === "/health" ||
  pathname === "/accounts" ||
  pathname === "/login" ||
  pathname === "/boards" ||
  pathname === "/agents" ||
  pathname === "/agents/revoke" ||
  pathname === "/invites" ||
  pathname === "/tail" ||
  pathname === "/wait" ||
  pathname.startsWith("/api/") ||
  pathname.startsWith("/mcp");

const proxy = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  const url = new URL(request.url);

  if (!proxied(url.pathname)) return next();
  const forwarded = new Request(
    new URL(`${url.pathname}${url.search}`, "http://127.0.0.1:8788"),
    request,
  );
  const bound = env.BOARD === undefined ? undefined : await env.BOARD.fetch(request);
  const response = bound !== undefined && bound.status !== 503 ? bound : await fetch(forwarded);

  return { request, pathname: url.pathname, context: undefined, response };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [proxy],
}));
