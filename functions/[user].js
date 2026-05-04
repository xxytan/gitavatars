export async function onRequest(ctx) {
  try {
    const u = new URL(ctx.request.url);
    // 获取图片尺寸参数 ( ?s= 或 ?size= )
    const size = u.searchParams.get('size') || u.searchParams.get('s');
    // 从路径中获取用户名或 UID
    const p = (ctx.params.user || '').trim();
    if (!p) return new Response('Missing user', { status: 400 });

    const h = { 'User-Agent': 'Cloudflare-Proxy' };
    if (ctx.env.GITHUB_TOKEN) h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;

    const isForced = p.startsWith('-'); // 强制作为用户名
    const raw = isForced ? p.slice(1) : p; // 去掉前缀 -
    const isUid = /^\d+$/.test(raw) && !isForced;

    // ========== 用户名：查询 UID → 302 重定向 ==========
    if (!isUid) {
      const cache = caches.default;
      // 修复：只使用用户名本身作为缓存键，不带任何查询参数
      const cacheKey = new URL(`https://uid-cache.local/${raw}`).toString();
      let r = await cache.match(cacheKey);
      
      if (!r) {
        // 缓存未命中，请求 GitHub API
        const api = await fetch(`https://api.github.com/users/${raw}`, { headers: h });
        if (!api.ok) return new Response(api.status === 403 ? 'Rate limited' : `User ${api.status}`, { status: 502 });
        const { id } = await api.json();
        // 缓存 UID，设置30分钟过期
        r = new Response(null, {
          headers: {
            'X-UID': id.toString(),
            'Cache-Control': 'public, s-maxage=1800'
          }
        });
        ctx.waitUntil(cache.put(cacheKey, r.clone()));
      }
      
      // 动态生成跳转 URL，保留当前请求的参数
      const uid = r.headers.get('X-UID');
      const redirectUrl = `/${uid}${u.search}`; // u.search 是 "?size=64"
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl, 'Cache-Control': 'public, s-maxage=1800' }
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