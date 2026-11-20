// 查一下"现在最前面的窗口"是哪个、多大。看板收在屏幕边上时，如果前面是一个全屏的窗口
// （看视频、放幻灯片、打游戏），边上的鹈鹕要先躲起来。
// 只在 Windows 上有效；系统接口调不了时返回 null，调用方当作"不是全屏"处理。
let api = null;

function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    api = {
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void* hwnd, _Out_ RECT* rect)'),
      IsZoomed: user32.func('bool __stdcall IsZoomed(void* hwnd)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(void* hwnd, void* name, int max)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)'),
    };
  } catch {
    api = false;
  }
  return api;
}

// 返回 { rect: {x, y, width, height}（屏幕像素）, zoomed（是否最大化）, className, pid }，拿不到时返回 null
function foregroundWindow() {
  const lib = load();
  if (!lib) return null;
  try {
    const hwnd = lib.GetForegroundWindow();
    if (!hwnd) return null;
    const rect = {};
    if (!lib.GetWindowRect(hwnd, rect)) return null;
    const name = Buffer.alloc(512);
    const length = lib.GetClassNameW(hwnd, name, 256);
    const pid = [0];
    lib.GetWindowThreadProcessId(hwnd, pid);
    return {
      rect: { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top },
      zoomed: lib.IsZoomed(hwnd),
      className: name.toString('utf16le', 0, Math.max(0, length) * 2),
      pid: pid[0],
    };
  } catch {
    return null;
  }
}

module.exports = { foregroundWindow };
