export async function onRequest(ctx) {
  const u = new URL(ctx.request.url);
  const s = u.searchParams.get('size') || u.searchParams.get('s');
  const pathVal = [].concat(ctx.params.path || [])[0];
  const p = (pathVal || '').trim();        // 确保 p 是字符串，防止 undefined
  if (!p) return new Response('Missing user. Use /123, /torvalds, or /-username', { status: 400 });

  const h = { 'User-Agent': 'Cloudflare-Proxy' };
  if (ctx.env.GITHUB_TOKEN) h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;

  const isForcedUser = p.startsWith('-');
  const rawUser = isForcedUser ? p.slice(1) : p;
  const isUid = /^\d+$/.test(rawUser) && !isForcedUser;

  // 用户名分支
  if (!isUid) {
    const c = caches.default, k = `https://uid:${rawUser}`;
    let r = await c.match(k);
    if (!r) {
      try {
        const a = await fetch(`https://api.github.com/users/${rawUser}`, { headers: h });
        if (!a.ok) return new Response(a.status === 403 ? 'Rate limited' : `User ${a.status}`, { status: 502 });
        const { id } = await a.json();
        r = new Response(null, { status: 302, headers: { Location: `/${id}`, 'Cache-Control': 'public, s-maxage=1800' } });
        ctx.waitUntil(c.put(k, r.clone()));
      } catch (e) {
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    }
    return r;
  }

  // UID 分支
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