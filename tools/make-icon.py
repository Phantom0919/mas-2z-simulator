"""生成《中二野人实验室》的应用图标。

用法：  python tools/make-icon.py
输出：
    electron/assets/icon.png            512×512（圆角、带透明边角）
    electron/assets/icon.ico            16/24/32/48/64/128/256 多尺寸
    web/icons/icon-192.png, icon-512.png
    web/icons/icon-maskable-512.png     满幅不透明，供 Android 自适应图标裁切
    android/app/res/mipmap-*/ic_launcher.png   mdpi…xxxhdpi 五档
    build/icon-preview.png              自检用对比图（真实尺寸 + 圆形/圆角遮罩）

设计意图（一句话）：**晨光从翻开的书后面升起来**。
    · 书      —— 高中三年最核心的意象：课本、晚自习、写满字的纸页。
    · 朝阳    —— 「高考 / 青春 / 希望」，同时把品牌的绿→蓝渐变收进主体里。
    · 「二中」—— 印在左右两页上，是最直接的身份标识；字号够大，缩到 192 仍清晰。
小尺寸（48px）能认出来的原因：整幅图只有**两个大色块**——上面一团发光的绿→蓝
弧顶，下面一本白色的书。没有细线、没有描边文字堆叠，所以轮廓在极小的尺寸下
依然干净；书页上的字缩小时会自然糊成纸面纹理，不会变成脏点。

配色沿用游戏 UI：底色 #0d1117 系（#12161f→#080b10），主色 #3fb950 绿、#2f81f7 蓝。
所有绘制都在 4 倍超采样画布（2048）上完成，最后用 LANCZOS 缩到目标尺寸，
因此边缘干净、没有毛刺。

兼容性：
    · 主体内容全部落在以画布中心为圆心、半径 200/512（≈78%）的安全圆内，
      Android 的圆形/圆角遮罩不会切到笔画；maskable 版本还额外整体缩到 78%。
    · 找不到中文字体时（非 Windows 环境）不会画出方块或留白：书页退化成
      三条浅色「文字线」，看起来仍然是一本写着字的书。
    · 只依赖 Pillow 与标准库。
"""

from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "electron" / "assets"
SIZE = 512          # 最终图标边长
SS = 4              # 超采样倍率
CANVAS = SIZE * SS  # 绘制画布 2048
U = CANVAS / 512.0  # 设计坐标（按 512 写）→ 画布坐标

# ---------- 配色 ----------
PLATE_TOP = (20, 27, 39)        # 底板顶部，比 #0d1117 略亮一点
PLATE_MID = (13, 17, 25)        # 底板中部 ≈ 游戏 UI 的 #0d1117
PLATE_BOT = (8, 11, 16)         # 底板底部压暗
GREEN = (63, 185, 80)           # #3fb950 主色绿
BLUE = (47, 129, 247)           # #2f81f7 主色蓝
SUN_STOPS = [                   # 朝阳：弧顶最亮的嫩绿 → 主色绿 → 青 → 主色蓝
    (0.00, (184, 248, 192)),
    (0.42, GREEN),
    (0.72, (58, 168, 156)),
    (1.00, BLUE),
]
PAPER_HI = (250, 253, 255)      # 纸面高光
PAPER_LO = (198, 213, 232)      # 纸面暗部
PAPER_EDGE = (126, 146, 172)    # 纸叠厚度
COVER_STOPS = [                 # 书封：深绿→深蓝，把两页兜成一本，也补上品牌蓝
    (0.00, (46, 138, 78)),
    (0.52, (34, 110, 138)),
    (1.00, (34, 84, 190)),
]
INK = (30, 46, 70)              # 书页上的墨色
FALLBACK_LINE = (176, 192, 214)  # 无中文字体时的「文字线」

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",      # 微软雅黑 Bold（笔画最粗，小尺寸最清楚）
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",      # 黑体
    r"C:\Windows\Fonts\Dengb.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
]

