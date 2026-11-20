// 仅测试用：往空的数据目录里放一批不同冷热的示例，用来看排版。
// 用法：YUWEN_DATA=<临时目录> electron . --seed=1 --shot=<输出.png>
const fs = require('fs');
const path = require('path');

module.exports = function seed({ items, IMG, nativeImage, lang, tall, stress }) {
  if (items.length) return;
  const H = 3600e3;
  const now = Date.now();
  let n = 0;
  const put = (type, hoursAgo, extra) => items.push({
    id: `seed${n++}`, type, created: now - hoursAgo * H, touched: now - hoursAgo * H,
    uses: 0, pin: false, sunk: false, ...extra,
  });

  function image(name, w, h, draw) {
    const buf = Buffer.alloc(w * h * 4);
    const px = (x, y, r, g, b) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (Math.round(y) * w + Math.round(x)) * 4;
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, 250, 250, 248);
    draw(px);
    fs.writeFileSync(path.join(IMG, name), nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG());
    return { file: name, w, h };
  }
  const plot = image('seed-plot.png', 640, 380, (px) => {
    for (let y = 30; y < 340; y++) px(60, y, 40, 40, 40);
    for (let x = 60; x < 610; x++) px(x, 340, 40, 40, 40);
    for (let x = 62; x < 610; x += 0.25) {
      const u = (x - 62) / 548;
      for (let k = 0; k < 3; k++) {
        px(x, 330 - 270 * (1 - Math.exp(-4 * u)) + k, 200, 70, 40);
        px(x, 330 - 190 * (1 - Math.exp(-2.5 * u)) + k, 50, 100, 190);
      }
    }
  });
  const table = image('seed-table.png', 520, 160, (px) => {
    for (let r = 0; r <= 4; r++) for (let x = 20; x < 500; x++) px(x, 20 + r * 30, 150, 150, 150);
    for (let c = 0; c <= 4; c++) for (let y = 20; y < 140; y++) px(20 + c * 120, y, 150, 150, 150);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let x = 0; x < 50 + ((r * 7 + c * 13) % 40); x++) {
      px(34 + c * 120 + x, 35 + r * 30, 60, 60, 60); px(34 + c * 120 + x, 36 + r * 30, 60, 60, 60);
    }
  });

  // --tall=1：再加一张很长的截图（聊天记录那样的），用来看长图的显示
  if (tall) {
    const chat = image('seed-long.png', 420, 2600, (px) => {
      for (let row = 0; row < 60; row++) {
        const y0 = 24 + row * 42, mine = row % 3 === 1, len = 120 + ((row * 53) % 180);
        const x0 = mine ? 400 - len : 20;
        for (let y = y0; y < y0 + 26; y++) for (let x = x0; x < x0 + len; x++) px(x, y, mine ? 150 : 225, mine ? 215 : 225, mine ? 150 : 225);
        for (let x = x0 + 10; x < x0 + len - 14; x++) { px(x, y0 + 12, 70, 70, 70); px(x, y0 + 13, 70, 70, 70); }
      }
    });
    put('image', 1, { ...chat });
  }

  // --stress=1：很多条目，外加一条几百万字的单行文字和一条十几万行的文字，用来看会不会卡、会不会出错
  if (stress) {
    for (let i = 0; i < 400; i++) put('text', i * 0.4, { text: `第 ${i} 条 · ` + 'note '.repeat(1 + (i % 9)) });
    put('text', 0.2, { text: 'x'.repeat(3000000) });
    put('text', 0.3, { text: Array.from({ length: 150000 }, (_, i) => `line ${i}`).join('\n') });
    put('text', 500, { text: '归档很久、已经过期的一条', sunk: true, sunkAt: now - 31 * 24 * H });
  }

  if (lang === 'en') {
    put('text', 0.1, { text: 'ssh -p 2222 lab@gpu-03', uses: 6 });
    put('text', 30, { text: 'Group meeting Thu 14:30 · Room B1-312', pin: true });
    put('image', 3, { ...plot, uses: 2 });
    put('text', 8, { text: 'Reviewer 2: change the y-axis of Fig. 3 to dB, and move the legend to the lower right so it stops covering the knee of the curve.' });
    put('text', 20, { text: 'lr=3e-4  batch=64  seed=17', uses: 3 });
    put('link', 30, { url: 'https://example.org/papers/contrastive-baseline', title: 'The baseline paper the reviewer mentioned' });
    put('text', 50, { text: '\\includegraphics[width=.8\\linewidth]{fig/result.pdf}', uses: 1 });
    put('text', 70, { text: 'Parcel pickup code 6-2-3071' });
    put('link', 90, { url: 'https://example.com/help/matlab/ref/tiledlayout.html', title: 'tiledlayout documentation', uses: 1 });
    put('image', 120, { ...table });
    put('text', 150, { text: 'Expense claim BX-2026-11-0412' });
    put('file', 60, { path: 'C:\\Users\\demo\\Documents\\Defense\\slides-v3.pptx' });
    put('text', 400, { text: 'Last week\'s meeting room code 8841' });
    put('text', 300, { text: 'conda activate torch26', sunk: true, sunkAt: now - 40 * H });
    return;
  }

  put('text', 0.1, { text: 'ssh -p 2222 lab@gpu-03', uses: 6 });
  put('text', 30, { text: '组会 周四 14:30 · B1-312', pin: true });
  put('image', 3, { ...plot, uses: 2 });
  put('text', 8, { text: '王老师：图 3 的纵轴单位要改成 dB，另外图例放到右下角，不要挡住曲线的拐点。' });
  put('text', 20, { text: 'lr=3e-4  batch=64  seed=17', uses: 3 });
  put('link', 30, { url: 'https://example.org/papers/contrastive-baseline', title: '审稿人提到的那篇对比论文' });
  put('text', 50, { text: '\\includegraphics[width=.8\\linewidth]{fig/result.pdf}', uses: 1 });
  put('text', 70, { text: '取件码 6-2-3071' });
  put('link', 90, { url: 'https://example.com/help/matlab/ref/tiledlayout.html', title: 'tiledlayout 文档', uses: 1 });
  put('image', 120, { ...table });
  put('text', 150, { text: '报销单号 BX-2026-11-0412' });
  put('file', 60, { path: 'C:\\Users\\demo\\Documents\\答辩\\slides-v3.pptx' });
  put('text', 400, { text: '上周的会议室预约码 8841' });
  put('text', 300, { text: 'conda activate torch26', sunk: true, sunkAt: now - 40 * H });
};
