# Documentación técnica — Dinero

## 1. Visión general

**Dinero** es una aplicación web progresiva (PWA) de finanzas personales para iPhone y Android. Gestiona:

- cuentas, gastos, ingresos y transferencias;
- deudas («debo» / «me deben») con pagos parciales;
- presupuestos mensuales y movimientos programados;
- análisis con gráficas;
- copias de seguridad cifradas y exportación CSV.

Principios de diseño:

- **Local-first y privada.** No hay backend: todos los datos viven en el dispositivo (IndexedDB), cifrados con AES-256-GCM. La clave se abre con un PIN de 6 dígitos.
- **Sin dependencias en tiempo de ejecución.** HTML + CSS + JavaScript (módulos ES), sin frameworks, librerías ni paso de compilación.
- **Funciona sin conexión.** Un service worker precarga la app y avisa cuando hay versión nueva.
- **Hosting estático.** GitHub Pages publica la carpeta `app/` mediante GitHub Actions.
- **Temas.** Modo automático, claro u oscuro, y un color de acento elegible. El contraste está garantizado por cálculo, siguiendo WCAG AA.

## 2. Stack tecnológico

| Capa | Tecnología | Versión | Notas |
|------|------------|---------|-------|
| Lenguaje | JavaScript (ES2022, módulos ES) | — | Sin transpilación. Usa `??=`, `Array.prototype.at` y `Object.hasOwn` (iOS 16.4+, Chrome 111+) |
| UI | HTML + CSS propios | — | Tokens CSS claro/oscuro, `<dialog>`, `popover` (opcional), `color-mix`, `dvh` |
| Gráficas | SVG generado a mano (`app/js/ui/charts.js`) | — | Sin librerías; colores validados con la guía dataviz |
| Temas | Variables CSS + `data-theme` + color en OKLCH (`core/color.js`) | — | Contraste WCAG calculado para cada modo |
| Almacenamiento | IndexedDB | — | Almacenes `meta` y `vault` |
| Criptografía | WebCrypto | — | PBKDF2-HMAC-SHA-256 (600.000 iteraciones), AES-256-GCM |
| Sin conexión | Service Worker + Cache Storage | — | `app/sw.js` |
| Iconos | Tabler Icons (MIT) | v3.48.0 | 123 trazados copiados en `app/js/ui/icon-data.js` |
| Herramientas | Python | 3.9+ | `tools/*.py` (solo biblioteca estándar) |
| Publicación | GitHub Pages + GitHub Actions | checkout v7.0.1, configure-pages v6.0.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1 | Acciones fijadas por SHA |
| Tests | Ejecutor propio en el navegador (`tests/`) | — | 60 tests del núcleo |

## 3. Arquitectura

