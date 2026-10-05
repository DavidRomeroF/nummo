#!/usr/bin/env python3
"""Descarga los iconos de Tabler Icons que usa la app y genera app/js/ui/icon-data.js.

Uso:  python3 tools/fetch_icons.py

- Versión de Tabler fijada en TABLER_VERSION (licencia MIT, se conserva el aviso en el módulo).
- Solo se aceptan elementos geométricos de una lista blanca y se convierten a trazados «d»
  validados con una expresión regular: el resultado no puede contener scripts ni estilos.
- Para añadir un icono: añádelo a ICONS, ejecuta el script y, si es para el selector de
  cuentas/categorías, añádelo también a PICKER_ICONS en app/js/core/catalog.js.
"""
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

TABLER_VERSION = "v3.48.0"
BASE_URL = f"https://raw.githubusercontent.com/tabler/tabler-icons/{TABLER_VERSION}/icons/outline/"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "js" / "ui" / "icon-data.js"

ICONS = [
    # Interfaz
    "home", "list-details", "scale", "chart-pie", "dots", "plus", "x", "check",
    "chevron-left", "chevron-right", "chevron-down", "search", "adjustments-horizontal",
    "trash", "pencil", "arrows-exchange", "arrow-right", "arrow-up", "arrow-down", "calendar",
    "repeat", "target", "lock", "lock-open", "shield-lock", "key", "download", "upload",
    "file-spreadsheet", "settings", "info-circle", "alert-triangle", "eye", "eye-off",
    "backspace", "share-2", "square-plus", "device-mobile", "refresh", "archive",
    "circle-check", "help-circle", "letter-case", "clock", "user",
    # Selector de cuentas y categorías
    "shopping-cart", "basket", "tools-kitchen-2", "coffee", "pizza", "beer", "glass-full",
    "bus", "car", "gas-station", "parking", "train", "plane", "bike", "motorbike",
    "building", "bulb", "droplet", "flame", "wifi", "device-tv", "movie", "music",
    "device-gamepad-2", "ticket", "book", "school", "shopping-bag", "shirt", "hanger",
    "diamond", "first-aid-kit", "pill", "dental", "stethoscope", "barbell", "ball-football",
    "swimming", "paw", "baby-carriage", "heart", "gift", "cake", "confetti", "scissors",
    "brush", "tool", "hammer", "plant-2", "umbrella", "shield", "receipt", "file-invoice",
    "building-bank", "credit-card", "cash", "cash-banknote", "wallet", "pig-money", "coin",
    "coins", "chart-line", "trending-up", "briefcase", "receipt-refund", "report-money",
    "currency-euro", "users", "world", "camera", "headphones", "device-laptop", "cloud",
    "package", "truck", "tag", "star", "beach",
]

NUM = r"-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
PATH_RE = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\-\s]+$")