# ---------- 主体几何（512 设计坐标，全部在安全圆半径 200 内）----------
SAFE_R = 200                       # 半径 200/512 ≈ 39%，即直径约 78% 的圆形安全区
MASKABLE_ART_SCALE = 0.78          # maskable 再把主体整体缩到 78%，双保险
SUN_C = (256, 250)   # 朝阳圆心，下半部分会被书挡住
SUN_R = 96
# 左页轮廓控制点（512 设计坐标）。这本书刻意画得「扁」——书宽约 352、高约 100，
# 横向的书才像摊开的课本；画成两块等高的竖板立刻变成「两张卡片」。
# 顶边用三次贝塞尔做出纸页翘起的弧，外缘往下微微内收形成楔形。
GUT_TOP = (252, 282)   # 靠书脊的上端
CURL_1 = (206, 246)    # 顶边弧控制点 1
CURL_2 = (140, 240)    # 顶边弧控制点 2（纸页翘起的最高处）
OUT_TOP = (80, 262)    # 外侧上角
OUT_BOT = (112, 344)   # 外侧下角（比上角内收，形成楔形）
GUT_BOT = (252, 350)   # 靠书脊的下端
INK_C = (162, 298)     # 字在左页的落点
INK_SIZE = 58


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------
def load_font(size: int):
    """找一个能画中文的字体；都找不到就返回 None（走退化路径）。"""
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, int(size))
            except OSError:
                continue
    return None


def _lerp(c0, c1, t):
    return tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))


def _sample(stops, t):
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1:
            return _lerp(c0, c1, (t - t0) / (t1 - t0) if t1 > t0 else 0.0)
    return stops[-1][1]


def linear_gradient(stops, angle=96.0, n=192):
    """线性渐变。先在 n×n 小图上算，再放大——又快又不会有色带。"""
    a = math.radians(angle)
    dx, dy = math.cos(a), math.sin(a)
    den = (abs(dx) + abs(dy)) * n
    small = Image.new("RGB", (n, n))
    px = small.load()
    for j in range(n):
        for i in range(n):
            px[i, j] = _sample(stops, ((i + .5) * dx + (j + .5) * dy) / den)
    return small.resize((CANVAS, CANVAS), Image.BICUBIC)


def linear_gradient_in(box, stops, angle=96.0, n=192):
    """只在 box 里归一化的线性渐变。

    整幅画布归一化的话，太阳这种小面积只能吃到色阶中间的一小段，
    看上去就是一块死绿；按元素自己的包围盒归一化才能把整条绿→蓝铺满。
    """
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    a = math.radians(angle)
    dx, dy = math.cos(a), math.sin(a)
    den = (abs(dx) + abs(dy)) * n
    small = Image.new("RGB", (n, n))
    px = small.load()
    for j in range(n):
        for i in range(n):
            px[i, j] = _sample(stops, ((i + .5) * dx + (j + .5) * dy) / den)
    patch = small.resize((w, h), Image.BICUBIC)
    canvas = Image.new("RGB", (CANVAS, CANVAS), (0, 0, 0))
    canvas.paste(patch, (x0, y0))
    return canvas


def poly_mask(pts, blur=0.0):
    m = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur)) if blur else m


def ellipse_mask(box):
    m = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(m).ellipse(box, fill=255)
    return m


def text_mask(text, font, center):
    """把文字画成掩膜，按墨迹包围盒居中（中文用 anchor 不好使，直接算 bbox）。"""
    m = Image.new("L", (CANVAS, CANVAS), 0)
    d = ImageDraw.Draw(m)
    b = d.textbbox((0, 0), text, font=font)
    d.text((center[0] - (b[2] - b[0]) / 2 - b[0], center[1] - (b[3] - b[1]) / 2 - b[1]), text, font=font, fill=255)
    return m


def glow(mask, blur, color, strength=1.0):
    """把形状轮廓化成一层柔和外发光（RGBA 图层）。"""
    a = mask.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * strength))
    layer = Image.new("RGBA", mask.size, tuple(color) + (0,))
    layer.putalpha(a)
    return layer


