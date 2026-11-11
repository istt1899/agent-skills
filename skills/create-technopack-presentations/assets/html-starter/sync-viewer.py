"""Embed the shared viewer into the standalone starter without order-form code.

Usage: python sync-viewer.py --javascript <showcase.js> --css <photo-viewer.css>
Run scripts/verify-photo-viewer.cjs after synchronizing; the HTML has no runtime imports.
"""

import argparse
import base64
import hashlib
from pathlib import Path
import re


def replace_block(html: str, name: str, value: str, before: str) -> str:
    begin, end = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    block = f"{begin}\n{value}\n{end}"
    if begin in html:
        return re.sub(re.escape(begin) + r".*?" + re.escape(end), lambda _: block, html, flags=re.S)
    assert before in html
    return html.replace(before, block + "\n" + before, 1)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--javascript", required=True, type=Path)
parser.add_argument("--css", required=True, type=Path)
args = parser.parse_args()
target = Path(__file__).with_name("index.html")
html = target.read_text(encoding="utf-8-sig")
javascript = args.javascript.read_text(encoding="utf-8-sig")
boundary = "  const config = JSON.parse(document.getElementById('proposal-config').textContent);"
assert javascript.count(boundary) == 1, "Shared viewer boundary changed; review integration"
javascript = javascript.split(boundary)[0] + "})();\n"
javascript = javascript.replace("  document.documentElement.classList.add('js');\n", "")
javascript = javascript.replace("  const viewer = document.getElementById('viewer-image');", "  if (!dialog) return;\n  document.documentElement.classList.add('js');\n  const viewer = document.getElementById('viewer-image');")
javascript = javascript.replace("const historyKey = 'concavePhotoViewer';", "const historyKey = 'documentaryPhotoViewer';")
css = args.css.read_text(encoding="utf-8-sig")
css += """
/* Scope the dark viewer independently of a chapter's light palette. */
#photo-viewer{--ink:#f4f7fa;--muted:#c5d3dc;--line:#4d6271;color:#f4f7fa;height:calc(100% - var(--viewer-top) - var(--viewer-bottom))}
.zoomable > a[data-zoom]{display:block;position:relative;touch-action:manipulation}
.zoomable > a[data-zoom] > img{display:block;width:100%;height:auto;border-radius:1.6rem}
:is(.photo,.zoomable):target > a[data-zoom] > img{border-radius:0}
.zoom-hint{position:absolute;right:12px;bottom:12px;padding:6px 10px;border-radius:24px;background:#08131e;color:#f4f7fa;font-size:.8rem}
@media screen{:is(.photo,.zoomable):target{height:auto}}
"""
dialog = """<dialog id="photo-viewer" aria-labelledby="viewer-title">
<div class="viewer-bar">
<button type="button" id="viewer-close" aria-label="Закрыть фотографию"><span aria-hidden="true">×</span> Закрыть</button>
<p id="viewer-title"></p>
<div class="viewer-actions">
<button type="button" id="viewer-zoom-in" aria-label="Увеличить фотографию">+</button>
<button type="button" id="viewer-zoom-out" aria-label="Уменьшить фотографию">−</button>
<button type="button" id="viewer-fit">Вписать</button>
<button type="button" id="viewer-native" aria-pressed="false">100%</button>
<output id="viewer-scale" aria-label="Масштаб фотографии">Вписано</output>
</div></div>
<div class="viewer-stage"><img id="viewer-image" alt=""></div>
<p class="viewer-help"><span class="viewer-touch-help">Потяните фото вверх или вниз — закрыть. Двойной тап — увеличить или вписать. В увеличении свайп перемещает кадр; два пальца — масштаб браузера.</span><span class="viewer-mouse-help">Нажмите на фото — увеличить; ещё раз — вписать. + / − и колёсико — масштаб; перетаскивание и стрелки — перемещение. Enter / пробел — увеличить или вписать. 100% — исходный размер.</span></p>
</dialog>"""

if 'id="documentary-visual"' not in html:
    match = re.search(r'<figure class="illustration" data-reveal>\s*(<svg .*?</svg>)', html, re.S)
    assert match, "Expected the original starter diagram"
    svg = match[1].replace("<svg ", '<svg style="background:#e8edf0" ', 1)
    data = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")
    figure = f'''<figure id="documentary-visual" class="illustration zoomable" data-reveal>
<a class="fallback-backdrop" href="#thumb-documentary-visual" tabindex="-1" aria-hidden="true"></a>
<a class="fallback-close" href="#thumb-documentary-visual" aria-label="Закрыть изображение"><span aria-hidden="true">×</span> Закрыть</a>
<a id="thumb-documentary-visual" href="#documentary-visual" data-zoom data-caption="Схема структуры" aria-label="Увеличить схему структуры">
<img src="{data}" width="600" height="620" alt="Схема структуры: обложка, спокойная колонка для чтения и доступное досье" decoding="async">
<span class="zoom-hint" aria-hidden="true">Увеличить ↗</span></a>'''
    html = html[:match.start()] + figure + html[match.end():]

html = html.replace('content="width=device-width,initial-scale=1"', 'content="width=device-width,initial-scale=1,viewport-fit=cover"')
html = html.replace('data-zoom aria-label="Увеличить схему структуры"', 'data-zoom data-caption="Схема структуры" aria-label="Увеличить схему структуры"')
# The original diagram's CSS canvas must travel with its standalone SVG.
def diagram_canvas(match: re.Match) -> str:
    svg = base64.b64decode(match[1]).decode("utf-8")
    if 'id="visual-title"' in svg and '<svg style="background:#e8edf0"' not in svg:
        svg = svg.replace("<svg ", '<svg style="background:#e8edf0" ', 1)
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")

html = re.sub(r"data:image/svg\+xml;base64,([A-Za-z0-9+/=]+)", diagram_canvas, html)
digest = hashlib.sha256(javascript.encode("utf-8")).hexdigest()
html = replace_block(html, "shared-photo-viewer-css", "<style>\n" + css + "</style>", "</head>")
html = replace_block(html, "shared-photo-viewer", dialog + f'\n<script data-viewer-sha256="{digest}">\n' + javascript + "</script>", "</body>")
target.write_text(html, encoding="utf-8")
print(f"Updated {target.name}; viewer SHA-256 {digest}")
