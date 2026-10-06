# TO-DO — Sugerencias y pendientes

> Sugerencias y mejoras propuestas durante el desarrollo, además de los pendientes acordados.
> Prioridad: 🔴 alta · 🟡 media · 🟢 baja
> Categorías: seguridad · optimización · limpieza · funcionalidad · documentación

## Pendientes

### Publicación (la hace la persona propietaria)

- [ ] 🔴 [funcionalidad] Crear el repositorio público en GitHub (nombre recomendado: `nummo`), subir el código
      y activar Pages (Settings → Pages → Source: GitHub Actions). Pasos en README.md y DOCUMENTACION-TECNICA.md §6.
      Justificación: sin publicar no se puede instalar en el iPhone ni en Android.
- [ ] 🟡 [funcionalidad] Primera prueba en el iPhone real: instalar desde Safari, crear el PIN, hacer una copia
      y guardarla en Archivos, y comprobar el teclado sobre las hojas.
      Justificación: hay detalles de iOS que el navegador del ordenador no reproduce.


### Sugerencias (fuera del alcance de la v1)

- [ ] 🟢 [optimización] Bloques mensuales ('mov-AAAA-MM') en lugar de anuales y escrituras agrupadas en una microtarea.
      Justificación: con más de 20.000 movimientos, cada cambio recifra el año entero (≈1 MB; 6-15 ms en un móvil).
- [ ] 🟢 [limpieza] Unificar en un solo componente los grupos de selección (segmented, chipPicker, categoryGrid,
      iconPicker, colorPicker y los chips escritos a mano en accounts.js y movements.js).
      Justificación: hoy la lógica de selección está repetida 7 veces.
- [ ] 🟢 [limpieza] Un único ayudante para «elegir y confirmar PIN» (screens.js y security.js) y una única
      comprobación de referencias (store.checkRefs y la de model.normalizeData).
      Justificación: evitar que los mensajes y reglas diverjan.

- [ ] 🟢 [funcionalidad] Tamaño de letra dinámico de iOS (font: -apple-system-body) para quien usa letra grande.
      Justificación: accesibilidad; requiere revisar todos los tamaños fijos.
- [ ] 🟢 [funcionalidad] Pantallas de arranque (splash) de iOS con apple-touch-startup-image.
      Justificación: hoy iOS muestra un fondo liso mientras carga (es breve).
- [ ] 🟡 [seguridad] Desbloqueo con Face ID mediante passkey (WebAuthn + extensión PRF), manteniendo el PIN como respaldo.
      Justificación: más cómodo sin rebajar el cifrado; requiere iOS 18+ y pruebas en un iPhone real.
- [ ] 🟢 [seguridad] Opción de contraseña alfanumérica en lugar de PIN de 6 dígitos.
      Justificación: un PIN numérico es débil frente a un ataque técnico al almacenamiento; una contraseña larga no.
- [ ] 🟢 [funcionalidad] Importar extractos bancarios (CSV).
      Justificación: ahorra introducir a mano los movimientos de tarjeta.
- [ ] 🟢 [funcionalidad] Dividir un gasto con otras personas y generar automáticamente lo que te deben.
      Justificación: caso habitual (cenas, viajes, Bizum).
- [ ] 🟢 [funcionalidad] Compartir datos entre personas o dispositivos (p. ej. gastos de pareja) mediante sincronización cifrada.
      Justificación: hoy cada instalación es independiente; requeriría un servidor y cuentas de usuario.

### Bancos (Open Banking e importación)

- [ ] 🔴 [funcionalidad] Primera conexión real con Caja Rural desde el móvil (lo hace la persona propietaria): crear la
      aplicación en Enable Banking, vincular las cuentas en su panel, registrar la Redirect URL de GitHub Pages y conectar.
      Justificación: comprobar en real que la API admite llamadas desde el navegador (CORS), qué cuentas devuelve
      Caja Rural (¿ahorro, tarjetas, plazo fijo?), cuánto historial da y si el identificador de apunte es estable.