```
┌──────────────────────────── navegador (iPhone / Android) ─────────────────────────────┐
│                                                                                       │
│  views/*  ── leen ──►  store.getState() / store.derived()   (cálculos en finance.js)    │
│     │                         ▲                                                       │
│     └── llaman a ──►  store.add*/update*/delete* ── validan con model.js (normalize*)  │
│                               │                                                       │
│                               ▼ marca bloques «sucios» ('core', 'mov-AAAA')            │
│                         store.save()  (escrituras encadenadas, nunca solapadas)        │
│                               │                                                       │
│                               ▼                                                       │
│                         vault.js  ── AES-GCM (DEK en memoria) ──►  idb.js ─► IndexedDB │
│                               ▲                                                       │
│               PIN ─► PBKDF2 ─► KEK ─► descifra la DEK (si el PIN es incorrecto, falla) │
│                                                                                       │
│  ui/shell.js: barra superior + vista + pestañas; se repinta (requestAnimationFrame)   │
│  al cambiar el estado o la ruta (ui/router.js, rutas #/…).                            │
│  sw.js: precarga y sirve la app desde caché; la versión nueva se activa al pulsar      │
│  «Actualizar».                                                                        │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Temas:

- **Antes de pintar.** `js/theme-boot.js` es un script clásico y síncrono en `<head>`, compatible con la CSP. Lee la preferencia de `localStorage`, valida los valores y fija:
  - `data-theme="light|dark"` en `<html>`;
  - las variables `--accent`, `--accent-fill`, `--on-accent` y `--accent-bg`;
  - las metas `color-scheme` y `theme-color`.
- **Con la app cargada.** `ui/theme.js` sigue los cambios del sistema en modo automático y aplica la elección de la persona.
- **Cálculo de tonos.** `core/color.js` calcula los tonos de cada modo, oscureciendo o aclarando en OKLCH:
  - el texto de color tiene ≥ 4,5:1 frente a la página y a las tarjetas;
  - el texto sobre los botones es blanco o tinta, ≥ 4,5:1;
  - el botón se distingue de la tarjeta.
- **Azul por defecto.** No se escribe ningún valor en línea: se usan los valores de `css/app.css`.

Ciclo de vida (`app/js/main.js`):

1. **Arranque.** Comprueba que la app no está dentro de un iframe y que hay contexto seguro, WebCrypto e IndexedDB. Después registra el service worker y prepara el bloqueo automático y el teclado.
2. **Pantallas iniciales.** Si `vault.status()` es `'new'` muestra la bienvenida; si no, el desbloqueo con PIN.
3. **Al desbloquear.** Se descifran los bloques y se ejecuta `store.loadFromBuckets` (validación en modo reparación). Luego se monta el armazón y se crean los movimientos programados pendientes.
4. **Bloqueo.** Al salir de la app se añade la clase `private`, que oculta la app y las hojas en la captura del selector de apps. Pasado el tiempo configurado se bloquea:
   1. guarda lo pendiente;
   2. cierra las hojas;
   3. olvida la clave;
   4. vacía el estado;
   5. muestra el PIN.

Accesibilidad de la interfaz (`ui/focus.js`, `ui/sheet.js`, `ui/pinpad.js`):

- **Foco estable.** Al repintar una vista, el foco vuelve al mismo botón (se identifica por su tipo y su texto). Al cerrar una hoja vuelve al botón que la abrió o, si ya no existe, al título de la pantalla.
- **Alertas seguras.** Las confirmaciones empiezan con el foco en «Cancelar», así que Intro o Espacio nunca confirman por error.
- **Anuncios medidos.** Los cambios de paso al crear o cambiar el PIN se anuncian. La cuenta atrás por intentos fallidos se anuncia al empezar y al terminar, no cada segundo.
- **Avisos con «Deshacer».** Duran 8 s y no desaparecen mientras tienen el foco o el dedo o el puntero encima.

## 4. Estructura del proyecto

```
App_Dinero/
├── app/                      ← lo único que se publica
│   ├── index.html            CSP estricta (meta), Trusted Types, enlaces a manifest e iconos
│   ├── manifest.webmanifest  instalación (standalone, iconos any + maskable)
│   ├── sw.js                 service worker (bloque @generated por tools/release.py)
│   ├── css/app.css           estilos (tokens claro/oscuro, componentes, gráficas)
│   ├── icons/                icon.svg, icon-192/512.png, icon-maskable-512.png, apple-touch-icon.png
│   └── js/
│       ├── main.js           arranque, rutas, ciclo de vida, bloqueo automático
│       ├── theme-boot.js     aplica el tema guardado antes de pintar (script clásico)
│       ├── core/             lógica sin DOM (probada con tests)
│       │   ├── money.js      céntimos: parseAmount, formatMoney…
│       │   ├── dates.js      fechas 'AAAA-MM-DD' y meses 'AAAA-MM'
│       │   ├── ids.js        identificadores aleatorios
│       │   ├── text.js       saneado de texto
│       │   ├── catalog.js    listas blancas (colores, iconos, tipos) y datos iniciales
│       │   ├── model.js      normalizadores, validación del conjunto, bloques
│       │   ├── crypto.js     PBKDF2, AES-GCM, Base64
│       │   ├── idb.js        envoltorio de IndexedDB
│       │   ├── vault.js      caja fuerte cifrada (PIN, intentos, cambio de PIN)
│       │   ├── store.js      estado en memoria + operaciones + guardado
│       │   ├── finance.js    saldos, deudas, resúmenes, presupuestos, series
│       │   ├── recurring.js  fechas de programados
│       │   ├── backup.js     copia cifrada y CSV
│       │   └── color.js      contraste WCAG y tonos de acento en OKLCH
│       ├── ui/               infraestructura de interfaz (dom, componentes, hojas, avisos,
│       │                     router, shell, gráficas, PWA, teclado PIN, iconos, formatos, tema)
│       └── views/            pantallas y formularios
├── tests/                    ejecutor y tests del núcleo (abrir /tests/ en el navegador)
├── tools/
│   ├── serve.py              servidor local (127.0.0.1:8080, sin caché)
│   ├── release.py            versión del service worker + comprobaciones de seguridad
│   ├── fetch_icons.py        descarga de iconos Tabler fijados a una versión
│   └── make_icons.py         iconos de la app (macOS: qlmanage + sips)
├── .github/workflows/pages.yml  publicación en GitHub Pages
├── GUIA-DE-USO.md · DOCUMENTACION-TECNICA.md · README.md
└── to-do.md · work.log       sugerencias pendientes y diario de trabajo
```

## 5. Configuración y variables de entorno

La app **no usa variables de entorno ni secretos**: no hay servidor, API ni claves. La única configuración es la de cada usuario y se guarda cifrada con sus datos:

- bloqueo automático;
- última cuenta usada;
- fecha de la última copia.

| Variable | Descripción | Obligatoria | Ejemplo (no secreto) |
|----------|-------------|-------------|----------------------|
| `PORT` | Puerto de `tools/serve.py` (solo desarrollo) | No | `8080` |

La **apariencia** se guarda por dispositivo y sin cifrar en `localStorage` (clave `dinero:apariencia`), porque es una preferencia visual y no un dato personal. Su formato es `{ mode, color, tokens: { light, dark } | null }`. No forma parte de las copias de seguridad.

> En desarrollo, añade `?nosw` a la URL (`http://127.0.0.1:8080/app/?nosw`) para desactivar el service worker y ver los cambios al recargar.

