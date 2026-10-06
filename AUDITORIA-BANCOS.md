# Auditoría de seguridad — funcionalidad bancaria de Nummo

Fecha: 6 de octubre de 2026 · Alcance: importación de extractos, Open Banking (Enable Banking), sincronización, reglas, cambios en la caja fuerte y en la publicación. Revisión hecha como auditor externo sobre el código de la rama `cuentas-bancarias`.

**Conclusión.** No quedan problemas graves conocidos en el código. Los riesgos que siguen abiertos dependen del entorno (navegador, iPhone, proveedor) o de cómo se use la app, y se detallan en «Riesgos que siguen existiendo».

## 1. Cómo se ha revisado

- Lectura completa de los módulos nuevos (`core/import/*`, `core/bank/*`, vistas nuevas) y de los cambios en `model.js`, `store.js`, `vault.js`, `main.js`.
- 118 tests automáticos: duplicados, `sync()` ×3, pendientes, saldos, reglas, transferencias, errores de la API (401, 422, 429, 5xx, CORS, JSON inválido), sesión caducada o revocada, banco caído, archivos dañados y bombas ZIP, secretos y copias.
- Recorrido completo en el navegador con la API de Enable Banking simulada: ida al banco, vuelta con `code`, vinculación, sincronización y resincronización.
- `tools/release.py --check`: red solo en un módulo, CSP, sin `innerHTML`/`eval`, sin `console.log`, escaneo de secretos y de archivos personales en todo el repositorio (comprobado con una clave y un `.xlsx` de prueba).

## 2. Resultado por punto

| Punto | Estado | Detalle |
| --- | --- | --- |
| Contraseñas del banco | ✅ Nunca pasan por Nummo | Autenticación en el banco por redirección (PSD2). No hay ningún formulario de credenciales bancarias ni scraping |
| Credenciales de Ruralvía | ✅ No se guardan | Solo existe el permiso de lectura que da el banco al proveedor |
| Tokens en texto plano | ✅ Cifrados | Clave privada, id de sesión y conexión a medias van en el bloque `secrets` (AES-256-GCM con la DEK) |
| Secretos en el código / GitHub | ✅ Ninguno | Cada persona trae su propia aplicación. `release.py` busca PEM, JWT y tokens; `.gitignore` excluye `.pem`, `.key`, `.xlsx`, `.csv` y copias |
| API keys en el cliente | ⚠️ Aceptado con límites | La clave privada de Enable Banking vive en el dispositivo (ver riesgo R1) |
| IBAN expuestos | ✅ Minimizado | Solo `•••• 1234` y hash SHA-256. No se exportan |
| Datos financieros en logs | ✅ No | Errores con código (`rate_limit`, `expired`…); `console.log/info/debug` prohibidos; los fallos de lectura de archivos solo registran el tipo de error |
| Información sensible en errores | ✅ No | `BankError` descarta el cuerpo de la respuesta y limpia el código técnico (probado con un IBAN y `<script>` en la respuesta) |
| Copias sin cifrar | ✅ Cifradas | Las copias ya iban cifradas; ahora además no incluyen el acceso al banco, y restaurar una copia lo conserva |
| Base de datos local sin protección | ✅ Cifrada | Todo en IndexedDB va cifrado. Con un banco conectado es obligatoria una contraseña (≥ 10 caracteres) en lugar del PIN |
| Exportaciones | ✅ Con aviso | El CSV avisa de que no va cifrado; no lleva IBAN ni secretos |
| Acceso a datos sensibles desde cualquier parte | ✅ Controlado | Los secretos no están en `state`: solo `core/bank/service.js` los lee con `store.getSecrets()`. Solo `enablebanking.js` puede usar la red |
| HTTPS/TLS | ✅ | Dominio fijo `https://api.enablebanking.com`; CSP `connect-src` limitada a él; `credentials: 'omit'`; `referrer: no-referrer` |
| Rotación / revocación | ✅ | JWT de 1 h firmados en el momento; renovar el permiso revoca la sesión anterior; desconectar y «Borrar todos los datos» revocan en el banco |
| Sesiones | ✅ | Estado de la sesión comprobado en cada sincronización; caducada o revocada → se marca y se pide reconectar sin tocar los datos |
| Vuelta del banco (CSRF/OAuth) | ✅ | `state` aleatorio de 32 caracteres, guardado cifrado, de un solo uso y con caducidad de 30 min; `code` borrado de la URL al arrancar |
| SQL injection | No aplica | No hay SQL |
| XSS | ✅ | DOM con `textContent`, Trusted Types y CSP sin cambios; textos del banco saneados y recortados |
| CSRF | No aplica | No hay servidor con cookies; las llamadas van sin credenciales |
| Validación de datos | ✅ | Respuestas de la API con tipos comprobados y 8 MB máximo; archivos con límites de tamaño, filas y descompresión; modelo v2 validado al cargar y al restaurar |
| Dependencias vulnerables | ✅ | Sin dependencias en tiempo de ejecución; WebCrypto para JWT y cifrado; acciones de GitHub fijadas por SHA |
| Variables de entorno | No aplica | No hay servidor; la configuración de cada persona va cifrada en su dispositivo |
| Concurrencia | ✅ | Escrituras encadenadas (también los secretos); cerrojo de sincronización entre pestañas; si la app se bloquea a mitad de una sincronización, no se aplica nada |
| Duplicados / errores de sincronización | ✅ | Idempotencia probada (`sync()` ×3), también con apuntes idénticos el mismo día, pendientes y archivo + banco |
| Privacidad | ✅ | Ni IA, ni analítica, ni informes de fallos. Desconectar, borrar los movimientos de un banco, exportar y borrarlo todo |

