export async function onRequest(ctx) {
  try {
    const u = new URL(ctx.request.url);
    const size = u.searchParams.get('size') || u.searchParams.get('s');
    // 确保从路径中获取用户名或UID
    const p = (ctx.params.user || '').trim();
    if (!p) return new Response('Missing user', { status: 400 });

    // 准备请求头，包含可选的GitHub Token
    const h = { 'User-Agent': 'Cloudflare-Proxy' };
    if (ctx.env.GITHUB_TOKEN) {
      h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;
    }

    const isForced = p.startsWith('-');
    const raw = isForced ? p.slice(1) : p;
    const isUid = /^\d+$/.test(raw) && !isForced;

    if (!isUid) {
      // --- 用户名分支：带缓存的查询 ---
      const cache = caches.default;
      const cacheKey = `https://uid-cache.local/${raw}`;
      let uid = null;
      const cached = await cache.match(cacheKey);

      if (cached) {
        uid = await cached.text();
      }

      if (!uid) {
        // 缓存未命中，查询 GitHub API
        const api = await fetch(`https://api.github.com/users/${raw}`, { headers: h });
        if (!api.ok) return new Response(api.status === 403 ? 'Rate limited' : `User ${api.status}`, { status: 502 });
        const data = await api.json();
        uid = data.id.toString();
        
        // 确保获取到有效的UID
        if (!uid || uid === 'undefined') {
          return new Response('Failed to get user ID', { status: 502 });
        }

        // 将有效的UID写入缓存，设置30分钟过期
        const cachedResponse = new Response(uid, {
          headers: { 'Cache-Control': 'public, s-maxage=1800' }
        });
        ctx.waitUntil(cache.put(cacheKey, cachedResponse.clone()));
      }

      // 无论缓存是否命中，都动态生成重定向URL，确保查询参数不丢失
      const redirectUrl = `/${uid}${u.search}`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl,
          'Cache-Control': 'no-cache', // 告诉浏览器不要缓存此302跳转
        }
      });
    } else {
      // --- UID 分支：返回头像 ---
      const imgUrl = `https://avatars.githubusercontent.com/u/${raw}${size ? `?s=${size}` : ''}`;
      const img = await fetch(imgUrl, { headers: h, redirect: 'manual' });
      
      if (img.status !== 200 && img.status !== 304) return new Response(`Upstream ${img.status}`, { status: 502 });
      if (!(img.headers.get('content-type') || '').startsWith('image/')) return new Response('Not an image', { status: 502 });

      const hd = new Headers(img.headers);
      hd.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
      return new Response(img.body, { status: img.status, headers: hd });
    }
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}