def bezier(p0, p1, ctrl, n=14):
    """二次贝塞尔采样：用来把书页边缘画得有点弧度，不然像信封。"""
    out = []
    for i in range(n + 1):
        t = i / n
        s = 1 - t
        out.append((s * s * p0[0] + 2 * s * t * ctrl[0] + t * t * p1[0],
                    s * s * p0[1] + 2 * s * t * ctrl[1] + t * t * p1[1]))
    return out


def cubic(p0, c1, c2, p1, n=18):
    """三次贝塞尔采样：书页顶边那条「翘起来」的弧。"""
    out = []
    for i in range(n + 1):
        t = i / n
        s = 1 - t
        out.append((s ** 3 * p0[0] + 3 * s * s * t * c1[0] + 3 * s * t * t * c2[0] + t ** 3 * p1[0],
                    s ** 3 * p0[1] + 3 * s * s * t * c1[1] + 3 * s * t * t * c2[1] + t ** 3 * p1[1]))
    return out


def page_outline(dx=0.0, dy=0.0, grow=1.0):
    """一片书页的闭合轮廓（左页）。dx/dy/grow 用来做错位、放大的书封。"""
    def tf(p):
        return (256 * U + (p[0] - 256) * grow * U + dx, p[1] * U + dy)

    top = cubic(GUT_TOP, CURL_1, CURL_2, OUT_TOP)
    outer = bezier(OUT_TOP, OUT_BOT, (min(OUT_TOP[0], OUT_BOT[0]) - 4, (OUT_TOP[1] + OUT_BOT[1]) / 2))
    bottom = bezier(OUT_BOT, GUT_BOT, ((OUT_BOT[0] + GUT_BOT[0]) / 2, max(OUT_BOT[1], GUT_BOT[1]) + 5))
    pts = top + outer[1:] + bottom[1:]
    return [tf(p) for p in pts]


# --------------------------------------------------------------------------
# 画面元素
# --------------------------------------------------------------------------
def make_plate() -> Image.Image:
    """底板：深色渐变 + 一点环境光，跟游戏深色 UI 一致。"""
    base = linear_gradient([(0.0, PLATE_TOP), (0.55, PLATE_MID), (1.0, PLATE_BOT)], angle=96).convert("RGBA")
    base = Image.alpha_composite(base, glow(_big_blob((256 * U, 320 * U), 350 * U), 0, (26, 60, 56), .55))
    base = Image.alpha_composite(base, glow(_big_blob((140 * U, 120 * U), 320 * U), 0, (16, 34, 68), .45))
    return base


def _big_blob(center, radius) -> Image.Image:
    """一个大号软光斑掩膜（用于底板环境光）。"""
    m = Image.new("L", (CANVAS, CANVAS), 0)
    d = ImageDraw.Draw(m)
    steps = 60
    for i in range(steps, 0, -1):
        t = i / steps
        r = radius * t
        a = int(255 * (1 - t) ** 1.4)
        d.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r], fill=a)
    return m


def make_sun() -> Image.Image:
    """朝阳：从书后面升起来的发光弧顶。下半部分会被书挡住，所以只需要画圆。"""
    cx, cy = SUN_C[0] * U, SUN_C[1] * U
    r = SUN_R * U
    box = [cx - r, cy - r, cx + r, cy + r]
    sun = ellipse_mask(box)

    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    layer = Image.alpha_composite(layer, glow(sun, 30 * U, (36, 108, 80), .55))   # 外发光（晨光晕）
    # 绿→蓝本体：渐变按太阳自己的包围盒归一化，整条色阶才铺得开
    face = linear_gradient_in(box, SUN_STOPS, angle=10.0).convert("RGBA")
    face.putalpha(sun)
    layer = Image.alpha_composite(layer, face)
    # 弧顶高光：让它是「光源」而不是一个球
    inner = ellipse_mask([cx - (r - 5 * U), cy - (r - 5 * U), cx + (r - 5 * U), cy + (r - 5 * U)])
    rim = Image.new("RGBA", (CANVAS, CANVAS), (222, 255, 230, 0))
    rim.putalpha(ImageChops.subtract(sun, inner).point(lambda v: int(v * .8)))
    return Image.alpha_composite(layer, rim)