def fetch(name: str) -> str:
    # curl usa los certificados del sistema; evita problemas de CA con el Python de Apple.
    result = subprocess.run(
        ["curl", "-sSf", "--max-time", "20", BASE_URL + name + ".svg"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"no se pudo descargar «{name}»: {result.stderr.strip()}")
    return result.stdout


def num(value: str) -> float:
    if not re.fullmatch(NUM, value or ""):
        raise ValueError(f"valor numérico no válido: {value!r}")
    return float(value)


def fmt(n: float) -> str:
    return ("%g" % n)


def to_path(tag: str, a: dict) -> str:
    if tag == "path":
        d = a.get("d", "").strip()
        if not d or not PATH_RE.match(d):
            raise ValueError(f"trazado no válido: {d!r}")
        return " ".join(d.split())
    if tag == "circle":
        cx, cy, r = num(a["cx"]), num(a["cy"]), num(a["r"])
        return f"M{fmt(cx - r)} {fmt(cy)}a{fmt(r)} {fmt(r)} 0 1 0 {fmt(2 * r)} 0a{fmt(r)} {fmt(r)} 0 1 0 {fmt(-2 * r)} 0"
    if tag == "ellipse":
        cx, cy, rx, ry = num(a["cx"]), num(a["cy"]), num(a["rx"]), num(a["ry"])
        return f"M{fmt(cx - rx)} {fmt(cy)}a{fmt(rx)} {fmt(ry)} 0 1 0 {fmt(2 * rx)} 0a{fmt(rx)} {fmt(ry)} 0 1 0 {fmt(-2 * rx)} 0"
    if tag == "line":
        return f"M{fmt(num(a['x1']))} {fmt(num(a['y1']))}L{fmt(num(a['x2']))} {fmt(num(a['y2']))}"
    if tag in ("polyline", "polygon"):
        pts = [fmt(num(p)) for p in re.split(r"[\s,]+", a["points"].strip())]
        pairs = [f"{pts[i]} {pts[i + 1]}" for i in range(0, len(pts), 2)]
        return "M" + "L".join(pairs) + ("Z" if tag == "polygon" else "")
    if tag == "rect":
        x, y = num(a.get("x", "0")), num(a.get("y", "0"))
        w, h = num(a["width"]), num(a["height"])
        rx = num(a.get("rx", a.get("ry", "0")))
        if rx <= 0:
            return f"M{fmt(x)} {fmt(y)}h{fmt(w)}v{fmt(h)}h{fmt(-w)}Z"
        r = min(rx, w / 2, h / 2)
        return (f"M{fmt(x + r)} {fmt(y)}h{fmt(w - 2 * r)}a{fmt(r)} {fmt(r)} 0 0 1 {fmt(r)} {fmt(r)}"
                f"v{fmt(h - 2 * r)}a{fmt(r)} {fmt(r)} 0 0 1 {fmt(-r)} {fmt(r)}h{fmt(-(w - 2 * r))}"
                f"a{fmt(r)} {fmt(r)} 0 0 1 {fmt(-r)} {fmt(-r)}v{fmt(-(h - 2 * r))}a{fmt(r)} {fmt(r)} 0 0 1 {fmt(r)} {fmt(-r)}Z")
    raise ValueError(f"elemento no permitido: <{tag}>")


def parse(svg_text: str) -> list:
    svg_text = re.sub(r"<!--.*?-->", "", svg_text, flags=re.S)
    root = ET.fromstring(svg_text)
    paths = []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag == "svg":
            continue
        if el.get("stroke") == "none":
            continue  # recuadro invisible de 24×24 que incluyen algunos iconos
        if el.get("fill") not in (None, "none"):
            raise ValueError("el icono tiene partes rellenas (no soportado)")
        paths.append(to_path(tag, el.attrib))
    if not paths:
        raise ValueError("icono vacío")
    return paths


def main() -> int:
    if len(set(ICONS)) != len(ICONS):
        print("Hay iconos duplicados en ICONS", file=sys.stderr)
        return 1
    data, errors = {}, []
    for name in ICONS:
        try:
            data[name] = parse(fetch(name))
        except Exception as exc:  # noqa: BLE001 — se informa y se continúa con el resto
            errors.append(f"  {name}: {exc}")
    if errors:
        print("Iconos con problemas:\n" + "\n".join(errors), file=sys.stderr)
        return 1
    lines = [
        "// Generado por tools/fetch_icons.py — no editar a mano.",
        f"// Tabler Icons {TABLER_VERSION} · MIT License · Copyright (c) 2020-2026 Paweł Kuna · https://tabler.io/icons",
        "// Cada icono es una lista de trazados SVG (viewBox 24×24, trazo de 2 px).",
        "export default {",
    ]
    for name in sorted(data):
        joined = ", ".join('"' + d + '"' for d in data[name])
        lines.append(f'  "{name}": [{joined}],')
    lines.append("};")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(data)} iconos escritos en {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
