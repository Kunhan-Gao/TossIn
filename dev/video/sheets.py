# 仅做视频用：把抽出来的帧拼成几张总览图，方便一眼看完整条片子。用法：python dev/video/sheets.py <帧所在的文件夹>
import glob, os, sys
from PIL import Image, ImageDraw

folder = sys.argv[1]
files = sorted(glob.glob(os.path.join(folder, 'f*.jpg')))
w, h = Image.open(files[0]).size
portrait = h > w
tw, th, cols, rows = (270, 480, 6, 2) if portrait else (480, 270, 3, 3)
for old in glob.glob(os.path.join(folder, 'sheet*.png')):
    os.remove(old)
per = cols * rows
for s in range(0, len(files), per):
    chunk = files[s:s + per]
    n = -(-len(chunk) // cols)
    sheet = Image.new('RGB', (cols * (tw + 6) + 6, n * (th + 6) + 6), (70, 70, 70))
    for i, f in enumerate(chunk):
        x, y = 6 + (i % cols) * (tw + 6), 6 + (i // cols) * (th + 6)
        sheet.paste(Image.open(f).resize((tw, th), Image.LANCZOS), (x, y))
        ImageDraw.Draw(sheet).text((x + 4, y + 4), '%.1fs' % (int(os.path.basename(f)[1:5]) / 30), fill=(255, 255, 0))
    sheet.save(os.path.join(folder, 'sheet%d.png' % (s // per)))
print(len(files), 'frames ->', -(-len(files) // per), 'sheets')
