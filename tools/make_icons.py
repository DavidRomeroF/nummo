#!/usr/bin/env python3
"""Genera los iconos de Nummo (SVG y PNG) a partir del logo: una «N» de trazo continuo, como un
clip, en blanco cálido sobre una placa casi negra.

La N está redibujada en vectorial para que se vea nítida a cualquier tamaño. Sus medidas salen
del logo original (placa de 300 px) y se ajustaron superponiendo ambos dibujos: coinciden en un
98 % de los píxeles del trazo.

Uso:  python3 tools/make_icons.py

Necesita macOS: los PNG se dibujan con QuickLook (qlmanage) y se ajustan con sips.
Salida en app/icons/:
  icon.svg               favicon, marca en la app y portada de privacidad (esquinas redondeadas)
  icon-192.png, icon-512.png  icono «any» del manifest (cuadrado; el sistema aplica su forma)
  icon-maskable-512.png  icono adaptable de Android (la N cabe holgada en la zona segura)
  apple-touch-icon.png   180×180 sin transparencia (iOS redondea las esquinas)
"""
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "icons"
SIZE = 512
TOP, BOTTOM = "#181818", "#090909"  # degradado vertical de la placa
INK = "#F2EFEB"  # blanco cálido del trazo

# Medidas del logo original, en px de una placa de 300 (líneas centrales del trazo).
TILE = 300
STROKE = 8.8
STEM_X = 114.25  # palo izquierdo
INNER_X, OUTER_X = 228.0, 247.75  # las dos líneas del palo derecho
TOP_Y = 124.65  # parte alta de los dos arcos
BOTTOM_Y = 241.35  # parte baja de la curva inferior derecha
UPPER_K, LOWER_K = 22.75, -37.75  # diagonales a 45°: x = y + k
HOOK_R, HOOK_CY, HOOK_TIP = 9.5, 230.75, 50.0  # gancho inferior izquierdo (radio, centro, ángulo de la punta)


def n_paths(size: int) -> list[str]:
    """Los dos trazos de la N, centrados en un lienzo de `size` px."""
    k = size / TILE
    left, right = STEM_X - STROKE / 2, OUTER_X + STROKE / 2
    top, bottom = TOP_Y - STROKE / 2, max(BOTTOM_Y, HOOK_CY + HOOK_R) + STROKE / 2
    cx, cy = (left + right) / 2, (top + bottom) / 2

    def p(x: float, y: float) -> str:
        return f"{size / 2 + (x - cx) * k:.2f} {size / 2 + (y - cy) * k:.2f}"

    def at(center: tuple, r: float, deg: float) -> tuple:
        a = math.radians(deg)
        return center[0] + r * math.cos(a), center[1] + r * math.sin(a)

    def arc(r: float, large: int, sweep: int, end: tuple) -> str:
        return f"A{r * k:.2f} {r * k:.2f} 0 {large} {sweep} {p(*end)}"

    # Arco superior izquierdo: tangente al palo y a la diagonal de arriba.
    r1 = (TOP_Y + UPPER_K - STEM_X) / math.sqrt(2)
    c1 = (STEM_X + r1, TOP_Y + r1)
    # Curva inferior derecha: tangente a la diagonal de abajo y al palo exterior derecho.
    r2 = (OUTER_X - BOTTOM_Y - LOWER_K) / math.sqrt(2)
    c2 = (OUTER_X - r2, BOTTOM_Y - r2)
    # La diagonal de arriba termina al cortar esa curva: (y + a)² + (y + b)² = r2².
    a, b = UPPER_K - c2[0], -c2[1]
    y_end = (-(a + b) + math.sqrt((a + b) ** 2 - 2 * (a * a + b * b - r2 * r2))) / 2
    # Remate redondo del palo derecho y gancho tangente al palo izquierdo.
    r3 = (OUTER_X - INNER_X) / 2
    c3 = ((OUTER_X + INNER_X) / 2, TOP_Y + r3)
    hook_c = (STEM_X + HOOK_R, HOOK_CY)

    # Trazo 1: gancho → palo izquierdo → arco → diagonal de arriba.
    first = (f"M{p(*at(hook_c, HOOK_R, HOOK_TIP))}{arc(HOOK_R, 0, 1, (STEM_X, HOOK_CY))}"
             f"L{p(STEM_X, c1[1])}{arc(r1, 0, 1, at(c1, r1, 315))}L{p(y_end + UPPER_K, y_end)}")
    # Trazo 2: diagonal de abajo → curva → palo derecho por fuera → remate → por dentro.
    second = (f"M{p(STEM_X, STEM_X - LOWER_K)}L{p(*at(c2, r2, 135))}{arc(r2, 0, 0, (OUTER_X, c2[1]))}"
              f"L{p(OUTER_X, c3[1])}{arc(r3, 0, 0, (INNER_X, c3[1]))}L{p(INNER_X, INNER_X - UPPER_K)}")
    return [first, second]


def svg(radius: int) -> str:
    """Icono de 512×512; `radius` es el redondeo de las esquinas de la placa (0: a sangre)."""
    paths = "".join(f'<path d="{d}"/>' for d in n_paths(SIZE))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{TOP}"/>'
        f'<stop offset="1" stop-color="{BOTTOM}"/></linearGradient></defs>'
        f'<rect width="{SIZE}" height="{SIZE}" rx="{radius}" fill="url(#g)"/>'
        f'<g fill="none" stroke="{INK}" stroke-width="{STROKE * SIZE / TILE:.2f}" stroke-linecap="round" '
        f'stroke-linejoin="round">{paths}</g></svg>\n'
    )


def render(svg_text: str, size: int, dest: Path, tmp: Path) -> None:
    source = tmp / f"{dest.stem}.svg"
    source.write_text(svg_text, encoding="utf-8")
    subprocess.run(["qlmanage", "-t", "-s", str(SIZE), "-o", str(tmp), str(source)], check=True, capture_output=True)
    rendered = tmp / f"{source.name}.png"
    shutil.copyfile(rendered, dest)
    if size != SIZE:
        subprocess.run(["sips", "-z", str(size), str(size), str(dest)], check=True, capture_output=True)


def main() -> int:
    if shutil.which("qlmanage") is None or shutil.which("sips") is None:
        print("Este script necesita macOS (qlmanage y sips).", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "icon.svg").write_text(svg(radius=115), encoding="utf-8")
    square = svg(radius=0)
    with tempfile.TemporaryDirectory() as folder:
        tmp = Path(folder)
        # QuickLook aplana la transparencia sobre blanco: los PNG van a sangre (sin esquinas).
        render(square, 192, OUT / "icon-192.png", tmp)
        render(square, 512, OUT / "icon-512.png", tmp)
        render(square, 512, OUT / "icon-maskable-512.png", tmp)
        render(square, 180, OUT / "apple-touch-icon.png", tmp)
    for name in ("icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"):
        info = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(OUT / name)], capture_output=True, text=True).stdout
        dims = [line.split(":")[1].strip() for line in info.splitlines() if "pixel" in line]
        print(f"{name}: {'×'.join(dims)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
