// Frontend Worker for digitalitems.store
// - Proxies /sitemap.xml and /robots.txt to the backend API (dynamic, main domain)
// - For blog post pages, injects an LCP image preload + SEO meta into the HTML
//   so the browser starts loading the hero image immediately (fixes slow LCP)
// - Serves everything else from static assets (SPA)

const BACKEND = 'https://digitalitems-api.agazade-vuqar-1996.workers.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy SEO files to the backend's dynamic generators
    if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') {
      const backendRes = await fetch(BACKEND + url.pathname, {
        headers: { 'Accept': url.pathname.endsWith('.xml') ? 'application/xml' : 'text/plain' }
      });
      const body = await backendRes.text();
      const contentType = url.pathname.endsWith('.xml')
        ? 'application/xml; charset=utf-8'
        : 'text/plain; charset=utf-8';
      return new Response(body, {
        status: backendRes.status,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' }
      });
    }

    // Blog post pages: inject LCP image preload + SEO meta server-side
    if (url.pathname.startsWith('/blog/')) {
      const slug = url.pathname.replace('/blog/', '').replace(/\/$/, '');
      if (slug) {
        try {
          // Fetch the static HTML shell and the blog data in parallel
          const [assetRes, blogRes] = await Promise.all([
            env.ASSETS.fetch(new Request(url.origin + '/index.html', request)),
            fetch(BACKEND + '/blog?slug=' + encodeURIComponent(slug))
          ]);
          let html = await assetRes.text();
          const data = await blogRes.json();
          const blog = data && data.blog;
          if (blog) {
            const img = blog.image
              ? (blog.image.startsWith('http') ? blog.image : BACKEND + blog.image)
              : '';
            const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            let inject = '';
            // Preload the LCP hero image so the browser fetches it right away
            if (img) {
              inject += `<link rel="preload" as="image" href="${esc(img)}" fetchpriority="high" />`;
            }
            // SEO meta + Open Graph (helps social shares and crawlers)
            if (blog.title) inject += `<meta property="og:title" content="${esc(blog.metaTitle || blog.title)}" />`;
            if (blog.metaDescription || blog.excerpt) inject += `<meta property="og:description" content="${esc(blog.metaDescription || blog.excerpt)}" />`;
            if (img) inject += `<meta property="og:image" content="${esc(img)}" />`;
            inject += `<meta property="og:type" content="article" />`;
            inject += `<link rel="canonical" href="https://digitalitems.store/blog/${esc(slug)}" />`;
            // Insert right after <head> so preload is discovered as early as possible
            html = html.replace('<head>', '<head>' + inject);

            return new Response(html, {
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=300'
              }
            });
          }
          // No blog found — serve the shell unchanged
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        } catch (e) {
          // On any error, fall back to normal static serving
          return env.ASSETS.fetch(request);
        }
      }
    }

    // Everything else: serve from static assets (SPA)
    return env.ASSETS.fetch(request);
  }
};
