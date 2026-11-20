// 演示视频的舞台脚本。
// 做法：把真实的看板页面（renderer/index.html）嵌进一个 iframe，给它一套假的时钟和假的数据接口，
// 然后按分镜在里面粘贴、点击、拖动；四周的字幕、鼠标指针、按键提示和开头结尾的动画由这里按时间画出来。
// 每一帧的样子只取决于"第几帧"，所以录出来的结果每次都一样。由 dev/video/record.js 调用 stage.init / stage.frame。
//
// 节奏的规矩：每个动作都是"字幕先出 → 动作 → 结果停住"。字幕的第二行等结果出来再亮。
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { FPS, DURATION, T } = require('./timeline');
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const ROOT = path.join(__dirname, '..', '..');
const $ = (id) => document.getElementById(id);

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const inOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const inCubic = (x) => x * x * x;
const overshoot = (x) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
const bump = (x, len) => (x > 0 && x < len ? Math.sin((x / len) * Math.PI) : 0);

// ---------- 三个版本：竖屏中文、横屏中文、横屏英文 ----------

const VARIANTS = {
  'v-zh': { lang: 'zh', portrait: true },
  'h-zh': { lang: 'zh', portrait: false },
  'h-en': { lang: 'en', portrait: false },
};

const TEXT = {
  zh: {
    questions: ['截图还在发给自己？', '取件码记在记事本？', '网页开着不敢关？'],
    pre: '临时要用的东西', title: '先放这儿', titleSub: 'TOSSIN',
    scraps: ['发给自己', '记事本', '开着的 20 个标签页'],
    cues: [
      ['截图、文字、文件、链接', '<b>都放在一起</b>'],
      ['点一下', '<b>就复制了</b>'],
      ['拖出去', '<b>就能用</b>'],
      ['不用的，自己淡出', '<b>不用整理</b>'],
      ['不用时', '<b>收到屏幕边上</b>'],
    ],
    hints: { paste: '粘贴', drag: '直接拖进来', hot: '在任何窗口里' },
    day: (n) => `第 <b>${n}</b> 天`,
    noteTitle: '备忘.txt', memoTitle: '给同事的留言.txt',
    note: (code) => `今天要办的事\n<mark>${code}</mark>\n下午三点前交周报`,
    memo: ['帮我带一下快递：', '顺便把这张表发你：'],
    meeting: '周四 14:30 项目例会 · 3 楼会议室',
    link: '差旅报销流程说明',
    wifi: '访客 Wi-Fi：guest-2026',
    code: '取件码 6-2-3071',
    file: 'D:\\工作\\汇报\\季度汇报-v3.pptx',
    endName: '先放这儿', endSub: 'TOSSIN', endTags: '免费 · 开源 · Windows', endWhere: 'GitHub 搜 TossIn',
  },
  en: {
    questions: ['Still sending screenshots<br>to yourself?', 'Pickup codes<br>in Notepad?', 'Tabs you don’t dare<br>to close?'],
    pre: 'For the things you only need for now', title: 'TossIn', titleSub: 'TOSS IT IN',
    scraps: ['SENT TO MYSELF', 'NOTEPAD', '20 OPEN TABS'],
    cues: [
      ['Screenshots, text, files, links', '<b>all in one place</b>'],
      ['Click it', '<b>and it’s copied</b>'],
      ['Drag it out', '<b>and use it</b>'],
      ['What you stop using fades', '<b>nothing to tidy</b>'],
      ['Not using it?', '<b>Tuck it to the edge</b>'],
    ],
    hints: { paste: 'paste', drag: 'just drag it in', hot: 'from any window' },
    day: (n) => `DAY <b>${n}</b>`,
    noteTitle: 'notes.txt', memoTitle: 'note-to-colleague.txt',
    note: (code) => `Things to do today\n<mark>${code}</mark>\nSend the weekly report by 3 pm`,
    memo: ['Please grab my parcel:', 'And here is the Q3 table:'],
    meeting: 'Thu 14:30 project sync · Room 3F',
    link: 'How to file travel expenses',
    wifi: 'Guest Wi-Fi: guest-2026',
    code: 'Pickup code 6-2-3071',
    file: 'D:\\Work\\Reports\\Quarterly-review-v3.pptx',
    endName: 'TossIn', endSub: 'A TEMPORARY DESKTOP WORKSPACE', endTags: 'Free · Open source · Windows', endWhere: 'github.com/Kunhan-Gao/TossIn',
  },
};

