// 合成演示视频的声音。用法：electron dev/video/audio.js --out=<文件夹>
// 在那个文件夹里写出 audio-sfx.wav（只有音效）、audio-full.wav（音效加配乐）和 audio.json（核对结果）。
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv.find((a) => a.startsWith('--out=')).slice(6));
app.setPath('userData', path.join(out, '.profile'));
app.whenReady().then(() => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, additionalArguments: [`--out=${out}`] } });
  ipcMain.once('done', (_e, result) => {
    fs.writeFileSync(path.join(out, 'audio.json'), JSON.stringify(result, null, 1));
    app.quit();
  });
  win.loadFile(path.join(__dirname, 'audio.html'));
});