## 6. Instalación y despliegue

### Desarrollo local

Requisitos: macOS/Linux con Python 3.9+ y un navegador moderno.

```bash
python3 tools/serve.py
```

- App: http://127.0.0.1:8080/app/ (con `?nosw` mientras desarrollas).
- Tests: http://127.0.0.1:8080/tests/ (el título de la pestaña muestra `PASS n/n` o `FAIL`).

> WebCrypto y el service worker exigen un contexto seguro: funcionan en `localhost`/`127.0.0.1`, pero **no** al abrir la IP del Mac desde el iPhone por la red local. Para probar en el móvil hay que publicarla con HTTPS.

### Antes de cada commit que cambie `app/`

```bash
python3 tools/release.py
```

El script hace dos cosas:

- Recalcula la versión del service worker: un hash del contenido de `app/`, así que cualquier cambio genera versión nueva y el aviso «Actualizar».
- Pasa las comprobaciones de seguridad.

`python3 tools/release.py --check` no modifica nada y falla si algo no está al día. Es lo que ejecuta GitHub Actions antes de publicar.

### Publicar en GitHub Pages (una sola vez)

1. Crea en GitHub un repositorio **público** (por ejemplo `dinero`). GitHub Pages gratuito requiere repositorio público. El código no contiene datos personales ni secretos.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. En la carpeta del proyecto, sube el código:

   ```bash
   git remote add origin https://github.com/<usuario>/dinero.git
   ```

   ```bash
   git push -u origin main
   ```