def normalise_blur(mask, radius):
    """模糊后取阈值：把多边形的小尖角磨圆一点，避免书页看起来像蝴蝶翅膀。"""
    if radius <= 0:
        return mask
    return mask.filter(ImageFilter.GaussianBlur(radius)).point(lambda v: 255 if v >= 128 else 0)


def make_book() -> Image.Image:
    """翻开的书：白色纸面 + 上缘受光 + 纸叠厚度 + 书脊，页面上印「二中」。"""
    def book_mask(dy=0.0, soft=2.4 * U, grow=1.0):
        """整本书的掩膜。dy/grow 用来做错位的书封，soft 把纸角磨圆一点点。"""
        left = page_outline(dy=dy, grow=grow)
        right = [(2 * 256 * U - x, y) for x, y in left]      # 右页 = 左页镜像
        m = ImageChops.lighter(poly_mask(left), poly_mask(right))
        return normalise_blur(m, soft)

    union = book_mask()
    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    # 书封：露在书页下缘和左右外侧的一圈，把两页兜成「一本」（不然像两张卡片）
    cover = book_mask(dy=11 * U, grow=1.022)
    layer.paste((0, 0, 0), (0, 0), cover.filter(ImageFilter.GaussianBlur(14 * U)).point(lambda v: int(v * .5)))
    cover_box = [OUT_TOP[0] * U, OUT_TOP[1] * U, (512 - OUT_TOP[0]) * U, (GUT_BOT[1] + 24) * U]
    layer.paste(linear_gradient_in(cover_box, COVER_STOPS, angle=118).convert("RGBA"), (0, 0), cover)
    # 书页落影：把书页从书封上「抬」起来，做出层次
    layer.paste((0, 0, 0), (0, 0), book_mask(dy=9 * U, soft=9 * U).point(lambda v: int(v * .40)))
    # 纸叠厚度（下缘那条浅灰）
    edge = ImageChops.subtract(book_mask(8 * U), union)
    layer.paste(PAPER_EDGE + (255,), (0, 0), edge.point(lambda v: int(v * .9)))
    # 纸面：上白下灰，按书本包围盒归一化，页面才有起伏
    paper_box = [OUT_TOP[0] * U, CURL_2[1] * U, (512 - OUT_TOP[0]) * U, (GUT_BOT[1] + 8) * U]
    layer.paste(linear_gradient_in(paper_box, [(0.0, PAPER_HI), (1.0, PAPER_LO)], angle=96).convert("RGBA"),
                (0, 0), union)
    # 上缘高光：偏一点绿，暗示纸页是被朝阳照亮的
    rim = ImageChops.multiply(book_mask(dy=-3 * U, soft=4 * U), union)
    layer.paste((234, 255, 238, 255), (0, 0), rim.point(lambda v: int(v * .5)))
    # 靠书脊的内侧压暗，做出纸张弯进书脊的感觉（要克制）
    near = ImageChops.multiply(poly_mask([(224 * U, 0), (288 * U, 0), (288 * U, CANVAS), (224 * U, CANVAS)], blur=14 * U), union)
    layer.paste((150, 170, 198, 255), (0, 0), near.point(lambda v: int(v * .38)))
    # 书脊折痕：上端那个小三角是关键——它就是「两页在书脊处汇合」的视觉证据
    gutter = poly_mask([(GUT_TOP[0] - 4) * U, (GUT_TOP[1] - 2) * U,
                        (GUT_TOP[0] + 12) * U, (GUT_TOP[1] - 2) * U,
                        (GUT_TOP[0] + 4) * U, (GUT_TOP[1] + 30) * U], blur=3.5 * U)
    layer.paste((96, 118, 148, 255), (0, 0), ImageChops.multiply(gutter, union).point(lambda v: int(v * .55)))
    layer.paste((154, 174, 200, 255), (0, 0), poly_mask(
        [(GUT_TOP[0] * U, GUT_TOP[1] * U), ((512 - GUT_TOP[0]) * U, GUT_TOP[1] * U),
         ((512 - GUT_BOT[0]) * U, GUT_BOT[1] * U), (GUT_BOT[0] * U, GUT_BOT[1] * U)], blur=1.6 * U).point(lambda v: int(v * .7)))

    # 页面上的字：有中文字体就写「二中」，否则退化成三条文字线（不能让小图出现方块）
    font = load_font(INK_SIZE * U)
    if font:
        layer.paste(INK + (255,), (0, 0), text_mask("二", font, (INK_C[0] * U, INK_C[1] * U)))
        layer.paste(INK + (255,), (0, 0), text_mask("中", font, ((512 - INK_C[0]) * U, INK_C[1] * U)))
    else:
        d = ImageDraw.Draw(layer)
        for cx in (INK_C[0], 512 - INK_C[0]):
            for k, w in enumerate((58, 70, 48)):
                y = (INK_C[1] - 18 + k * 20) * U
                d.rounded_rectangle([(cx - w / 2) * U, y - 4 * U, (cx + w / 2) * U, y + 4 * U],
                                    radius=4 * U, fill=FALLBACK_LINE + (235,))
    return layer


