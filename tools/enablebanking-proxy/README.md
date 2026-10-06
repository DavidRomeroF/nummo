# Intermediario para Enable Banking (Cloudflare Worker)

La API de Enable Banking **no admite llamadas desde una web** (no envía cabeceras CORS), así que el navegador bloquea las peticiones de Nummo. Comprobado el 6 de octubre de 2026 desde `https://davidromerof.github.io`: el servidor responde, pero el navegador no deja leer la respuesta.

Este Worker solo **reenvía** las peticiones a `https://api.enablebanking.com` y añade CORS para tu web:

- No tiene ninguna clave: cada petición ya llega firmada desde el móvil, y la clave privada no sale de allí.
- No guarda ni registra nada (mantén desactivados los «Logs» del Worker).
- Solo acepta tu web (`ALLOWED_ORIGINS`) y las rutas de lectura que usa Nummo. Los pagos no están permitidos.
- Es gratis: el plan gratuito de Cloudflare Workers permite 100.000 peticiones al día, y Nummo hace unas pocas decenas.

## Crearlo (5 minutos, una vez)

1. Crea una cuenta gratuita en <https://dash.cloudflare.com/sign-up>.
2. En el panel: **Compute (Workers) → Workers & Pages → Create → Create Worker** (plantilla «Hello World»). Ponle de nombre `nummo-banco` y pulsa **Deploy**.
3. Pulsa **Edit code**, borra todo, pega el contenido de [`worker.js`](worker.js) y pulsa **Deploy**.
4. Si tu Nummo no está en `https://davidromerof.github.io`, cambia `ALLOWED_ORIGINS` antes de desplegar (solo el dominio, sin ruta ni barra final).
5. Copia la dirección del Worker, por ejemplo `https://nummo-banco.TU-SUBDOMINIO.workers.dev`.
6. En Nummo: **Más → Bancos y extractos → Aplicación de Enable Banking**, pega esa dirección en **Intermediario** y pulsa **Guardar**. Nummo comprueba la conexión al guardar.

## Qué cambia en la seguridad

Los datos de tus cuentas pasan por la red de Cloudflare camino de tu móvil, igual que pasarían por cualquier servidor web. Tu Worker no los almacena. La CSP de Nummo solo permite conectar con `api.enablebanking.com` y con direcciones `*.workers.dev`.