function layoutFor(portrait) {
  if (portrait) {
    return {
      W: 540, H: 960, zoom: 1.12,
      caption: { x: 30, y: 62, w: 480, size: 34, align: 'center' },
      keys: { x: 270, y: 174, center: true, size: 17 },
      desk: { x: 20, y: 236, w: 500, h: 694 },
      other: { x: 16, y: 424, w: 468, h: 254, from: 'bottom' },
      behind: { x: 28, y: 300, w: 380, h: 254 },
      hook: {
        question: { x: 30, y: 112, w: 480, size: 46 },
        focus: { x: 270, y: 420, scale: 2.1 },
        scraps: [[136, 606, -7, 1.05], [404, 606, 6, 1.05], [270, 420, 0, 2.1]],
        bird: { cx: 270, y: 704, scale: 4.4 },
      },
      end: { y: 268, icon: 132, name: 46, sub: 16, tags: 15, where: 15 },
    };
  }
  return {
    W: 960, H: 540, zoom: 0.88,
    caption: { x: 46, y: 92, w: 292, size: 28, align: 'left' },
    keys: { x: 46, y: 250, center: false, size: 15 },
    desk: { x: 372, y: 34, w: 558, h: 472 },
    other: { x: 14, y: 232, w: 320, h: 226, from: 'left' },
    behind: { x: 26, y: 150, w: 330, h: 226 }, slot: 78,
    hook: {
      question: { x: 60, y: 40, w: 840, size: 38 },
      focus: { x: 480, y: 246, scale: 1.5 },
      scraps: [[176, 300, -6, 1], [784, 300, 5, 1], [480, 246, 0, 1.5]],
      bird: { cx: 480, y: 372, scale: 3.2 },
    },
    end: { y: 84, icon: 104, name: 40, sub: 14, tags: 14, where: 14 },
  };
}

let V, L, TX, app, clock;
const handlers = {};
let nextCapture = [];
const events = [];
let fired = 0;
const at = (time, run) => events.push({ at: time, run });

// ---------- 假时钟：看板页面里的计时器、动画帧和"现在几点"都由这里说了算 ----------

function installClock(w) {
  const c = { t: 0, warp: 0, base: new Date(2026, 10, 16, 9, 30).getTime(), timers: new Map(), id: 1, rafs: [] };
  c.dateNow = () => c.base + c.warp + c.t;
  const RealDate = w.Date;
  w.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(c.dateNow()); }
    static now() { return c.dateNow(); }
  };
  w.performance.now = () => c.t;
  w.setTimeout = (fn, ms = 0, ...args) => { c.timers.set(c.id, { at: c.t + Math.max(0, ms), fn, args }); return c.id++; };
  w.setInterval = (fn, ms, ...args) => { c.timers.set(c.id, { at: c.t + ms, fn, args, every: ms }); return c.id++; };
  w.clearTimeout = w.clearInterval = (id) => { c.timers.delete(id); };
  w.requestAnimationFrame = (fn) => { c.rafs.push(fn); return c.rafs.length; };
  w.cancelAnimationFrame = () => {};
  // 走到 to 这一刻：按时间顺序把到点的计时器跑掉，再跑一轮动画帧回调
  c.advance = (to) => {
    for (;;) {
      let next = null;
      for (const [id, tm] of c.timers) if (tm.at <= to && (!next || tm.at < next.tm.at)) next = { id, tm };
      if (!next) break;
      c.t = Math.max(c.t, next.tm.at);
      if (next.tm.every) next.tm.at += next.tm.every; else c.timers.delete(next.id);
      try { next.tm.fn(...next.tm.args); } catch (err) { console.error(err); }
    }
    c.t = to;
    const rafs = c.rafs;
    c.rafs = [];
    for (const fn of rafs) { try { fn(c.t); } catch (err) { console.error(err); } }
  };
  return c;
}

