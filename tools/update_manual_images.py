"""Embed captured guide images and their annotations by ID, never by page order.

Usage: python tools/update_manual_images.py output/guide-captures
The capture directory contains shots.json and one PNG per capture ID.
"""
import argparse
import base64
import html
import json
import re
import struct
from pathlib import Path


def update_figure(figure, captures, shots):
    name = re.search(r'data-guide-image="([\w-]+)"', figure)[1]
    shot = shots[name]
    png = (captures / f'{name}.png').read_bytes()
    if png[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'{name}: expected a PNG')
    pixels_wide, pixels_high = struct.unpack('>II', png[16:24])
    pixel_ratio = shot.get('pixelRatio', 1)
    width, height = shot['width'], shot['height']
    if abs(pixels_wide / pixel_ratio - width) > 1 or abs(pixels_high / pixel_ratio - height) > 1:
        raise ValueError(f'{name}: screenshot and coordinates have different dimensions')
    alt = re.search(r'<svg[^>]+aria-label="([^"]*)"', figure)[1]
    encoded = base64.b64encode(png).decode('ascii')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width + 80:g} {height + 80:g}" '
           f'role="img" aria-label="{alt}"><image href="data:image/png;base64,{encoded}" '
           f'x="40" y="40" width="{width:g}" height="{height:g}"/>')
    override = re.search(r'data-guide-first-number="(\d+)"', figure)
    # The full-width flow screenshot is scaled down more than the detail crops.
    radius, font_size = (27, 33) if name == 'view' else (15, 18)
    for index, box in enumerate(shot['boxes']):
        if (box['x'] < -1 or box['y'] < -1 or
                box['x'] + box['width'] > width + 1 or
                box['y'] + box['height'] > height + 1):
            raise ValueError(f'{name}: annotation is outside the screenshot')
        x, y = box['x'] + 40, box['y'] + 40
        number = str(int(override[1]) + index) if override else box['number']
        svg += (f'<rect x="{x-3:.1f}" y="{y-3:.1f}" width="{box["width"]+6:.1f}" '
                f'height="{box["height"]+6:.1f}" rx="4" fill="none" stroke="#c74522" stroke-width="3"/>'
                f'<circle cx="{x-7:.1f}" cy="{y-7:.1f}" r="{radius}" fill="#c74522" stroke="white" stroke-width="2"/>'
                f'<text x="{x-7:.1f}" y="{y-7:.1f}" text-anchor="middle" dominant-baseline="central" '
                f'fill="white" font-size="{font_size}" font-weight="700" font-family="Segoe UI, sans-serif">'
                f'{html.escape(str(number))}</text>')
    figure = re.sub(r'--shot-width:[\d.]+px', f'--shot-width:{width + 80:g}px', figure)
    return re.sub(r'<svg\b.*?</svg>', lambda _: svg + '</svg>', figure, count=1, flags=re.S)


def update_manual(manual, captures):
    shots = json.loads((captures / 'shots.json').read_text(encoding='utf-8'))
    source = manual.read_text(encoding='utf-8')
    result = re.sub(r'<figure class="guide-shot".*?</figure>',
                    lambda match: update_figure(match[0], captures, shots), source, flags=re.S)
    # Validate every figure before replacing the document.
    manual.write_text(result, encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('captures', type=Path)
    parser.add_argument('--manual', type=Path, default=Path(__file__).resolve().parents[1] / 'manual.html')
    args = parser.parse_args()
    update_manual(args.manual, args.captures)
