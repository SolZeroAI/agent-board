declare module "cloudflare:workers" {
  export const env: { BOARD?: { fetch: (request: Request) => Promise<Response> } };
}