// 看板里的过渡动画不让它自己跑：每一帧把它们拨到该在的位置
const born = new WeakMap();
function syncAnimations(doc, ms) {
  for (const a of doc.getAnimations()) {
    if (!born.has(a)) { born.set(a, ms); a.pause(); }
    a.currentTime = ms - born.get(a);
  }
}

// ---------- 假的数据接口：看板以为自己在和主进程说话 ----------

let seq = 0;
const item = (type, hoursAgo, extra) => ({
  id: `demo${seq++}`, type, created: clock.dateNow() - hoursAgo * HOUR, touched: clock.dateNow() - hoursAgo * HOUR,
  uses: 0, pin: false, sunk: false, ...extra,
});

function makeYw(items) {
  const find = (id) => items.find((it) => it.id === id);
  return {
    init: async () => ({
      items, zoom: L.zoom, level: 'normal', theme: 'dusk', lang: V.lang,
      hotkeys: { put: { accel: 'Control+Alt+V', ok: true }, show: { accel: 'Control+Alt+Space', ok: true } },
      update: null, version: '1.0', firstRun: false,
      imageBase: pathToFileURL(path.join(__dirname, 'assets')).href + '/',
    }),
    capture: async () => { const got = nextCapture; nextCapture = []; return got; },
    addText: async (text) => item('text', 0, { text }),
    addPaths: async () => [], addImageUrl: async () => null,
    update: async (id, patch) => { const it = find(id); if (it) Object.assign(it, patch); return it; },
    remove: async () => true, trash: async () => true, untrash: async () => [], emptyTrash: async () => true,
    copy: async () => true, copyMany: async (ids) => ids, open: async () => true,
    drag() {}, peek() {}, win: async () => 'normal',
    setZoom() {}, setTheme() {}, openData() {}, openAuthor() {}, openUpdate() {}, setLang() {},
    setHotkey: async () => ({ ok: true, hotkeys: {} }), hotkeyRecording() {}, pathFor: () => '',
    on: (channel, fn) => { handlers[channel] = fn; },
  };
}

