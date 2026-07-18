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
            html = html.replace('<head>', '<head>' + inject);
            // Replace the static <title> instead of adding a duplicate one
            if (blog.metaTitle || blog.title) {
              html = html.replace(
                /<title>[^<]*<\/title>/,
                `<title>${esc(blog.metaTitle || blog.title)}</title>`
              );
            }
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
          // Blog post not found by slug — still fix the canonical to point at THIS URL
          // (never leave it defaulting to the homepage).
          {
            const esc2 = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            html = html.replace(
              '<link rel="canonical" href="https://digitalitems.store/" />',
              `<link rel="canonical" href="https://digitalitems.store/blog/${esc2(slug)}" />`
            );
          }
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        } catch (e) {
          // Fall back to normal static serving
          return env.ASSETS.fetch(request);
        }
      }
    }

    // Product pages: inject SEO meta (title/description/keywords/canonical/OG) server-side
    if (url.pathname.startsWith('/products/')) {
      const slug = url.pathname.replace('/products/', '').replace(/\/$/, '');
      if (slug) {
        try {
          const assetRes = await env.ASSETS.fetch(new Request('https://assets.local/index.html'));
          let html = await assetRes.text();

          let product = null;
          try {
            const prodRes = await fetch(BACKEND + '/products');
            const data = await prodRes.json();
            const products = (data && data.products) || [];
            // Match by stored slug first; fall back to a computed slug from the name
            // in case older backend data predates the slug field.
            const computeSlug = (s) => (s || '').toLowerCase().trim()
              .replace(/[\u2010-\u2015]/g, '-')
              .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            product = products.find(p => p.slug === slug) || products.find(p => computeSlug(p.name) === slug) || null;
          } catch (e) { product = null; }

          if (product) {
            const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            const title = product.metaTitle || ('Buy ' + product.name + ' – DigitalItems.Store');
            const desc = product.metaDesc || product.desc || ('Buy ' + product.name + ' at DigitalItems.Store');
            const img = product.image
              ? (product.image.startsWith('http') ? product.image : BACKEND + product.image)
              : '';

            let inject = `<meta property="og:title" content="${esc(title)}" />`;
            inject += `<meta property="og:description" content="${esc(desc)}" />`;
            inject += `<meta property="og:type" content="product" />`;
            if (img) inject += `<meta property="og:image" content="${esc(img)}" />`;
            html = html.replace('<head>', '<head>' + inject);
            // Replace the static <title> instead of adding a duplicate one
            html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);

            // Replace the static description/keywords meta with product-specific ones
            html = html.replace(
              /<meta name="description" content="[^"]*" \/>/,
              `<meta name="description" content="${esc(desc)}" />`
            );
            if (product.metaKeywords) {
              html = html.replace(
                /<meta name="keywords" content="[^"]*" \/>/,
                `<meta name="keywords" content="${esc(product.metaKeywords)}" />`
              );
            }
            // Replace the static canonical with the product-specific one
            html = html.replace(
              '<link rel="canonical" href="https://digitalitems.store/" />',
              `<link rel="canonical" href="https://digitalitems.store/products/${esc(slug)}" />`
            );

            return new Response(html, {
              headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
            });
          }
          // Product not matched by slug — still fix the canonical to point at THIS URL
          // (never leave it defaulting to the homepage, which causes Google to treat
          // distinct product pages as duplicates of "/").
          {
            const esc2 = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            html = html.replace(
              '<link rel="canonical" href="https://digitalitems.store/" />',
              `<link rel="canonical" href="https://digitalitems.store/products/${esc2(slug)}" />`
            );
          }
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        } catch (e) {
          return env.ASSETS.fetch(request);
        }
      }
    }

    // Category pages (Twitter/Reddit/Marketing/custom): inject SEO title/description
    // server-side so bots/crawlers (including Google Ads) see the correct meta in raw HTML.
    try {
      const catRes = await fetch(BACKEND + '/catalogs', { cf: { cacheTtl: 300, cacheEverything: true } });
      const catData = await catRes.json();
      const catalogs = Array.isArray(catData.catalogs) ? catData.catalogs : [];
      const catalog = catalogs.find(c => c.url === url.pathname);
      if (catalog && (catalog.seoTitle || catalog.seoDesc)) {
        const assetRes = await env.ASSETS.fetch(new Request('https://assets.local/index.html'));
        let html = await assetRes.text();
        const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        if (catalog.seoTitle) {
          html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(catalog.seoTitle)}</title>`);
          html = html.replace(
            /<meta property="og:title" content="[^"]*" \/>/,
            `<meta property="og:title" content="${esc(catalog.seoTitle)}" />`
          );
        }
        if (catalog.seoDesc) {
          html = html.replace(
            /<meta name="description" content="[^"]*" \/>/,
            `<meta name="description" content="${esc(catalog.seoDesc)}" />`
          );
          html = html.replace(
            /<meta property="og:description" content="[^"]*" \/>/,
            `<meta property="og:description" content="${esc(catalog.seoDesc)}" />`
          );
        }
        if (catalog.seoKeywords) {
          html = html.replace(
            /<meta name="keywords" content="[^"]*" \/>/,
            `<meta name="keywords" content="${esc(catalog.seoKeywords)}" />`
          );
        }
        html = html.replace(
          '<link rel="canonical" href="https://digitalitems.store/" />',
          `<link rel="canonical" href="https://digitalitems.store${esc(catalog.url)}" />`
        );

        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
        });
      }
    } catch (e) {
      // Fall through to normal static serving on any error
    }

    // Static/custom pages (About, Contact, Terms, Refund Policy, Privacy Policy, and any
    // admin-created custom pages): inject correct title/description/canonical server-side.
    // Without this, the raw HTML always shows the homepage's canonical, causing Google to
    // pick its own canonical instead of trusting the page's declared one ("Duplicate,
    // Google chose different canonical than user").
    const STATIC_ROUTES = {
      '/about': { key: 'about', title: 'About Us – DigitalItems.Store',
        desc: 'DIGITALITEMS LTD is a UK-registered company providing premium social media accounts and digital marketing services worldwide.',
        keywords: 'digitalitems store, about digitalitems, digitalitems ltd' },
      '/contact': { key: 'contact', title: 'Contact Us – DigitalItems.Store',
        desc: 'Contact DigitalItems.Store for questions about orders, products, or support. Reach us by email, WhatsApp, or Telegram.',
        keywords: 'contact digitalitems, digitalitems support' },
      '/terms': { key: 'terms', title: 'Terms of Service – DigitalItems.Store',
        desc: 'Terms of Service for DigitalItems.Store. Read our policies on purchases, delivery, and acceptable use.',
        keywords: 'digitalitems terms of service' },
      '/refund-policy': { key: 'refund', title: 'Refund Policy – DigitalItems.Store',
        desc: 'DigitalItems.Store refund and returns policy for digital products and social media accounts.',
        keywords: 'digitalitems refund policy' },
      '/privacy-policy': { key: 'privacy', title: 'Privacy Policy – DigitalItems.Store',
        desc: 'Privacy Policy for DigitalItems.Store. Learn how we collect, use, and protect your personal information.',
        keywords: 'digitalitems privacy policy' }
    };

    try {
      const staticRoute = STATIC_ROUTES[url.pathname];
      const customSlug = url.pathname.replace(/^\//, '');
      if (staticRoute || customSlug) {
        const pagesRes = await fetch(BACKEND + '/pages', { cf: { cacheTtl: 300, cacheEverything: true } });
        const pagesData = await pagesRes.json();
        const customPages = pagesData.pages || {};

        let title = null, desc = null, keywords = null, matched = false;
        if (staticRoute) {
          const override = customPages[staticRoute.key];
          title = (override && override.metaTitle) || staticRoute.title;
          desc = (override && override.metaDesc) || staticRoute.desc;
          keywords = (override && override.metaKeywords) || staticRoute.keywords;
          matched = true;
        } else if (customPages[customSlug]) {
          const cp = customPages[customSlug];
          title = cp.metaTitle || cp.title;
          desc = cp.metaDesc || '';
          keywords = cp.metaKeywords || '';
          matched = true;
        }

        if (matched) {
          const assetRes = await env.ASSETS.fetch(new Request('https://assets.local/index.html'));
          let html = await assetRes.text();
          const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

          if (title) {
            html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
            html = html.replace(
              /<meta property="og:title" content="[^"]*" \/>/,
              `<meta property="og:title" content="${esc(title)}" />`
            );
          }
          if (desc) {
            html = html.replace(
              /<meta name="description" content="[^"]*" \/>/,
              `<meta name="description" content="${esc(desc)}" />`
            );
            html = html.replace(
              /<meta property="og:description" content="[^"]*" \/>/,
              `<meta property="og:description" content="${esc(desc)}" />`
            );
          }
          if (keywords) {
            html = html.replace(
              /<meta name="keywords" content="[^"]*" \/>/,
              `<meta name="keywords" content="${esc(keywords)}" />`
            );
          }
          html = html.replace(
            '<link rel="canonical" href="https://digitalitems.store/" />',
            `<link rel="canonical" href="https://digitalitems.store${esc(url.pathname)}" />`
          );

          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
          });
        }
      }
    } catch (e) {
      // Fall through to normal static serving on any error
    }

    // Everything else: serve from static assets (SPA)
    return env.ASSETS.fetch(request);
  }
};
