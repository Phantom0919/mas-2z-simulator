"""检查打好的 APK 里那份源码，确认用户改过的文案确实进包了。

    python tools/check-apk-content.py [apk路径]

不给路径时自动挑 dist/ 里最新的那个 APK——
以前这里写死版本号，每发一版都要回来改一次，忘改就报 FileNotFoundError。
"""

import glob
import os
import sys
import zipfile

# Windows 控制台默认是 GBK，输出里的 ✅ 之类会直接抛 UnicodeEncodeError。
# 这里强制把 stdout 换成 UTF-8（失败也不影响检查本身）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


def newest_apk():
    candidates = glob.glob(os.path.join("dist", "*.apk"))
    if not candidates:
        raise SystemExit("dist/ 里没有 APK，先跑 npm run apk")
    return max(candidates, key=os.path.getmtime)


APK = sys.argv[1] if len(sys.argv) > 1 else newest_apk()

# (压缩包里的路径, 应该出现的片段, 不该出现的片段)
# 说明：unwanted 只在"这一处确实被替换掉"时才写，别写成全文搜索——
# 比如"大华国际广场"是补习班那一处的地点，本来就该留着。
CHECKS = [
    ("assets/src/data/cast.js", "role: '心动对象'", "role: 'crush'"),
    ("assets/src/data/actions.js", "金鹰四楼的奶茶店", "大华广场四楼的奶茶店"),
    ("assets/src/data/items.js", "二中特色毕业纪念册", None),
    ("assets/src/data/events.js", "数学、物理、化学、生物(信息)竞赛队员", None),
    ("assets/src/data/events.js", "年级前五", None),
    ("assets/src/data/events3.js", "厚德励学敦行", None),
    ("assets/src/data/events3.js", "妇幼保健医院", "体检安排在人民医院"),
    ("assets/src/data/events3.js", "榆树下拍了十几张", "梧桐树下拍了十几张"),
    ("assets/src/data/school.js", "高一(13)班", "高一(12)班"),
    ("assets/src/data/school.js", "马鞍山中加双语", "马鞍山二中复读班"),
    ("assets/src/data/story.js", "成人礼在报告厅举行", "成人礼在礼堂举行"),
    ("assets/src/data/character.js", "没有信息TvT", None),
    ("assets/src/data/character.js", "适合记忆力和表达强的学生", None),
    # v2.5：自定义人物（性格 / 缺陷 / 属性点 / 角色模板）必须一起进包
    ("assets/src/data/character.js", "export const PERSONALITIES", None),
    ("assets/src/data/character.js", "export const POINT_BUY", None),
    ("assets/src/data/character.js", "export const CHARACTER_PRESETS", None),
    # v2.5：校园日常事件 + 两个新结局
    ("assets/src/data/events5.js", "团结广场的网咖赛", None),
    ("assets/src/data/events5.js", "群里的刷单兼职", None),
    ("assets/src/engine.js", "esports", None),
    ("assets/src/engine.js", "resolveCustomRules", None),
    # v2.5：前端要有自定义人物的界面（否则 APK 里只有引擎、没有入口）
    ("assets/www/index.html", 'id="avatar-options"', None),
    ("assets/www/index.html", 'id="point-attrs"', None),
    ("assets/www/app.js", "随机捏一个", None),
    ("assets/www/app.js", "customCast", None),
    # v2.6：热更新（内容包）与志愿填报必须一起进包
    ("assets/src/content.js", "PACK_FORMAT", None),
    ("assets/src/data/colleges.js", "平行志愿", None),
    ("assets/src/data/events6.js", "chainOnly", None),
    ("assets/src/engine.js", "applyContentPack", None),
    ("assets/src/engine.js", "submitVolunteers", None),
    ("assets/www/index.html", 'id="volunteer-modal"', None),
    ("assets/www/index.html", 'id="content-modal"', None),
    ("assets/www/app.js", "/api/volunteer", None),
    ("assets/www/local-api.js", "/api/content", None),
    # v2.7：推送（更新清单）必须一起进包，而且默认必须是"不检查更新"
    ("assets/src/update.js", "decideUpdate", None),
    ("assets/src/update.js", "isAllowedManifestUrl", None),
    ("assets/www/app.js", "/api/update", None),
    ("assets/www/index.html", 'id="update-banner"', None),
    ("assets/www/local-api.js", "runUpdateCheckInPage", None),
    ("assets/www/content/update-endpoint.json", '"manifest": ""', None),
    # v2.9：游戏内的交流入口 / 关于我们（赞助商）必须一起进包
    ("assets/www/index.html", 'id="community-modal"', None),
    ("assets/www/index.html", "印显元（爸爸）", None),
    ("assets/www/index.html", "https://pd.qq.com/s/c38ht6k4r", None),
    ("assets/www/index.html", 'id="btn-community"', None),
    ("assets/www/index.html", 'id="btn-ending-share"', None),
    ("assets/www/app.js", "COMMUNITY_URL", None),
    ("assets/www/app.js", "openCommunityModal", None),
    ("assets/www/app.js", "execCommand('copy')", None),
    ("assets/www/style.css", ".community-block", None),
    # v3.0：改名 + AI 对战必须一起进包（校名只写"二中"，产品名是新名字）
    ("assets/www/index.html", "中二野人实验室", None),
    ("assets/www/manifest.webmanifest", "中二野人实验室", None),
    ("assets/src/data/school.js", "name: '二中'", "马鞍山市第二中学"),
    ("assets/src/engine.js", "RIVAL_LEVELS", None),
    ("assets/src/engine.js", "advanceRivalPhase", None),
    ("assets/src/engine.js", "versusView", None),
    ("assets/src/engine.js", "settleRival", None),
    ("assets/www/index.html", 'id="mode-options"', None),
    ("assets/www/index.html", 'id="versus-body"', None),
    ("assets/www/app.js", "renderModes", None),
    ("assets/www/app.js", "versusEndingHtml", None),
    ("assets/www/local-api.js", "rivalLevel", None),
]


