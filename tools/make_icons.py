#!/usr/bin/env python3
"""Genera los iconos de la app (SVG y PNG) a partir del símbolo «wallet» de Tabler Icons (MIT).

Uso:  python3 tools/make_icons.py

Necesita macOS: los PNG se dibujan con QuickLook (qlmanage) y se ajustan con sips.
Salida en app/icons/:
  icon.svg               favicon y portada de privacidad (esquinas redondeadas)
  icon-192.png, icon-512.png  icono «any» del manifest (cuadrado; el sistema aplica su forma)
  icon-maskable-512.png  icono adaptable de Android (símbolo dentro de la zona segura)
  apple-touch-icon.png   180×180 sin transparencia (iOS redondea las esquinas)
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "icons"
WALLET = [
    "M17 8v-3a1 1 0 0 0 -1 -1h-10a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1 -1 1h-12a2 2 0 0 1 -2 -2v-12",
    "M20 12v4h-4a2 2 0 0 1 0 -4h4",
]
TOP, BOTTOM = "#17A884", "#0A6B58"


def svg(radius: int, glyph: float) -> str:
    """Icono de 512×512; `glyph` es la fracción del lado que ocupa el símbolo."""
    scale = 512 * glyph / 24
    offset = (512 - 24 * scale) / 2
    paths = "".join(f'<path d="{d}"/>' for d in WALLET)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{TOP}"/>'
        f'<stop offset="1" stop-color="{BOTTOM}"/></linearGradient></defs>'
        f'<rect width="512" height="512" rx="{radius}" fill="url(#g)"/>'
        f'<g transform="translate({offset:.2f} {offset:.2f}) scale({scale:.4f})" fill="none" stroke="#fff" '
        f'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{paths}</g></svg>\n'
    )


def render(svg_text: str, size: int, dest: Path, tmp: Path) -> None:
    source = tmp / f"{dest.stem}.svg"
    source.write_text(svg_text, encoding="utf-8")
    subprocess.run(["qlmanage", "-t", "-s", "512", "-o", str(tmp), str(source)], check=True, capture_output=True)
    rendered = tmp / f"{source.name}.png"
    shutil.copyfile(rendered, dest)
    if size != 512:
        subprocess.run(["sips", "-z", str(size), str(size), str(dest)], check=True, capture_output=True)


def main() -> int:
    if shutil.which("qlmanage") is None or shutil.which("sips") is None:
        print("Este script necesita macOS (qlmanage y sips).", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    rounded = svg(radius=112, glyph=0.58)
    square = svg(radius=0, glyph=0.58)
    maskable = svg(radius=0, glyph=0.46)
    (OUT / "icon.svg").write_text(rounded, encoding="utf-8")
    with tempfile.TemporaryDirectory() as folder:
        tmp = Path(folder)
        # QuickLook aplana la transparencia sobre blanco: los PNG van a sangre (sin esquinas).
        render(square, 192, OUT / "icon-192.png", tmp)
        render(square, 512, OUT / "icon-512.png", tmp)
        render(maskable, 512, OUT / "icon-maskable-512.png", tmp)
        render(square, 180, OUT / "apple-touch-icon.png", tmp)
    for name in ("icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"):
        info = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(OUT / name)], capture_output=True, text=True).stdout
        dims = [line.split(":")[1].strip() for line in info.splitlines() if "pixel" in line]
        print(f"{name}: {'×'.join(dims)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
