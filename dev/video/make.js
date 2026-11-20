// 做演示视频：先合成声音（音效加配乐），再把三个版本各录一遍画面，各编成一个 mp4。
// 用法：npm run video（可以只做某一个：npm run video -- v-zh）
// 成片在 dist/video/ 里：
//   TossIn-demo-vertical-zh.mp4     竖屏中文，1080×1920，给抖音和朋友圈
//   TossIn-demo-landscape-zh.mp4    横屏中文，1920×1080，放在中文 README
//   TossIn-demo-landscape-en.mp4    横屏英文，放在英文 README（GitHub 上的视频不能超过 10 MB，所以横屏的码率低一些）
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const electron = require('electron');

const root = path.join(__dirname, '..', '..');
const outDir = path.join(root, 'dist', 'video');
const VARIANTS = {
  'v-zh': { name: 'TossIn-demo-vertical-zh', bitrate: 6000000 },
  'h-zh': { name: 'TossIn-demo-landscape-zh', bitrate: 1900000, limit: 10 },
  'h-en': { name: 'TossIn-demo-landscape-en', bitrate: 1900000, limit: 10 },
};
const wanted = process.argv.slice(2).filter((a) => VARIANTS[a]);
const check = [0, 20, 70, 115, 150, 170, 235, 320, 390, 500, 560, 640, 690, 800, 880, 1000, 1060, 1199].join(',');
const run = (script, args) => spawnSync(electron, [path.join(__dirname, script), ...args], { stdio: 'ignore' });

console.log('合成声音…');
fs.mkdirSync(outDir, { recursive: true });
run('audio.js', [`--out=${outDir}`]);
const audio = JSON.parse(fs.readFileSync(path.join(outDir, 'audio.json'), 'utf8'));
if (audio.error) { console.error(audio.error); process.exit(1); }
console.log(`声音：${audio.sounds} 个音效，最大音量 ${audio.fullPeakDb} dB，削顶 ${audio.clipped} 处`);

for (const id of wanted.length ? wanted : Object.keys(VARIANTS)) {
  const { name, bitrate, limit } = VARIANTS[id];
  const frames = path.join(outDir, `frames-${id}`);
  fs.rmSync(frames, { recursive: true, force: true });
  console.log(`[${id}] 录画面…`);
  run('record.js', [`--variant=${id}`, `--out=${frames}`]);
  const log = fs.existsSync(path.join(frames, 'record.log')) ? fs.readFileSync(path.join(frames, 'record.log'), 'utf8') : '';
  if (!/\[done\]/.test(log) || /\[error\]/.test(log)) { console.error(log || '没有录出画面'); process.exit(1); }
  for (const [suffix, wav] of [['', 'audio-full.wav']]) {
    console.log(`[${id}${suffix}] 编码…`);
    const file = path.join(outDir, `${name}${suffix}.mp4`);
    run('encode.js', [`--frames=${frames}`, `--out=${file}`, `--audio=${path.join(outDir, wav)}`, `--bitrate=${bitrate}`, ...(suffix ? [] : [`--check=${check}`])]);
    const result = JSON.parse(fs.readFileSync(file.replace(/\.mp4$/, '.json'), 'utf8'));
    delete result.file;
    console.log(`[${id}${suffix}] ${JSON.stringify(result)}`);
    if (result.error || result.audioError || result.decodedFrames !== result.frames) process.exit(1);
    if (limit && result.megabytes > limit) console.warn(`[${id}${suffix}] 超过 ${limit} MB，GitHub 上传不了，需要再降码率`);
  }
  fs.rmSync(frames, { recursive: true, force: true });
}
