# TO-DO — Sugerencias y pendientes

> Sugerencias y mejoras propuestas durante el desarrollo, además de los pendientes acordados.
> Prioridad: 🔴 alta · 🟡 media · 🟢 baja
> Categorías: seguridad · optimización · limpieza · funcionalidad · documentación

## Pendientes

### Plan de acción v1 (propuesto, pendiente de aprobación)

- [ ] 🔴 [funcionalidad] Hito 1 — Núcleo: importes en céntimos, fechas locales, validación, cifrado, IndexedDB y estado en memoria, con tests.
      Justificación: todo lo demás se apoya en esta base; los errores aquí afectan a saldos y datos.
- [ ] 🔴 [seguridad] Hito 2 — Bloqueo: crear PIN, desbloqueo, bloqueo automático, límite de intentos, cambio de PIN y pantalla de privacidad.
      Justificación: los datos deben estar cifrados desde el primer movimiento.
- [ ] 🔴 [funcionalidad] Hito 3 — Cuentas, categorías y movimientos (alta rápida, lista por meses, búsqueda y filtros, edición, borrado con deshacer).
      Detalle: cuentas ilimitadas (banco, tarjeta, efectivo, ahorro, inversión…) con símbolo o iniciales
      (p. ej. «BBVA») y color a elegir, saldo inicial, reordenar, archivar e incluir/excluir del total.
      Categorías con símbolo y color editables. Símbolos de línea estilo iOS (set Tabler Icons, licencia MIT,
      ~80 iconos copiados dentro de la app: sin conexiones externas). Sin logotipos oficiales de bancos.
      Justificación: es el uso diario principal; los símbolos y colores permiten identificar cuentas de un vistazo.
- [ ] 🔴 [funcionalidad] Hito 4 — Deudas «Debo» y «Me deben», con pagos y cobros parciales y vínculo opcional a cuentas.
      Justificación: requisito principal del encargo.
- [ ] 🟡 [funcionalidad] Hito 5 — Presupuestos mensuales por categoría y movimientos recurrentes.
      Justificación: funciones extra confirmadas para la v1.
- [ ] 🟡 [funcionalidad] Hito 6 — Inicio (resumen) y Análisis (gráficas SVG propias).
      Justificación: funciones extra confirmadas para la v1.
- [ ] 🔴 [seguridad] Hito 7 — Copias de seguridad cifradas (exportar y restaurar) y exportación a CSV.
      Justificación: con los datos solo en el iPhone, la copia es la única forma de no perderlos.
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

- (ninguno todavía)
