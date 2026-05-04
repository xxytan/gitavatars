export async function onRequest(ctx) {
  const u = new URL(ctx.request.url);
  const q = u.searchParams.get('u');
  const s = u.searchParams.get('size') || u.searchParams.get('s');
  const p = [].concat(ctx.params.path || [])[0] || '';
  const user = q || p;
  if (!user) return new Response('Missing user. Use /123 or ?u=name', { status: 400 });

  const h = { 'User-Agent': 'Cloudflare-Proxy' };
  if (ctx.env.GITHUB_TOKEN) h['Authorization'] = `token ${ctx.env.GITHUB_TOKEN}`;

  const isUid = /^\d+$/.test(user) && !q;

  if (!isUid) {
    const c = caches.default, k = `https://uid:${user}`;
    let r = await c.match(k);
    if (!r) {
      const a = await fetch(`https://api.github.com/users/${user}`, { headers: h });
      if (!a.ok) return new Response(a.status === 403 ? 'Rate limited' : `User ${a.status}`, { status: 502 });
      const { id } = await a.json();
      r = new Response(null, { status: 302, headers: { Location: `/${id}`, 'Cache-Control': 'public, s-maxage=1800' } });
      ctx.waitUntil(c.put(k, r.clone()));
    }
    return r;
  }

  const img = await fetch(`https://avatars.githubusercontent.com/u/${user}${s ? `?s=${s}` : ''}`, { headers: h, redirect: 'manual' });
  if (img.status !== 200 && img.status !== 304) return new Response(`Upstream ${img.status}`, { status: 502 });
  const ct = img.headers.get('content-type');
  if (!ct?.startsWith('image/')) return new Response('Not an image', { status: 502 });

  const hd = new Headers(img.headers);
  hd.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
  return new Response(img.body, { status: img.status, headers: hd });
}