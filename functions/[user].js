export async function onRequest(ctx) {
  try {
    const u = new URL(ctx.request.url);
    const size = u.searchParams.get('size') || u.searchParams.get('s');
    const p = (ctx.params.user || '').trim();
    if (!p) return new Response('Missing user', { status: 400 });

    const h = { 'User-Agent': 'Cloudflare-Proxy' };
    if (ctx.env.GITHUB_TOKEN) h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;

    const isForced = p.startsWith('-');
    const raw = isForced ? p.slice(1) : p;
    const isUid = /^\d+$/.test(raw) && !isForced;

    // ========== 用户名：查询 UID → 302 跳转 ==========
    if (!isUid) {
      const cache = caches.default;
      // 缓存 Key 固定为用户名，不受查询参数影响
      const cacheKey = new URL(`https://uid-cache.local/${raw}`).toString();
      let uid;

      const cached = await cache.match(cacheKey);
      if (cached) {
        // 从缓存中读取 UID
        uid = await cached.text();
      } else {
        // 查询 GitHub API
        const api = await fetch(`https://api.github.com/users/${raw}`, { headers: h });
        if (!api.ok) return new Response(api.status === 403 ? 'Rate limited' : `User ${api.status}`, { status: 502 });
        const data = await api.json();
        uid = data.id.toString();

        // 将 UID 缓存起来，有效期 30 分钟
        const cachedResponse = new Response(uid, {
          headers: { 'Cache-Control': 'public, s-maxage=1800' }
        });
        ctx.waitUntil(cache.put(cacheKey, cachedResponse.clone()));
      }

      // 动态生成跳转 URL，保留当前请求的完整查询参数
      const redirectUrl = `/${uid}${u.search}`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl,
          'Cache-Control': 'public, s-maxage=1800'
        }
      });
    }

    // ========== UID：返回头像 ==========
    const img = await fetch(`https://avatars.githubusercontent.com/u/${raw}${size ? `?s=${size}` : ''}`, {
      headers: h,
      redirect: 'manual',
    });
    if (img.status !== 200 && img.status !== 304) return new Response(`Upstream ${img.status}`, { status: 502 });
    if (!(img.headers.get('content-type') || '').startsWith('image/')) return new Response('Not an image', { status: 502 });

    const hd = new Headers(img.headers);
    hd.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
    return new Response(img.body, { status: img.status, headers: hd });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}