// 把打包好的文件夹做成安装包和免安装压缩包。用法：npm run installer（先要 npm run pack）
// 需要 NSIS：把它的免安装版解压到 dev/tools/nsis/ 下面，或者装到系统里让 makensis 能直接运行。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const dist = path.join(root, 'dist');
const src = path.join(dist, 'TossIn-win32-x64');
const setup = path.join(dist, `TossIn-Setup-${pkg.version}.exe`);
const zip = path.join(dist, `TossIn-${pkg.version}-win-x64.zip`);
const fileList = path.join(dist, 'uninstall-files.nsh');

if (!fs.existsSync(path.join(src, 'TossIn.exe'))) {
  console.error('还没有打包好的程序，先运行 npm run pack');
  process.exit(1);
}

// 找 makensis：先看项目里的 dev/tools/nsis，再看系统路径
function findMakensis() {
  const tools = path.join(__dirname, 'tools', 'nsis');
  if (fs.existsSync(tools)) {
    for (const dir of ['', ...fs.readdirSync(tools)]) {
      const exe = path.join(tools, dir, 'makensis.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return 'makensis';
}

// 卸载时要删的清单：先是每一个文件，再是每一层文件夹（从最深的开始）。只删装进去的，不碰别的
function writeFileList() {
  const files = [];
  const dirs = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}\\${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(path.join(dir, entry.name), next); dirs.push(next); } else files.push(next);
    }
  };
  walk(src, '');
  const lines = [
    ...files.map((f) => `Delete "$INSTDIR\\${f}"`),
    ...dirs.map((d) => `RMDir "$INSTDIR\\${d}"`), // walk 是先进子文件夹再记自己，所以这里已经是从深到浅
  ];
  fs.writeFileSync(fileList, '\ufeff' + lines.join('\r\n') + '\r\n');
  return files.length;
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    console.error((result.stdout || '').split('\n').slice(-25).join('\n'));
    console.error(result.stderr || result.error);
    process.exit(1);
  }
  return result.stdout;
}

const count = writeFileList();
console.log(`程序文件 ${count} 个，开始压缩（要一两分钟）…`);

for (const old of [setup, zip]) if (fs.existsSync(old)) fs.unlinkSync(old);
run(findMakensis(), [
  '/V2', '/INPUTCHARSET', 'UTF8',
  `/DVERSION=${pkg.version}`,
  `/DAUTHOR=${pkg.author}`,
  `/DYEAR=${new Date().getFullYear()}`,
  `/DHOMEPAGE=https://github.com/${pkg.repository.replace(/^github:/, '')}`,
  `/DSRC=${src}`,
  `/DOUT=${setup}`,
  `/DICON=${path.join(root, 'assets', 'icon.ico')}`,
  `/DFILES=${fileList}`,
  path.join(__dirname, 'installer.nsi'),
]);
fs.unlinkSync(fileList);
console.log(`安装包：${setup}（${(fs.statSync(setup).size / 1048576).toFixed(0)} MB）`);

// 免安装版：用系统自带的 tar 打成 zip
run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', dist, path.basename(src)]);
console.log(`压缩包：${zip}（${(fs.statSync(zip).size / 1048576).toFixed(0)} MB）`);
