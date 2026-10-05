# TO-DO — Sugerencias y pendientes

> Sugerencias y mejoras propuestas durante el desarrollo, además de los pendientes acordados.
> Prioridad: 🔴 alta · 🟡 media · 🟢 baja
> Categorías: seguridad · optimización · limpieza · funcionalidad · documentación

## Pendientes

### Plan de acción v1 (aprobado el 2026-10-05)

- [ ] 🔴 [seguridad] Hito 9 — QA: tests, prueba con tamaño iPhone y Android, revisión de seguridad, limpieza y medición de rendimiento.
      Justificación: criterio de "terminado".
- [ ] 🟡 [documentación] Hito 10 — GUIA-DE-USO.md y DOCUMENTACION-TECNICA.md.
      Justificación: cierre obligatorio del protocolo.


### Sugerencias (fuera del alcance de la v1)

- [ ] 🟢 [optimización] Bloques mensuales ('mov-AAAA-MM') en lugar de anuales y escrituras agrupadas en una microtarea.
      Justificación: con más de 20.000 movimientos, cada cambio recifra el año entero (≈1 MB; 6-15 ms en un móvil).
- [ ] 🟢 [limpieza] Unificar en un solo componente los grupos de selección (segmented, chipPicker, categoryGrid,
      iconPicker, colorPicker y los chips escritos a mano en accounts.js y movements.js).
      Justificación: hoy la lógica de selección está repetida 7 veces.
- [ ] 🟢 [limpieza] Un único ayudante para «elegir y confirmar PIN» (screens.js y security.js) y una única
      comprobación de referencias (store.checkRefs y la de model.normalizeData).
      Justificación: evitar que los mensajes y reglas diverjan.

- [ ] 🟡 [funcionalidad] Validar en un iPhone real el teclado sobre las hojas (variable --kb) y el menú Compartir con archivos .json.
      Justificación: el emulador del navegador no reproduce el teclado de iOS ni su hoja de compartir.
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

## Completados

- [x] 2026-10-05 — Hito 9: revisión de código completa (9 revisores) y corrección de todos los fallos confirmados; 74 tests.
- [x] 2026-10-05 — Documentación: «Apariencia» en la guía y en la documentación técnica; README.md creado.
- [x] 2026-10-05 — Temas: modo claro/oscuro/automático y color de la app con contraste garantizado (Más → Apariencia).
- [x] 2026-10-05 — Hito 8: service worker (sin conexión y aviso de versión nueva), tools/release.py y publicación
      automática en GitHub Pages con acciones oficiales fijadas por commit.
- [x] 2026-10-05 — Hitos 2 a 7: PIN y bloqueo, cuentas, categorías, movimientos, deudas, presupuestos,
      programados, Inicio, Análisis con gráficas, copias cifradas y CSV (probado en navegador, iPhone/Android, claro/oscuro).
- [x] 2026-10-05 — Hito 1: núcleo (importes, fechas, modelo, cálculos, recurrentes, cifrado, caja fuerte, almacén, copias) con 59 tests en verde.