def main():
    archive = zipfile.ZipFile(APK)
    names = archive.namelist()
    print(f"APK: {APK}")
    print(f"条目数: {len(names)}　大小: {round(len(open(APK, 'rb').read()) / 1024)} KB\n")

    cache = {}
    failures = []
    for path, want, unwanted in CHECKS:
        if path not in cache:
            try:
                cache[path] = archive.read(path).decode("utf-8")
            except KeyError:
                cache[path] = None
        text = cache[path]
        if text is None:
            failures.append(f"{path} 不在 APK 里")
            print(f"  [X] {path} 缺失")
            continue
        ok_want = want in text
        ok_unwanted = unwanted is None or unwanted not in text
        mark = "OK" if (ok_want and ok_unwanted) else "XX"
        if mark == "XX":
            failures.append(f"{path}: want={want!r} present={ok_want}, unwanted={unwanted!r} absent={ok_unwanted}")
        extra = "" if unwanted is None else f"　（不应再有 {unwanted!r}）"
        print(f"  [{mark}] {path.split('/')[-1]:<14} {want}{extra}")

    check_icons(archive, failures)

    print()
    if failures:
        print("有未通过项：")
        for line in failures:
            print("  -", line)
        sys.exit(1)
    print("全部通过 ✅")


def check_icons(archive, failures):
    """启动图标是不是最新的那一版。

    aapt2 会重新编码 PNG，所以不能比 md5——只能解出像素来比，允许 1% 的重编码误差。
    """
    try:
        from PIL import Image, ImageChops
    except ImportError:
        print("\n  [--] 跳过图标比对（没装 Pillow）")
        return

    import io
    from pathlib import Path

    pairs = [
        ("res/mipmap-mdpi-v4/ic_launcher.png", "android/app/res/mipmap-mdpi/ic_launcher.png"),
        ("res/mipmap-hdpi-v4/ic_launcher.png", "android/app/res/mipmap-hdpi/ic_launcher.png"),
        ("res/mipmap-xhdpi-v4/ic_launcher.png", "android/app/res/mipmap-xhdpi/ic_launcher.png"),
        ("res/mipmap-xxhdpi-v4/ic_launcher.png", "android/app/res/mipmap-xxhdpi/ic_launcher.png"),
        ("res/mipmap-xxxhdpi-v4/ic_launcher.png", "android/app/res/mipmap-xxxhdpi/ic_launcher.png"),
    ]
    print("\n启动图标（比像素，不比字节）：")
    for inside, outside in pairs:
        if inside not in archive.namelist():
            failures.append(f"APK 里缺少 {inside}")
            print(f"  [XX] {inside} 不在包里")
            continue
        if not Path(outside).exists():
            print(f"  [--] {outside} 不存在，跳过")
            continue
        packed = Image.open(io.BytesIO(archive.read(inside))).convert("RGBA")
        source = Image.open(outside).convert("RGBA")
        if packed.size != source.size:
            failures.append(f"{inside} 尺寸不符 {packed.size} vs {source.size}")
            print(f"  [XX] {inside} 尺寸不符")
            continue
        diff = ImageChops.difference(packed, source)
        bad = 0
        if diff.getbbox():
            data = diff.tobytes()
            bad = sum(1 for i in range(0, len(data), 4) if max(data[i : i + 3]) > 8)
        ratio = bad / (packed.size[0] * packed.size[1])
        ok = ratio < 0.01
        if not ok:
            failures.append(f"{inside} 与源文件不一致（差异 {ratio * 100:.1f}%）")
        print(f"  [{'OK' if ok else 'XX'}] {inside.split('/')[1]:<22} {packed.size[0]}×{packed.size[1]}　差异 {ratio * 100:.2f}%")


if __name__ == "__main__":
    main()
