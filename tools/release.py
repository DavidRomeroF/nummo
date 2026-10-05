#!/usr/bin/env python3
"""Prepara la app para publicar y comprueba reglas de calidad y seguridad.

Uso:
  python3 tools/release.py           Regenera la versión y la lista de archivos de app/sw.js.
  python3 tools/release.py --check   No modifica nada: falla si app/sw.js no está al día o si
                                     alguna comprobación no pasa (lo ejecuta GitHub Actions).

Comprobaciones:
  1. Service worker al día: VERSION es un hash del contenido de todos los archivos de app/, así
     cualquier cambio publica una versión nueva y el aviso «Actualizar» aparece solo.
  2. Sin sumideros de HTML ni código dinámico en app/ (innerHTML, outerHTML, insertAdjacentHTML,
     document.write, eval, new Function, setTimeout con texto).
  3. Sin peticiones de red desde la app (fetch/XMLHttpRequest/WebSocket/sendBeacon), salvo el
     propio service worker.
  4. Todos los iconos que usa el código existen en app/js/ui/icon-data.js.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
SW = APP / "sw.js"
ICON_DATA = APP / "js" / "ui" / "icon-data.js"
CATALOG = APP / "js" / "core" / "catalog.js"
BLOCK_RE = re.compile(r"// @generated-start\n.*?// @generated-end\n", re.S)
IGNORED = {".DS_Store", "sw.js"}

FORBIDDEN = [
    (re.compile(r"\.(innerHTML|outerHTML)\b"), "innerHTML/outerHTML"),
    (re.compile(r"insertAdjacentHTML"), "insertAdjacentHTML"),
    (re.compile(r"document\.write"), "document.write"),
    (re.compile(r"\beval\s*\("), "eval"),
    (re.compile(r"new\s+Function\s*\("), "new Function"),
    (re.compile(r"set(Timeout|Interval)\s*\(\s*['\"`]"), "setTimeout/setInterval con texto"),
]
NETWORK = re.compile(r"\b(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource)")
ICON_USE = re.compile(r"(?:\bicon\(\s*|iconName:\s*|\bicon:\s*)'([a-z0-9-]+)'")


def app_files():
    return sorted(p for p in APP.rglob("*") if p.is_file() and p.name not in IGNORED)


def generated_block():
    files = app_files()
    digest = hashlib.sha256()
    for path in files:
        rel = path.relative_to(APP).as_posix()
        digest.update(rel.encode() + b"\0" + path.read_bytes() + b"\0")
    assets = ["./"] + [p.relative_to(APP).as_posix() for p in files]
    return (
        "// @generated-start\n"
        f"const VERSION = '{digest.hexdigest()[:12]}';\n"
        f"const ASSETS = {json.dumps(assets, ensure_ascii=False)};\n"
        "// @generated-end\n"
    )


def lint():
    problems = []
    known_icons = set(re.findall(r'^\s*"([a-z0-9-]+)":', ICON_DATA.read_text(encoding="utf-8"), re.M))
    for path in sorted(APP.rglob("*.js")):
        if path == ICON_DATA:
            continue
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        for pattern, label in FORBIDDEN:
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                problems.append(f"{rel}:{line}: uso prohibido ({label})")
        if path != SW:
            for match in NETWORK.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                problems.append(f"{rel}:{line}: petición de red no permitida ({match.group(1).strip('( ')})")
        for match in ICON_USE.finditer(text):
            if match.group(1) not in known_icons:
                line = text.count("\n", 0, match.start()) + 1
                problems.append(f"{rel}:{line}: icono inexistente «{match.group(1)}»")
    picker = re.search(r"PICKER_ICONS = \[(.*?)\];", CATALOG.read_text(encoding="utf-8"), re.S)
    for name in re.findall(r"'([a-z0-9-]+)'", picker.group(1) if picker else ""):
        if name not in known_icons:
            problems.append(f"app/js/core/catalog.js: PICKER_ICONS incluye un icono inexistente «{name}»")
    return problems


def main():
    check = "--check" in sys.argv[1:]
    problems = lint()
    sw_text = SW.read_text(encoding="utf-8")
    if not BLOCK_RE.search(sw_text):
        problems.append("app/sw.js: falta el bloque // @generated-start … // @generated-end")
    else:
        expected = BLOCK_RE.sub(generated_block().replace("\\", "\\\\"), sw_text, count=1)
        if expected != sw_text:
            if check:
                problems.append("app/sw.js no está al día: ejecuta «python3 tools/release.py» y vuelve a hacer commit")
            else:
                SW.write_text(expected, encoding="utf-8")
                print("app/sw.js actualizado")
    if problems:
        print("Problemas encontrados:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    version = re.search(r"const VERSION = '([^']+)'", SW.read_text(encoding="utf-8")).group(1)
    print(f"OK · versión {version} · {len(app_files()) + 1} recursos en caché")
    return 0


if __name__ == "__main__":
    sys.exit(main())
