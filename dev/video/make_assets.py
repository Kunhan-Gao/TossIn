# 仅做视频用：生成演示里那张"表格截图"（中英文各一张）。用法：python dev/video/make_assets.py
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), 'assets')
os.makedirs(OUT, exist_ok=True)
FONT = r'C:\Windows\Fonts\msyh.ttc'
BOLD = r'C:\Windows\Fonts\msyhbd.ttc'

def table(name, title, head, rows, total):
    W, H, S = 720, 400, 2
    im = Image.new('RGB', (W * S, H * S), (252, 252, 250))
    d = ImageDraw.Draw(im)
    f = lambda size, bold=False: ImageFont.truetype(BOLD if bold else FONT, size * S)
    d.text((28 * S, 20 * S), title, font=f(20, True), fill=(34, 40, 46))
    x0, y0, rh = 28, 70, 44
    cols = [200, 150, 150, 164]
    # 表头
    d.rectangle([x0 * S, y0 * S, (W - 28) * S, (y0 + rh) * S], fill=(232, 238, 242))
    x = x0
    for w, text in zip(cols, head):
        d.text(((x + 14) * S, (y0 + 11) * S), text, font=f(15, True), fill=(60, 72, 80))
        x += w
    for r, row in enumerate(rows + [total]):
        y = y0 + rh * (r + 1)
        last = r == len(rows)
        if last:
            d.rectangle([x0 * S, y * S, (W - 28) * S, (y + rh) * S], fill=(255, 244, 236))
        x = x0
        for c, (w, text) in enumerate(zip(cols, row)):
            color = (200, 96, 48) if (last and c > 0) else (40, 46, 52)
            d.text(((x + 14) * S, (y + 11) * S), text, font=f(15, last), fill=color)
            x += w
        d.line([x0 * S, y * S, (W - 28) * S, y * S], fill=(214, 220, 224), width=S)
    bottom = y0 + rh * (len(rows) + 2)
    d.rectangle([x0 * S, y0 * S, (W - 28) * S, bottom * S], outline=(196, 204, 210), width=S)
    x = x0
    for w in cols[:-1]:
        x += w
        d.line([x * S, y0 * S, x * S, bottom * S], fill=(214, 220, 224), width=S)
    im = im.resize((W, H), Image.LANCZOS)
    im.save(os.path.join(OUT, name))

table('table.zh.png', '第三季度销售汇总', ['地区', '7 月', '8 月', '9 月'],
      [['华东', '128.4', '136.9', '151.2'], ['华南', '96.7', '101.3', '118.5'], ['华北', '84.2', '88.0', '93.6'], ['西南', '52.9', '61.4', '70.8']],
      ['合计', '362.2', '387.6', '434.1'])
table('table.en.png', 'Q3 sales summary', ['Region', 'July', 'August', 'September'],
      [['East', '128.4', '136.9', '151.2'], ['South', '96.7', '101.3', '118.5'], ['North', '84.2', '88.0', '93.6'], ['Southwest', '52.9', '61.4', '70.8']],
      ['Total', '362.2', '387.6', '434.1'])
print('ok')
