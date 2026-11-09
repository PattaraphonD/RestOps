"""Render the app icons (plate mark on brand green) as PNGs using only the standard library."""
import math, struct, zlib
from pathlib import Path

BRAND = (0x1d, 0x5c, 0x45)
WHITE = (255, 255, 255)
out_dir = Path(__file__).resolve().parent.parent / "app" / "icons"


def png(path, size, pixels):
    raw = b"".join(b"\x00" + bytes(c for px in pixels[y * size:(y + 1) * size] for c in px) for y in range(size))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(data)


def render(size, rounded, scale=1.0, ss=3):
    px = []
    c = size / 2
    corner = size * 0.22 if rounded else 0
    rings = [(150 * scale, 18 * scale, 1.0), (78 * scale, 14 * scale, 0.55)]  # radius, half-width, alpha (512 grid)
    k = size / 512
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    fx, fy = x + (sx + .5) / ss, y + (sy + .5) / ss
                    # rounded-rect mask
                    if corner:
                        dx = max(corner - fx, 0, fx - (size - corner))
                        dy = max(corner - fy, 0, fy - (size - corner))
                        if dx * dx + dy * dy > corner * corner:
                            continue
                    col = list(BRAND)
                    d = math.hypot(fx - c, fy - c) / k
                    for r, hw, a in rings:
                        if abs(d - r) <= hw:
                            col = [col[i] * (1 - a) + WHITE[i] * a for i in range(3)]
                            break
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            n = ss * ss
            px.append(tuple(int(round(v / n)) for v in acc))
    return px


for name, size, rounded, scale in [
    ("icon-192.png", 192, True, 1.0),
    ("icon-512.png", 512, True, 1.0),
    ("icon-maskable-512.png", 512, False, 0.78),   # full bleed, mark inside the safe zone
    ("apple-touch-icon.png", 180, False, 1.0),     # iOS rounds the corners itself
]:
    png(out_dir / name, size, render(size, rounded, scale, ss=2 if size > 200 else 3))
    print("wrote", name)
