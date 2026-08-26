const RETIRED_EXTENSIONLESS_GUIDES = new Set([
  "/articles/best-overlanding-solar-and-power",
  "/articles/best-portable-power-stations-for-overlanding",
]);

export default function articleHtmlCanonical(request: Request, context: { next: () => Response | Promise<Response> }) {
  const url = new URL(request.url);

  // Let the explicit legacy-guide redirects produce their direct canonical hop.
  if (RETIRED_EXTENSIONLESS_GUIDES.has(url.pathname) || url.pathname.endsWith(".html")) {
    return context.next();
  }

  // This executes before Pretty URLs can serve the matching static asset. The
  // .html guard makes the canonical destination terminal and prevents loops.
  url.pathname = `${url.pathname}.html`;
  return Response.redirect(url.toString(), 301);
}

export const config = { path: "/articles/*" };
