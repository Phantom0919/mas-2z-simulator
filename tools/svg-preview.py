"""把关系树的 SVG 画成 PNG，方便在没有浏览器的情况下肉眼检查版式。

只认 relations-view.js 会吐出来的那几种元素（rect / text / path），
用 Pillow 按坐标重绘，目的是"看排版对不对"，不是做通用 SVG 渲染器。

    python tools/svg-preview.py build/preview/relations.svg build/preview/relations.png
"""

import re
import sys

from PIL import Image, ImageDraw, ImageFont
from lxml import etree

NS = {"svg": "http://www.w3.org/2000/svg"}
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]
SCALE = 2  # 放大画，字才看得清


def load_font(size, bold=False):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def parse_color(value, default=(139, 148, 158)):
    if not value:
        return default
    value = value.strip()
    if value.startswith("#"):
        value = value[1:]
        if len(value) == 3:
            value = "".join(ch * 2 for ch in value)
        if len(value) >= 6:
            return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))
    return default


def text_anchor_offset(anchor, width):
    if anchor == "middle":
        return -width / 2
    if anchor == "end":
        return -width
    return 0


def main(svg_path, out_path):
    tree = etree.parse(svg_path)
    root = tree.getroot()
    # 有 xmlns 就带命名空间查，没有就直接查（两种都能跑）
    global NS
    NS = {"svg": root.nsmap.get(None)} if root.nsmap.get(None) else {"svg": None}
    view_box = [float(v) for v in root.get("viewBox").split()]
    width, height = int(view_box[2]), int(view_box[3])

    image = Image.new("RGB", (width * SCALE, height * SCALE), (13, 17, 23))
    draw = ImageDraw.Draw(image)

    def sx(value):
        return float(value) * SCALE

    # 先画线
    for path in root.findall(".//svg:path", NS):
        d = path.get("d", "")
        numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", d)]
        if len(numbers) < 8:
            continue
        x1, y1, cx1, cy1, cx2, cy2, x2, y2 = numbers[:8]
        # 采样三次贝塞尔
        points = []
        for step in range(25):
            t = step / 24
            mt = 1 - t
            bx = mt**3 * x1 + 3 * mt**2 * t * cx1 + 3 * mt * t**2 * cx2 + t**3 * x2
            by = mt**3 * y1 + 3 * mt**2 * t * cy1 + 3 * mt * t**2 * cy2 + t**3 * y2
            points.append((sx(bx), sx(by)))
        draw.line(points, fill=parse_color(path.get("stroke"), (48, 54, 61)), width=max(1, SCALE))

    # 再画盒子
    for rect in root.findall(".//svg:rect", NS):
        x, y = sx(rect.get("x")), sx(rect.get("y"))
        w, h = sx(rect.get("width")), sx(rect.get("height"))
        stroke = parse_color(rect.get("stroke"), (48, 54, 61))
        fill = rect.get("fill")
        cls = rect.get("class") or ""
        if fill:
            inner = parse_color(fill)
        elif "root" in cls:
            inner = (26, 42, 66)
        elif "group" in cls:
            inner = (26, 31, 38)
        elif "person" in cls:
            inner = (22, 27, 34)
        else:
            inner = (60, 68, 78)
        draw.rounded_rectangle([x, y, x + w, y + h], radius=10 * SCALE, fill=inner, outline=stroke, width=SCALE)

    # 最后画字
    for text in root.findall(".//svg:text", NS):
        content = "".join(text.itertext())
        if not content.strip():
            continue
        x, y = sx(text.get("x")), sx(text.get("y"))
        cls = text.get("class") or ""
        size = 14
        if "tree-label" in cls:
            size = 15
        elif "tree-sub" in cls:
            size = 11
        elif "tree-value" in cls:
            size = 14
        elif "tree-icon" in cls:
            size = 17
        font = load_font(int(size * SCALE))
        color = parse_color(text.get("fill"), (230, 237, 243))
        if cls.startswith("tree-sub"):
            color = (139, 148, 158)
        width_px = draw.textlength(content, font=font)
        draw.text((x + text_anchor_offset(text.get("text-anchor"), width_px), y - size * SCALE * 0.85), content, font=font, fill=color)

    image.save(out_path)
    print(f"已输出 {out_path}（{image.width}x{image.height}）")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "preview.png")