## 3. Problemas encontrados durante la revisión y ya corregidos

1. **Sincronización tras bloquear.** Una sincronización lenta podía aplicarse a la sesión siguiente si se bloqueaba y desbloqueaba a mitad. Ahora se comprueba la sesión antes de aplicar (test incluido).
2. **«Borrar todos los datos» no retiraba el permiso en el banco.** Ahora se revocan antes todas las sesiones.
3. **Reintentos automáticos tras un fallo persistente** (por ejemplo CORS) gastaban las 4 consultas diarias. Ahora se espera 1 h tras un fallo.
4. **Escrituras de secretos fuera de la cola de guardado**: podían chocar con otra escritura. Ahora van por la misma cola.
5. **Vuelta del banco a otra ventana (iPhone).** Si el banco abre Safari en lugar de la app instalada, se perdía la conexión. Ahora esa ventana muestra la dirección para pegarla en la app.

## 4. Riesgos que siguen existiendo

| # | Riesgo | Impacto | Mitigación actual | Qué haría falta para eliminarlo |
| --- | --- | --- | --- | --- |
| R1 | **La clave privada de la aplicación de Enable Banking está en el dispositivo.** Enable Banking recomienda tenerla en un servidor | Quien desbloquee la app o controle la página mientras está abierta podría pedir los datos de **tus** cuentas vinculadas mientras el permiso esté vigente (solo lectura; el modo gratuito no da acceso a otras cuentas) | Cifrada con contraseña, importada como no extraíble, solo AIS, revocable desde Nummo, desde el panel de Enable Banking o desde el banco | Un intermediario propio (Cloudflare Worker) que guarde la clave. Obligatorio si Nummo fuera para más personas |
| R2 | **CORS sin comprobar.** No se ha podido verificar desde aquí si `api.enablebanking.com` admite llamadas desde una web | Si no las admite, la conexión con el banco no funcionará (la importación de extractos sí) | El error se muestra claramente («el navegador no ha podido llamar…») | El mismo intermediario de R1 |
| R3 | **Contraseña elegida por la persona.** La protección en reposo depende de ella | Con una contraseña débil, alguien con una copia de la base de datos podría adivinarla | Mínimo 10 caracteres, sin contraseñas comunes ni solo números; PBKDF2 600.000 iteraciones | Passkey (WebAuthn PRF) o un KDF más lento (Argon2, requiere WASM) |
| R4 | **Memoria del navegador.** Con la app desbloqueada, el texto PEM y los datos están en memoria de JavaScript | Una extensión maliciosa o un depurador podrían leerlos | Bloqueo automático; datos ocultos al salir de la app | Inherente a una app web |
| R5 | **Confianza en Enable Banking y en el banco** | El proveedor ve los movimientos en tránsito (es un AISP regulado) | Solo lectura, permiso limitado en el tiempo y revocable | Sería necesaria una licencia AISP propia: desproporcionado |
| R6 | **Comportamiento real de Caja Rural sin comprobar**: identificador de apunte estable, historial disponible, si aparecen ahorro, tarjetas o plazos fijos | Posibles duplicados si cambian a la vez el identificador y el concepto de un mismo apunte | Huella y comparación por fecha e importe además del identificador | Probar con la cuenta real y ajustar |
| R7 | **Sin actualización en segundo plano** | Los movimientos llegan al abrir la app, no antes | Se explica en la app; botón «Sincronizar ahora» | App nativa o servidor (descartado por privacidad y coste) |
| R8 | **Un permiso activo por persona** en los bancos de Redsys | Conectar en dos dispositivos anula el permiso del primero | Avisado en la guía | Sincronización entre dispositivos (opción E) con el banco solo en uno |
| R9 | **Publicación en un repositorio público** | Cualquiera ve el código (no hay secretos en él) | Escaneo de secretos en cada publicación | — |
| R10 | **Hash del IBAN sin sal** | Dentro de una copia descifrada, el IBAN se podría deducir probando | Las copias van cifradas; el hash solo sirve para reconocer cuentas | Usar un HMAC con una clave de la caja fuerte |

## 5. Recomendaciones antes de usarla con datos reales

1. Hacer la primera conexión real y comprobar R2 y R6 (pasos en `to-do.md`).
2. Usar una contraseña larga (cuatro palabras al azar) y hacer una copia de seguridad cifrada después de conectar.
3. No subir nunca al repositorio el `.pem` ni extractos descargados (el `.gitignore` y `release.py` lo impiden, pero conviene saberlo).
4. Al dejar de usar la app en un dispositivo: Bancos → Desconectar, y después borrar los datos.
