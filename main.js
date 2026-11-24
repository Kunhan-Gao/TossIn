const {
  app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, ClipboardItem, nativeImage,
  ipcMain, shell, screen, net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const { foregroundWindow } = require('./fullscreen');

// 测试时用独立的数据目录，不碰真实数据
const TEST_DIR = process.env.YUWEN_DATA;
if (TEST_DIR) app.setPath('userData', path.resolve(TEST_DIR));
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const SHOT = argOf('shot');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.argv.includes('--quit')) {
  // 安装程序用 --quit 请正在运行的那一份退出。走到这里说明没有在运行的，那就什么都不做
  app.quit();
} else {
  main();
}

function main() {
  // 软件先后叫过"余温"和"For Now"，数据在 %APPDATA% 下对应的目录里。
  // 第一次以新名字启动时，把最近用过的那份数据和窗口设置搬过来（旧目录保留不动）
  if (!TEST_DIR) {
    const newDir = app.getPath('userData');
    const fresh = !fs.existsSync(path.join(newDir, 'window.json')) && !fs.existsSync(path.join(newDir, 'data', 'index.json'));
    const oldDir = ['For Now', '余温'].map((name) => path.join(app.getPath('appData'), name))
      .find((dir) => dir !== newDir && fs.existsSync(path.join(dir, 'data', 'index.json')));
    if (fresh && oldDir) {
      try {
        fs.mkdirSync(newDir, { recursive: true });
        if (fs.existsSync(path.join(oldDir, 'data'))) fs.cpSync(path.join(oldDir, 'data'), path.join(newDir, 'data'), { recursive: true });
        if (fs.existsSync(path.join(oldDir, 'window.json'))) fs.copyFileSync(path.join(oldDir, 'window.json'), path.join(newDir, 'window.json'));
      } catch {}
    }
  }

  // 主进程里用到的文字（窗口标题、托盘菜单）；界面上的文字在 renderer/i18n.js
  const TEXT = {
    zh: { name: '先放这儿', show: '显示', top: '窗口总在最前', login: '开机自启', data: '打开数据文件夹', quit: '退出' },
    en: { name: 'TossIn', show: 'Show', top: 'Always on top', login: 'Start with Windows', data: 'Open data folder', quit: 'Quit' },
  };
  // 没选过语言时跟随系统：中文系统用中文，其余用英文
  const langOf = () => (TEXT[state.lang] ? state.lang : (app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'));
  const tr = (key) => TEXT[langOf()][key];
  const DATA = path.join(app.getPath('userData'), 'data');
  const IMG = path.join(DATA, 'images');
  const INDEX = path.join(DATA, 'index.json');
  const STATE = path.join(app.getPath('userData'), 'window.json');
  const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
  const DEFAULT_HOTKEYS = { put: 'Control+Alt+V', show: 'Control+Alt+Space' };
  const REPO = 'Kunhan-Gao/TossIn'; // 发布用的 GitHub 仓库，更新检查看这里的 Releases

  let items = [];
  let state = {};
  let win = null;
  let tray = null;
  let quitting = false;
  let saveTimer = null;
  let stateTimer = null;

  // ---------- 存储 ----------

  function readJSON(file) {
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // 文件损坏时留一份备份，避免被空数据覆盖
      try { fs.renameSync(file, `${file}.broken-${Date.now()}`); } catch {}
      return null;
    }
  }
  function writeJSON(file, obj) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
    fs.renameSync(tmp, file);
  }
  function saveItems() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; writeJSON(INDEX, { version: 1, items }); }, 250);
  }
  function saveState() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => { stateTimer = null; writeJSON(STATE, state); }, 400);
  }
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeJSON(INDEX, { version: 1, items }); }
    if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; writeJSON(STATE, state); }
  }

  // ---------- 条目 ----------

  const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const byId = (id) => items.find((it) => it.id === id);
  const imagePath = (it) => path.join(IMG, it.file);
  const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

  function create(type, extra) {
    const now = Date.now();
    const it = { id: newId(), type, created: now, touched: now, uses: 0, pin: false, sunk: false, ...extra };
    items.push(it);
    saveItems();
    return it;
  }
  // 重复放同一样东西：不新建，只让原来那条重新变热
  function rewarm(it) {
    it.touched = Date.now();
    it.sunk = false;
    delete it.sunkAt;
    saveItems();
    return it;
  }

  // 复制来的内容带格式（表格、列表、加粗、链接……）时，把那一段 HTML 一起存下来；只是普通文字就不存
  const RICH = /<(table|ul|ol|li|b|strong|i|em|u|s|h[1-6]|br|pre|blockquote|a\s[^>]*href)\b/i;
  function richHtml(raw) {
    let html = String(raw || '');
    const a = html.indexOf('<!--StartFragment-->'), b = html.indexOf('<!--EndFragment-->');
    if (a >= 0 && b > a) html = html.slice(a + 20, b);
    html = html.trim();
    return html && html.length <= 300000 && RICH.test(html) ? html : '';
  }

  function addText(raw, htmlRaw) {
    const text = String(raw || '').replace(/\r\n/g, '\n').trim();
    if (!text) return null;
    if (/^https?:\/\/\S+$/i.test(text)) {
      const dup = items.find((it) => it.type === 'link' && it.url === text);
      if (dup) return rewarm(dup);
      const it = create('link', { url: text, title: '' });
      fetchTitle(it);
      return it;
    }
    const html = richHtml(htmlRaw);
    const dup = items.find((it) => it.type === 'text' && it.text === text && (it.html || '') === html);
    if (dup) return rewarm(dup);
    return create('text', html ? { text, html } : { text });
  }

  // 一次放进来好几个网址（每行一个）：拆成几条链接；其余照常当一条
  function addTexts(raw, htmlRaw) {
    const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every((l) => /^https?:\/\/\S+$/i.test(l))) return [...new Set(lines)].map((l) => addText(l)).filter(Boolean);
    return [addText(raw, htmlRaw)].filter(Boolean);
  }

  function addImageBuffer(buf, ext, size) {
    const hash = crypto.createHash('sha1').update(buf).digest('hex');
    const dup = items.find((it) => it.type === 'image' && it.hash === hash);
    if (dup) return rewarm(dup);
    const file = `${newId()}${ext}`;
    fs.writeFileSync(path.join(IMG, file), buf);
    return create('image', { file, hash, w: size.width || 0, h: size.height || 0 });
  }

  function addPath(p) {
    if (!p || !fs.existsSync(p)) return null;
    const ext = path.extname(p).toLowerCase();
    if (IMAGE_EXT.has(ext) && fs.statSync(p).isFile()) {
      const buf = fs.readFileSync(p);
      return addImageBuffer(buf, ext, nativeImage.createFromBuffer(buf).getSize());
    }
    const dup = items.find((it) => it.type === 'file' && it.path === p);
    if (dup) return rewarm(dup);
    return create('file', { path: p });
  }

  async function addImageUrl(url) {
    if (!/^https?:\/\//i.test(url)) return null;
    try {
      const res = await net.fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (!type.startsWith('image/')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = { 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp' }[type.split(';')[0]] || '.png';
      return addImageBuffer(buf, ext, nativeImage.createFromBuffer(buf).getSize());
    } catch {
      return null;
    }
  }

  // 剪贴板里有什么就放什么：文件优先，其次文字，再次图片
  async function captureClipboard() {
    let entries = [];
    try { entries = await clipboard.read(); } catch { return []; }
    const bytesOf = async (type) => {
      for (const entry of entries) {
        if (!entry.types.includes(type)) continue;
        try { return Buffer.from(await (await entry.getType(type)).arrayBuffer()); } catch {}
      }
      return null;
    };

    // 资源管理器里复制的文件：以 file:// 列表的形式出现，可以是多个
    const uriBytes = await bytesOf('text/uri-list');
    if (uriBytes) {
      const paths = uriBytes.toString('utf8').split(/\r?\n/)
        .filter((line) => /^file:/i.test(line.trim()))
        .map((line) => { try { return fileURLToPath(line.trim()); } catch { return ''; } });
      const added = paths.map(addPath).filter(Boolean);
      if (added.length) return added;
    }
    const textBytes = await bytesOf('text/plain');
    const text = textBytes ? textBytes.toString('utf8') : '';
    if (text.trim()) {
      const htmlBytes = await bytesOf('text/html'); // Excel、网页、Word 里复制的内容，同时带着带格式的版本
      return addTexts(text, htmlBytes ? htmlBytes.toString('utf8') : '');
    }
    for (const [type, ext] of [['image/png', '.png'], ['image/jpeg', '.jpg']]) {
      const buf = await bytesOf(type);
      if (buf && buf.length) return [addImageBuffer(buf, ext, nativeImage.createFromBuffer(buf).getSize())];
    }
    return [];
  }

  async function copyItem(it) {
    if (it.type === 'text' && it.html) { // 带格式的：纯文字和原来的格式一起放进剪贴板，粘到 Excel、Word 里还是表格
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob([it.text], { type: 'text/plain' }), 'text/html': new Blob([it.html], { type: 'text/html' }) })]);
      return;
    }
    if (it.type !== 'image') {
      await clipboard.writeText(it.type === 'link' ? it.url : it.type === 'file' ? it.path : it.text);
      return;
    }
    const file = imagePath(it);
    const png = path.extname(file).toLowerCase() === '.png' ? fs.readFileSync(file) : nativeImage.createFromPath(file).toPNG();
    if (!png.length) { await clipboard.writeText(file); return; } // 转不了的格式，退而复制路径
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decodeEntities = (s) => s
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m);

  async function fetchTitle(it) {
    try {
      const res = await net.fetch(it.url, { signal: AbortSignal.timeout(8000) });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/html/i.test(type)) return;
      const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 300000);
      const charset = (/charset=([\w-]+)/i.exec(type) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString('latin1')) || [])[1] || 'utf-8';
      let html;
      try { html = new TextDecoder(charset).decode(buf); } catch { html = buf.toString('utf8'); }
      const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      const title = m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
      if (title && byId(it.id)) {
        it.title = title;
        saveItems();
        send('changed', it);
      }
    } catch {}
  }

  let trash = [];
  function emptyTrash() {
    for (const it of trash) {
      if (it.type === 'image') { try { fs.unlinkSync(imagePath(it)); } catch {} }
    }
    trash = [];
    return true;
  }

  function removeItem(id) {
    const i = items.findIndex((it) => it.id === id);
    if (i < 0) return false;
    const [it] = items.splice(i, 1);
    if (it.type === 'image') { try { fs.unlinkSync(imagePath(it)); } catch {} }
    saveItems();
    return true;
  }

  // ---------- 图标 ----------

  // 图标文件由 dev/make-icons.js 生成，放在 assets/
  const ASSETS = path.join(__dirname, 'assets');
  const APP_ICON = path.join(ASSETS, 'icon.png');

  // ---------- 窗口 ----------

  function defaultBounds() {
    const primary = screen.getPrimaryDisplay();
    const second = screen.getAllDisplays().find((d) => d.id !== primary.id);
    if (second) return { ...second.workArea };
    // 只有一块屏：靠右一条
    const a = primary.workArea;
    const width = Math.max(320, Math.min(520, Math.round(a.width * 0.28)));
    return { x: a.x + a.width - width, y: a.y, width, height: a.height };
  }
  function onScreen(b) {
    if (!b || !(b.width > 0) || !(b.height > 0)) return false;
    return screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x + b.width > a.x + 80 && b.x < a.x + a.width - 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 60;
    });
  }
  // 窗口底色跟外观一致，启动时不闪
  const THEME_BG = { dusk: '#2B3238', night: '#11181C', term: '#0C0C0C' };
  const DEFAULT_THEME = 'dusk';
  const themeOf = () => (THEME_BG[state.theme] ? state.theme : DEFAULT_THEME); // 已取消的外观回到默认
  const bgColor = () => THEME_BG[themeOf()];

  function createWindow() {
    const bounds = onScreen(state.bounds) ? state.bounds : defaultBounds();
    const size = argOf('size'); // 仅测试用：--size=宽x高
    if (size) [bounds.width, bounds.height] = size.split('x').map(Number);
    win = new BrowserWindow({
      ...bounds,
      minWidth: 260,
      minHeight: 200,
      frame: false,
      show: false,
      title: tr('name'),
      icon: APP_ICON,
      backgroundColor: bgColor(),
      alwaysOnTop: state.level === 'top',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: false,
        spellcheck: false,
      },
    });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    win.once('ready-to-show', () => { if (!SHOT && !tucked) win.show(); });

    // 记下窗口的位置和大小。差一两个像素不算改动：屏幕缩放不是 100% 时，读回来的数字本来就会差一点，
    // 要是每次都当真，窗口会一点点变大
    state.bounds = { ...bounds };
    const remember = () => {
      if (sliding || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
      const now = win.getBounds();
      if (['x', 'y', 'width', 'height'].every((k) => Math.abs(now[k] - state.bounds[k]) <= 2)) return;
      state.bounds = now;
      saveState();
    };
    win.on('resize', remember);
    win.on('move', remember);
    win.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      win.hide();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('before-input-event', (_e, input) => {
      if (!app.isPackaged && input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }

  function showWindow() {
    if (!win) return;
    if (tucked) { reveal(true); return; }
    if (win.isMinimized()) win.restore();
    visiting = null; // 本来只是临时出来接东西的，现在算正式出来了
    if (state.tucked) { state.tucked = false; saveState(); }
    win.show();
    win.focus();
  }
  // 快捷键和托盘图标：看不见就叫出来；正在用就收起，收到上次收的地方（屏幕边上或托盘）
  function toggleWindow() {
    if (tucked) reveal(true);
    else if (win.isVisible() && !win.isMinimized() && win.isFocused()) { if (state.hideTo === 'edge') tuck(); else hideToTray(); }
    else showWindow();
  }
  // 收起到托盘：看板和边上的鹈鹕都不留
  function hideToTray() {
    if (tucked) { tucked = false; hidePeek(); } else win.hide();
    visiting = null;
    state.tucked = false;
    state.hideTo = 'tray';
    saveState();
  }
  function setLevel(level) {
    state.level = level;
    win.setAlwaysOnTop(level === 'top');
    saveState();
    send('level', level);
    refreshTray();
  }

  // 开机自启在注册表里登记的名字固定为 TossIn，卸载时按这个名字清掉
  const loginOptions = () => (app.isPackaged ? { name: 'TossIn' } : { path: process.execPath, args: [app.getAppPath()] });

  // 现在是不是开机自启。Windows 上要看 executableWillLaunchAtLogin：openAtLogin 在这里读回来一直是 false
  function opensAtLogin() {
    const now = app.getLoginItemSettings(loginOptions());
    return !!(now.executableWillLaunchAtLogin || now.openAtLogin);
  }

  function refreshTray() {
    if (!tray) return;
    tray.setToolTip(tr('name'));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: tr('show'), click: showWindow },
      { label: tr('top'), type: 'checkbox', checked: state.level === 'top', click: (m) => setLevel(m.checked ? 'top' : 'normal') },
      {
        label: tr('login'), type: 'checkbox',
        checked: opensAtLogin(),
        click: (m) => { app.setLoginItemSettings({ ...loginOptions(), openAtLogin: m.checked }); refreshTray(); },
      },
      { type: 'separator' },
      { label: tr('data'), click: () => shell.openPath(DATA) },
      { label: tr('quit'), click: () => { quitting = true; app.quit(); } },
    ]));
  }

  // ---------- 收到屏幕边上 ----------

  // 点看板右上角的按钮，看板收到屏幕边上，边上留一只探出头的小鹈鹕；点一下鹈鹕，看板回来并一直留着。
  // 拖着东西移到鹈鹕上时，看板临时出来接一下，指针离开后自己收回去。
  // 别的程序全屏时（看视频、放幻灯片），鹈鹕先躲起来。
  const PEEK = { width: 64, height: 64 };
  const SLIDE = { distance: 36, ms: 150 };
  let peek = null;
  let peekReady = null;
  let tucked = false;  // 看板正收在边上
  let sliding = false; // 正在滑进滑出（这期间窗口位置的变化不记）
  let ducked = false;  // 前面有全屏的窗口，鹈鹕暂时躲着
  let visiting = null; // 看板只是临时出来接东西：{ since, entered, outside }
  let ticking = false;
  let home = null;     // 看板收起前的位置

  // 看板靠哪一边：看它的中心在所在屏幕的左半还是右半
  function edgeOf(b) {
    const area = screen.getDisplayMatching(b).workArea;
    return { area, side: b.x + b.width / 2 < area.x + area.width / 2 ? 'left' : 'right' };
  }
  function createPeek() {
    peek = new BrowserWindow({
      width: PEEK.width, height: PEEK.height,
      show: false, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
    });
    peek.setAlwaysOnTop(true, 'floating');
    peekReady = peek.loadFile(path.join(__dirname, 'renderer', 'peek.html'));
  }
  // 鹈鹕在边上的位置：上下可以拖，记的是比例，换屏幕也成立
  function peekBounds() {
    const { area, side } = edgeOf(home);
    const at = typeof state.peekAt === 'number' ? Math.max(0, Math.min(1, state.peekAt)) : 0.62;
    return {
      side,
      bounds: {
        x: side === 'right' ? area.x + area.width - PEEK.width : area.x,
        y: Math.round(area.y + at * (area.height - PEEK.height)),
        width: PEEK.width, height: PEEK.height,
      },
    };
  }
  async function showPeek() {
    if (!peek || peek.isDestroyed()) createPeek();
    await peekReady;
    if (!tucked) return;
    const { side, bounds } = peekBounds();
    peek.setBounds(bounds);
    await peek.webContents.executeJavaScript(`setup(${JSON.stringify(themeOf())}, ${JSON.stringify(side)})`).catch(() => {});
    if (tucked && !ducked) peek.showInactive();
  }
  const hidePeek = () => { if (peek && !peek.isDestroyed()) peek.hide(); };

  // 最前面的窗口是不是把鹈鹕所在的那块屏幕整个占满了（全屏）。最大化不算，桌面不算，自己的窗口不算
  function fullscreenInFront(fg = foregroundWindow()) {
    if (!home || !fg || fg.pid === process.pid || fg.zoomed) return false;
    if (/^(Progman|WorkerW|Shell_TrayWnd)$/.test(fg.className)) return false;
    let r;
    try { r = screen.screenToDipRect(null, fg.rect); } catch { return false; }
    const b = screen.getDisplayMatching(home).bounds;
    return r.x <= b.x + 1 && r.y <= b.y + 1 && r.x + r.width >= b.x + b.width - 1 && r.y + r.height >= b.y + b.height - 1;
  }
  // 定时看一眼：全屏了就让鹈鹕躲起来，退出全屏再出来
  function duckTick(fg) {
    if (!tucked || sliding) return;
    const full = fullscreenInFront(fg);
    if (full === ducked) return;
    ducked = full;
    if (ducked) hidePeek(); else showPeek();
  }

  // 滑一小段并淡入淡出。位置和大小每一步都用记下来的固定值整块设进去。
  // 不能只设位置，也不能从窗口读回来再改：屏幕缩放不是 100% 时，那两种做法都会让窗口一次次变大
  function slide(showing) {
    const dir = edgeOf(home).side === 'right' ? 1 : -1;
    const start = Date.now();
    return new Promise((resolve) => {
      const step = () => {
        const p = Math.min(1, (Date.now() - start) / SLIDE.ms);
        const away = showing ? (1 - p) ** 3 : p ** 2;
        win.setBounds({ ...home, x: Math.round(home.x + dir * SLIDE.distance * away) });
        win.setOpacity(1 - away);
        if (p < 1) setTimeout(step, 12); else resolve();
      };
      step();
    });
  }
  async function tuck() {
    if (tucked || sliding || !win.isVisible() || win.isMinimized()) return;
    tucked = true;
    sliding = true;
    visiting = null;
    home = { ...state.bounds };
    state.tucked = true;
    state.hideTo = 'edge';
    saveState();
    await slide(false);
    win.hide();
    win.setBounds(home);
    win.setOpacity(1);
    sliding = false;
    ducked = fullscreenInFront();
    await showPeek();
  }
  // 上次退出时看板是收着的：这次也从收着开始
  function startTucked() {
    tucked = true;
    home = { ...state.bounds };
    ducked = fullscreenInFront();
    showPeek();
  }
  // stay 为 true：看板回来并留着。为 false：只是临时出来接东西，不抢焦点，指针离开后自己收回去
  async function reveal(stay) {
    if (!tucked || sliding) return;
    tucked = false;
    sliding = true;
    visiting = stay ? null : { since: Date.now(), entered: false, outside: 0 };
    if (stay) { state.tucked = false; saveState(); }
    hidePeek();
    win.setOpacity(0);
    if (stay) { win.show(); win.focus(); } else { win.showInactive(); win.moveTop(); }
    await slide(true);
    sliding = false;
  }
  const peekMode = () => (state.peekMode === 'hover' ? 'hover' : 'click');
  function peekSays(what) {
    if (!tucked) return;
    if (what === 'hover') { if (peekMode() === 'hover') reveal(false); }
    else if (what === 'click') reveal(peekMode() !== 'hover');
    else if (what === 'drag') reveal(false);
    else if (what === 'move') movePeek(screen.getCursorScreenPoint().y);
    else if (what === 'moved') saveState();
  }
  // 上下挪鹈鹕：记下它在屏幕边上的比例，再按这个比例整块设位置和大小。
  // 不从窗口读回位置再改——屏幕缩放不是 100% 时那样会让这个小窗口越拖越大，鹈鹕就被挤出屏幕了
  function movePeek(cursorY) {
    const { area } = edgeOf(home);
    const y = Math.max(area.y, Math.min(area.y + area.height - PEEK.height, Math.round(cursorY - PEEK.height / 2)));
    state.peekAt = (y - area.y) / Math.max(1, area.height - PEEK.height);
    peek.setBounds(peekBounds().bounds);
  }
  // 屏幕变了：鹈鹕挪到新的边上
  function syncPeek() {
    if (tucked) showPeek();
  }
  // 临时出来接东西的时候，定时看一眼指针：进来过又离开了一会儿（或者一直没进来），而且看板没在忙，就收回去
  async function visitTick(point) {
    if (!visiting || ticking || sliding || tucked) return false;
    if (!win.isVisible() || win.isMinimized()) { visiting = null; return false; }
    const b = win.getBounds();
    const m = 10;
    if (point.x >= b.x - m && point.x < b.x + b.width + m && point.y >= b.y - m && point.y < b.y + b.height + m) {
      visiting.entered = true;
      visiting.outside = 0;
      return false;
    }
    if (!visiting.entered && Date.now() - visiting.since < 2500) return false; // 刚出来，指针还在往这边移
    visiting.outside = visiting.outside || Date.now();
    if (Date.now() - visiting.outside < 600) return false;
    ticking = true;
    try {
      const busy = await win.webContents.executeJavaScript('window.ywBusy ? window.ywBusy() : false').catch(() => false);
      if (busy || !visiting) return false;
      await tuck();
      return true;
    } finally {
      ticking = false;
    }
  }

  // ---------- 角上的小鹈鹕 ----------

  // 用快捷键放东西时，如果看板看不见，就在鼠标所在屏幕的右下角冒出一只小鹈鹕，张嘴、合上，一秒后消失。
  // 它不抢焦点，也点不到，只是告诉你"接住了"。
  const TOAST = { width: 140, height: 104, margin: 12, life: 1200 };
  let toast = null;
  let toastReady = null;
  let toastTimer = null;
  function createToast() {
    toast = new BrowserWindow({
      width: TOAST.width, height: TOAST.height,
      show: false, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    toast.setAlwaysOnTop(true, 'pop-up-menu');
    toast.setIgnoreMouseEvents(true);
    toastReady = toast.loadFile(path.join(__dirname, 'renderer', 'toast.html'));
  }
  // 看板算"看得见"：窗口开着，并且正在用它，或者它在另一块屏幕上（鼠标所在的屏幕上才可能被别的窗口挡住）
  function boardInSight(display) {
    if (!win.isVisible() || win.isMinimized()) return false;
    return win.isFocused() || screen.getDisplayMatching(win.getBounds()).id !== display.id;
  }
  async function gulp(force) {
    // 看板收在边上时，由边上的那只鹈鹕来接
    if (!force && tucked && peek && !peek.isDestroyed() && peek.isVisible()) {
      peek.webContents.executeJavaScript('gulp()').catch(() => {});
      return;
    }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (!force && boardInSight(display)) return;
    if (!toast || toast.isDestroyed()) createToast();
    await toastReady;
    const a = display.workArea;
    toast.setBounds({
      x: a.x + a.width - TOAST.width - TOAST.margin,
      y: a.y + a.height - TOAST.height - TOAST.margin,
      width: TOAST.width, height: TOAST.height,
    });
    toast.showInactive();
    toast.webContents.executeJavaScript(`play(${JSON.stringify(themeOf())})`).catch(() => {});
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toast && !toast.isDestroyed()) toast.hide(); }, TOAST.life);
  }

  // ---------- 全局快捷键（可以在面板里改） ----------

  // 测试时默认不注册，免得和正在用的那份抢；加 --hotkeys=1 才真的注册
  const HOTKEYS_ON = !TEST_DIR || !!argOf('hotkeys');
  const VALID_HOTKEY = /^(?:(?:Control|Alt|Shift|Super)\+){1,4}(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert)$/;
  const hotkeyOk = { put: false, show: false };
  // 一个按键只对应一件事。全局快捷键不能：和另一个全局快捷键重复；占用看板里已经有用处的按键；
  // 占用各种程序里通用的按键（否则在别的程序里按它，就被这里截走了）
  const IN_APP = { 'Control+V': 'paste', 'Control+C': 'copy', 'Control+Z': 'undo', 'Control+F': 'find', 'Control+A': 'all', 'Control+0': 'zoom' };
  const COMMON = /^(?:Control\+(?:[A-Z0-9]|F4|F5|Space|Insert|Home|End|Up|Down|Left|Right)|Alt\+(?:F4|Space|Left|Right)|Super\+(?:[A-Z0-9]|Space|Up|Down|Left|Right|Home))$/;
  function hotkeyConflict(which, accel) {
    const other = which === 'put' ? 'show' : 'put';
    if (accel === hotkeyOf(other)) return { reason: 'same', what: other };
    if (IN_APP[accel]) return { reason: 'inapp', what: IN_APP[accel] };
    if (COMMON.test(accel)) return { reason: 'common' };
    return null;
  }
  // 存着的快捷键如果按现在的规矩不能用了（比如旧版本里设的），就用回默认的
  const hotkeyOf = (which) => {
    const saved = state.hotkeys && state.hotkeys[which];
    return saved && VALID_HOTKEY.test(saved) && !IN_APP[saved] && !COMMON.test(saved) ? saved : DEFAULT_HOTKEYS[which];
  };
  const hotkeyActions = {
    put: async () => {
      const added = await captureClipboard();
      if (!added.length) return;
      send('added', added);
      gulp();
    },
    show: () => toggleWindow(),
  };
  function tryRegister(accel, action) {
    try { return globalShortcut.register(accel, action); } catch { return false; }
  }
  function registerHotkeys() {
    if (!HOTKEYS_ON) return;
    globalShortcut.unregisterAll();
    for (const which of ['put', 'show']) hotkeyOk[which] = tryRegister(hotkeyOf(which), hotkeyActions[which]);
  }
  // ok 为 false 表示这个组合被别的程序占着，界面上会标出来
  const hotkeyInfo = () => ({
    put: { accel: hotkeyOf('put'), ok: HOTKEYS_ON ? hotkeyOk.put : true },
    show: { accel: hotkeyOf('show'), ok: HOTKEYS_ON ? hotkeyOk.show : true },
  });

  // ---------- 新版本检查 ----------

  // 只做"检查并提示"：问一下 GitHub 上最新的版本号，有更新就在面板里给一个下载入口。不会自己下载安装。
  let update = null;
  function isNewer(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
  }
  async function checkUpdate() {
    try {
      let latest;
      const fake = argOf('fake-latest'); // 仅测试用
      if (fake) {
        latest = { tag_name: `v${fake}`, html_url: `https://github.com/${REPO}/releases/tag/v${fake}` };
      } else {
        if (TEST_DIR) return;
        const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'TossIn' },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return;
        latest = await res.json();
      }
      const version = String(latest.tag_name || '').replace(/^v/i, '');
      if (!/^\d+(\.\d+){0,2}$/.test(version) || !isNewer(version, app.getVersion())) {
        update = null;
      } else {
        const page = String(latest.html_url || '');
        update = { version, url: page.startsWith(`https://github.com/${REPO}/`) ? page : `https://github.com/${REPO}/releases` };
      }
      send('update', update);
    } catch {}
  }

  // ---------- 启动 ----------

  app.on('second-instance', (_e, argv) => {
    // 安装或卸载之前，安装程序会带着 --quit 再启动一次：存好数据，退出
    if (argv.includes('--quit')) { quitting = true; app.quit(); } else showWindow();
  });
  app.on('before-quit', () => { quitting = true; emptyTrash(); flush(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {});

  app.whenReady().then(() => {
    fs.mkdirSync(IMG, { recursive: true });
    items = (readJSON(INDEX) || {}).items || [];
    for (const it of items) delete it.todo; // 早期版本有过"待办"标记，已取消
    state = readJSON(STATE) || {};
    Menu.setApplicationMenu(null);

    if (argOf('theme')) state.theme = argOf('theme');
    if (argOf('lang')) state.lang = argOf('lang');
    if (argOf('seed')) require('./dev/seed')({ items, IMG, nativeImage, lang: argOf('lang'), tall: argOf('tall'), stress: argOf('stress') });

    createWindow();

    if (!TEST_DIR) {
      tray = new Tray(path.join(ASSETS, 'tray.png'));
      tray.on('click', toggleWindow);
      refreshTray();
    }
    registerHotkeys();
    if (HOTKEYS_ON) createToast();
    if (!TEST_DIR) {
      if (state.tucked) startTucked();
      setInterval(() => visitTick(screen.getCursorScreenPoint()), 150);
      setInterval(() => duckTick(), 800);
      for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, syncPeek);
    }

    // 启动后过一会儿查一次新版本，之后每 12 小时查一次
    if (argOf('fake-latest')) checkUpdate();
    else if (!TEST_DIR) {
      setTimeout(checkUpdate, 8000);
      setInterval(checkUpdate, 12 * 3600e3);
    }

    // 仅测试用：--shot=截图路径 [--do=dev/checks.js 里的检查名]
    if (SHOT) {
      const log = [];
      win.webContents.on('console-message', (ev) => log.push(`[page] ${ev.message}`));
      win.webContents.once('did-finish-load', () => {
        win.showInactive();
        setTimeout(async () => {
          const check = argOf('do');
          if (check === '@gulp') {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
            log.push(`[gulp] boardInSight=${boardInSight(display)}`);
            await gulp(true);
            await wait(430);
            fs.writeFileSync(SHOT.replace(/\.png$/, '-open.png'), (await toast.webContents.capturePage()).toPNG());
            const b = toast.getBounds();
            const a = display.workArea;
            log.push(`[gulp] visible=${toast.isVisible()} focused=${toast.isFocused()} size=${b.width}x${b.height} fromRight=${a.x + a.width - b.x - b.width} fromBottom=${a.y + a.height - b.y - b.height}`);
            await wait(1000);
            log.push(`[gulp] hiddenAfter=${!toast.isVisible()}`);
          } else if (check === '@edge') {
            // 收到屏幕边上：按钮收起、鹈鹕的位置、接东西、点鹈鹕回来并留着、拖东西时临时出来、快捷键、托盘；左右两边各走一遍
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const js = (code) => win.webContents.executeJavaScript(code, true);
            try {
              win.show();
              for (const want of ['left', 'right']) {
                const area = screen.getDisplayMatching(win.getBounds()).workArea;
                const size = win.getBounds();
                win.setBounds({ ...size, x: want === 'right' ? area.x + area.width - size.width : area.x, y: area.y + 40 });
                await wait(200);
                const before = win.getBounds();
                await js(`document.getElementById('b-edge').click()`);
                await wait(700);
                const pb = peek.getBounds();
                const { side } = edgeOf(home);
                const fromEdge = side === 'right' ? area.x + area.width - pb.x - pb.width : pb.x - area.x;
                log.push(`[edge:${want}] button: tucked=${tucked} boardHidden=${!win.isVisible()} peekVisible=${peek.isVisible()} peekFocused=${peek.isFocused()} side=${side} fromEdge=${fromEdge} down=${((pb.y - area.y) / (area.height - pb.height)).toFixed(2)} remembered=${state.tucked}/${state.hideTo}`);
                fs.writeFileSync(SHOT.replace(/\.png$/, `-peek-${want}.png`), (await peek.webContents.capturePage()).toPNG());
                await gulp();
                await wait(430);
                log.push(`[edge:${want}] gulp: cornerToastUsed=${!!toast && toast.isVisible()}`);
                await wait(900);

                // 点鹈鹕：回来并留着，指针在外面多久都不收
                await reveal(true);
                await wait(300);
                const after = win.getBounds();
                const inside = { x: after.x + 50, y: after.y + 50 };
                const outside = { x: want === 'right' ? after.x - 300 : after.x + after.width + 300, y: after.y + 50 };
                await visitTick(inside); await visitTick(outside); await wait(800);
                log.push(`[edge:${want}] click: revealed=${win.isVisible()} peekHidden=${!peek.isVisible()} sameBounds=${['x', 'y', 'width', 'height'].every((k) => Math.abs(after[k] - before[k]) <= 2)} opacity=${win.getOpacity()} remembered=${state.tucked} autoTuck=${await visitTick(outside)} stillOut=${win.isVisible() && !tucked}`);

                // 拖着东西移到鹈鹕上：临时出来，指针进来再离开后收回去
                await tuck(); await wait(300);
                await reveal(false);
                await wait(300);
                log.push(`[edge:${want}] drag: revealed=${win.isVisible()} focused=${win.isFocused()} remembered=${state.tucked} tuckBeforeEntering=${await visitTick(outside)}`);
                await visitTick(inside);
                log.push(`[edge:${want}] drag: tuckAtOnce=${await visitTick(outside)}`);
                await wait(700);
                log.push(`[edge:${want}] drag: tuckLater=${await visitTick(outside)} tucked=${tucked}`);
                await wait(300);

                // 临时出来时开着面板：不收
                await reveal(false); await wait(300);
                await js(`document.getElementById('b-look').click()`);
                await visitTick(inside); await visitTick(outside); await wait(700);
                log.push(`[edge:${want}] drag: tuckWhileGuideOpen=${await visitTick(outside)}`);
                await js(`document.getElementById('b-look').click()`);
                await visitTick(outside); await wait(400);

                // 快捷键：收着时叫出来；正在用时收回边上
                if (!tucked) { await tuck(); await wait(300); }
                toggleWindow(); await wait(500);
                const shown = win.isVisible() && !tucked;
                win.focus(); await wait(200);
                const focused = win.isFocused();
                toggleWindow(); await wait(500);
                log.push(`[edge:${want}] hotkey: shows=${shown} wasFocused=${focused} tucksBack=${tucked}`);

                // 托盘的"显示"；右上角的关闭是收到托盘，鹈鹕也不留，之后快捷键也收到托盘
                showWindow(); await wait(400);
                hideToTray(); await wait(200);
                log.push(`[edge:${want}] tray: board=${win.isVisible()} peekVisible=${peek.isVisible()} remembered=${state.tucked}/${state.hideTo}`);
                showWindow();
                await wait(300);
              }
              // 屏幕缩放不是 100% 时（测试时用 --force-device-scale-factor 模拟），来回收放和上下挪鹈鹕都不能让窗口变大
              {
                const before = win.getBounds();
                for (let n = 0; n < 8; n++) { await tuck(); await wait(60); await reveal(true); await wait(60); }
                const after = win.getBounds();
                await tuck(); await wait(300);
                const area = edgeOf(home).area;
                for (let n = 0; n < 150; n++) movePeek(area.y + 100 + n * 3);
                const pb = peek.getBounds();
                log.push(`[scale] factor=${screen.getPrimaryDisplay().scaleFactor} boardGrew=${after.width - before.width}x${after.height - before.height} boardMoved=${after.x - before.x},${after.y - before.y} peekSize=${pb.width}x${pb.height} peekOffEdge=${area.x + area.width - pb.x - pb.width} peekAt=${state.peekAt.toFixed(2)}`);
                // 两种呼出方式
                state.peekMode = 'click';
                peekSays('hover'); await wait(300);
                const clickModeIgnoresHover = tucked;
                state.peekMode = 'hover';
                peekSays('hover'); await wait(400);
                const b = win.getBounds();
                const opened = win.isVisible() && !win.isFocused() && !!visiting;
                await visitTick({ x: b.x + 40, y: b.y + 40 });
                await visitTick({ x: b.x - 400, y: b.y + 40 }); await wait(700);
                const closed = await visitTick({ x: b.x - 400, y: b.y + 40 });
                log.push(`[mode] clickModeIgnoresHover=${clickModeIgnoresHover} hoverOpens=${opened} leavesAndTucks=${closed} tucked=${tucked}`);
                peekSays('click'); await wait(400);
                log.push(`[mode] hoverModeClickIsAlsoTemporary=${!!visiting}`);
                state.peekMode = 'click';
                await visitTick({ x: b.x + 40, y: b.y + 40 }); await visitTick({ x: b.x - 400, y: b.y + 40 }); await wait(700); await visitTick({ x: b.x - 400, y: b.y + 40 }); await wait(300);
                peekSays('click'); await wait(400);
                log.push(`[mode] clickModeStays=${win.isVisible() && !visiting && !tucked}`);
              }
              // 全屏判断（用假的窗口数据）：全屏的算，最大化的、桌面、自己的窗口、另一块屏幕上的不算
              await tuck(); await wait(300);
              const d = screen.getDisplayMatching(home);
              const phys = screen.dipToScreenRect(null, d.bounds);
              const other = screen.getAllDisplays().find((x) => x.id !== d.id);
              const fake = (extra) => ({ rect: phys, zoomed: false, className: 'Chrome_WidgetWin_1', pid: 1, ...extra });
              log.push(`[full] fullscreen=${fullscreenInFront(fake())} maximized=${fullscreenInFront(fake({ zoomed: true }))} desktop=${fullscreenInFront(fake({ className: 'WorkerW' }))} own=${fullscreenInFront(fake({ pid: process.pid }))} smaller=${fullscreenInFront(fake({ rect: { ...phys, width: phys.width - 200 } }))} otherScreen=${other ? fullscreenInFront(fake({ rect: screen.dipToScreenRect(null, other.bounds) })) : 'n/a'} none=${fullscreenInFront(null)}`);
              duckTick(fake()); await wait(200);
              const hidden = !peek.isVisible();
              duckTick(fake({ zoomed: true })); await wait(400);
              log.push(`[full] pelicanHidesWhenFullscreen=${hidden} comesBack=${peek.isVisible()} realForeground=${JSON.stringify(foregroundWindow())}`);
              await reveal(true); await wait(300);
            } catch (err) {
              log.push(`[error] ${err.stack}`);
            }
          } else if (check === '@full') {
            // 真的全屏窗口（由测试脚本另外启动一个全屏窗口）：等鹈鹕躲起来，再等它回来
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            try {
              win.show();
              await tuck(); await wait(500);
              log.push(`[full] start: peekVisible=${peek.isVisible()}`);
              let hidAt = -1, backAt = -1, seen = '';
              for (let i = 0; i < 80; i++) {
                duckTick();
                await wait(200);
                if (hidAt < 0 && !peek.isVisible()) { hidAt = i; seen = JSON.stringify(foregroundWindow()); }
                if (hidAt >= 0 && peek.isVisible()) { backAt = i; break; }
              }
              log.push(`[full] hidAfter=${hidAt < 0 ? 'never' : `${hidAt * 0.2}s`} backAfter=${backAt < 0 ? 'never' : `${backAt * 0.2}s`} fullscreenWindow=${seen}`);
              await reveal(true); await wait(300);
            } catch (err) {
              log.push(`[error] ${err.stack}`);
            }
          } else if (check === '@login') {
            // 开机自启：打开后注册表里应该多出名为 TossIn 的一项，关掉后消失（只在打包后的程序里有意义）
            const { execSync } = require('child_process');
            const query = () => { try { return execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v TossIn', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/).pop().trim(); } catch { return '(none)'; } };
            log.push(`[login] packaged=${app.isPackaged} before=${query()}`);
            app.setLoginItemSettings({ ...loginOptions(), openAtLogin: true });
            log.push(`[login] on: reads=${opensAtLogin()} registry=${query()}`);
            app.setLoginItemSettings({ ...loginOptions(), openAtLogin: false });
            log.push(`[login] off: reads=${opensAtLogin()} registry=${query()}`);
          } else if (check === '@file') {
            // 剪贴板里是文件时（由测试脚本事先放好），收进来的应该是文件条目
            const got = await captureClipboard();
            log.push(`[file] ${JSON.stringify(got.map((it) => [it.type, it.path ? path.basename(it.path) : it.file]))}`);
          } else if (check === '@clip') {
            // 真实的复制粘贴往返：会短暂占用系统剪贴板，结束后尽量恢复原内容
            try {
              const js = (code) => win.webContents.executeJavaScript(code, true);
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const pressPaste = async () => {
                win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] });
                win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] });
                await wait(900);
              };
              const typesNow = async () => (await clipboard.read()).flatMap((entry) => entry.types);
              const grab = async (type) => {
                for (const entry of await clipboard.read()) {
                  if (entry.types.includes(type)) return Buffer.from(await (await entry.getType(type)).arrayBuffer());
                }
                return null;
              };

              const before = await typesNow();
              const savedPng = before.includes('image/png') ? await grab('image/png') : null;
              const savedText = before.includes('text/plain') ? await clipboard.readText() : null;
              log.push(`[clip] 原有格式: ${before.join(', ') || '(空)'}`);

              win.show(); win.focus(); win.webContents.focus();
              const count = () => items.length;

              // 1. 点击文字 → 剪贴板里应该是这段文字
              const textItem = items.find((it) => it.type === 'text');
              await js(`window.yw.copy(${JSON.stringify(textItem.id)})`);
              log.push(`[clip] 复制文字: ${(await clipboard.readText()) === textItem.text ? '通过' : '失败'}`);

              // 2. 点击图片 → 剪贴板里应该有图片
              const imageItem = items.find((it) => it.type === 'image');
              await js(`window.yw.copy(${JSON.stringify(imageItem.id)})`);
              const png = await grab('image/png');
              log.push(`[clip] 复制图片: ${png && png.length > 100 ? '通过' : '失败'} (${png ? png.length : 0} 字节)`);

              // 3. 剪贴板里是图片时按 Ctrl+V → 应多出一张图
              let n = count();
              await pressPaste();
              log.push(`[clip] 粘贴图片: ${count() === n + 1 && items[items.length - 1].type === 'image' ? '通过' : '失败'}`);

              // 4. 剪贴板里是文字时按 Ctrl+V → 应多出一条文字
              await clipboard.writeText('粘贴测试 paste-check');
              n = count();
              await pressPaste();
              log.push(`[clip] 粘贴文字: ${count() === n + 1 && items[items.length - 1].text === '粘贴测试 paste-check' ? '通过' : '失败'}`);

              // 5. 剪贴板里是网址时 → 应成为链接
              await clipboard.writeText('https://example.com/some/page');
              n = count();
              await pressPaste();
              const last = items[items.length - 1];
              log.push(`[clip] 粘贴网址: ${count() === n + 1 && last.type === 'link' ? '通过' : '失败'}`);

              // 6. 全局快捷键走的同一个函数
              await clipboard.writeText('快捷键测试 hotkey-check');
              const viaHotkey = await captureClipboard();
              log.push(`[clip] 快捷键路径: ${viaHotkey.length === 1 && viaHotkey[0].text === '快捷键测试 hotkey-check' ? '通过' : '失败'}`);

              // 7. 一起复制：两条文字各占一行；两张图片是两个文件
              const texts = items.filter((it) => it.type === 'text').slice(0, 2);
              await js(`window.yw.copyMany(${JSON.stringify(texts.map((it) => it.id))})`);
              const lines = (s) => s.split(/\r?\n/).filter(Boolean);
              log.push(`[clip] 一起复制文字: ${lines(await clipboard.readText()).join('|') === texts.map((it) => it.text).join('|') ? '通过' : '失败'}`);
              const images = items.filter((it) => it.type === 'image').slice(0, 2);
              const copied = await js(`window.yw.copyMany(${JSON.stringify(images.map((it) => it.id))})`);
              const uriList = await grab('text/uri-list');
              const fileCount = uriList ? lines(uriList.toString('utf8')).filter((l) => /^file:/i.test(l)).length : 0;
              log.push(`[clip] 一起复制图片: ${copied.length === 2 && fileCount === 2 ? '通过' : '失败'} (${fileCount} 个文件)`);

              // 恢复原来的剪贴板
              if (savedPng) await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(savedPng)], { type: 'image/png' }) })]);
              else if (savedText !== null) await clipboard.writeText(savedText);
              else clipboard.clear();
              log.push(`[clip] 已恢复剪贴板: ${savedPng ? '图片' : savedText !== null ? '文字' : '清空'}`);
            } catch (err) {
              log.push(`[error] ${err.stack}`);
            }
          } else if (check) {
            try {
              const result = await win.webContents.executeJavaScript(require('./dev/checks')[check], true);
              log.push(`[result] ${JSON.stringify(result, null, 1)}`);
            } catch (err) {
              log.push(`[error] ${err.message}`);
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
          try {
            fs.writeFileSync(SHOT, (await win.webContents.capturePage()).toPNG());
          } catch (err) {
            log.push(`[shot] ${err.message}`); // 看板收着的时候截不了图
          }
          fs.writeFileSync(`${SHOT}.log`, log.join('\n'));
          quitting = true;
          app.quit();
        }, 1500);
      });
    }
  });

  // ---------- 界面调用 ----------

  ipcMain.handle('init', () => {
    // 第一次打开时展示一次说明
    const firstRun = !state.seenGuide && (!TEST_DIR || !!argOf('guide'));
    if (firstRun) { state.seenGuide = true; saveState(); }
    return {
      items,
      zoom: state.zoom || 1,
      level: state.level || 'normal',
      theme: themeOf(),
      lang: langOf(),
      hotkeys: hotkeyInfo(),
      peekMode: peekMode(),
      update,
      version: app.getVersion().split('.').slice(0, 2).join('.'),
      firstRun,
      imageBase: pathToFileURL(IMG).href + '/',
    };
  });
  ipcMain.handle('capture', () => captureClipboard());
  ipcMain.handle('addText', (_e, text) => addText(text));
  ipcMain.handle('addTexts', (_e, text, html) => addTexts(text, html));
  ipcMain.handle('addPaths', (_e, paths) => (paths || []).map(addPath).filter(Boolean));
  ipcMain.handle('addImageUrl', (_e, url) => addImageUrl(String(url)));

  const EDITABLE = ['text', 'html', 'title', 'pin', 'sunk', 'sunkAt', 'touched', 'uses', 'w', 'h', 'scale'];
  ipcMain.handle('update', (_e, id, patch) => {
    const it = byId(id);
    if (!it) return null;
    for (const key of EDITABLE) {
      if (!(key in patch)) continue;
      if (patch[key] === null) delete it[key];
      else it[key] = patch[key];
    }
    saveItems();
    return it;
  });
  ipcMain.handle('remove', (_e, id) => removeItem(id));

  // 删除先进回收区，几秒内可以撤销；清空时才真正删掉图片文件
  ipcMain.handle('trash', (_e, ids) => {
    for (const id of ids || []) {
      const i = items.findIndex((it) => it.id === id);
      if (i >= 0) trash.push(...items.splice(i, 1));
    }
    saveItems();
    return true;
  });
  ipcMain.handle('untrash', () => {
    const back = trash;
    trash = [];
    items.push(...back);
    saveItems();
    return back;
  });
  ipcMain.handle('emptyTrash', () => emptyTrash());
  // 按编号取回、或彻底清掉回收区里的条目（撤销历史用）
  ipcMain.handle('restore', (_e, ids) => {
    const back = [];
    for (const id of ids || []) {
      const i = trash.findIndex((it) => it.id === id);
      if (i >= 0) back.push(...trash.splice(i, 1));
    }
    items.push(...back);
    saveItems();
    return back;
  });
  ipcMain.handle('discard', (_e, ids) => {
    for (const id of ids || []) {
      const i = trash.findIndex((it) => it.id === id);
      if (i < 0) continue;
      const [it] = trash.splice(i, 1);
      if (it.type === 'image') { try { fs.unlinkSync(imagePath(it)); } catch {} }
    }
    return true;
  });

  ipcMain.handle('copy', async (_e, id) => {
    const it = byId(id);
    if (!it) return false;
    if (TEST_DIR && argOf('do') !== '@clip') return true; // 界面测试时不动真实剪贴板
    await copyItem(it);
    return true;
  });
  // 一起复制。选的全是文件（或多张图片）时，复制的是文件本身，可以直接粘贴到聊天窗口或文件夹里；
  // 其余情况复制文字：文字、网址、文件路径各占一行，图片跳过。返回真正复制了的条目
  ipcMain.handle('copyMany', async (_e, ids) => {
    const list = (ids || []).map(byId).filter(Boolean);
    if (!list.length) return [];
    const real = !TEST_DIR || argOf('do') === '@clip'; // 界面测试时不动真实剪贴板
    const fileOf = (it) => (it.type === 'image' ? imagePath(it) : it.type === 'file' ? it.path : '');
    if (list.length === 1 && list[0].type !== 'file') {
      if (real) await copyItem(list[0]);
      return [list[0].id];
    }
    if (list.every(fileOf)) {
      const found = list.filter((it) => fs.existsSync(fileOf(it)));
      if (!found.length) return [];
      const uris = found.map((it) => pathToFileURL(fileOf(it)).href).join('\r\n');
      if (real) await clipboard.write([new ClipboardItem({ 'text/uri-list': new Blob([uris], { type: 'text/uri-list' }) })]);
      return found.map((it) => it.id);
    }
    const texts = list.filter((it) => it.type !== 'image');
    if (real) await clipboard.writeText(texts.map((it) => (it.type === 'link' ? it.url : it.type === 'file' ? it.path : it.text)).join('\n'));
    return texts.map((it) => it.id);
  });
  ipcMain.handle('open', (_e, id) => {
    const it = byId(id);
    if (!it) return false;
    if (it.type === 'link' && /^https?:\/\//i.test(it.url)) shell.openExternal(it.url);
    else if (it.type === 'file') {
      if (!fs.existsSync(it.path)) return false; // 文件被移走或删掉了
      if (!TEST_DIR) shell.openPath(it.path);
    } else if (it.type === 'image') shell.openPath(imagePath(it));
    return true;
  });
  ipcMain.on('drag', (e, id) => {
    const it = byId(id);
    if (!it || (it.type !== 'image' && it.type !== 'file')) return;
    const file = it.type === 'image' ? imagePath(it) : it.path;
    if (!fs.existsSync(file)) return;
    let icon = it.type === 'image' ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
    icon = icon.isEmpty() ? nativeImage.createFromPath(APP_ICON).resize({ width: 32 }) : icon.resize({ width: 96 });
    e.sender.startDrag({ file, icon });
  });
  ipcMain.handle('win', (_e, action) => {
    if (action === 'min') win.minimize();
    else if (action === 'hide') hideToTray();
    else if (action === 'tuck') tuck();
    else if (action === 'top') setLevel(state.level === 'top' ? 'normal' : 'top');
    return state.level || 'normal';
  });
  ipcMain.on('setTheme', (_e, name) => {
    if (!THEME_BG[name]) return;
    state.theme = name;
    saveState();
    win.setBackgroundColor(bgColor());
  });
  ipcMain.on('setLang', (_e, lang) => {
    if (!TEXT[lang]) return;
    state.lang = lang;
    saveState();
    win.setTitle(tr('name'));
    refreshTray();
  });

  // 边上的鹈鹕说了什么。呼出方式有两种，在面板里选：
  //   click（默认）：点一下，看板回来并一直留着，要自己点按钮才收回去
  //   hover：指针移上去看板就出来，离开看板后自己收回去
  // 两种方式下，拖着东西移到鹈鹕上都是临时出来接一下；按住上下拖是挪它的位置
  ipcMain.on('peek', (e, what) => {
    if (!peek || peek.isDestroyed() || e.sender !== peek.webContents) return;
    peekSays(what);
  });
  ipcMain.on('setPeekMode', (_e, mode) => {
    if (mode !== 'click' && mode !== 'hover') return;
    state.peekMode = mode;
    saveState();
  });

  // 录制新快捷键时先把现有的全放开，不然按下旧组合会直接触发
  ipcMain.on('hotkeyRecording', (_e, on) => {
    if (!HOTKEYS_ON) return;
    if (on) globalShortcut.unregisterAll();
    else registerHotkeys();
  });
  ipcMain.handle('setHotkey', (_e, which, accel) => {
    if (!DEFAULT_HOTKEYS[which] || !VALID_HOTKEY.test(String(accel))) return { ok: false, reason: 'invalid', hotkeys: hotkeyInfo() };
    const conflict = hotkeyConflict(which, accel);
    if (conflict) return { ok: false, ...conflict, hotkeys: hotkeyInfo() };
    if (HOTKEYS_ON) {
      // 先试着注册一下：注册不上说明被别的程序占着，保留原来的
      globalShortcut.unregisterAll();
      if (!tryRegister(accel, hotkeyActions[which])) {
        registerHotkeys();
        return { ok: false, reason: 'taken', hotkeys: hotkeyInfo() };
      }
    }
    state.hotkeys = { ...state.hotkeys, [which]: accel };
    saveState();
    registerHotkeys();
    return { ok: true, hotkeys: hotkeyInfo() };
  });

  ipcMain.on('openUpdate', () => { if (update && !TEST_DIR) shell.openExternal(update.url); });
  ipcMain.on('openData', () => { if (!TEST_DIR) shell.openPath(DATA); });
  // 作者主页：地址写死在这里，界面不能让它打开别的网址
  ipcMain.on('openAuthor', () => { if (!TEST_DIR) shell.openExternal('https://github.com/Kunhan-Gao'); });
  ipcMain.on('setZoom', (_e, z) => {
    if (typeof z === 'number' && z > 0.3 && z < 4) { state.zoom = z; saveState(); }
  });
}