- [ ] 🔴 [seguridad] Si la API de Enable Banking NO admite llamadas desde el navegador (CORS): intermediario mínimo
      propio (Cloudflare Worker) que solo reenvíe a api.enablebanking.com, con la clave en el Worker y autenticación.
      Justificación: sin eso la conexión no funciona desde una web; el diseño (provider.js) ya lo permite sin tocar el resto.
- [ ] 🟡 [funcionalidad] Comprobar en un iPhone real la vuelta del banco a la app instalada (o a Safari) y el aviso con la
      dirección para pegar. Justificación: iOS trata distinto las PWA instaladas y no se puede reproducir en el ordenador.
- [ ] 🟡 [funcionalidad] Análisis por subcategoría y por comercio (los datos ya están: `parentId`, `source.cp`).
      Justificación: estadísticas por comercio y agrupación de subcategorías en las gráficas.
- [ ] 🟡 [funcionalidad] Detección de suscripciones y pagos recurrentes a partir de lo importado, con propuesta de crear
      el programado. Justificación: sale casi gratis de los datos del banco.
- [ ] 🟢 [funcionalidad] Alertas de presupuesto al importar (aviso cuando una categoría pasa del 80 %).
- [ ] 🟢 [funcionalidad] Sincronización entre dispositivos con cifrado de extremo a extremo (los bloques cifrados se
      suben tal cual a un almacén que no tiene la clave; emparejado por QR). Justificación: PC y móvil con los mismos datos.
      Ver la propuesta de arquitectura (opción E). El banco seguiría conectado solo en un dispositivo.
- [ ] 🟢 [funcionalidad] Más plantillas de extractos (BBVA, Santander, CaixaBank…) y Norma 43.
- [ ] 🟢 [seguridad] Desbloqueo con passkey (WebAuthn PRF) como alternativa a la contraseña.

## Completados

- [x] 2026-10-06 — Bancos: modelo v2 con migración, tubería de importación idempotente (huella, pendientes, duplicados
      entre fuentes, transferencias propias), lector de Excel/CSV con plantilla de Ruralvía, reglas de categorías que
      aprenden, Open Banking con Enable Banking (JWT con clave no extraíble, conexión, vinculación, sincronización con
      límites PSD2, desconexión y revocación), contraseña obligatoria para guardar el acceso al banco, secretos fuera de
      las copias, CSP y release.py endurecidos, subcategorías, plazos fijos manuales. 118 tests.

- [x] 2026-10-05 — Nuevo nombre y logo: Nummo (iconos vectoriales a partir del logo; nombre en app, archivos y documentación).

- [x] 2026-10-05 — Última pasada de revisión: 8 fallos más corregidos (borrar una cuenta ya no cambia el saldo de
      otras, foco al repintar y al cerrar hojas, confirmación al borrar un movimiento, espera del PIN con reloj
      monotónico, pantalla del PIN robusta, anuncios de accesibilidad, tipo de deuda editable, fecha de la copia).
- [x] 2026-10-05 — Hito 10: GUIA-DE-USO.md y DOCUMENTACION-TECNICA.md (actualizadas con cada cambio).

- [x] 2026-10-05 — Hito 9: QA (tamaño iPhone/Android, rendimiento con 20.000 movimientos) y revisión de código
      completa (9 revisores) con todos los fallos confirmados corregidos; 74 tests.
- [x] 2026-10-05 — Documentación: «Apariencia» en la guía y en la documentación técnica; README.md creado.
- [x] 2026-10-05 — Temas: modo claro/oscuro/automático y color de la app con contraste garantizado (Más → Apariencia).
- [x] 2026-10-05 — Hito 8: service worker (sin conexión y aviso de versión nueva), tools/release.py y publicación
      automática en GitHub Pages con acciones oficiales fijadas por commit.
- [x] 2026-10-05 — Hitos 2 a 7: PIN y bloqueo, cuentas, categorías, movimientos, deudas, presupuestos,
      programados, Inicio, Análisis con gráficas, copias cifradas y CSV (probado en navegador, iPhone/Android, claro/oscuro).
- [x] 2026-10-05 — Hito 1: núcleo (importes, fechas, modelo, cálculos, recurrentes, cifrado, caja fuerte, almacén, copias) con 59 tests en verde.
