export async function onRequest(ctx) {
  const u = new URL(ctx.request.url);
  const s = u.searchParams.get('size') || u.searchParams.get('s');
  const p = (ctx.params.user || '').trim();   // 直接从动态路由获取
  if (!p) return new Response('Missing user. Use /123, /torvalds, or /-username', { status: 400 });

  const h = { 'User-Agent': 'Cloudflare-Proxy' };
  if (ctx.env.GITHUB_TOKEN) h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;

  const isForcedUser = p.startsWith('-');      // 以 - 开头 → 强制用户名
  const rawUser = isForcedUser ? p.slice(1) : p;
  const isUid = /^\d+$/.test(rawUser) && !isForcedUser;

  // 用户名分支：查 UID → 302 重定向
  if (!isUid) {
    const c = caches.default, k = `https://uid:${rawUser}`;
    let r = await c.match(k);
    if (!r) {
      try {
        const api = await fetch(`https://api.github.com/users/${rawUser}`, { headers: h });
        if (!api.ok) return new Response(api.status === 403 ? 'Rate limited' : `User ${api.status}`, { status: 502 });
        const { id } = await api.json();
        r = new Response(null, { status: 302, headers: { Location: `/${id}`, 'Cache-Control': 'public, s-maxage=1800' } });
        ctx.waitUntil(c.put(k, r.clone()));
      } catch (e) {
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    }
    return r;
  }

  // UID 分支：返回头像
  try {
    const img = await fetch(`https://avatars.githubusercontent.com/u/${rawUser}${s ? `?s=${s}` : ''}`, {
      headers: h,
      redirect: 'manual',
    });
    if (img.status !== 200 && img.status !== 304) return new Response(`Upstream ${img.status}`, { status: 502 });
    const ct = img.headers.get('content-type');
    if (!ct?.startsWith('image/')) return new Response('Not an image', { status: 502 });

    const hd = new Headers(img.headers);
    hd.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
    return new Response(img.body, { status: img.status, headers: hd });
  } catch (e) {
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
}