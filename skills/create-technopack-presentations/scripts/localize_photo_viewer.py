"""Localize the trusted starter viewer before embedding it in an HTML document."""
import hashlib
import re


def localize_photo_viewer(viewer: str, lang: str) -> str:
    if lang == "ru":
        return viewer
    if lang != "zh-CN":
        raise ValueError(f"Viewer translation required for {lang}")
    translations = {
        "Потяните фото вверх или вниз — закрыть. Двойной тап — увеличить или вписать. В увеличении свайп перемещает кадр; два пальца — масштаб браузера.": "上下滑动照片可关闭。双击可放大或适应窗口。放大后滑动可移动照片；双指可缩放浏览器页面。",
        "Нажмите на фото — увеличить; ещё раз — вписать. + / − и колёсико — масштаб; перетаскивание и стрелки — перемещение. Enter / пробел — увеличить или вписать. 100% — исходный размер.": "点击照片可放大，再次点击可适应窗口。使用 + / − 或滚轮缩放，拖动或方向键移动照片。按回车键或空格键可放大或适应窗口。100% 为原始尺寸。",
        "Двойной тап — увеличить или вписать. В полном кадре потяните фото вверх или вниз, чтобы закрыть. ": "双击可放大或适应窗口。完整显示时，上下滑动照片可关闭。",
        "В увеличении свайп перемещает фото; два пальца меняют масштаб браузера.": "放大后滑动可移动照片；双指可缩放浏览器页面。",
        "Закрыть фотографию": "关闭照片",
        "Увеличить фотографию": "放大照片",
        "Уменьшить фотографию": "缩小照片",
        "Масштаб фотографии": "照片缩放比例",
        "Закрыть": "关闭",
        "Вписать": "适应窗口",
        "Вписано": "已适应窗口",
        "Уменьшить": "缩小",
        "Увеличить": "放大",
        " фотографию: ": "照片：",
    }
    for source, target in translations.items():
        if source not in viewer:
            raise ValueError(f"Starter viewer changed; review translation: {source}")
        viewer = viewer.replace(source, target)
    if re.search(r"[А-Яа-яЁё]", viewer):
        raise ValueError("Untranslated Cyrillic remains in Chinese photo viewer")
    script = re.search(r'<script data-viewer-sha256="[a-f0-9]+">(.*?)</script>', viewer, re.S)
    if not script:
        raise ValueError("Trusted viewer script missing")
    digest = hashlib.sha256(script.group(1).encode("utf-8")).hexdigest()
    return re.sub(r'data-viewer-sha256="[a-f0-9]+"', f'data-viewer-sha256="{digest}"', viewer)
