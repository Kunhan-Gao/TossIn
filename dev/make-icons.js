// 生成图标文件。用法：electron dev/make-icons.js
// 输出到 assets/：icon.ico（程序图标）、icon.png（窗口和任务栏）、tray*.png（托盘，按屏幕缩放比例各一张）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');

// 鹈鹕半身像：短粗的脖子、圆肩膀、橙色喉囊
const bird = (body, pouch, eye) => `
  <circle cx="14" cy="61" r="21.5" fill="${body}"/>
  <path d="M19.5 45 C18 40 20.5 35 21.5 30" fill="none" stroke="${body}" stroke-width="13" stroke-linecap="round"/>
  <circle cx="22" cy="26" r="10" fill="${body}"/>
  <path d="M27.5 19.4 L57 32.4 Q59.8 34 58.2 37 L28.5 31.4 Z" fill="${body}"/>
  <path d="M28.8 31 L58.1 36.7 C53.3 45.3 45.3 51.8 37 49.8 C31.4 48.2 28.1 43.4 27.4 37.8 Z" fill="${pouch}"/>
  ${eye ? `<circle cx="24.7" cy="23.8" r="1.75" fill="${eye}"/>` : ''}`;

// 程序图标：深色圆角底板，鹈鹕放大到差不多撑满（嘴尖和头顶各留一点边）
const appSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs><clipPath id="p"><rect width="64" height="64" rx="15"/></clipPath></defs>
  <rect width="64" height="64" rx="15" fill="#11181C"/>
  <g clip-path="url(#p)"><g transform="translate(-10 -10.4) scale(1.16)">${bird('#DCE4E7', '#FF9C66', '#11181C')}</g></g>
</svg>`;

// 把 RGBA 像素转成图标里用的位图（自下而上的 BGRA，加一层全透明的掩码）
function dib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // 高度按"图像 + 掩码"算
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = (y * size + x) * 4;
      pixels[dst] = rgba[src + 2];
      pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src];
      pixels[dst + 3] = rgba[src + 3];
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([header, pixels, mask]);
}

// ICO 容器。256 像素那张放 PNG，其余放位图：这是各版本 Windows 都认的组合
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const render = async (svg, size) => {
    const b64 = Buffer.from(svg).toString('base64');
    const out = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = ${size};
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        const raw = ctx.getImageData(0, 0, ${size}, ${size}).data;
        let bin = '';
        for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i]);
        resolve({ png: c.toDataURL('image/png'), rgba: btoa(bin) });
      };
      img.onerror = () => reject(new Error('svg load failed'));
      img.src = 'data:image/svg+xml;base64,${b64}';
    })`);
    return { png: Buffer.from(out.png.split(',')[1], 'base64'), rgba: Buffer.from(out.rgba, 'base64') };
  };

  fs.mkdirSync(OUT, { recursive: true });
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const images = [];
  let largest = null;
  for (const size of sizes) {
    const r = await render(appSvg(size), size);
    images.push({ size, data: size >= 256 ? r.png : dib(size, r.rgba) });
    largest = r.png;
  }
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(images));
  fs.writeFileSync(path.join(OUT, 'icon.png'), largest);

  // 托盘和任务栏用同一个图标（带深色底板），按屏幕缩放比例各出一张
  for (const [suffix, size] of [['', 16], ['@1.25x', 20], ['@1.5x', 24], ['@2x', 32], ['@3x', 48]]) {
    fs.writeFileSync(path.join(OUT, `tray${suffix}.png`), (await render(appSvg(size), size)).png);
  }
  app.quit();
});