4. En **Actions** espera a que termine «Publicar en GitHub Pages». Si falló porque Pages aún no estaba activado, pulsa **Re-run**.
5. La app queda en `https://<usuario>.github.io/dinero/`.

Después, cada `git push` a `main` vuelve a publicar automáticamente.

## 7. Modelo de datos

Todos los importes son **céntimos enteros** (máximo ±999.999.999,99 €). Las fechas son texto `AAAA-MM-DD` en hora local y los identificadores tienen 12 caracteres alfanuméricos.

| Entidad | Campos |
|---|---|
| **Account** | `id, name (≤40), type (bank\|card\|cash\|savings\|investment\|other), icon, letters (≤4), color, initial, includeInTotal, archived, order` |
| **Category** | `id, kind (expense\|income), name, icon, color, archived, order` |
| **Debt** | `id, kind (owe\|owed), name, note (≤140), dueDate \| null` |
| **Budget** | `id, categoryId \| null (null = total del mes), amount` (mensual) |
| **Recurring** | `id, active, frequency (weekly\|monthly\|yearly), interval (1–12), startDate, index, endDate \| null, template` |
| **Movement** | `id, date, type (expense\|income\|transfer\|debt), amount (>0), accountId, toAccountId (transfer), categoryId (expense/income), debtId + flow (add\|pay) (debt), note, recurringId?, ts` |
| **Settings** | `autoLockSec (0\|60\|300\|900), lastBackupAt, lastAccountId, installHintDismissed` |

`icon`, `color` y `type` son claves de listas blancas definidas en `catalog.js`, así que nunca se guardan colores ni SVG libres.

### Reglas de negocio

- **Saldo de una cuenta.** Es el saldo inicial más el efecto de cada movimiento:
  - gasto: −importe;
  - ingreso: +importe;
  - transferencia: −importe en el origen y +importe en el destino;
  - movimiento de deuda con cuenta: signo = `(kind==='owe') === (flow==='add') ? + : −`.
- **Pendiente de una deuda.** Es Σ`add` − Σ`pay`.
- **Tipo de deuda.** Se puede cambiar al editarla, para corregir una deuda apuntada al revés. Como el signo depende de `kind`, el cambio invierte el efecto de todos sus movimientos en las cuentas.
- **Patrimonio neto.** Saldo de las cuentas con `includeInTotal` − lo que debes + lo que te deben.
- **Resumen del mes.**
  - Los movimientos de deuda **no** son gasto ni ingreso: van en «Deudas», y solo si pasaron por una cuenta.
  - Las transferencias no cuentan.
- **Presupuestos.** Nivel `warn` al llegar al 80 % y `over` al superarse.
- **Programados.**
  - La ocurrencia *k* se calcula siempre desde la fecha de inicio, inicio + *k*·intervalo. Así no hay deriva: el día 31 cae el 28/29 de febrero y vuelve al 31 en marzo.
  - Se generan como mucho 500 por ejecución.
  - Al reanudar no se recuperan las fechas de la pausa.
- **Borrados en cascada.**
  - **Cuenta:** se borran sus gastos, ingresos, transferencias y programados.
    - Por cada transferencia borrada, la otra cuenta recibe la diferencia en su saldo inicial, así que su saldo no cambia.
    - Los pagos de deudas (y sus programados) se conservan sin cuenta, para no alterar lo pendiente.
  - **Categoría:** sus movimientos pasan a la categoría que elija la persona.
  - **Deuda:** se borra con sus movimientos y programados.

### Almacenamiento (IndexedDB «app-dinero»)

