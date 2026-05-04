export async function onRequest(ctx) {
  try {
    const u = new URL(ctx.request.url); // 获取完整的请求URL对象
    const s = u.searchParams.get('size') || u.searchParams.get('s'); // 尺寸参数
    const p = (ctx.params.user || '').trim(); // 获取路径中的用户名或UID
    if (!p) return new Response('Missing user', { status: 400 });

    const h = { 'User-Agent': 'Cloudflare-Proxy' };
    if (ctx.env.GITHUB_TOKEN) h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;

    const isForced = p.startsWith('-');
    const raw = isForced ? p.slice(1) : p;
    const isUid = /^\d+$/.test(raw) && !isForced;

    if (!isUid) {
      const cache = caches.default;
      const cacheKey = new URL(`https://uid-cache.local/${raw}`).toString();
      let r = await cache.match(cacheKey);
      if (!r) {
        const api = await fetch(`https://api.github.com/users/${raw}`, { headers: h });
        if (!api.ok) return new Response(api.status === 403 ? 'Rate limited' : `User ${api.status}`, { status: 502 });
        const { id } = await api.json();
        
        // ---- 修复点 ----
        // 保留原始请求中的查询参数，并添加到跳转目标中
        let redirectUrl = `/${id}`;
        if (u.search) { // u.search 包含了 "?" 以及之后的查询字符串
            redirectUrl += u.search;
        }
        // ----------------

        r = new Response(null, {
          status: 302,
          headers: { Location: redirectUrl, 'Cache-Control': 'public, s-maxage=1800' }
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