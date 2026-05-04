export async function onRequest(ctx) {
  try {
    const u = new URL(ctx.request.url);
    const s = u.searchParams.get('size') || u.searchParams.get('s');
    const p = (ctx.params.user || '').trim();
    if (!p) return new Response('Missing user', { status: 400 });

    const h = { 'User-Agent': 'Cloudflare-Proxy' };
    if (ctx.env.GITHUB_TOKEN) h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;

    const isForced = p.startsWith('-');
    const raw = isForced ? p.slice(1) : p;
    const isUid = /^\d+$/.test(raw) && !isForced;

    if (!isUid) {
      const cache = caches.default;
      // 构造合法的缓存 Key（URL 形式）
      const cacheKey = new URL(`https://uid-cache.local/${raw}`).toString();
      let r = await cache.match(cacheKey);
      if (!r) {
        const api = await fetch(`https://api.github.com/users/${raw}`, { headers: h });
        if (!api.ok) return new Response(api.status === 403 ? 'Rate limited' : `User ${api.status}`, { status: 502 });
        const { id } = await api.json();
        r = new Response(null, {
          status: 302,
          headers: { Location: `/${id}`, 'Cache-Control': 'public, s-maxage=1800' }
        });
        ctx.waitUntil(cache.put(cacheKey, r.clone()));
      }
      return r;
    }

    const imgUrl = `https://avatars.githubusercontent.com/u/${raw}${s ? `?s=${s}` : ''}`;
    const img = await fetch(imgUrl, { headers: h, redirect: 'manual' });
    if (img.status !== 200 && img.status !== 304) return new Response(`Upstream ${img.status}`, { status: 502 });
    if (!(img.headers.get('content-type') || '').startsWith('image/')) return new Response('Not an image', { status: 502 });

    const hd = new Headers(img.headers);
    hd.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
    return new Response(img.body, { status: img.status, headers: hd });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}