| Almacén | Clave | Valor |
|---|---|---|
| `meta` | `vault` | `{ v, kdf: { name, hash, iterations, salt }, dek: { iv, ct } }`: la DEK cifrada con la clave derivada del PIN |
| `meta` | `lockout` | `{ failures, until }` (sin cifrar; no es un secreto). Se actualiza en una sola transacción: varios intentos simultáneos cuentan todos |
| `meta` | `revision` | Marca aleatoria de la última escritura. Cada guardado comprueba que sigue siendo la que esta ventana cargó; si otra ventana o pestaña escribió después, se rechaza (`ConflictError`) y la app se bloquea para recargar los datos |
| `vault` | `core` | `{ iv, ct }`: cifrado de `{ version, settings, accounts, categories, debts, budgets, recurring }` |
| `vault` | `mov-AAAA` | `{ iv, ct }`: cifrado de `{ movements }` de ese año |

AAD de cada bloque: `app-dinero:bucket:v1:<clave>`. Impide intercambiar bloques cifrados entre sí.

### Copia de seguridad (`dinero-copia-AAAA-MM-DD.json`)

```json
{ "format": "app-dinero-backup", "version": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<base64>" },
  "cipher": { "name": "AES-GCM", "iv": "<base64>" },
  "data": "<base64 de AES-GCM({ exportedAt, data })>" }
```

- La contraseña tiene al menos 8 caracteres y es independiente del PIN.
- Dentro de la copia, `settings.lastBackupAt` es la fecha de la propia copia. Así, al restaurarla, «Última copia» no queda desfasada.
- Al restaurar se valida todo en **modo estricto**: cualquier incoherencia rechaza el archivo sin tocar los datos actuales.

### CSV

Formato pensado para Excel en español:

- Separador `;`, coma decimal, BOM UTF-8.
- Columnas: Fecha, Tipo, Importe (con signo), Cuenta, Cuenta destino, Categoría, Deuda, Operación, Nota.

## 8. Seguridad implementada

- **Cifrado en reposo.**
  - Una DEK aleatoria de 256 bits cifra los datos (AES-GCM, IV aleatorio de 96 bits por operación y AAD por uso).
  - La DEK solo se guarda cifrada con una KEK derivada del PIN (PBKDF2-SHA-256, 600.000 iteraciones, sal de 16 bytes).
  - En memoria, la DEK es una `CryptoKey` **no extraíble**. Los bytes en claro se ponen a cero tras importarla.
- **PIN.**
  - Comprobación implícita: si el PIN no es el correcto, el descifrado de la DEK falla, así que no se guarda ningún hash del PIN.
  - Se rechazan PIN triviales.
  - Tras 5 fallos seguidos hay que esperar 30 s, el doble en cada fallo siguiente, hasta un máximo de 15 min.
  - La espera se guarda con la hora del dispositivo y, mientras la app sigue abierta, también con un reloj monotónico (`performance.now()`). Adelantar la hora no la acorta, y la cuenta atrás de la pantalla tampoco cambia.
  - Cambiar el PIN solo vuelve a cifrar la DEK.
- **Bloqueo automático y privacidad.**
  - Se bloquea al pasar a segundo plano según el ajuste (por defecto, 1 minuto).
  - El tiempo fuera de la app se mide con el reloj del sistema y con un reloj monotónico. Si el reloj del sistema se atrasa, se bloquea igualmente.
  - El bloqueo se pausa unos minutos solo mientras está abierto el selector de archivos o el menú Compartir, que abre la propia app.
  - Al bloquear se cierran al instante todas las hojas y alertas. Las alertas se cierran como «Cancelar».
  - Al ocultarse, la app y las hojas quedan invisibles para la captura del selector de apps.
- **Contenido y XSS.**
  - Todo el DOM se construye con `createElement`/`textContent` (`ui/dom.js`). No hay `innerHTML`.
  - `tools/release.py` prohíbe `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` y temporizadores con texto.
  - Si se intentara usar un sumidero de HTML, Trusted Types (`require-trusted-types-for 'script'`) lo bloquearía en el navegador.
- **CSP estricta (meta).** `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'`.
  - Sin estilos ni scripts en línea.
  - Solo hay una política Trusted Types, `app-sw`, y acepta únicamente `./sw.js`.
