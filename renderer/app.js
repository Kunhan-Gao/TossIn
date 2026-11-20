(async function () {
  const yw = window.yw;
  const HOUR = 3600e3;
  const DAY = 24 * HOUR;
  const SINK = 0.06;          // 低于这个温度就沉底
  const KEEP = 30 * DAY;      // 沉底后保留多久
  const $ = (id) => document.getElementById(id);
  const board = $('board'), stage = $('stage'), emptyEl = $('empty'), sed = $('sed');
  const find = $('find'), q = $('q'), menu = $('menu'), view = $('view'), bTop = $('b-top');
  const bandEl = $('band'), undoEl = $('undo');
  const guide = $('guide'), bLook = $('b-look'), pet = $('pet');

  const init = await yw.init();
  let items = init.items;
  let zoom = init.zoom;
  const imageBase = init.imageBase;

  // ---------- 语言 ----------
  let lang = init.lang;
  const T = (key, vars) => {
    let text = (window.I18N[lang] || window.I18N.zh)[key];
    if (text === undefined) text = window.I18N.zh[key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (_m, k) => vars[k]) : text;
  };

  let mode = 'live';          // live：看板；arch：沉底的东西
  let draft = null;           // 正在输入的新条目
  let editing = null;         // 正在编辑的条目
  let relayTimer = null;
  let selfDrag = false;
  let busyOnDown = false;     // 鼠标按下时是否正在输入、开着菜单或有选中
  const els = new Map();
  const selected = new Set(); // 选中的条目
  const risen = new Set();    // 刚从归档里捞回、还没在看板上露过面的条目
  const mouse = { x: -1, y: -1 };
  let band = null;            // 正在拖的选框
  let suppressClick = false;
  let undoCount = 0;
  let undoTimer = null;
  let recording = null;       // 正在录制的快捷键

  // ---------- 温度 ----------

  const halflife = (it) => Math.min(168, 48 + 12 * (it.uses || 0)) * HOUR;
  const temp = (it, now) => (it.pin ? 1 : Math.pow(0.5, Math.max(0, now - it.touched) / halflife(it)));
  const isSunk = (it, now) => !!it.sunk || (!it.pin && temp(it, now) < SINK);
  const sunkTime = (it) => (it.sunk ? it.sunkAt || it.touched : it.touched + halflife(it) * Math.log2(1 / SINK));

  // 归档超过保留期的，彻底清除。启动时做一次，之后定时做（程序可能一连开很多天不重启）
  function purge() {
    const now = Date.now();
    for (const it of items.slice()) {
      if (isSunk(it, now) && now - sunkTime(it) > KEEP) {
        items.splice(items.indexOf(it), 1);
        yw.remove(it.id);
      }
    }
  }
  purge();

  // ---------- 条目的样子 ----------

  const isMono = (s) => !/[\u3400-\u9fff]/.test(s) && /[{}[\]=\\$<>|;`_]|\w[./]\w|^\S+ -/.test(s);
  const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; } };
  const prettyUrl = (url) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  const splitPath = (p) => { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return [p.slice(i + 1) || p, p.slice(0, Math.max(i, 0))]; };
  const haystack = (it) => [it.text, it.title, it.url, it.path].filter(Boolean).join(' ').toLowerCase();

  function ago(ms) {
    if (ms < 90e3) return T('now');
    if (ms < HOUR) return T('min', { n: Math.round(ms / 60e3) });
    if (ms < DAY) return T('hour', { n: Math.round(ms / HOUR) });
    return T('day', { n: Math.round(ms / DAY) });
  }
  function metaText(it, now) {
    // 归档里显示还能留几天（过期的会在下次启动时清掉）
    if (mode === 'arch') return T('left', { n: Math.max(1, Math.ceil((KEEP - (now - sunkTime(it))) / DAY)) });
    const parts = [ago(now - it.touched)];
    if (it.uses > 0) parts.push(T('used', { n: it.uses }));
    return parts.join(' · ');
  }

  function build(it) {
    const el = document.createElement('div');
    el.className = `it ${it.type}`;
    el.dataset.id = it.id;
    el.draggable = true;
    el.appendChild(document.createElement('span')).className = 'mark';
    if (it.type === 'image') {
      const img = el.appendChild(document.createElement('img'));
      img.draggable = false;
      img.alt = '';
      const size = () => { img.style.aspectRatio = `${it.w} / ${it.h}`; };
      if (it.w && it.h) size();
      else img.addEventListener('load', () => {
        it.w = img.naturalWidth; it.h = img.naturalHeight;
        yw.update(it.id, { w: it.w, h: it.h });
        size(); layout();
      }, { once: true });
      img.src = imageBase + it.file;
    } else {
      el.appendChild(document.createElement('div')).className = 'body';
      if (it.type !== 'text') el.appendChild(document.createElement('div')).className = 'sub';
    }
    el.appendChild(document.createElement('div')).className = 'meta';
    fill(it, el);
    return el;
  }
  function fill(it, el) {
    const body = el.querySelector('.body');
    const sub = el.querySelector('.sub');
    if (it.type === 'text') {
      // 整篇文章那么长的文字，看板上只放开头一段（复制和编辑时仍是全文）
      if (!editing || editing.it !== it) body.textContent = it.text.length > SHOWN ? it.text.slice(0, SHOWN) : it.text;
      el.classList.toggle('mono', isMono(it.text));
    } else if (it.type === 'link') {
      body.textContent = it.title || prettyUrl(it.url);
      sub.textContent = hostOf(it.url);
    } else if (it.type === 'file') {
      const [name, dir] = splitPath(it.path);
      body.textContent = name;
      sub.textContent = dir;
    }
    el.classList.toggle('pin', !!it.pin);
  }

  // ---------- 排布：按温度从上到下，越热越靠上、越大 ----------

  function shown(now) {
    if (mode === 'arch') {
      const k = q.value.trim().toLowerCase();
      return items.filter((it) => isSunk(it, now) && (!k || haystack(it).includes(k)))
        .sort((a, b) => sunkTime(b) - sunkTime(a));
    }
    return items.filter((it) => !isSunk(it, now))
      .sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || temp(b, now) - temp(a, now) || b.touched - a.touched);
  }

  // 单独缩放：每一条可以有自己的倍数（scale），叠加在新鲜度决定的大小上。
  // 倍数是相对值，不是像素，所以换一块屏幕、换一个窗口大小都还成立。
  const SCALE_MIN = 0.5, SCALE_MAX = 3;
  const SHOWN = 12000; // 一条文字在看板上最多放这么多字
  const TALL = 2.3; // 高是宽的这么多倍以上，算长图（长截图）；普通的手机截图不算
  const isTall = (it) => !!it.w && it.h / it.w > TALL;
  const scaleOf = (it) => (mode === 'live' && it.scale) || 1;

  // 一条占几栏、图片多宽。所有东西都对齐到栏上，放大的东西多占几栏，版面不会乱。
  // 热的东西只有在一栏放不下时才占两栏，短的照常一栏，这样各栏高度更均匀。
  const ruler = document.createElement('canvas').getContext('2d');
  function textWidth(it, t, s, grid) {
    const mono = it.type === 'text' && isMono(it.text);
    const text = it.type === 'text' ? it.text : it.type === 'link' ? it.title || prettyUrl(it.url) : splitPath(it.path)[0];
    ruler.font = `${(mono ? 0.84 + t * 0.5 : 0.9 + t * 0.62) * s * grid.fs}px ${mono ? grid.mono : grid.sans}`;
    // 只量前面的几十行、每行开头的一段：再往后反正显示不出来，再长也肯定超过栏宽了
    let widest = 0;
    for (const line of text.slice(0, SHOWN).split('\n', 60)) widest = Math.max(widest, ruler.measureText(line.slice(0, 400)).width);
    return widest + 1;
  }
  function measure(it, t, grid) {
    const { cols, colW, gapX } = grid;
    const spanW = (n) => colW * n + gapX * (n - 1);
    const fit = (w) => Math.max(1, Math.min(cols, Math.ceil((w + gapX - 0.5) / (colW + gapX))));
    if (it === draft) return { span: 1 };
    const s = scaleOf(it);
    const hot = cols >= 3 && t >= 0.6 && mode === 'live';
    if (it.type === 'image') {
      const base = spanW(hot && it.w > colW ? 2 : 1);
      const ratio = it.w && it.h ? it.h / it.w : 0;
      const tall = ratio > TALL;
      // 不放大时不超过图片本身的大小；放大时最多铺满整行，也不超过窗口允许的高度
      let w = Math.min(Math.min(it.w || base, (0.5 + t * 0.5) * base) * s, spanW(cols));
      if (ratio && !tall) w = Math.min(w, grid.maxH / ratio);
      // 只比整栏宽出一点点时收回到整栏，不为一条窄边多占一栏
      const n = fit(w);
      if (n > 1 && w - spanW(n - 1) < colW * 0.25) w = spanW(n - 1);
      // 长图不整体缩小：宽度照常，只露出顶部一段
      return { span: fit(w), imgW: w, imgH: tall ? Math.min(grid.maxH, w * 1.6) : 0 };
    }
    const most = hot ? 2 : 1;
    const cap = s > 1 ? Math.round(most * s + 0.25) : most; // 放大的文字可以多占几栏，免得被挤成很多行
    return { span: Math.min(fit(textWidth(it, t, s, grid)), cap) };
  }

  function layout() {
    const now = Date.now();
    const list = shown(now);
    const keep = new Set(list.map((it) => it.id));
    // 从看板上离开的条目：归档的朝左下角的入口沉下去，捞回的往上浮走；删除和搜索筛掉的直接消失
    const leaving = [];
    for (const [id, el] of els) {
      if (keep.has(id)) continue;
      els.delete(id);
      const it = items.find((x) => x.id === id);
      const why = !it ? '' : mode === 'live' && isSunk(it, now) ? 'sink' : mode === 'arch' && !isSunk(it, now) ? 'rise' : '';
      if (why) leaving.push({ el, why }); else el.remove();
    }
    for (const id of selected) if (!keep.has(id)) selected.delete(id);

    const boardStyle = getComputedStyle(board);
    const fs = parseFloat(boardStyle.fontSize);
    const W = stage.clientWidth;
    const gapX = 2.8 * fs, gapY = 2.3 * fs;
    const cols = Math.max(1, Math.round((W + gapX) / (18.5 * fs + gapX)));
    const colW = (W - gapX * (cols - 1)) / cols;
    const grid = { cols, colW, gapX, fs, maxH: innerHeight * 0.72, sans: boardStyle.fontFamily, mono: boardStyle.getPropertyValue('--mono') };

    const boxes = (draft ? [draft, ...list] : list).map((it) => {
      let el = it === draft ? draft.el : els.get(it.id);
      let fresh = false;
      if (!el) {
        el = build(it);
        el.classList.add('enter', 'still');
        els.set(it.id, el);
        stage.appendChild(el);
        fresh = true;
      }
      const t = it === draft ? 1 : mode === 'arch' ? 0.4 : temp(it, now);
      const s = it === draft ? 1 : scaleOf(it);
      const { span, imgW, imgH } = measure(it, t, grid);
      el.style.setProperty('--t', t.toFixed(3));
      el.style.setProperty('--s', s);
      el.style.setProperty('--lines', Math.round((4 + t * 10) * Math.max(1, s)));
      el.style.width = `${colW * span + gapX * (span - 1)}px`;
      if (imgW) {
        el.style.setProperty('--w', `${imgW.toFixed(1)}px`);
        el.classList.toggle('tall', !!imgH);
        el.style.setProperty('--h', imgH ? `${imgH.toFixed(1)}px` : 'auto');
      }
      if (it !== draft && mode === 'arch') el.querySelector('.meta').dataset.hint = T('rescueHint');
      if (it !== draft) el.classList.toggle('sel', selected.has(it.id));
      if (it !== draft && !el.classList.contains('said')) el.querySelector('.meta').textContent = metaText(it, now);
      return { el, span, fresh };
    });

    const heights = new Array(cols).fill(0);
    const holes = []; // 占多栏的条目上方会留下空档，后面一栏宽的条目先补进去
    const put = (b, col, top) => { b.el.style.transform = `translate(${Math.round(col * (colW + gapX))}px, ${Math.round(top)}px)`; };
    for (const b of boxes) {
      const h = b.el.offsetHeight;
      const hole = b.span === 1 && holes.find((g) => g.bottom - g.top >= h);
      if (hole) {
        put(b, hole.col, hole.top);
        hole.top += h + gapY;
        continue;
      }
      let col = 0, top = Infinity;
      for (let c = 0; c + b.span <= cols; c++) {
        const y = Math.max(...heights.slice(c, c + b.span));
        if (y < top - 0.5) { top = y; col = c; }
      }
      put(b, col, top);
      for (let c = col; c < col + b.span; c++) {
        if (top - gapY - heights[c] > fs) holes.push({ col: c, top: heights[c], bottom: top - gapY });
        heights[c] = top + h + gapY;
      }
    }
    stage.style.height = `${Math.max(0, ...heights)}px`;

    const sunk = items.reduce((n, it) => n + (isSunk(it, now) ? 1 : 0), 0);
    emptyEl.hidden = mode === 'arch' || !!draft || list.length > 0;
    sed.hidden = mode === 'live' && sunk === 0;
    sed.textContent = mode === 'arch' ? T('back') : T('sunk', { n: sunk });

    // 左下角"归档"入口的位置（换算到看板的坐标里）：归档的东西沉到这里，捞回的从这里浮上来
    const origin = stage.getBoundingClientRect();
    const door = sed.hidden ? { left: 2.5 * fs, top: innerHeight - 1.9 * fs } : sed.getBoundingClientRect();
    const atDoor = `translate(${Math.round(door.left - origin.left)}px, ${Math.round(door.top - origin.top)}px) scale(.3)`;

    for (const { el, why } of leaving) {
      el.classList.add('gone');
      el.classList.remove('sel');
      if (why === 'sink') el.style.transform = atDoor;
      else el.style.transform = `${el.style.transform} translateY(${-3 * fs}px)`;
      setTimeout(() => el.remove(), 520);
    }
    if (leaving.some((x) => x.why === 'sink')) {
      sed.classList.add('got');
      clearTimeout(sed.gotTimer);
      sed.gotTimer = setTimeout(() => sed.classList.remove('got'), 700);
    }

    const fresh = boxes.filter((b) => b.fresh);
    if (fresh.length) {
      for (const b of fresh) {
        if (mode !== 'live' || !risen.delete(b.el.dataset.id)) continue;
        b.to = b.el.style.transform; // 刚捞回的：先放在入口那里，下一帧再浮到自己的位置
        b.el.style.transform = atDoor;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const b of fresh) {
          b.el.classList.remove('enter', 'still');
          if (b.to) b.el.style.transform = b.to;
        }
      }));
    }
  }

  const relayoutSoon = (ms) => { clearTimeout(relayTimer); relayTimer = setTimeout(layout, ms); };

  // ---------- 动作 ----------

  const itemOf = (el) => el && items.find((it) => it.id === el.dataset.id);
  const save = (it, patch) => { Object.assign(it, patch); return yw.update(it.id, patch); };

  function adopt(it) {
    if (!it) return;
    const old = items.find((x) => x.id === it.id);
    if (old) Object.assign(old, it); else items.push(it);
    const el = els.get(it.id);
    if (el) fill(old || it, el);
  }
  function arrive(list) {
    list = (list || []).filter(Boolean);
    if (!list.length) return;
    list.forEach(adopt);
    if (mode === 'arch') setMode('live'); else layout();
    board.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function say(el, text) {
    el.querySelector('.meta').textContent = text;
    el.classList.add('said');
    clearTimeout(el.sayTimer);
    el.sayTimer = setTimeout(() => {
      el.classList.remove('said');
      const it = itemOf(el);
      if (it) el.querySelector('.meta').textContent = metaText(it, Date.now());
    }, 900);
  }
  function touch(it) {
    save(it, { touched: Date.now(), uses: (it.uses || 0) + 1 });
    relayoutSoon(520); // 先让"已复制"停一下，再浮到最上面
  }
  async function use(it, el) {
    if (it.type === 'link' || it.type === 'file') {
      // 文件被移走或删掉了：说一声，不算用过
      const ok = await yw.open(it.id);
      say(el, T(ok ? 'opened' : 'missing'));
      if (!ok) return;
    } else {
      yw.copy(it.id);
      say(el, T('copied'));
    }
    touch(it);
  }
  // 一起复制：文字、网址、文件路径各占一行；选的全是图片和文件时，复制的是这些文件本身
  async function copyMany(list) {
    list = list.filter(Boolean);
    if (!list.length) return;
    const done = new Set(await yw.copyMany(list.map((it) => it.id)));
    for (const it of list) {
      const el = els.get(it.id);
      if (!done.has(it.id) || !el) continue;
      say(el, T('copied'));
      if (mode === 'live') touch(it);
    }
  }
  function sinkMany(list) {
    const now = Date.now();
    for (const it of list) save(it, { sunk: true, sunkAt: now, pin: false });
    layout();
  }
  const sink = (it) => sinkMany([it]);
  function rescueMany(list) {
    const now = Date.now();
    for (const it of list) { save(it, { sunk: false, sunkAt: null, touched: now }); delete it.sunkAt; risen.add(it.id); }
    layout();
  }
  const rescue = (it) => rescueMany([it]);

  // 单独缩放：to 是一个函数，给出每一条的新倍数。回到 1 附近就当作恢复原样
  function resize(list, to) {
    for (const it of list) {
      let s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, to(it.scale || 1)));
      if (Math.abs(s - 1) < 0.04) s = 1;
      save(it, { scale: s === 1 ? null : +s.toFixed(3) });
      const el = els.get(it.id);
      if (el) say(el, `${Math.round(s * 100)}%`);
    }
    layout();
  }

  // 删除先进回收区：底部出现撤销入口，几秒后才真正删掉
  function destroyMany(list) {
    const ids = new Set(list.filter(Boolean).map((it) => it.id));
    if (!ids.size) return;
    items = items.filter((it) => !ids.has(it.id));
    for (const id of ids) selected.delete(id);
    yw.trash([...ids]);
    undoCount += ids.size;
    renderUndo();
    clearTimeout(undoTimer);
    undoTimer = setTimeout(forgetUndo, 8000);
    layout();
  }
  const destroy = (it) => destroyMany([it]);
  function renderUndo() {
    undoEl.textContent = T('undo', { n: undoCount });
    undoEl.hidden = undoCount === 0;
  }
  function forgetUndo() {
    clearTimeout(undoTimer);
    undoCount = 0;
    undoEl.hidden = true;
    yw.emptyTrash();
  }
  async function undo() {
    if (!undoCount) return;
    clearTimeout(undoTimer);
    undoCount = 0;
    undoEl.hidden = true;
    (await yw.untrash()).forEach(adopt);
    layout();
  }

  // 选中
  function paintSelection() {
    for (const [id, el] of els) el.classList.toggle('sel', selected.has(id));
  }
  function clearSelection() {
    if (!selected.size) return;
    selected.clear();
    paintSelection();
  }
  const selectedItems = () => items.filter((it) => selected.has(it.id));

  function setMode(next) {
    mode = next;
    document.body.classList.toggle('arch', mode === 'arch');
    find.hidden = mode !== 'arch';
    q.value = '';
    for (const el of els.values()) el.remove();
    els.clear();
    layout();
    board.scrollTop = 0;
    if (mode === 'arch') q.focus();
  }

  // ---------- 输入与编辑 ----------

  const isEditable = (node) => !!node && (node.isContentEditable || node.tagName === 'INPUT');
  function caretToEnd(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const readText = (node) => node.innerText.replace(/\u00a0/g, ' ').replace(/\n+$/, '').trim();

  function startDraft() {
    if (draft || editing || mode !== 'live') return;
    const el = document.createElement('div');
    el.className = 'it text draft';
    const body = el.appendChild(document.createElement('div'));
    body.className = 'body';
    body.contentEditable = 'plaintext-only';
    stage.appendChild(el);
    draft = { el, body, done: false };
    const finish = async (keep) => {
      if (draft.done) return;
      draft.done = true;
      const text = keep ? readText(body) : '';
      el.remove();
      draft = null;
      if (text) adopt(await yw.addText(text));
      layout();
    };
    body.addEventListener('input', layout);
    body.addEventListener('blur', () => finish(true));
    body.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    });
    draft.cancel = () => finish(false);
    layout();
    board.scrollTop = 0;
    body.focus();
  }

  function startEdit(it, el) {
    if (editing || it.type !== 'text') return;
    clearTimeout(relayTimer);
    const body = el.querySelector('.body');
    editing = { it, el };
    el.classList.add('editing');
    el.draggable = false;
    body.contentEditable = 'plaintext-only';
    if (it.text.length > SHOWN) body.textContent = it.text; // 编辑的是全文
    let cancelled = false;
    const onKey = (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.stopPropagation(); cancelled = true; body.blur(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); body.blur(); }
    };
    const onBlur = () => {
      body.removeEventListener('keydown', onKey);
      body.removeEventListener('input', layout);
      body.contentEditable = 'false';
      el.classList.remove('editing');
      el.draggable = true;
      editing = null;
      const text = cancelled ? it.text : readText(body);
      if (!text) { destroy(it); return; }
      if (text !== it.text) save(it, { text, touched: Date.now() });
      fill(it, el);
      layout();
    };
    body.addEventListener('keydown', onKey);
    body.addEventListener('input', layout);
    body.addEventListener('blur', onBlur, { once: true });
    layout();
    body.focus();
    caretToEnd(body);
  }

  // ---------- 鼠标 ----------

  document.addEventListener('mousedown', (e) => {
    busyOnDown = !!draft || !!editing || !menu.hidden || !guide.hidden || selected.size > 0;
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
    if (recording && !recording.button.contains(e.target)) stopRecording();
    if (!guide.hidden && !guide.contains(e.target) && !bLook.contains(e.target) && !pet.contains(e.target)) showGuide(false);
  }, true);

  // 在空白处按住拖动：框选
  board.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || (e.target !== board && e.target !== stage)) return;
    if (draft || editing || e.clientX >= board.getBoundingClientRect().left + board.clientWidth) return; // 滚动条
    band = { x: e.clientX, y: e.clientY, base: e.ctrlKey ? new Set(selected) : new Set(), active: false };
  });
  function moveBand(e) {
    if (!band.active) {
      if (Math.hypot(e.clientX - band.x, e.clientY - band.y) < 6) return;
      band.active = true;
      bandEl.hidden = false;
    }
    const left = Math.min(band.x, e.clientX), top = Math.min(band.y, e.clientY);
    const right = Math.max(band.x, e.clientX), bottom = Math.max(band.y, e.clientY);
    Object.assign(bandEl.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    selected.clear();
    for (const id of band.base) selected.add(id);
    for (const [id, el] of els) {
      const hit = [...el.querySelectorAll('.body, .sub, img')].some((node) => {
        const r = node.getBoundingClientRect();
        return r.left < right && r.right > left && r.top < bottom && r.bottom > top;
      });
      if (hit) selected.add(id);
    }
    paintSelection();
  }
  window.addEventListener('mouseup', () => {
    if (!band) return;
    if (band.active) {
      bandEl.hidden = true;
      suppressClick = true; // 松手时的那次点击不算"点空白处"
      setTimeout(() => { suppressClick = false; }, 0);
    }
    band = null;
  });

  board.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const el = e.target.closest('.it');
    if (!el) {
      if (selected.size) { clearSelection(); return; }
      // 点空白处：开始打字
      if (!busyOnDown && (e.target === board || e.target === stage)) startDraft();
      return;
    }
    const it = itemOf(el);
    if (!it || el.classList.contains('editing') || e.detail > 1) return;
    if (e.ctrlKey) { // Ctrl+点击：加选或取消
      if (!selected.delete(it.id)) selected.add(it.id);
      paintSelection();
      return;
    }
    clearSelection();
    if (mode === 'arch') rescue(it); else use(it, el);
  });

  board.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.it');
    const it = itemOf(el);
    if (!it || mode !== 'live') return;
    if (it.type === 'text') startEdit(it, el);
    else if (it.type === 'image') openView(it);
  });

  // 右键菜单
  function closeMenu() { menu.hidden = true; menu.replaceChildren(); }
  function openMenu(it, x, y, group) {
    const add = (label, fn, cls) => {
      const b = menu.appendChild(document.createElement('button'));
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', () => { closeMenu(); fn(); });
    };
    menu.replaceChildren();
    if (group) {
      // 多选时：只给整批操作
      if (mode === 'arch') add(T('m.rescueN', { n: group.length }), () => rescueMany(group));
      else add(T('m.sinkN', { n: group.length }), () => sinkMany(group));
      menu.appendChild(document.createElement('hr'));
      add(T('m.deleteN', { n: group.length }), () => destroyMany(group), 'danger');
    } else {
      if (mode === 'arch') {
        add(T('m.rescue'), () => rescue(it));
      } else {
        if (it.type === 'text') add(T('m.edit'), () => startEdit(it, els.get(it.id)));
        if (it.type === 'link') add(T('m.copyLink'), () => { yw.copy(it.id); say(els.get(it.id), T('copied')); });
        if (it.type === 'image') add(T('m.enlarge'), () => openView(it));
        add(it.pin ? T('m.unpin') : T('m.pin'), () => { save(it, { pin: !it.pin, touched: Date.now() }); fill(it, els.get(it.id)); layout(); });
        add(T('m.sink'), () => sink(it));
        if (it.scale) add(T('m.resetSize'), () => resize([it], () => 1));
      }
      menu.appendChild(document.createElement('hr'));
      add(T('m.delete'), () => destroy(it), 'danger');
    }
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  }
  board.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.it');
    const it = itemOf(el);
    if (!it || el.classList.contains('editing')) return;
    e.preventDefault();
    if (selected.size > 1 && selected.has(it.id)) {
      openMenu(null, e.clientX, e.clientY, selectedItems());
    } else {
      clearSelection();
      openMenu(it, e.clientX, e.clientY);
    }
  });
  board.addEventListener('scroll', () => { if (!menu.hidden) closeMenu(); });
  window.addEventListener('blur', () => { if (!menu.hidden) closeMenu(); });

  // 看大图。长图不缩小，按宽度铺开，上下滚动着看
  function openView(it) {
    view.firstElementChild.src = imageBase + it.file;
    view.classList.toggle('tall', isTall(it));
    view.hidden = false;
    view.scrollTop = 0;
  }
  view.addEventListener('click', () => { view.hidden = true; });

  // ---------- 放进来：粘贴、拖入 ----------

  document.addEventListener('paste', async (e) => {
    if (isEditable(e.target)) {
      // 空白输入行里粘贴，等同于直接放上来（这样图片也能收）
      if (draft && e.target === draft.body && !readText(draft.body)) draft.cancel();
      else return;
    }
    e.preventDefault();
    arrive(await yw.capture());
  });

  board.addEventListener('dragstart', (e) => {
    const el = e.target.closest ? e.target.closest('.it') : null;
    const it = itemOf(el);
    if (!it || el.classList.contains('editing')) return;
    if (it.type === 'image' || it.type === 'file') {
      e.preventDefault();
      yw.drag(it.id); // 交给系统拖出真正的文件
      touch(it);
      return;
    }
    selfDrag = true;
    const text = it.type === 'link' ? it.url : it.text;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', text);
    if (it.type === 'link') e.dataTransfer.setData('text/uri-list', it.url);
    el.addEventListener('dragend', () => { selfDrag = false; touch(it); }, { once: true });
  });

  window.addEventListener('dragover', (e) => {
    if (selfDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('over');
  });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('over'); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('over');
    if (selfDrag) return;
    const dt = e.dataTransfer;
    const paths = [...dt.files].map((f) => { try { return yw.pathFor(f); } catch { return ''; } }).filter(Boolean);
    if (paths.length) { arrive(await yw.addPaths(paths)); return; }
    const html = dt.getData('text/html');
    const uri = (dt.getData('text/uri-list').split(/\r?\n/).find((l) => l && !l.startsWith('#')) || '').trim();
    const text = dt.getData('text/plain');
    const src = ((/<img[^>]+src=["']([^"']+)/i.exec(html) || [])[1] || '').replace(/&amp;/g, '&');
    // 从浏览器拖来的图片：把图本身存下来
    if (/^https?:/i.test(src) && (!uri || uri === src || !/<a[\s>]/i.test(html))) {
      const it = await yw.addImageUrl(src);
      if (it) { arrive([it]); return; }
    }
    arrive([await yw.addText(uri || text)]);
  });

  // ---------- 键盘、缩放、窗口 ----------

  function setZoom(z) {
    zoom = Math.max(0.6, Math.min(2.2, z));
    document.documentElement.style.setProperty('--z', zoom.toFixed(3));
    yw.setZoom(zoom);
    layout();
  }
  // Alt+滚轮：只缩放指针下面的那一条；指针在多选的其中一条上时，选中的一起缩放。
  // 缩放时版面会重排，条目可能从指针下面移开，所以滚动期间一直认准最初的那一条。
  let sizing = null;
  window.addEventListener('wheel', (e) => {
    if (e.altKey && !e.ctrlKey) {
      e.preventDefault();
      if (mode !== 'live' || draft || editing) return;
      let list = sizing && sizing.list;
      if (!list) {
        const it = itemOf(e.target.closest && e.target.closest('.it'));
        if (!it) return;
        list = selected.size > 1 && selected.has(it.id) ? selectedItems() : [it];
      }
      clearTimeout(sizing && sizing.timer);
      sizing = { list, timer: setTimeout(() => { sizing = null; }, 700) };
      const notches = Math.max(-1, Math.min(1, -(e.deltaY || e.deltaX) / 100));
      resize(list, (s) => s * Math.pow(1.12, notches));
      return;
    }
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06));
  }, { passive: false });
  // 单按 Alt 在 Windows 上会激活窗口菜单，接下来的按键会被它吃掉；这里不需要
  for (const type of ['keydown', 'keyup']) {
    document.addEventListener(type, (e) => { if (e.key === 'Alt') e.preventDefault(); });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!view.hidden) view.hidden = true;
      else if (!menu.hidden) closeMenu();
      else if (!guide.hidden) showGuide(false);
      else if (selected.size) clearSelection();
      else if (mode === 'arch') setMode('live');
      return;
    }
    const typing = isEditable(e.target);
    if (e.key === 'Delete' && !typing) {
      // 有选中删选中的；没有就删指针下面的那一条
      e.preventDefault();
      if (selected.size) { destroyMany(selectedItems()); return; }
      const under = mouse.x >= 0 ? document.elementFromPoint(mouse.x, mouse.y) : null;
      const el = under && under.closest('.it');
      if (el && !el.classList.contains('draft')) destroyMany([itemOf(el)]);
      return;
    }
    if (e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); setMode(mode === 'arch' ? 'live' : 'arch'); }
      else if (k === '0') setZoom(1);
      else if (k === '=' || k === '+') setZoom(zoom * 1.06);
      else if (k === '-') setZoom(zoom / 1.06);
      else if (k === 'z' && !typing) { e.preventDefault(); undo(); }
      else if (k === 'a' && !typing) { e.preventDefault(); for (const id of els.keys()) selected.add(id); paintSelection(); }
      else if (k === 'c' && !typing) {
        // 有选中复制选中的；没有就复制指针下面的那一条
        e.preventDefault();
        const under = mouse.x >= 0 ? document.elementFromPoint(mouse.x, mouse.y) : null;
        const el = under && under.closest('.it');
        copyMany(selected.size ? selectedItems() : el && !el.classList.contains('draft') ? [itemOf(el)] : []);
      }
      return;
    }
    if (e.key === 'Enter' && !typing && view.hidden && menu.hidden) { e.preventDefault(); startDraft(); }
  });

  undoEl.addEventListener('click', undo);

  // 外观与说明
  function setLook(name, persist) {
    document.documentElement.dataset.theme = name;
    for (const b of guide.querySelectorAll('[data-look]')) b.setAttribute('aria-pressed', String(b.dataset.look === name));
    if (persist) yw.setTheme(name);
    layout(); // 字体可能变了，重新排一次
  }
  function showGuide(open) {
    if (!open) stopRecording();
    guide.hidden = !open;
    bLook.classList.toggle('on', open);
    pet.classList.toggle('open', open); // 空看板上的鹈鹕：面板开着时张着嘴
  }
  $('open-data').addEventListener('click', () => yw.openData());
  $('author').addEventListener('click', () => yw.openAuthor());
  $('ver').textContent = init.version;

  // 语言：把页面上带标记的文字换成当前语言
  function applyLang() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = T('name');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = T(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-title]')) { el.title = T(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); }
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = T(el.dataset.i18nPlaceholder);
    for (const b of guide.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    renderHotkeys();
    renderUpdate();
    renderUndo();
  }
  guide.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b || b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    yw.setLang(lang);
    applyLang();
    layout();
  });

  // 快捷键：点一下进入录制，按下新的组合就换；Esc 或点别处取消
  let hotkeys = init.hotkeys;
  const prettyKey = (accel) => accel.split('+')
    .map((part) => ({ Control: 'Ctrl', Super: 'Win', Space: T('key.space') }[part] || part)).join('+');
  function accelFrom(e) {
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const c = e.code;
    let key = null;
    if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
    else if (/^Digit\d$/.test(c)) key = c.slice(5);
    else if (/^F([1-9]|1[0-2])$/.test(c)) key = c;
    else if (/^Arrow(Up|Down|Left|Right)$/.test(c)) key = c.slice(5);
    else if (['Space', 'Home', 'End', 'PageUp', 'PageDown', 'Insert'].includes(c)) key = c;
    // 至少要带 Ctrl、Alt 或 Win 中的一个，免得把普通打字的键占掉
    if (!key || !(e.ctrlKey || e.altKey || e.metaKey)) return null;
    return [...mods, key].join('+');
  }
  function renderHotkeys() {
    for (const b of guide.querySelectorAll('.hk')) {
      const info = hotkeys[b.dataset.hk];
      if (recording && recording.button === b) continue;
      b.textContent = prettyKey(info.accel);
      b.classList.toggle('bad', !info.ok);
      b.title = info.ok ? T('hk.change') : T('hk.bad');
    }
  }
  function stopRecording(message) {
    if (!recording) return;
    const { button } = recording;
    window.removeEventListener('keydown', recording.onKey, true);
    recording = null;
    yw.hotkeyRecording(false);
    button.classList.remove('rec');
    if (message) {
      // 换失败了：先说一声，再变回原来的
      button.textContent = message;
      button.classList.add('bad');
      setTimeout(renderHotkeys, 1400);
    } else {
      renderHotkeys();
    }
  }
  function startRecording(button) {
    if (recording) stopRecording();
    const which = button.dataset.hk;
    const onKey = async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { stopRecording(); return; }
      const accel = accelFrom(e);
      if (!accel) return; // 只按了修饰键，或者是不能用的键：继续等
      const result = await yw.setHotkey(which, accel);
      hotkeys = result.hotkeys;
      stopRecording(result.ok ? '' : T('hk.taken'));
    };
    recording = { button, onKey };
    button.classList.add('rec');
    button.classList.remove('bad');
    button.textContent = T('hk.press');
    yw.hotkeyRecording(true);
    window.addEventListener('keydown', onKey, true);
  }
  guide.addEventListener('click', (e) => {
    const b = e.target.closest('.hk');
    if (b) startRecording(b);
  });

  // 新版本提示
  let update = init.update;
  const updateEl = $('update');
  function renderUpdate() {
    updateEl.hidden = !update;
    if (update) updateEl.textContent = T('update', { v: update.version });
    bLook.classList.toggle('new', !!update);
  }
  updateEl.addEventListener('click', () => yw.openUpdate());
  yw.on('update', (info) => { update = info; renderUpdate(); });
  bLook.addEventListener('click', () => showGuide(guide.hidden));
  pet.addEventListener('click', () => showGuide(guide.hidden)); // 空看板上的鹈鹕
  guide.addEventListener('click', (e) => {
    const b = e.target.closest('[data-look]');
    if (b) setLook(b.dataset.look, true);
  });

  q.addEventListener('input', layout);
  sed.addEventListener('click', () => setMode(mode === 'arch' ? 'live' : 'arch'));

  const showLevel = (level) => bTop.classList.toggle('on', level === 'top');
  bTop.addEventListener('click', async () => showLevel(await yw.win('top')));
  $('b-min').addEventListener('click', () => yw.win('min'));
  // 收到屏幕边上。按钮上的箭头朝着看板靠的那一边
  const bEdge = $('b-edge');
  bEdge.addEventListener('click', () => yw.win('tuck'));
  const aimEdge = () => bEdge.classList.toggle('left', screenX + outerWidth / 2 < (screen.availLeft || 0) + screen.availWidth / 2);
  $('ctl').addEventListener('mouseenter', aimEdge);
  aimEdge();
  $('b-close').addEventListener('click', () => yw.win('hide'));
  document.addEventListener('mousemove', (e) => {
    // 指针真的挪开了：下一次 Alt+滚轮重新认指针下面的那一条
    if (sizing && Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y) > 4) { clearTimeout(sizing.timer); sizing = null; }
    mouse.x = e.clientX; mouse.y = e.clientY;
    document.body.classList.toggle('near', e.clientY < 72);
    if (band) moveBand(e);
  });
  document.addEventListener('mouseleave', () => { mouse.x = mouse.y = -1; document.body.classList.remove('near'); });

  // 贴边隐藏时主进程会来问：现在能不能把看板收起来。正在输入、开着菜单或面板、拖着东西时不能
  window.ywBusy = () => !!draft || !!editing || !!band || selfDrag || !!recording || !menu.hidden || !guide.hidden || !view.hidden;

  yw.on('added', arrive);
  yw.on('changed', (it) => { adopt(it); layout(); });
  yw.on('level', showLevel);

  // 东西会自己变凉：定时重排
  setInterval(() => { purge(); layout(); }, 5 * 60e3);
  window.addEventListener('focus', layout);
  new ResizeObserver(layout).observe(board);

  document.documentElement.style.setProperty('--z', zoom.toFixed(3));
  showLevel(init.level);
  applyLang();
  setLook(init.theme, false);
  if (init.firstRun) showGuide(true);
})();
