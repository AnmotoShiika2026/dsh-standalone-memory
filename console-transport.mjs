// DSH rc.5: reuse the host's authenticated browser admission and lifecycle.
const localIP = address => address === '127.0.0.1' || address === '::1';
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const keys = new Set(['op','sessionId','confirm','args']);
const refused = code => ({ok:true,value:{ok:false,error:code}});
export function registerConsoleTransport(ctx, dispatch) {
  const connection = ctx.get('connection'), web = ctx.get('webServer');
  if (!connection || typeof dispatch !== 'function' || !web) return;
  return connection.register(ctx, '/standalone-memory-console', async (method, input, signal, peer) => {
    try {
      // Don't trust caller-controlled owner/profile/address fields. The admitted browser
      // peer is a runtime identity; a principal with the same role alone is insufficient.
      if (!localIP(web.host) || !localIP(web.server?.address()?.address) || !peer ||
          peer !== connection.browserPeer || peer.principal?.kind !== 'owner' ||
          !signal || signal.aborted || peer.signal?.aborted) return refused('unavailable');
      if (method !== 'dispatch' || !plain(input) || !Object.hasOwn(input,'op') || typeof input.op !== 'string' ||
          input.op.length > 32 || Object.keys(input).some(k=>!keys.has(k)) ||
          (Object.hasOwn(input,'args') && !plain(input.args)) || Buffer.byteLength(JSON.stringify(input),'utf8') > 128*1024) return refused('invalid_request');
      // createConsole is responsible for per-operation schema and mutation confirmation.
      return {ok:true,value:await dispatch(input)};
    } catch { return refused('unavailable'); }
  });
}
