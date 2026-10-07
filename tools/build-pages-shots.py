"""把 shots/ 里的界面验收截图压成发布页能用的素材。

    python tools/build-pages-shots.py

为什么要单独一步：
    shots/ 里的 PNG 是「无头浏览器截出来的原图」（1280×900 起步，单张 100~460 KB），
    直接放上发布页就是 1.5 MB 起，手机流量党会直接关掉页面。
    这里统一转成 JPEG（体积降到约 1/6），顺便生成分享用的 OG 大图。

产物（都在 docs/ 里，属于可重新生成的素材）：
    docs/assets/shots/setup.jpg / game.jpg / volunteer.jpg / ending.jpg /
    update.jpg / content.jpg / mobile.jpg
    docs/assets/og.jpg          1200×630 的社交分享图
    docs/assets/icon-192.png    站点图标（从 web/icons 复制，图片只有一份真源）
"""

import shutil
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - 只是给人看的提示
    raise SystemExit("需要 Pillow：pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
SHOTS_DIR = ROOT / "shots"
OUT_DIR = ROOT / "docs" / "assets"
SHOTS_OUT = OUT_DIR / "shots"

# (源图, 目标名, 目标宽度, JPEG 质量, 说明)
SHOTS = [
    ("ui-wide.png", "setup.jpg", 1000, 82, "开局构筑"),
    ("ingame-sidebar-wide.png", "game.jpg", 1000, 78, "游戏主界面"),
    ("ui-real-volunteer-desktop.png", "volunteer.jpg", 900, 82, "志愿填报"),
    ("ui-real-ending-desktop.png", "ending.jpg", 900, 82, "结局结算"),
    ("ui-real-update-banner-desktop.png", "update.jpg", 900, 82, "推送横幅"),
    ("ui-real-content-desktop.png", "content.jpg", 900, 82, "内容包面板"),
    ("ui-mobile-top.png", "mobile.jpg", 520, 85, "手机竖屏"),
]

# 分享图（QQ / 微信 / 论坛发链接时显示的那张）
OG_SIZE = (1200, 630)
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
]


def load_font(size, bold=True):
    candidates = FONT_CANDIDATES if bold else FONT_CANDIDATES[1:]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def kb(path):
    return round(path.stat().st_size / 1024)


def convert_shots():
    SHOTS_OUT.mkdir(parents=True, exist_ok=True)
    total_before = 0
    total_after = 0
    made = []

    print("截图：")
    for source_name, target_name, width, quality, label in SHOTS:
        source = SHOTS_DIR / source_name
        if not source.exists():
            print(f"  [--] 缺少 {source_name}（跳过一个，发布页会少一张图）")
            continue
        image = Image.open(source).convert("RGB")
        if image.width > width:
            height = round(image.height * width / image.width)
            image = image.resize((width, height), Image.LANCZOS)
        target = SHOTS_OUT / target_name
        image.save(target, "JPEG", quality=quality, optimize=True, progressive=True)
        total_before += source.stat().st_size
        total_after += target.stat().st_size
        made.append(target)
        print(
            f"  [OK] {label:<8} {source_name:<34} "
            f"{kb(source):>5} KB → {target_name:<14} {kb(target):>4} KB  {image.width}×{image.height}"
        )

    if made:
        saved = 1 - total_after / total_before
        print(
            f"  合计 {round(total_before / 1024)} KB → {round(total_after / 1024)} KB"
            f"（省了 {saved * 100:.0f}%）"
        )
    return made


def rounded(image, radius):
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, image.size[0] - 1, image.size[1] - 1], radius=radius, fill=255)
    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


def build_og():
    """1200×630 分享图：左边标题，右边一张真实截图。"""
    shot_path = SHOTS_OUT / "volunteer.jpg"
    if not shot_path.exists():
        shot_path = SHOTS_OUT / "game.jpg"
    if not shot_path.exists():
        print("\n分享图：跳过（还没有任何截图）")
        return None

    canvas = Image.new("RGB", OG_SIZE, (13, 17, 23))
    draw = ImageDraw.Draw(canvas, "RGBA")
    # 左上绿、右上蓝两团光，跟网页首屏一致
    for center, color in (((180, 90), (79, 212, 99, 46)), ((1020, 60), (47, 129, 247, 52))):
        for step in range(9, 0, -1):
            radius = 46 * step
            alpha = int(color[3] * (10 - step) / 46)
            draw.ellipse(
                [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius],
                fill=(color[0], color[1], color[2], alpha),
            )

    title = load_font(62)
    tagline = load_font(30)
    subtitle = load_font(22, bold=False)
    draw.text((64, 178), "马鞍山二中模拟器", font=title, fill=(230, 237, 243))
    draw.text((66, 268), "三年 · 六个学期 · 72 次抉择", font=tagline, fill=(79, 212, 99))
    draw.text((66, 320), "37 种行动 · 95 个随机事件 · 29 个结局", font=subtitle, fill=(154, 167, 180))
    draw.text((66, 356), "免费 · 无广告 · 无内购 · 不联网也能玩", font=subtitle, fill=(154, 167, 180))
    draw.text((66, 470), "点开就能玩 · 安卓 0.5 MB 免安装", font=tagline, fill=(47, 129, 247))

    shot = Image.open(shot_path).convert("RGB")
    target_w, target_h = 560, 372
    scale = min(target_w / shot.width, target_h / shot.height)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    shot = rounded(shot, 14)
    left = OG_SIZE[0] - shot.width - 56
    top = (OG_SIZE[1] - shot.height) // 2
    draw.rectangle([left - 3, top - 3, left + shot.width + 3, top + shot.height + 3], fill=(38, 48, 65, 255))
    canvas.paste(shot, (left, top), shot)

    target = OUT_DIR / "og.jpg"
    canvas.save(target, "JPEG", quality=86, optimize=True, progressive=True)
    print(f"\n分享图：og.jpg {kb(target)} KB　{OG_SIZE[0]}×{OG_SIZE[1]}")
    return target


def copy_icons():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pairs = [("web/icons/icon-192.png", "docs/assets/icon-192.png")]
    print("\n站点图标：")
    for source_name, target_name in pairs:
        source = ROOT / source_name
        target = ROOT / target_name
        if not source.exists():
            print(f"  [--] 缺少 {source_name}")
            continue
        shutil.copyfile(source, target)
        print(f"  [OK] {source_name} → {target_name}（{kb(target)} KB）")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    convert_shots()
    build_og()
    copy_icons()
    print("\n完成 ✅ 发布页素材已更新（docs/assets/）")


if __name__ == "__main__":
    main()
