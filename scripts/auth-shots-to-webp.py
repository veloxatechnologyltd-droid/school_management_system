"""Turns the raw screenshots from scripts/capture-auth-shots.mjs into the WebP files the sign-in and register pages load.
Desktop shots become 1500 px wide, phone shots 600 px wide (they are shown at most 300 px wide, so this is sharp at 2x).
Usage: python3 -I scripts/auth-shots-to-webp.py"""
from pathlib import Path
from PIL import Image

RAW = Path('.local/auth-shots/raw')
OUT = Path('frontend/public/auth')
OUT.mkdir(parents=True, exist_ok=True)

for src in sorted(RAW.glob('*.png')):
    image = Image.open(src).convert('RGB')
    width = 600 if src.stem.startswith('parent-') else 1500
    height = round(image.height * width / image.width)
    image.resize((width, height), Image.LANCZOS).save(OUT / f'{src.stem}.webp', 'WEBP', quality=80, method=6)
    print(f'{src.stem}.webp {width}x{height} {(OUT / f"{src.stem}.webp").stat().st_size // 1024} KB')
