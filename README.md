# Dinero

App web (PWA) para controlar tu dinero desde el móvil (iPhone y Android):

- gastos, ingresos y transferencias entre tus cuentas;
- deudas («debo» y «me deben») con pagos parciales;
- presupuestos mensuales y movimientos programados;
- análisis con gráficas;
- temas claro, oscuro y automático con el color que elijas;
- copias de seguridad cifradas.

**Privada por diseño:** sin servidores ni cuentas. Los datos se guardan **solo en el dispositivo**, cifrados con AES-256 y protegidos con un PIN. Funciona sin conexión y no tiene dependencias externas.

## Documentación

- **[Guía de uso](GUIA-DE-USO.md):** para quien la usa. Instalación en el móvil, tareas del día a día y preguntas frecuentes.
- **[Documentación técnica](DOCUMENTACION-TECNICA.md):** arquitectura, modelo de datos, seguridad, rendimiento, tests y despliegue.
- **[to-do.md](to-do.md):** pendientes y mejoras propuestas.
- **[work.log](work.log):** diario de todo lo hecho.

## Probar en local

Requisito: Python 3.9 o superior.

```bash
python3 tools/serve.py
```

- App: http://127.0.0.1:8080/app/ (añade `?nosw` mientras desarrollas para desactivar la caché sin conexión).
- Tests: http://127.0.0.1:8080/tests/

## Publicar (GitHub Pages)

Antes de cada commit que cambie `app/`:

```bash
python3 tools/release.py
```

Sube la versión de la app y pasa las comprobaciones de seguridad.

Primera publicación:

1. Crea un repositorio **público** en GitHub, por ejemplo `dinero`.
2. Ve a **Settings → Pages → Source: GitHub Actions**.
3. Sube el código:

   ```bash
   git remote add origin https://github.com/<usuario>/dinero.git
   ```

   ```bash
   git push -u origin main
   ```

4. La app quedará en `https://<usuario>.github.io/dinero/`. Ábrela en el móvil e instálala:
   - **iPhone:** Compartir → Añadir a pantalla de inicio.
   - **Android:** menú ⋮ → Instalar aplicación.

Cada `git push` a `main` vuelve a publicar automáticamente.

## Créditos

Iconos: [Tabler Icons](https://tabler.io/icons) (MIT), © 2020-2026 Paweł Kuna.
