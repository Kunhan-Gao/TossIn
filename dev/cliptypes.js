// 仅测试用：打印当前剪贴板里有哪些格式（只打印格式名）。用法：electron dev/cliptypes.js <输出文件>
const { app, clipboard } = require('electron');
const fs = require('fs');

app.whenReady().then(async () => {
  const lines = [];
  for (const entry of await clipboard.read()) {
    for (const type of entry.types) {
      let size = '?';
      try { size = (await entry.getType(type)).size; } catch {}
      lines.push(`${type}  (${size} 字节)`);
    }
  }
  fs.writeFileSync(process.argv[2], lines.join('\n'));
  app.quit();
});
