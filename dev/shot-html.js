// 仅测试用：把一个本地网页截成图。用法：electron dev/shot-html.js <网页> <输出.png> [宽] [高]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [page, out, w = '1180', h = '640'] = process.argv.slice(2);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: +w, height: +h, show: false, useContentSize: true });
  await win.loadFile(path.resolve(page));
  win.showInactive();
  await new Promise((r) => setTimeout(r, 800));
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  app.quit();
});
