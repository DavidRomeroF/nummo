// Intermediario mínimo para Nummo → Enable Banking (Cloudflare Workers, plan gratuito).
//
// Por qué existe: la API de Enable Banking no admite llamadas desde una web (CORS), así que el
// navegador las bloquea. Este Worker solo reenvía las peticiones de Nummo a la API y añade las
// cabeceras CORS para TU web. No guarda nada, no registra nada y no tiene ninguna clave: cada
// petición ya viene firmada desde el móvil con tu clave privada, que nunca sale de allí.
//
// Qué tienes que cambiar: ALLOWED_ORIGINS, con la dirección de tu Nummo (solo el dominio, sin
// ruta ni barra final).
//
// Qué ve Cloudflare: el tráfico pasa por su red (como cualquier web alojada allí), así que técnicamente
// los datos del banco atraviesan tu Worker. No se almacenan ni se registran mientras no actives
// los registros (Logs) del Worker: déjalos desactivados.

const ALLOWED_ORIGINS = ['https://davidromerof.github.io'];

const UPSTREAM = 'https://api.enablebanking.com';
// Solo las rutas que usa Nummo (lectura de cuentas). Nada de pagos.
const ALLOWED_PATHS = /^\/(aspsps|auth|sessions|sessions\/[A-Za-z0-9-]{1,100}|accounts\/[^/]{1,200}\/(balances|transactions|details))$/;
const ALLOWED_METHODS = ['GET', 'POST', 'DELETE'];
const MAX_BODY = 16 * 1024;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? '';
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (!ALLOWED_METHODS.includes(request.method) || !ALLOWED_PATHS.test(url.pathname)) {
      return new Response('Not found', { status: 404, headers: cors });
    }
    const headers = new Headers();
    for (const name of ['authorization', 'content-type']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    let body;
    if (request.method === 'POST') {
      body = await request.text();
      if (body.length > MAX_BODY) return new Response('Too large', { status: 413, headers: cors });
    }
    const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, { method: request.method, headers, body });
    const out = new Headers(cors);
    for (const name of ['content-type', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    out.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
