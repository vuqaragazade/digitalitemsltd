// Frontend Worker for digitalitems.store
// Proxies /sitemap.xml and /robots.txt to the backend API (so they live on the
// main domain and auto-update), and serves everything else from static assets.

const BACKEND = 'https://digitalitems-api.agazade-vuqar-1996.workers.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy SEO files to the backend's dynamic generators
    if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') {
      const backendRes = await fetch(BACKEND + url.pathname, {
        headers: { 'Accept': url.pathname.endsWith('.xml') ? 'application/xml' : 'text/plain' }
      });
      // Re-serve with correct content type so it appears on digitalitems.store
      const body = await backendRes.text();
      const contentType = url.pathname.endsWith('.xml')
        ? 'application/xml; charset=utf-8'
        : 'text/plain; charset=utf-8';
      return new Response(body, {
        status: backendRes.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // Everything else: serve from static assets (SPA)
    return env.ASSETS.fetch(request);
  }
};
