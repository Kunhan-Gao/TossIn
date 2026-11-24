// 仅测试用：在界面里跑的检查脚本，配合 --shot 和 --do=<名字> 使用。
const sleep = 'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));';
const helpers = `
  ${sleep}
  const $$ = (s) => [...document.querySelectorAll(s)];
  const byText = (t) => $$('.it:not(.gone)').find((el) => (el.querySelector('.body') || {}).textContent?.includes(t));
  const yOf = (el) => Math.round(new DOMMatrix(getComputedStyle(el).transform).m42);
  const tOf = (el) => +el.style.getPropertyValue('--t');
  const click = (node, detail = 1) => {
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
  };
`;

module.exports = {
  // 压力（配合 --stress=1）：四百多条、一条三百万字的文字、一条十五万行的文字。看排一次版要多久，有没有出错
  stress: `(async () => { ${helpers}
    const out = { items: $$('.it').length };
    const time = (fn) => { const t0 = performance.now(); fn(); document.getElementById('stage').offsetHeight; return Math.round(performance.now() - t0); };
    out.layoutMs = [1, 2, 3].map(() => time(() => window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }))));
    const big = $$('.it').find((el) => el.querySelector('.body')?.textContent.startsWith('xxxx'));
    const lines = byText('line 0');
    out.bigShown = big && big.querySelector('.body').textContent.length;
    out.linesShown = lines && lines.querySelector('.body').textContent.length;
    const saved = (await window.yw.init()).items;
    out.bigKept = saved.find((it) => (it.text || '').startsWith('xxxx')).text.length;
    out.expiredPurged = !saved.some((it) => (it.text || '').includes('已经过期'));
    // 双击编辑大文本：编辑框里是全文，取消后不变
    big.querySelector('.body').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    out.editingFull = big.querySelector('.body').textContent.length;
    big.querySelector('.body').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    big.querySelector('.body').dispatchEvent(new FocusEvent('blur'));
    await sleep(600);
    out.afterCancel = { shown: big.querySelector('.body').textContent.length, kept: (await window.yw.init()).items.find((it) => (it.text || '').startsWith('xxxx')).text.length };
    return out;
  })()`,

  // 文件被移走了：点一下说"文件不在了"，不算用过
  missing: `(async () => { ${helpers}
    const file = byText('slides-v3');
    const before = tOf(file);
    click(file.querySelector('.body'));
    await sleep(300);
    const said = file.querySelector('.meta').textContent;
    await sleep(900);
    return { said, usesAfter: (await window.yw.init()).items.find((it) => it.type === 'file').uses, tBefore: before, tAfter: tOf(file) };
  })()`,
  // 右上角的按钮：指针靠近顶部时出现
  ctl: `(async () => { ${helpers}
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 10 }));
    document.getElementById('ctl').dispatchEvent(new MouseEvent('mouseenter'));
    await sleep(400);
    const drag = document.getElementById('drag').getBoundingClientRect();
    const first = document.getElementById('b-look').getBoundingClientRect();
    return {
      buttons: $$('#ctl button').map((b) => b.id + ':' + b.title + ':' + getComputedStyle(b).opacity),
      edgeArrowLeft: document.getElementById('b-edge').classList.contains('left'),
      dragStripStopsBeforeButtons: drag.right <= first.left + 0.5,
    };
  })()`,
  // 长图（配合 --tall=1）：看板上只露出顶部一段，双击后按宽度铺开、可以上下滚动
  tall: `(async () => { ${helpers}
    const out = {};
    const el = $$('.it.image').find((e) => e.classList.contains('tall'));
    const img = el.querySelector('img');
    const r = img.getBoundingClientRect();
    out.cropped = { width: Math.round(r.width), height: Math.round(r.height), shown: +(r.height / r.width).toFixed(2), natural: [img.naturalWidth, img.naturalHeight], fit: getComputedStyle(img).objectFit, faded: getComputedStyle(img).maskImage.includes('gradient') };
    out.otherImagesCropped = $$('.it.image').filter((e) => e !== el && e.classList.contains('tall')).length;
    img.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await sleep(500);
    const view = document.getElementById('view');
    const big = view.querySelector('img').getBoundingClientRect();
    out.view = { open: !view.hidden, tall: view.classList.contains('tall'), width: Math.round(big.width), height: Math.round(big.height), scrollable: view.scrollHeight > view.clientHeight };
    return out;
  })()`,

  // 归档有方向：沉向左下角的入口；归档里显示还剩几天；捞回后回到看板时从入口浮上来
  sink: `(async () => { ${helpers}
    const out = {};
    const sed = document.getElementById('sed');
    const stage = document.getElementById('stage');
    const target = byText('取件码');
    target.querySelector('.body').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    $$('#menu button').find((b) => b.textContent === '归档').click();
    const sr = sed.getBoundingClientRect(), st = stage.getBoundingClientRect();
    out.sinking = { gone: target.classList.contains('gone'), stillShown: target.isConnected, to: target.style.transform, door: [Math.round(sr.left - st.left), Math.round(sr.top - st.top)], doorLit: sed.classList.contains('got'), label: sed.textContent };
    await sleep(900);
    out.afterSink = { removed: !target.isConnected, doorLit: sed.classList.contains('got'), leftovers: $$('.it.gone').length };

    sed.click();
    await sleep(400);
    const arch = byText('取件码');
    const meta = arch.querySelector('.meta');
    out.arch = { meta: meta.textContent, hint: meta.dataset.hint, visible: +getComputedStyle(meta).opacity > 0.5, all: $$('.it .meta').map((m) => m.textContent) };
    const before = arch.style.transform;
    click(arch.querySelector('.body'));
    out.rising = { gone: arch.classList.contains('gone'), from: before, to: arch.style.transform };
    await sleep(700);
    out.afterRise = { removed: !arch.isConnected };

    sed.click();
    const back = byText('取件码');
    out.back = { startsAtDoor: back.style.transform };
    await sleep(900);
    out.settled = { at: back.style.transform, opacity: getComputedStyle(back).opacity, t: tOf(back) };
    return out;
  })()`,

  // 一起复制：多选后 Ctrl+C；没有选中时复制指针下面的那一条
  copy: `(async () => { ${helpers}
    const out = {};
    const key = (k, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
    const pick = (el) => (el.querySelector('.body') || el.querySelector('img')).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, detail: 1 }));
    const said = () => $$('.it.said').map((el) => (el.querySelector('.body')?.textContent || 'image').slice(0, 6) + ':' + el.querySelector('.meta').textContent);

    // 两条文字、一个链接、一张图：复制的是文字，图片跳过
    pick(byText('取件码')); pick(byText('报销单号')); pick(byText('审稿人')); pick($$('.it.image')[0]);
    key('c', { ctrlKey: true });
    await sleep(200);
    out.mixed = { said: said(), stillSelected: $$('.it.sel').length };
    await sleep(1800);
    key('Escape');

    // 只选图片：两张都算复制了
    for (const el of $$('.it.image')) pick(el);
    key('c', { ctrlKey: true });
    await sleep(200);
    out.imagesOnly = said();
    key('Escape');
    await sleep(1800);

    // 没有选中：复制指针下面的那一条
    const r = byText('lr=3e-4').querySelector('.body').getBoundingClientRect();
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
    key('c', { ctrlKey: true });
    await sleep(200);
    out.hover = said();
    return out;
  })()`,
  // 单独缩放：Alt+滚轮放大一张图、一段文字，缩小另一条；右键恢复；排版不重叠、不出界
  scale: `(async () => { ${helpers}
    const out = {};
    const stage = document.getElementById('stage');
    const wheel = (node, dy, n = 1) => { for (let i = 0; i < n; i++) node.dispatchEvent(new WheelEvent('wheel', { altKey: true, deltaY: dy, bubbles: true, cancelable: true })); };
    const box = (el) => {
      const m = /translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/.exec(el.style.transform);
      return { x: +m[1], y: +m[2], w: el.offsetWidth, h: el.offsetHeight };
    };
    const audit = () => {
      const bs = $$('.it').map(box);
      let overlaps = 0, outside = 0;
      for (let i = 0; i < bs.length; i++) {
        if (bs[i].x < -1 || bs[i].x + bs[i].w > stage.clientWidth + 1) outside++;
        for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i], b = bs[j];
          if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) overlaps++;
        }
      }
      const clipped = $$('.it img').filter((img) => img.getBoundingClientRect().right > stage.getBoundingClientRect().right + 1).length;
      const edge = document.getElementById('board').getBoundingClientRect().left + document.getElementById('board').clientWidth;
      const wide = $$('#stage *').filter((n) => n.getBoundingClientRect().right > edge + 1).map((n) => n.className + ':' + Math.round(n.getBoundingClientRect().width));
      return { items: bs.length, overlaps, outside, clipped, wide, columns: new Set(bs.map((b) => b.x)).size, hScroll: document.getElementById('board').scrollWidth > document.getElementById('board').clientWidth };
    };
    const sOf = (el) => el.style.getPropertyValue('--s');
    out.before = audit();

    const img = $$('.it.image')[0];
    const w0 = img.querySelector('img').getBoundingClientRect().width;
    wheel(img.querySelector('img'), -100, 5);
    await sleep(900);
    out.image = { s: sOf(img), from: Math.round(w0), to: Math.round(img.querySelector('img').getBoundingClientRect().width), said: img.querySelector('.meta').textContent };

    const text = byText('取件码') || byText('pickup code');
    const f0 = parseFloat(getComputedStyle(text.querySelector('.body')).fontSize);
    wheel(text.querySelector('.body'), -100, 4);
    await sleep(900);
    out.text = { s: sOf(text), from: f0, to: parseFloat(getComputedStyle(text.querySelector('.body')).fontSize), wrappedLines: Math.round(text.querySelector('.body').getBoundingClientRect().height / parseFloat(getComputedStyle(text.querySelector('.body')).lineHeight)) };

    const small = byText('lr=3e-4');
    wheel(small.querySelector('.body'), 100, 3);
    await sleep(900);
    out.shrunk = sOf(small);
    out.after = audit();

    // 一直滚也不会超过上下限
    wheel(small.querySelector('.body'), 100, 20);
    await sleep(800);
    out.floor = sOf(small);
    wheel(small.querySelector('.body'), -100, 40);
    await sleep(800);
    out.ceiling = sOf(small);
    out.atLimits = audit();

    // 右键里出现"恢复大小"，点了回到原样
    small.querySelector('.body').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    const labels = $$('#menu button').map((b) => b.textContent);
    $$('#menu button').find((b) => /恢复大小|Reset size/.test(b.textContent))?.click();
    await sleep(900);
    out.reset = { menu: labels, s: sOf(small) };
    // 没缩放过的条目，右键里没有这一项
    (byText('组会') || byText('Group')).querySelector('.body').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    out.plainMenu = $$('#menu button').map((b) => b.textContent);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // 指针不在条目上：什么都不变
    document.getElementById('board').dispatchEvent(new WheelEvent('wheel', { altKey: true, deltaY: -100, bubbles: true, cancelable: true }));
    await sleep(900);
    out.saved = (await window.yw.init()).items.filter((it) => it.scale).map((it) => [it.type, it.scale]);
    out.final = audit();
    return out;
  })()`,

  // 沉底视图
  arch: `(async () => { ${helpers}
    document.getElementById('sed').click();
    await sleep(500);
    return { shown: $$('.it').map((el) => el.querySelector('.body')?.textContent), label: document.getElementById('sed').textContent };
  })()`,

  // 右键菜单
  menu: `(async () => { ${helpers}
    const body = byText('lr=3e-4').querySelector('.body');
    const r = body.getBoundingClientRect();
    body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 12 }));
    return $$('#menu button').map((b) => b.textContent);
  })()`,

  // 语言：中文 → 英文，界面上的字都要换；重新读设置确认记住了
  lang: `(async () => { ${helpers}
    const out = {};
    const g = document.getElementById('guide');
    document.getElementById('b-look').click();
    const snap = () => ({
      title: document.title,
      sed: document.getElementById('sed').textContent,
      head: g.querySelector('h2').textContent,
      firstRow: g.querySelector('.keys span').textContent,
      data: document.getElementById('open-data').textContent,
      search: document.getElementById('q').placeholder,
      keys: $$('.hk').map((b) => b.textContent),
      meta: document.querySelector('.it .meta')?.textContent,
      tip: document.getElementById('b-look').title,
      blank: $$('[data-i18n]').filter((e) => !e.textContent.trim()).length,
    });
    out.zh = snap();
    g.querySelector('[data-lang="en"]').click();
    await sleep(200);
    out.en = snap();
    byText('lr=3e-4').querySelector('.body').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
    out.enMenu = $$('#menu button').map((b) => b.textContent);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    out.saved = (await window.yw.init()).lang;
    out.wrapped = $$('#guide .keys span').filter((e) => e.getBoundingClientRect().height > 30).map((e) => e.textContent);
    return out;
  })()`,

  // 快捷键：点一下进入录制，只按修饰键或普通字母不算，按下组合键才换；和另一个重复时拒绝；Esc 取消
  hotkey: `(async () => { ${helpers}
    const out = {};
    document.getElementById('b-look').click();
    const put = document.querySelector('.hk[data-hk="put"]');
    const show = document.querySelector('.hk[data-hk="show"]');
    const key = (o) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...o }));
    const state = (b) => ({ text: b.textContent, rec: b.classList.contains('rec'), bad: b.classList.contains('bad') });
    out.before = { put: state(put), show: state(show) };
    put.click();
    await sleep(100);
    out.recording = state(put);
    key({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
    key({ key: 'a', code: 'KeyA' });
    out.stillWaiting = put.classList.contains('rec');
    key({ key: 'F9', code: 'F9', ctrlKey: true, altKey: true });
    await sleep(400);
    out.after = state(put);
    // 冲突：和另一个全局快捷键重复、占了看板里已有的按键、占了别的程序常用的按键。都不能换，而且要说清楚为什么
    const desc = (b) => b.parentElement.nextElementSibling;
    const attempt = async (button, o) => {
      button.click();
      await sleep(50);
      key(o);
      await sleep(300);
      return { key: button.textContent, says: desc(button).textContent, warn: desc(button).classList.contains('warn') };
    };
    out.duplicate = await attempt(show, { key: 'F9', code: 'F9', ctrlKey: true, altKey: true });
    out.inApp = await attempt(show, { key: 'v', code: 'KeyV', ctrlKey: true });
    out.common = await attempt(show, { key: 's', code: 'KeyS', ctrlKey: true });
    out.winKey = await attempt(put, { key: 'd', code: 'KeyD', metaKey: true });
    await sleep(3400);
    out.settled = { show: state(show), says: desc(show).textContent, warn: desc(show).classList.contains('warn'), putSays: desc(put).textContent };
    out.allowed = await attempt(show, { key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true });
    // 呼出方式：点"悬停呼出"，记住了
    document.querySelector('[data-peek="hover"]').click();
    await sleep(200);
    out.peekMode = { pressed: document.querySelector('[data-peek][aria-pressed="true"]').dataset.peek, saved: (await window.yw.init()).peekMode };
    show.click();
    key({ key: 'Escape', code: 'Escape' });
    out.escCancels = !show.classList.contains('rec');
    out.saved = (await window.yw.init()).hotkeys;
    const g = document.getElementById('guide');
    out.panelFits = g.scrollHeight <= g.clientHeight;
    out.wrapped = $$('#guide .keys span').filter((e) => e.getBoundingClientRect().height > 30).map((e) => e.textContent);
    return out;
  })()`,

  // 新版本提示（配合 --fake-latest=版本号）
  update: `(async () => { ${helpers}
    await sleep(600);
    document.getElementById('b-look').click();
    const u = document.getElementById('update');
    return { shown: !u.hidden, text: u.textContent, dot: document.getElementById('b-look').classList.contains('new') };
  })()`,

  // 面板最底下一行：数据文件夹、名字、版本、作者
  about: `(async () => { ${helpers}
    document.getElementById('b-look').click();
    await sleep(200);
    const about = document.getElementById('about');
    const r = about.getBoundingClientRect();
    return {
      text: about.innerText.replace(/\\s+/g, ' ').trim(),
      version: document.getElementById('ver').textContent,
      authorIsButton: document.getElementById('author').tagName,
      visible: r.bottom <= window.innerHeight && r.height > 0,
      thanks: document.getElementById('thanks').innerText.trim(),
      thanksVisible: document.getElementById('thanks').getBoundingClientRect().bottom <= document.getElementById('guide').getBoundingClientRect().bottom - 8,
      panelFits: document.getElementById('guide').scrollHeight <= document.getElementById('guide').clientHeight,
      thanksLines: Math.round(document.getElementById('thanks').getBoundingClientRect().height / 16.5),
      lines: Math.round(r.height),
      looks: $$('#looks button').map((b) => b.textContent),
    };
  })()`,

  // 点一下空看板上的鹈鹕，留着张嘴的样子给截图看
  petopen: `(async () => { ${helpers}
    const pet = document.getElementById('pet');
    pet.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    pet.click();
    await sleep(600);
    return {
      open: pet.classList.contains('open'),
      guideOpen: !document.getElementById('guide').hidden,
      bill: getComputedStyle(pet.querySelector('.bill')).transform,
      dataButton: document.getElementById('open-data').textContent,
      theme: document.documentElement.dataset.theme,
    };
  })()`,

  // 空看板：鹈鹕在，点它打开说明，再点关掉；放进东西后鹈鹕消失
  empty: `(async () => { ${helpers}
    const out = {};
    const empty = document.getElementById('empty');
    const pet = document.getElementById('pet');
    const guide = document.getElementById('guide');
    const r = pet.getBoundingClientRect();
    out.shown = { emptyVisible: !empty.hidden, petSize: [Math.round(r.width), Math.round(r.height)], text: empty.querySelector('span').textContent };
    const press = () => { pet.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); pet.click(); };
    press();
    out.opensGuide = !guide.hidden;
    press();
    out.closesGuide = guide.hidden;
    const it = await window.yw.addText('第一条');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(100);
    out.hiddenWhileTyping = empty.hidden;
    document.querySelector('.it.draft .body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await sleep(100);
    out.backAfterCancel = !empty.hidden;
    return out;
  })()`,

  // 外观与说明面板：打开、切换外观、关掉再打开
  guide: `(async () => { ${helpers}
    const out = {};
    const root = document.documentElement;
    const guide = document.getElementById('guide');
    const bg = () => getComputedStyle(document.body).backgroundColor;
    out.start = { theme: root.dataset.theme, bg: bg(), guideOpen: !guide.hidden };
    document.getElementById('b-look').click();
    out.opened = !guide.hidden;
    const pick = (name) => guide.querySelector('[data-look="' + name + '"]').click();
    const seen = {};
    for (const name of ['dusk', 'term', 'night']) { pick(name); await sleep(80); seen[name] = bg(); }
    out.backgrounds = seen;
    pick('term');
    await sleep(300);
    out.final = { theme: root.dataset.theme, pressed: guide.querySelector('[data-look][aria-pressed="true"]').dataset.look, saved: (await window.yw.init()).theme };
    out.rows = $$('#guide .keys b').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    out.closedByEsc = guide.hidden;
    document.getElementById('b-look').click();
    return out;
  })()`,

  // 撤销历史、一次拖来几个网址、带格式的文字
  history: `(async () => { ${helpers}
    const out = {};
    const undoEl = document.getElementById('undo');
    const count = () => $$('.it:not(.gone)').length;
    const saved = async () => (await window.yw.init()).items.length;
    const key = (k, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
    const drop = (data) => { const dt = new DataTransfer(); for (const k in data) dt.setData(k, data[k]); window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); };
    out.start = { shown: count(), saved: await saved() };

    drop({ 'text/uri-list': 'https://a.invalid/1\\nhttps://b.invalid/2\\nhttps://c.invalid/3', 'text/plain': 'https://a.invalid/1' });
    await sleep(500);
    out.threeLinks = { shown: count(), undo: undoEl.hidden ? null : undoEl.textContent, saved: await saved() };
    key('z', { ctrlKey: true });
    await sleep(300);
    out.linksUndone = { shown: count(), saved: await saved(), undoHidden: undoEl.hidden };

    drop({ 'text/plain': 'zz1 zz2 zz3 zz4', 'text/html': '<table><tr><td>zz1</td><td>zz2</td></tr><tr><td>zz3</td><td>zz4</td></tr></table><script>window.hacked = 1</script>' });
    await sleep(400);
    const rich = document.querySelector('.it.rich');
    out.table = { shown: count(), rich: !!rich, cells: rich ? rich.querySelectorAll('td').length : 0, script: rich ? rich.querySelectorAll('script').length : -1, hacked: !!window.hacked };
    key('z', { ctrlKey: true });
    await sleep(300);
    out.tableUndone = { shown: count(), saved: await saved(), rich: !!document.querySelector('.it.rich') };

    key('z', { ctrlKey: true });
    await sleep(200);
    out.nothingToUndo = count();
    return out;
  })()`,

  // 框选、Delete、撤销、指针悬停删除、Ctrl+点击
  select: `(async () => { ${helpers}
    const out = {};
    const board = document.getElementById('board');
    const undoEl = document.getElementById('undo');
    const count = () => $$('.it').length;
    const sel = () => $$('.it.sel').length;
    const key = (k, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
    const move = (x, y) => document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    const rectOf = (t) => byText(t).querySelector('.body').getBoundingClientRect();
    out.start = count();

    // 从空白处拖一个框，罩住两条
    const a = rectOf('组会'), b = rectOf('lr=3e-4');
    const x0 = Math.min(a.left, b.left) - 8, y0 = Math.min(a.top, b.top) - 4;
    const x1 = Math.max(a.left, b.left) + 40, y1 = Math.max(a.bottom, b.bottom) + 4;
    board.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x0, clientY: y0 }));
    move(x0 + 20, y0 + 20);
    move(x1, y1);
    out.bandVisible = !document.getElementById('band').hidden;
    out.selectedWhileDragging = sel();
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x1, clientY: y1 }));
    board.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x1, clientY: y1 }));
    await sleep(50);
    out.afterBand = { selected: sel(), bandHidden: document.getElementById('band').hidden, draftOpened: !!document.querySelector('.it.draft') };

    // Delete 删掉选中的，底部出现撤销
    const n = sel();
    key('Delete');
    await sleep(200);
    out.deleted = { removed: out.start - count(), expected: n, undo: undoEl.hidden ? null : undoEl.textContent, saved: (await window.yw.init()).items.length };

    // Ctrl+Z 找回
    key('z', { ctrlKey: true });
    await sleep(300);
    out.undone = { count: count(), undoHidden: undoEl.hidden, saved: (await window.yw.init()).items.length };

    // 指针停在一条上按 Delete
    await sleep(600);
    const c = rectOf('取件码');
    move(c.left + 6, c.top + 6);
    key('Delete');
    await sleep(200);
    out.hoverDelete = { count: count(), stillThere: !!byText('取件码'), undo: undoEl.textContent };
    undoEl.click();
    await sleep(300);
    out.hoverUndone = { count: count(), back: !!byText('取件码') };

    // 指针在空白处按 Delete：什么都不删
    move(window.innerWidth - 60, window.innerHeight - 120);
    key('Delete');
    await sleep(100);
    out.deleteOnEmpty = count();

    // Ctrl+点击加选，Esc 取消
    await sleep(600);
    byText('取件码').querySelector('.body').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, detail: 1 }));
    byText('报销单号').querySelector('.body').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, detail: 1 }));
    out.ctrlClick = sel();
    key('Escape');
    out.afterEsc = sel();

    // 留一个选中状态给截图看
    byText('组会').querySelector('.body').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, detail: 1 }));
    $$('.it.image')[0].querySelector('img').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, detail: 1 }));
    byText('审稿人').querySelector('.body').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, detail: 1 }));
    return out;
  })()`,

  // 主要流程：新建、沉底、点击变热、编辑、缩放
  flow: `(async () => { ${helpers}
    const out = {};
    const board = document.getElementById('board');
    const sed = document.getElementById('sed');
    out.start = { items: $$('.it').length, sed: sed.textContent };

    // 点空白处 → 输入 → 回车
    click(board);
    const draft = document.querySelector('.it.draft .body');
    out.draftOpened = !!draft;
    if (draft) {
      draft.textContent = '新放的一条 hello';
      draft.dispatchEvent(new Event('input', { bubbles: true }));
      draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(400);
    }
    const made = byText('新放的一条');
    out.created = made ? { t: tOf(made), y: yOf(made), draftGone: !document.querySelector('.it.draft') } : null;

    // 右键菜单里选"沉底" → 从看板消失，沉底数加一
    const linkBody = byText('审稿人').querySelector('.body');
    linkBody.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    const sinkBtn = $$('#menu button').find((b) => b.textContent === '归档');
    sinkBtn && sinkBtn.click();
    await sleep(200);
    out.sunkByMenu = { gone: !byText('审稿人'), sed: sed.textContent, noTodoMarks: $$('.it.todo').length === 0 };

    // 点一条凉的 → 提示已复制 → 变热、浮上去
    const cold = byText('报销单号');
    const before = { t: tOf(cold), y: yOf(cold) };
    click(cold.querySelector('.body'));
    const said = cold.querySelector('.meta').textContent;
    await sleep(1300);
    out.use = { before, said, after: { t: tOf(cold), y: yOf(cold) }, meta: cold.querySelector('.meta').textContent };

    // 双击编辑 → 改字 → Ctrl+Enter
    const target = byText('取件码');
    const body = target.querySelector('.body');
    body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    out.editing = target.classList.contains('editing');
    body.textContent = '取件码 6-2-3071 已取';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    if (target.classList.contains('editing')) body.dispatchEvent(new FocusEvent('blur'));
    await sleep(300);
    out.edited = { stillEditing: target.classList.contains('editing'), text: byText('已取')?.querySelector('.body').textContent };

    // Ctrl+滚轮缩放
    const z0 = getComputedStyle(document.documentElement).getPropertyValue('--z');
    for (let i = 0; i < 4; i++) window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }));
    out.zoom = { from: z0, to: getComputedStyle(document.documentElement).getPropertyValue('--z') };

    // 重新读一遍存储，确认改动落盘
    await sleep(500);
    const saved = (await window.yw.init()).items;
    out.saved = {
      count: saved.length,
      created: saved.some((it) => it.text === '新放的一条 hello'),
      edited: saved.some((it) => it.text === '取件码 6-2-3071 已取'),
      usedCount: saved.find((it) => (it.text || '').includes('报销单号'))?.uses,
      linkSunk: saved.find((it) => it.type === 'link' && it.title.includes('审稿人'))?.sunk,
    };
    return out;
  })()`,
};
