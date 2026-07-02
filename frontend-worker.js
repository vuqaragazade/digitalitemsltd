// Frontend Worker for digitalitems.store
// - Proxies /sitemap.xml and /robots.txt to the backend API
// - For blog post pages, injects an LCP image preload + SEO meta into the HTML
// - Serves everything else from static assets (SPA)

const BACKEND = 'https://digitalitems-api.agazade-vuqar-1996.workers.dev';

export default {
  async fetch(request, env) {
    // Safety: if the assets binding is missing (e.g. in preview), just proxy backend for SEO files
    const hasAssets = env && env.ASSETS && typeof env.ASSETS.fetch === 'function';

    const url = new URL(request.url);

    // Proxy SEO files to the backend's dynamic generators
    if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') {
      try {
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
      } catch (e) {
        return new Response('Temporarily unavailable', { status: 503 });
      }
    }

    // If no assets binding available, we can't serve static files — return early
    if (!hasAssets) {
      return new Response('Assets binding not available', { status: 500 });
    }

    // Blog post pages: inject LCP image preload + SEO meta server-side
    if (url.pathname.startsWith('/blog/')) {
      const slug = url.pathname.replace('/blog/', '').replace(/\/$/, '');
      if (slug) {
        try {
          const assetRes = await env.ASSETS.fetch(new Request('https://assets.local/index.html'));
          let html = await assetRes.text();

          let blog = null;
          try {
            const blogRes = await fetch(BACKEND + '/blog?slug=' + encodeURIComponent(slug));
            const data = await blogRes.json();
            blog = data && data.blog;
          } catch (e) { blog = null; }

          if (blog) {
            const img = blog.image
              ? (blog.image.startsWith('http') ? blog.image : BACKEND + blog.image)
              : '';
            const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

            // Head injections: preload + SEO/OG meta
            let inject = '';
            if (img) inject += `<link rel="preload" as="image" href="${esc(img)}" fetchpriority="high" />`;
            if (blog.title) inject += `<meta property="og:title" content="${esc(blog.metaTitle || blog.title)}" />`;
            if (blog.metaDescription || blog.excerpt) inject += `<meta property="og:description" content="${esc(blog.metaDescription || blog.excerpt)}" />`;
            if (img) inject += `<meta property="og:image" content="${esc(img)}" />`;
            inject += `<meta property="og:type" content="article" />`;
            if (blog.metaTitle || blog.title) inject += `<title>${esc(blog.metaTitle || blog.title)}</title>`;
            html = html.replace('<head>', '<head>' + inject);
            // Replace the static canonical with the blog-specific one (avoid duplicates)
            html = html.replace(
              '<link rel="canonical" href="https://digitalitems.store/" />',
              `<link rel="canonical" href="https://digitalitems.store/blog/${esc(slug)}" />`
            );

            // Body injection: pre-render the blog content into the container so the
            // browser paints text + image immediately (fixes LCP and content-shift CLS).
            const dateStr = blog.date ? new Date(blog.date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '';
            const cat = blog.category ? `<span style="font-size:12px;color:var(--accent1);text-transform:uppercase;letter-spacing:0.5px">${esc(blog.category)}</span>` : '';
            const imgTag = img ? `<img src="${esc(img)}" width="720" height="480" fetchpriority="high" decoding="async" style="width:100%;height:auto;aspect-ratio:3/2;object-fit:cover;border-radius:12px;margin-bottom:24px;background:var(--bg3)" alt="${esc(blog.title)}" />` : '';
            const hashtags = (blog.hashtags||[]).length
              ? `<div style="margin-top:28px;padding-top:20px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap">${blog.hashtags.map(h=>`<span style="font-size:13px;color:var(--accent1)">${esc(h)}</span>`).join('')}</div>`
              : '';
            const views = blog.views || 0;
            const prerendered =
              `${cat}` +
              `<h1 style="margin:10px 0">${esc(blog.title)}</h1>` +
              `<div style="font-size:13px;color:var(--muted);margin-bottom:20px">${esc(dateStr)} · 👁 <span id="blog-view-count">${views}</span> views</div>` +
              `${imgTag}` +
              `<div class="blog-body" style="line-height:1.7;font-size:16px">${blog.content||''}</div>` +
              `${hashtags}`;

            // Insert into the blogpost container and mark the page active so it shows without JS.
            html = html.replace(
              '<div id="blogpost-content" style="margin-top:16px;min-height:80vh"></div>',
              '<div id="blogpost-content" style="margin-top:16px;min-height:80vh">' + prerendered + '</div>'
            );
            // Make the blogpost page visible immediately (before JS runs)
            html = html.replace(
              '<div class="page" id="page-blogpost">',
              '<div class="page active" id="page-blogpost" data-prerendered="1">'
            );
            // Hide the home page so it doesn't flash (anti-flash already handles this, but be explicit)
            html = html.replace(
              '<div class="page active" id="page-home">',
              '<div class="page" id="page-home">'
            );

            return new Response(html, {
              headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
            });
          }
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        } catch (e) {
          // Fall back to normal static serving
          return env.ASSETS.fetch(request);
        }
      }
    }

    // Everything else: serve from static assets (SPA)
    return env.ASSETS.fetch(request);
  }
};