- **Preferencia de tema.** Se lee de `localStorage`, que podría estar manipulado. Por eso solo se aceptan:
  - modos de una lista cerrada;
  - colores `#RRGGBB` o `#RRGGBBAA`, comprobados con una expresión regular antes de usarlos como variables CSS.

  No contiene datos personales.
- **Anti-iframe.** La app no arranca si `window.top !== window.self`. GitHub Pages no permite la cabecera `frame-ancestors`, así que esta comprobación la sustituye.
- **Sin red.**
  - Ni la app ni el service worker hacen peticiones a otros dominios.
  - El service worker solo responde a GET del mismo origen y dentro de su alcance.
  - `release.py` comprueba que no hay `fetch`, XHR ni WebSocket en la app.
- **Validación de entradas.**
  - Normalizadores por entidad con listas blancas, límites de longitud y rango y saneado de texto (sin caracteres de control ni marcas de dirección).
  - Integridad referencial y límites de cantidad.
  - Las copias se validan en modo estricto, con un tamaño máximo de 25 MB y un rango de iteraciones acotado (100.000–5.000.000) para evitar abusos.
- **CSV seguro.** Los textos que empiezan por `= + - @` se neutralizan, para evitar la inyección de fórmulas.
- **Varias ventanas a la vez.** Las escrituras van protegidas por la marca `revision`, así que una ventana con datos antiguos nunca sobrescribe a otra.
- **Acciones destructivas.**
  - Hay que escribir «BORRAR» para borrar todos los datos.
  - Todos los borrados piden confirmación, también el de un movimiento. Borrar un movimiento se puede deshacer justo después.
- **Cadena de suministro.**
  - No hay dependencias en tiempo de ejecución.
  - Los iconos están copiados, con versión fijada y trazados validados.
  - Las acciones de GitHub están fijadas por SHA, con permisos mínimos y `persist-credentials: false`.
- **Privacidad del repositorio.**
  - Los commits van firmados con un correo *noreply* de GitHub.
  - `.gitignore` excluye copias y CSV.

**Limitaciones conocidas de seguridad**

- **Un PIN de 6 cifras es débil frente a un ataque fuera de línea.** Si alguien extrajera la base de datos del dispositivo, podría probar todos los PIN. La protección fuerte en reposo la da el cifrado del propio sistema (bloqueo del iPhone/Android). Las copias usan contraseña larga por este motivo. Ver mejoras en `to-do.md`.
- **Memoria y entorno de ejecución.** JavaScript no garantiza borrar datos de la memoria. Un atacante con control de la página (extensiones, depurador) podría leer los datos mientras la app está desbloqueada.
- **El límite de intentos se guarda en el propio dispositivo.** Solo frena intentos manuales. Si alguien cierra la app y adelanta la hora del dispositivo, la espera guardada se acorta: sin conexión no hay una hora fiable.

## 9. Decisiones de optimización

Mediciones con 20.000 movimientos (unos 3 MB de JSON) en un Mac con Chromium; en un iPhone cabe esperar 2-4 veces más:

| Operación | Tiempo |
|---|---|
| Desbloquear (PBKDF2 600k + descifrar 7 bloques) | ≈ 46 ms |
| Validar y cargar (modo reparación) | ≈ 20 ms |
| Guardar un año (≈ 3.000 movimientos) cifrado | ≈ 1 ms |
| Todos los cálculos de una pantalla (saldos, resumen, series) | ≈ 8 ms |
| `normalizeData` estricto de 20.000 movimientos | ≈ 27 ms |

- **Bloques por año.** Guardar un movimiento solo recifra su año, no todo el historial.
- **Cálculos en una sola pasada (O(n)) con caché por versión del estado.** `store.derived()` no repite cálculos entre repintados si nada cambió.
- **Escrituras encadenadas.** Varios cambios seguidos se agrupan sin solapar transacciones.
- **Repintado agrupado.** El repintado se agrupa en `requestAnimationFrame`. La búsqueda solo repinta la lista de resultados, no la vista entera, y limita los resultados a 300.
- **Sin dependencias.** El JavaScript ocupa unos 230 KB sin minificar (5.700 líneas), con iconos SVG en línea y sin fuentes externas.

