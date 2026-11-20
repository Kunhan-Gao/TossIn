// 录演示视频的画面：把舞台页面一帧一帧走完，每帧存一张图。
// 用法：electron dev/video/record.js --variant=v-zh --out=<文件夹> [--every=15]（只存每第 N 帧，用来快速预览）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const variant = arg('variant', 'v-zh');
const out = path.resolve(arg('out', path.join(__dirname, '..', '..', 'dist', 'video', variant)));
const every = Number(arg('every', 1));
const until = Number(arg('until', Infinity));
const portrait = variant.startsWith('v');
const size = portrait ? { width: 540, height: 960 } : { width: 960, height: 540 };

app.setPath('userData', path.join(out, '.profile'));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const log = [];
  const win = new BrowserWindow({
    show: false, ...size, useContentSize: true,
    webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  win.webContents.on('console-message', (e) => log.push(`[page] ${e.message}`));
  try {
    await win.loadFile(path.join(__dirname, 'stage.html'));
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    // 舞台按逻辑尺寸排版（竖屏 540×960），输出时放大两倍，得到 1080×1920 的清晰画面
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 2, mobile: false });
    const info = await win.webContents.executeJavaScript(`stage.init(${JSON.stringify(variant)})`);
    const started = Date.now();
    let saved = 0;
    for (let i = 0; i < Math.min(info.frames, until); i++) {
      await win.webContents.executeJavaScript(`stage.frame(${i})`);
      if (i % every) continue;
      const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 96 });
      fs.writeFileSync(path.join(out, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
      saved++;
    }
    log.push(`[done] ${variant} frames=${info.frames} saved=${saved} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err) {
    log.push(`[error] ${err.stack || err}`);
  }
  fs.writeFileSync(path.join(out, 'record.log'), log.join('\n'));
  app.quit();
});
