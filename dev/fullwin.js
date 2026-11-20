// 仅测试用：在副屏（没有副屏就在主屏）上开一个全屏窗口，停留几秒后自己关掉。
// 用来验证"前面有全屏窗口时，边上的鹈鹕会躲起来"。用法：electron dev/fullwin.js <临时数据目录> [停留毫秒]
const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

app.setPath('userData', path.resolve(process.argv[2]));
app.whenReady().then(() => {
  const primary = screen.getPrimaryDisplay();
  const target = screen.getAllDisplays().find((d) => d.id !== primary.id) || primary;
  const win = new BrowserWindow({ x: target.bounds.x, y: target.bounds.y, frame: false, fullscreen: true, backgroundColor: '#11181C' });
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body style="margin:0;height:100vh;display:grid;place-items:center;background:#11181C;color:#98A6AD;font:20px sans-serif">TossIn 测试用的全屏窗口，几秒后自动关闭</body>')}`);
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  setTimeout(() => app.quit(), Number(process.argv[3]) || 3000);
});
