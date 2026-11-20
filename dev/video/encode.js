// 把帧编码成 mp4。用法：electron dev/video/encode.js --frames=<帧文件夹> --out=<成片.mp4> [--audio=<声音.wav>] [--bitrate=6000000] [--check=0,150,450]
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const pass = process.argv.filter((a) => /^--(frames|out|bitrate|fps|check|audio)=/.test(a)).map((a) => {
  const [key, value] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
  return key === '--frames' || key === '--out' || key === '--audio' ? `${key}=${path.resolve(value)}` : a;
});
const outFile = pass.find((a) => a.startsWith('--out=')).slice(6);

app.setPath('userData', path.join(path.dirname(outFile), '.profile'));
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, additionalArguments: pass } });
  ipcMain.once('done', (_e, out) => {
    fs.writeFileSync(outFile.replace(/\.mp4$/, '.json'), JSON.stringify(out, null, 1));
    app.quit();
  });
  win.loadFile(path.join(__dirname, 'encode.html'));
});
