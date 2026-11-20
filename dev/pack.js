// 打包成可以直接运行的文件夹。用法：npm run pack
// 用脚本而不是命令行参数，是为了能安全地写进版权符号等非英文字符。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');

(async () => {
  const { packager } = await import('@electron/packager');
  const out = await packager({
    dir: root,
    name: 'TossIn',
    platform: 'win32',
    arch: 'x64',
    out: path.join(root, 'dist'),
    overwrite: true,
    // 调系统接口的库带一个 .node 文件，它不能放在压缩包里，要单独摊开
    asar: { unpack: '**/*.node' },
    // 项目根目录里放着 Electron 的压缩包就用它（不用联网），没有就让打包工具自己下载
    ...(fs.readdirSync(root).some((f) => /^electron-v.+\.zip$/.test(f)) ? { electronZipDir: root } : {}),
    icon: path.join(root, 'assets', 'icon.ico'),
    ignore: [/^\/dist/, /^\/dev/, /^\/images/, /^\/README/, /^\/\.git/, /\.zip$/, /yuwen-plan\.html/],
    appVersion: pkg.version,
    appCopyright: `© ${new Date().getFullYear()} ${pkg.author}`,
    win32metadata: {
      CompanyName: pkg.author,
      ProductName: pkg.productName,
      FileDescription: pkg.productName,
      InternalName: 'TossIn',
      OriginalFilename: 'TossIn.exe',
    },
  });
  console.log(`Wrote new app to: ${out.join(', ')}`);
})().catch((err) => { console.error(err); process.exit(1); });