def draw_icon(rounded: bool = True, art_scale: float = 1.0) -> Image.Image:
    """合成一张图标。

    rounded   —— 是否把底板裁成圆角（普通图标要，maskable 不要，得满幅）。
    art_scale —— 主体缩放；maskable 用 0.78 保证落在 Android 的裁切安全区内。
    """
    img = make_plate()
    art = Image.alpha_composite(make_sun(), make_book())
    if art_scale != 1.0:
        inner = max(1, int(CANVAS * art_scale))
        art = art.resize((inner, inner), Image.LANCZOS)
        offset = (CANVAS - inner) // 2
        shrunk = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        shrunk.paste(art, (offset, offset))
        art = shrunk
    img = Image.alpha_composite(img, art)
    if rounded:
        mask = Image.new("L", (CANVAS, CANVAS), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, CANVAS - 1, CANVAS - 1], radius=int(CANVAS * 0.225), fill=255)
        img.putalpha(mask)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


# --------------------------------------------------------------------------
# 自检
# --------------------------------------------------------------------------
def audit_safe_area() -> None:
    """自检：主体最外圈的关键点必须落在安全圆内。

    安卓的圆角/圆形遮罩会切掉四角，所以主体关键点一律不能越出半径 200 的圆。
    以后调几何参数时这条会立刻拦住越界改法。
    """
    pts = [OUT_TOP, OUT_BOT, GUT_TOP, GUT_BOT,
           (SUN_C[0] - SUN_R, SUN_C[1]), (SUN_C[0] + SUN_R, SUN_C[1]), (SUN_C[0], SUN_C[1] - SUN_R)]
    worst = max(math.hypot(x - 256, y - 256) for x, y in pts)
    if worst > SAFE_R:
        raise SystemExit(f"主体越出安全区：最远关键点 {worst:.1f} > {SAFE_R}")