## 10. Tests

- **Ejecutar.** Arranca `python3 tools/serve.py` y abre http://127.0.0.1:8080/tests/. Usan una base de datos IndexedDB aparte, `app-dinero-test`.
- **Qué cubren (74 tests).**
  - Interpretación y formato de importes.
  - Fechas: bisiestos, anclaje de día y cambios de mes y año.
  - Validación del modelo en modo estricto y de reparación, integridad referencial y saneado.
  - Cálculos: saldos, deudas, patrimonio, resúmenes, presupuestos y series.
  - Programados: deriva, fin, pausa y tope.
  - Cifrado: ida y vuelta, AAD, manipulación y Base64.
  - Caja fuerte: crear y desbloquear, nada legible en disco, límite de intentos y cambio de PIN.
  - Almacén: persistencia, cascadas, deshacer, programados y restauración.
  - Copias: ida y vuelta, contraseña incorrecta, archivos manipulados o inválidos y CSV.
  - Color: contraste WCAG, ida y vuelta OKLCH y legibilidad garantizada con 12 colores extremos en claro y oscuro.
  - Regresión de la revisión de código:
    - programados: día de anclaje, formulario abierto mientras se genera una cuota, reanudación sin recuperar la pausa;
    - escrituras de otra ventana y restauración fallida que conserva los cambios;
    - limpieza de bloques vacíos al reparar;
    - intentos de PIN simultáneos y espera que no se acorta al adelantar la hora;
    - totales de deudas pagadas de más;
    - borrar una cuenta sin alterar el saldo de las demás;
    - corregir el tipo de una deuda;
    - la copia guarda su propia fecha como «última copia».
- **Comprobaciones automáticas de código.** `python3 tools/release.py --check`, también en GitHub Actions.
- **Pruebas manuales hechas en el navegador:**
  - recorrido completo con tamaño iPhone y Android, en modo claro y oscuro;
  - funcionamiento sin conexión con el servidor parado;
  - flujo de actualización del service worker;
  - temas con colores extremos (amarillo, azul marino) y modo automático siguiendo al sistema;
  - confirmación y «Deshacer» al borrar, foco al cerrar hojas, cambio de tipo de deuda y cuenta atrás del PIN con la hora adelantada.

## 11. Limitaciones conocidas y deuda técnica

Los pendientes y mejoras propuestas están en **[to-do.md](to-do.md)**. Los principales:

- Validar en un iPhone real el teclado sobre las hojas y el menú Compartir con archivos.
- Desbloqueo con Face ID (WebAuthn PRF) y opción de contraseña alfanumérica.
- Importación de extractos bancarios, dividir gastos y sincronización opcional entre dispositivos.
- Tamaño de letra dinámico de iOS y pantallas de arranque.
- Los datos de Safari y los de la app instalada en iPhone son almacenes distintos, un comportamiento del sistema. La app avisa de ello.

## 12. Cómo contribuir

- **Estilo.** JavaScript moderno sin dependencias, con dos espacios y comillas simples. Los textos de interfaz y comentarios van en español.
- **DOM.** Construye siempre con `h()`/`s()` de `ui/dom.js`. Nunca uses HTML como texto.
- **Datos.** Toda escritura pasa por una función de `store.js`, que valida con `model.js`. Las vistas nunca modifican el estado directamente.
- **Iconos.** Añádelos en `tools/fetch_icons.py` (y en `PICKER_ICONS` si son elegibles) y ejecuta el script.
- **Antes de cada commit:**
  1. tests en verde (`/tests/`);
  2. `python3 tools/release.py`;
  3. anotar en `work.log` lo hecho y en `to-do.md` lo propuesto.
- **Commits.** Un commit por cambio coherente, con mensaje en español que explique el porqué. Rama principal: `main`, que publica automáticamente.
