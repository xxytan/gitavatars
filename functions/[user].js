export async function onRequest(ctx) {
  return new Response(ctx.params.user || 'ok');
}