def write_preview(icon: Image.Image, path: Path) -> None:
    """自检对比图：把各尺寸横向排开放大展示，再放 192 的圆形/圆角遮罩，方便肉眼验收。"""
    sizes = [16, 24, 32, 48, 72, 96, 144, 192, 512]
    cell_w, cell_h, pad, lab = 268, 268, 16, 30
    W = pad + len(sizes) * (cell_w + pad)
    H = pad + cell_h + lab + 24 + cell_h + lab + pad
    canvas = Image.new("RGB", (W, H), (22, 24, 28))
    d = ImageDraw.Draw(canvas)
    lab_font = load_font(20)

    for i, s in enumerate(sizes):
        tile = icon.resize((s, s), Image.LANCZOS)
        # 整数倍放大，才是诚实的像素观感（小尺寸放大后会显得糙，正常）
        zoom = max(1, min(8, 200 // s)) if s <= 200 else 1
        if s == 512:
            shown = tile.resize((cell_h, cell_h), Image.LANCZOS)
        else:
            shown = tile.resize((s * zoom, s * zoom), Image.NEAREST)
        x = pad + i * (cell_w + pad)
        box = Image.new("RGB", (cell_w, cell_h), (40, 43, 48))
        box.paste(shown, ((cell_w - shown.width) // 2, (cell_h - shown.height) // 2))
        canvas.paste(box, (x, pad))
        text = f"{s}px" + (f"  (×{zoom})" if s != 512 else "  (1:1)")
        d.text((x + 4, pad + cell_h + 6), text, font=lab_font, fill=(226, 230, 236))

    big = icon.resize((192, 192), Image.LANCZOS)
    circle = Image.new("L", (192, 192), 0)
    ImageDraw.Draw(circle).ellipse([0, 0, 191, 191], fill=255)
    rounded = Image.new("L", (192, 192), 0)
    ImageDraw.Draw(rounded).rounded_rectangle([0, 0, 191, 191], radius=43, fill=255)
    y = pad + cell_h + lab + 24
    for j, (mask, title) in enumerate(((circle, "192 圆形遮罩（Android）"), (rounded, "192 圆角遮罩（桌面）"))):
        box = Image.new("RGB", (cell_w, cell_h), (40, 43, 48))
        board = Image.new("RGB", (192, 192), (72, 76, 84))
        board.paste(big, (0, 0), mask)
        shown = board.resize((230, 230), Image.NEAREST)
        box.paste(shown, ((cell_w - 230) // 2, (cell_h - 230) // 2))
        x = pad + j * (cell_w + pad)
        canvas.paste(box, (x, y))
        d.text((x + 4, y + cell_h + 6), title, font=lab_font, fill=(226, 230, 236))

    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)
    print(f"已生成 {path.relative_to(ROOT)}")


# --------------------------------------------------------------------------
# 输出
# --------------------------------------------------------------------------
def main() -> None:
    audit_safe_area()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    icon = draw_icon(rounded=True)

    png_path = OUT_DIR / "icon.png"
    icon.save(png_path)
    print(f"已生成 {png_path.relative_to(ROOT)} （{icon.width}×{icon.height}）")

    ico_path = OUT_DIR / "icon.ico"
    icon.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"已生成 {ico_path.relative_to(ROOT)} （16/24/32/48/64/128/256）")

    # 网页 / PWA
    web_icons = ROOT / "web" / "icons"
    web_icons.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        target = web_icons / f"icon-{size}.png"
        icon.resize((size, size), Image.LANCZOS).save(target)
        print(f"已生成 {target.relative_to(ROOT)} （{size}×{size}）")

    # maskable：满幅不透明，主体缩到 78%，四周留给 Android 自适应图标裁切
    maskable = draw_icon(rounded=False, art_scale=MASKABLE_ART_SCALE)
    target = web_icons / "icon-maskable-512.png"
    maskable.resize((512, 512), Image.LANCZOS).save(target)
    print(f"已生成 {target.relative_to(ROOT)} （512×512，满幅+安全区）")

    # Android 原生图标（mipmap）
    android_res = ROOT / "android" / "app" / "res"
    for folder, size in (("mipmap-mdpi", 48), ("mipmap-hdpi", 72), ("mipmap-xhdpi", 96),
                         ("mipmap-xxhdpi", 144), ("mipmap-xxxhdpi", 192)):
        target_dir = android_res / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        icon.resize((size, size), Image.LANCZOS).save(target_dir / "ic_launcher.png")
    print(f"已生成 {android_res.relative_to(ROOT)}/mipmap-*/ic_launcher.png （48/72/96/144/192）")

    # 自检对比图（构建产物，放在 build/ 下）
    write_preview(icon, ROOT / "build" / "icon-preview.png")


if __name__ == "__main__":
    main()