async function loadApp() {
  const frame = $('app');
  const w = frame.contentWindow;
  clock = installClock(w);
  const items = [
    item('text', 2, { text: TX.meeting, pin: true }),
    item('link', 5, { url: 'https://oa.example.com/guide/travel', title: TX.link }),
    item('text', 30, { text: TX.wifi }),
  ];
  w.yw = makeYw(items);
  let html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<base href="${pathToFileURL(path.join(ROOT, 'renderer')).href}/">`);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  app = { win: w, doc, items };
  // 等看板把最初的几条排出来
  for (let i = 0; i < 200 && doc.querySelectorAll('.it').length < items.length; i++) await sleep(25);
  for (let i = 0; i < 3; i++) { clock.advance(0); await sleep(30); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(r));

// ---------- 在看板里动手 ----------

const byText = (text) => [...app.doc.querySelectorAll('.it:not(.gone)')].find((el) => (el.querySelector('.body') || {}).textContent?.includes(text));
function rectOf(node) {
  const f = $('app').getBoundingClientRect();
  const r = node.getBoundingClientRect();
  return { x: f.left + r.left, y: f.top + r.top, w: r.width, h: r.height };
}
function centerOf(node, fx = 0.5, fy = 0.5) {
  const r = rectOf(node);
  return { x: r.x + r.w * fx, y: r.y + r.h * fy };
}
function clickIn(node) {
  node.dispatchEvent(new app.win.MouseEvent('mousedown', { bubbles: true }));
  node.dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, detail: 1 }));
}
const added = (list) => handlers.added(list);
const fileName = () => TX.file.split('\\').pop();

// ---------- 鼠标指针：一段一段地走 ----------

const cursorSegs = [];
function cursorPos(t) {
  let pos = { x: -50, y: -50 };
  for (const s of cursorSegs) {
    if (t < s.t0) break;
    const k = s.t1 > s.t0 ? inOut(seg(t, s.t0, s.t1)) : 1;
    pos = { x: lerp(s.from.x, s.to.x, k), y: lerp(s.from.y, s.to.y, k) };
  }
  return pos;
}
const cursorJump = (t, to) => cursorSegs.push({ t0: t, t1: t, from: to, to });
const cursorMove = (t, dur, to) => cursorSegs.push({ t0: t, t1: t + dur, from: cursorPos(t), to });

// ---------- 分镜里要在看板上做的事 ----------

function script() {
  const d = L.desk;
  const image = () => item('image', 0, { file: `table.${V.lang}.png`, w: 720, h: 400 });

  // 放：粘贴一张截图，拖进一个文件，在别的窗口里按快捷键放一段文字
  at(7.5, () => {
    nextCapture = [image()];
    app.doc.dispatchEvent(new app.win.Event('paste', { bubbles: true, cancelable: true }));
  });
  at(9.1, () => { cursorJump(9.1, { x: L.W - 26, y: L.H - 30 }); cursorMove(9.15, 1.1, { x: d.x + d.w * 0.56, y: d.y + d.h * 0.52 }); });
  at(9.6, () => app.doc.body.classList.add('over'));
  at(10.3, () => { app.doc.body.classList.remove('over'); added([item('file', 0, { path: TX.file })]); });
  at(12.6, () => added([item('text', 0, { text: TX.code })]));

  // 用：点一下复制，到别的窗口里粘贴出来；再把图片拖过去
  at(15.3, () => { cursorJump(15.3, { x: d.x + d.w * 0.62, y: d.y + d.h * 0.5 }); cursorMove(15.4, 0.8, centerOf(byText(TX.code).querySelector('.body'), 0.42, 0.55)); });
  at(16.4, () => clickIn(byText(TX.code).querySelector('.body')));
  at(17.5, () => {
    const r = document.querySelector('#other .memo .said').getBoundingClientRect();
    cursorMove(17.5, 0.5, { x: r.right + 14, y: r.top + r.height * 0.6 });
  });
  at(19.3, () => cursorMove(19.3, 0.8, centerOf(app.doc.querySelector('.it.image img'), 0.45, 0.35)));
  at(20.4, () => {
    const slot = document.querySelector('#other .slot').getBoundingClientRect();
    cursorMove(20.4, 0.9, { x: slot.left + slot.width * 0.5, y: slot.top + slot.height * 0.55 });
  });
  at(21.4, () => {
    const it = app.items.find((x) => x.type === 'image');
    handlers.changed({ id: it.id, touched: clock.dateNow(), uses: it.uses + 1 });
  });
  at(21.7, () => { const p = cursorPos(21.7); cursorMove(21.7, 0.5, { x: p.x + 40, y: p.y + 30 }); });

  // 收到屏幕边上：点右上角的按钮，再点边上的鹈鹕
  at(31.3, () => {
    cursorJump(31.3, { x: d.x + d.w * 0.5, y: d.y + d.h * 0.4 });
    app.doc.body.dispatchEvent(new app.win.MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 12 }));
  });
  at(31.4, () => cursorMove(31.4, 0.7, centerOf(app.doc.getElementById('b-edge'))));
  at(32.8, () => app.doc.body.dispatchEvent(new app.win.MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 300 })));
  at(33.6, () => cursorMove(33.6, 0.6, { x: d.x + d.w - 26, y: d.y + peekY() + 24 }));

  events.sort((a, b) => a.at - b.at);
}
const peekY = () => Math.round(0.2 * (L.desk.h - 44));

// "看这里"的一圈：跟着看板里刚落下的那一条
const glowTargets = {
  image: () => app.doc.querySelector('.it.image img'),
  file: () => byText(fileName())?.querySelector('.body'),
  code: () => byText(TX.code)?.querySelector('.body'),
  door: () => app.doc.getElementById('sed'),
};

// ---------- 画四周的东西 ----------

const px = (n) => `${n.toFixed(2)}px`;
function place(el, x, y, extra = '') { el.style.transform = `translate(${px(x)}, ${px(y)}) ${extra}`; }

function renderHook(t) {
  const hook = $('hook');
  if (t > T.hookOut[1] + 0.05) { hook.style.display = 'none'; return; }
  hook.style.display = '';
  hook.style.opacity = 1 - seg(t, ...T.hookOut);
  const h = L.hook;

  // 三句提问，一句一屏。第一句在第一帧就在：既是封面，也不让开头空着
  [...$('questions').children].forEach((el, i) => {
    const start = T.questions[i], end = T.questions[i + 1];
    const a = (i === 0 ? 1 : outCubic(seg(t, start - 0.04, start + 0.16))) * (1 - seg(t, end - 0.08, end + (i === 2 ? 0.2 : 0.08)));
    el.style.opacity = a;
    place(el, h.question.x, h.question.y + (i === 0 ? 0 : (1 - outCubic(seg(t, start, start + 0.22))) * 12));
  });
  const title = $('title');
  const tIn = outCubic(seg(t, ...T.title));
  title.style.opacity = tIn;
  place(title, h.question.x, h.question.y - h.question.size * 0.5, `scale(${lerp(0.94, 1, tIn).toFixed(3)})`);

  // 每句话对应的那样东西：先在中间放大给人看，下一句来了就退到一旁；最后都飞进鹈鹕嘴里
  const b = h.bird;
  const x0 = b.cx - 32 * b.scale;
  const mouth = { x: x0 + 46 * b.scale, y: b.y + 15.5 * b.scale };
  let gulp = 0;
  ['s-shot', 's-note', 's-tabs'].forEach((id, i) => {
    const el = $(id);
    const [sx, sy, rot, sScale] = h.scraps[i];
    const start = T.questions[i];
    const pop = outCubic(i === 0 ? seg(t, -0.25, 0.2) : seg(t, start + 0.08, start + 0.38));
    const park = i === 2 ? 0 : inOut(seg(t, start + 1.32, start + 1.68));
    const fly = inCubic(seg(t, T.fly[i], T.fly[i] + 0.45));
    const wobble = Math.sin(t * 2.1 + i * 1.9) * 3 * park * (1 - fly);
    const x = lerp(lerp(h.focus.x, sx, park), mouth.x, fly);
    const y = lerp(lerp(h.focus.y, sy, park) + wobble, mouth.y, fly) - Math.sin(fly * Math.PI) * 30;
    const scale = lerp(lerp(h.focus.scale, sScale, park) * lerp(0.82, 1, pop), 0.14, fly);
    el.style.opacity = pop * (1 - seg(fly, 0.82, 1));
    el.style.zIndex = i === 2 || park < 0.5 ? 3 : 1;
    place(el, x, y, `translate(-50%, -50%) rotate(${(rot * park * (1 - fly)).toFixed(2)}deg) scale(${scale.toFixed(3)})`);
    gulp += bump(t - (T.fly[i] + 0.45), 0.24);
  });

  const bird = $('bird');
  const rise = outCubic(seg(t, ...T.birdRise));
  const open = outCubic(seg(t, ...T.birdOpen)) * (1 - inOut(seg(t, ...T.birdClose)));
  const nod = Math.sin(seg(t, ...T.birdNod) * Math.PI) * 1.4 * b.scale;
  bird.style.opacity = rise;
  bird.style.width = px(64 * b.scale);
  place(bird, x0, b.y + (1 - rise) * 60 + nod);
  bird.querySelector('.bill').style.transform = `rotate(${(-27 * open).toFixed(2)}deg)`;
  bird.querySelector('.pc').style.transform = `rotate(${(9 * open).toFixed(2)}deg) scale(${(1 + 0.09 * gulp).toFixed(3)})`;
}

function renderCaptions(t) {
  [...$('captions').children].forEach((el, i) => {
    const [start, second, end] = T.cues[i];
    const a = outCubic(seg(t, start, start + 0.35));
    el.style.opacity = a * (1 - seg(t, end - 0.25, end));
    place(el, L.caption.x, L.caption.y + (1 - a) * 12);
    const b = outCubic(seg(t, second, second + 0.3));
    const line2 = el.lastElementChild;
    line2.style.opacity = b;
    line2.style.transform = `translateY(${px((1 - b) * 8)})`;
  });
}

let keysShown = '';
function renderKeys(t) {
  const el = $('keys');
  const k = T.keys.find((x) => t >= x.t0 - 0.05 && t <= x.t1 + 0.05);
  if (!k) { el.style.opacity = 0; return; }
  const html = k.keys.map((key) => `<kbd>${key}</kbd>`).join('+') + `<em>${TX.hints[k.hint]}</em>`;
  if (html !== keysShown) { el.innerHTML = html; keysShown = html; }
  el.classList.toggle('down', !!k.press && t >= k.press - 0.06 && t < k.press + 0.3);
  const a = outCubic(seg(t, k.t0, k.t0 + 0.2)) * (1 - seg(t, k.t1 - 0.2, k.t1));
  el.style.opacity = a;
  place(el, L.keys.x, L.keys.y + (1 - a) * 6, L.keys.center ? 'translateX(-50%)' : '');
}

let dayShown = -1;
function renderDays(t) {
  const el = $('days');
  const a = seg(t, T.days[0], T.days[0] + 0.25) * (1 - seg(t, T.days[1] - 0.25, T.days[1]));
  el.style.opacity = a;
  if (!a) return;
  const n = 1 + Math.floor(clock.warp / DAY);
  if (n !== dayShown) { el.innerHTML = TX.day(n); dayShown = n; }
  place(el, L.keys.x, L.keys.y, L.keys.center ? 'translateX(-50%)' : '');
}

function renderDesk(t) {
  const d = L.desk;
  const desk = $('desk');
  const a = outCubic(seg(t, ...T.deskIn)) * (1 - seg(t, ...T.deskOut));
  desk.style.opacity = a;
  desk.style.visibility = a ? 'visible' : 'hidden';
  place(desk, d.x, d.y + (1 - outCubic(seg(t, ...T.deskIn))) * 18);

  // 看板：收到边上时向右滑出去
  const tuck = inOut(seg(t, ...T.tuck)) * (1 - inOut(seg(t, ...T.reveal)));
  const board = $('boardwin');
  board.style.opacity = 1 - tuck * 0.35;
  place(board, tuck * (d.w + 24), 0);

  // 别的程序的窗口
  const o = L.other;
  const other = $('other');
  const now = T.others.find((x) => t >= x.t0 && t < x.t1 + 0.5);
  if (!now) { other.style.visibility = 'hidden'; } else {
    other.style.visibility = 'visible';
    const p = now.behind ? 1 : outCubic(seg(t, now.t0, now.t0 + 0.45)) * (1 - inCubic(seg(t, now.t1, now.t1 + 0.45)));
    other.style.zIndex = now.behind ? 1 : 3;
    other.querySelector('.note').style.display = now.mode === 'note' ? '' : 'none';
    other.querySelector('.memo').style.display = now.mode === 'memo' ? '' : 'none';
    other.querySelector('.bar span').textContent = now.mode === 'note' ? TX.noteTitle : TX.memoTitle;
    const r = now.behind ? L.behind : o;
    Object.assign(other.style, { width: px(r.w), height: px(r.h) });
    if (now.behind) place(other, r.x, r.y);
    else if (o.from === 'bottom') place(other, o.x, o.y + (1 - p) * (d.h - o.y + 24));
    else place(other, o.x - (1 - p) * (o.x + o.w + 24), o.y);
    // 粘贴出来的那几个字：刚出现时带一下底色
    const pasted = other.querySelector('.pasted');
    pasted.textContent = t >= T.pasted ? TX.code : '';
    pasted.style.background = `rgba(255, 162, 115, ${(0.55 * (1 - seg(t, T.pasted + 0.5, T.pasted + 1.3))).toFixed(3)})`;
    const slot = other.querySelector('.slot');
    slot.classList.toggle('over', t >= T.slotOver[0] && t < T.slotOver[1]);
    slot.classList.toggle('filled', t >= T.slotFilled);
  }

  // 边上的鹈鹕
  const peek = $('peek');
  const show = outCubic(seg(t, ...T.peekIn)) * (1 - seg(t, T.reveal[0], T.reveal[0] + 0.15));
  const hover = inOut(seg(t, ...T.peekHover));
  peek.style.visibility = show ? 'visible' : 'hidden';
  place(peek, d.w - 56 + (1 - show) * 62 + (1 - hover) * 9, peekY());
  peek.querySelector('.bill').style.transform = `rotate(${(-21 * hover).toFixed(2)}deg)`;
  peek.querySelector('.pc').style.transform = `rotate(${(6 * hover).toFixed(2)}deg)`;
}

function renderGlow(t) {
  const glow = $('glow');
  const g = T.glows.find((x) => t >= x.t0 + 0.25 && t <= x.t0 + 1.9);
  const node = g && glowTargets[g.what]();
  if (!node) { glow.style.opacity = 0; return; }
  const a = seg(t, g.t0 + 0.3, g.t0 + 0.55) * (1 - seg(t, g.t0 + 1.4, g.t0 + 1.9));
  const r = rectOf(node);
  const pad = 9;
  glow.style.opacity = a;
  Object.assign(glow.style, { width: px(r.w + pad * 2), height: px(r.h + pad * 2) });
  place(glow, r.x - pad, r.y - pad);
}

function renderEnd(t) {
  const end = $('end');
  const e = L.end;
  const a = seg(t, T.end, T.end + 0.4);
  end.style.opacity = a;
  end.style.visibility = a ? 'visible' : 'hidden';
  if (!a) return;
  place(end, 0, e.y);
  const rise = (el, start) => {
    const k = outCubic(seg(t, start, start + 0.45));
    el.style.opacity = k;
    el.style.transform = `translateY(${px((1 - k) * 12)})`;
  };
  $('end-icon').style.transform = `scale(${overshoot(seg(t, T.end, T.end + 0.55)).toFixed(3)})`;
  rise($('end-name'), T.end + 0.25);
  rise($('end-sub'), T.end + 0.4);
  rise($('end-tags'), T.end + 0.7);
  rise($('end-where'), T.end + 1.0);
}

function renderPointer(t) {
  const pos = cursorPos(t);
  const cursor = $('cursor');
  let a = 0;
  for (const [t0, t1] of T.cursor) a = Math.max(a, seg(t, t0, t0 + 0.2) * (1 - seg(t, t1 - 0.2, t1)));
  let press = 0, ringAt = -1;
  for (const c of T.clicks) { press = Math.max(press, bump(t - c + 0.06, 0.2)); if (t >= c) ringAt = c; }
  cursor.style.opacity = a;
  place(cursor, pos.x - 5, pos.y - 2.5, `scale(${(1 - 0.16 * press).toFixed(3)})`);

  const ring = $('ring');
  const k = ringAt < 0 ? 1 : seg(t, ringAt, ringAt + 0.42);
  ring.style.opacity = k < 1 ? (1 - k) * 0.9 * a : 0;
  place(ring, pos.x, pos.y, `scale(${lerp(0.35, 1.25, outCubic(k)).toFixed(3)})`);

  const ghost = $('ghost');
  const g = T.ghosts.find((x) => t >= x.t0 && t <= x.t1 + 0.15);
  if (!g) { ghost.style.opacity = 0; return; }
  if (ghost.dataset.kind !== g.kind) {
    ghost.dataset.kind = g.kind;
    ghost.innerHTML = g.kind === 'file' ? `<div class="file"><i></i>${fileName()}</div>` : `<img src="assets/table.${V.lang}.png" alt="">`;
  }
  const ga = seg(t, g.t0, g.t0 + 0.15) * (1 - seg(t, g.t1, g.t1 + 0.12));
  ghost.style.opacity = ga * 0.96;
  place(ghost, pos.x + 14, pos.y + 16, `scale(${lerp(0.9, 1, ga).toFixed(3)})`);
}

function render(t) {
  renderHook(t);
  renderCaptions(t);
  renderKeys(t);
  renderDays(t);
  renderDesk(t);
  renderGlow(t);
  renderEnd(t);
  renderPointer(t);
}

// ---------- 对外：准备、出一帧 ----------

async function init(variant) {
  V = VARIANTS[variant];
  L = layoutFor(V.portrait);
  TX = TEXT[V.lang];
  const stage = $('stage');
  stage.style.width = px(L.W);
  stage.style.height = px(L.H);
  document.documentElement.lang = V.lang === 'zh' ? 'zh-CN' : 'en';

  // 开头
  const h = L.hook;
  for (const text of TX.questions) {
    const q = $('questions').appendChild(document.createElement('div'));
    q.className = 'q';
    q.innerHTML = text;
    Object.assign(q.style, { width: px(h.question.w), fontSize: px(h.question.size), opacity: 0 });
  }
  Object.assign($('title').style, { width: px(h.question.w), fontSize: px(h.question.size * 1.5) });
  $('title').querySelector('small').textContent = TX.pre;
  $('title').querySelector('b').textContent = TX.title;
  $('title').querySelector('span').textContent = TX.titleSub;
  $('s-shot').querySelector('small').textContent = TX.scraps[0];
  $('s-shot').querySelector('img').src = `assets/table.${V.lang}.png`;
  $('s-note').querySelector('small').textContent = TX.scraps[1];
  $('s-note').querySelector('code').textContent = TX.code;
  $('s-tabs').querySelector('small').textContent = TX.scraps[2];

  // 字幕
  for (const lines of TX.cues) {
    const el = $('captions').appendChild(document.createElement('div'));
    el.className = 'cap';
    el.innerHTML = `<span>${lines[0]}</span><span>${lines[1]}</span>`;
    Object.assign(el.style, { width: px(L.caption.w), fontSize: px(L.caption.size), textAlign: L.caption.align, opacity: 0 });
  }
  $('keys').style.fontSize = px(L.keys.size);
  $('days').style.fontSize = px(L.keys.size + 2);

  // 屏幕、看板、别的窗口
  const d = L.desk;
  Object.assign($('desk').style, { width: px(d.w), height: px(d.h) });
  Object.assign($('boardwin').style, { width: px(d.w), height: px(d.h), zIndex: 2 });
  Object.assign($('other').style, { width: px(L.other.w), height: px(L.other.h) });
  $('other').querySelector('.note').innerHTML = TX.note(TX.code);
  $('other').querySelector('.said').textContent = TX.memo[0];
  $('other').querySelector('.said2').textContent = TX.memo[1];
  $('other').querySelector('.slot img').src = `assets/table.${V.lang}.png`;
  $('peek').style.zIndex = 4;
  if (L.slot) $('other').style.setProperty('--slot', px(L.slot));

  // 结尾
  const e = L.end;
  $('end').style.width = px(L.W);
  $('end-icon').src = pathToFileURL(path.join(ROOT, 'assets', 'icon.png')).href;
  Object.assign($('end-icon').style, { width: px(e.icon), height: px(e.icon) });
  $('end-name').textContent = TX.endName;
  Object.assign($('end-name').style, { fontSize: px(e.name), marginTop: px(e.icon * 0.26) });
  $('end-sub').textContent = TX.endSub;
  Object.assign($('end-sub').style, { fontSize: px(e.sub), marginTop: px(e.name * 0.36) });
  $('end-tags').textContent = TX.endTags;
  Object.assign($('end-tags').style, { fontSize: px(e.tags), marginTop: px(e.name * 0.9) });
  $('end-where').textContent = TX.endWhere;
  Object.assign($('end-where').style, { fontSize: px(e.where), marginTop: px(e.name * 0.5), padding: `${px(e.where * 0.62)} ${px(e.where * 1.3)}` });

  await loadApp();
  script();
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  render(0);
  return { width: L.W, height: L.H, frames: DURATION * FPS, fps: FPS };
}

async function frame(i) {
  const t = i / FPS;
  while (fired < events.length && events[fired].at <= t + 1e-9) await events[fired++].run();

  // 快进：只把"现在是哪天"往后拨，看板重新排一次，东西就按新的日期变淡、归档
  const warp = inOut(seg(t, ...T.warp)) * T.warpDays * DAY;
  if (warp !== clock.warp) {
    clock.warp = warp;
    if (i % 2 === 0 || t >= T.warp[1]) app.win.dispatchEvent(new app.win.Event('focus'));
  }

  clock.advance(t * 1000);
  await sleep(0);
  syncAnimations(app.doc, t * 1000);
  render(t);
  await raf();
  await raf();
  return true;
}

window.stage = { init, frame };
