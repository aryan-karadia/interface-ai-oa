import { join } from "path";

const PORT = Number(process.env.PORT || 3000);
const HTML_PATH = join(import.meta.dir, "index.html");

export function startLegacyPortalServer(port = PORT) {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/" || url.pathname === "/portal" || url.pathname === "/portal/search") {
        const file = Bun.file(HTML_PATH);
        return new Response(file, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`LegacyCore Portal running at http://localhost:${server.port}/portal/search`);
  return server;
}

if (import.meta.main) {
  startLegacyPortalServer();
}
