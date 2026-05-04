export async function onRequest(ctx) {
  const u = new URL(ctx.request.url);
  // 尺寸参数（支持 size 或 s）
  const s = u.searchParams.get('size') || u.searchParams.get('s');
  // 从路径获取用户输入，去掉首尾空
  const p = [].concat(ctx.params.path || [])[0]?.trim();
  if (!p) return new Response('Missing user. Use /123, /torvalds, or /-username', { status: 400 });

  const h = { 'User-Agent': 'Cloudflare-Proxy' };
  if (ctx.env.GITHUB_TOKEN) h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;

  // 判断输入类型
  const isForcedUser = p.startsWith('-');          // 以 - 开头 → 强制当作用户名
  const rawUser = isForcedUser ? p.slice(1) : p;   // 去掉前缀 -
  const isUid = /^\d+$/.test(rawUser) && !isForcedUser;

  // ========== 用户名分支：查 UID → 302 ==========
  if (!isUid) {
    const c = caches.default, k = `https://uid:${rawUser}`;
    let r = await c.match(k);
    if (!r) {
      const a = await fetch(`https://api.github.com/users/${rawUser}`, { headers: h });
      if (!a.ok) return new Response(a.status === 403 ? 'Rate limited' : `User ${a.status}`, { status: 502 });
      const { id } = await a.json();
      r = new Response(null, { status: 302, headers: { Location: `/${id}`, 'Cache-Control': 'public, s-maxage=1800' } });
      ctx.waitUntil(c.put(k, r.clone()));
    }
    return r;
  }

  // ========== UID 分支：返回头像 ==========
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
}