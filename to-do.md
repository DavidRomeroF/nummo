# TO-DO — Sugerencias y pendientes

> Sugerencias y mejoras propuestas durante el desarrollo, además de los pendientes acordados.
> Prioridad: 🔴 alta · 🟡 media · 🟢 baja
> Categorías: seguridad · optimización · limpieza · funcionalidad · documentación

## Pendientes

### Plan de acción v1 (aprobado el 2026-10-05)

- [ ] 🔴 [funcionalidad] Hito 8 — PWA: manifest, iconos, service worker sin conexión, aviso de actualización, script de versión y despliegue en GitHub Pages.
      Detalle Android: icono adaptable (maskable), botón «Instalar» propio (Chrome), el botón/gesto «atrás»
      cierra ventanas abiertas antes de cambiar de pantalla, copia de seguridad por descarga si no hay
      menú Compartir, instrucciones de instalación según el sistema y nota de privacidad en «Acerca de».
      Justificación: necesario para instalarla en iPhone y Android.
- [ ] 🔴 [seguridad] Hito 9 — QA: tests, prueba con tamaño iPhone y Android, revisión de seguridad, limpieza y medición de rendimiento.
      Justificación: criterio de "terminado".
- [ ] 🟡 [documentación] Hito 10 — GUIA-DE-USO.md y DOCUMENTACION-TECNICA.md.
      Justificación: cierre obligatorio del protocolo.

### Sugerencias (fuera del alcance de la v1)

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

- [x] 2026-10-05 — Hitos 2 a 7: PIN y bloqueo, cuentas, categorías, movimientos, deudas, presupuestos,
      programados, Inicio, Análisis con gráficas, copias cifradas y CSV (probado en navegador, iPhone/Android, claro/oscuro).
- [x] 2026-10-05 — Hito 1: núcleo (importes, fechas, modelo, cálculos, recurrentes, cifrado, caja fuerte, almacén, copias) con 59 tests en verde.
