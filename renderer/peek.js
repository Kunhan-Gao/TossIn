// 屏幕边上的小鹈鹕。主进程调用 setup 换外观和左右，调用 gulp 让它"接一口"。
const root = document.documentElement;
const tab = document.getElementById('tab');

window.setup = function setup(theme, side) {
  root.dataset.theme = theme;
  root.dataset.side = side;
};
window.gulp = function gulp() {
  root.classList.remove('go');
  void root.offsetWidth; // 让浏览器先应用"没有动画"的状态，动画才会重新开始
  root.classList.add('go');
  clearTimeout(gulp.timer);
  gulp.timer = setTimeout(() => root.classList.remove('go'), 1150);
};

// 点一下把看板叫回来。指针停在上面一小会儿也会告诉主进程一声：
// 只有在面板里选了"悬停呼出"时，主进程才会因此把看板叫出来（停一小会儿是免得路过屏幕边就弹出来）
let hoverTimer = null;
let press = null; // 按下时的位置；按住上下拖是挪鹈鹕的位置，没拖就是点击
tab.addEventListener('pointerenter', () => {
  if (press) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => window.yw.peek('hover'), 220);
});
tab.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
tab.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  clearTimeout(hoverTimer);
  press = { y: e.screenY, moved: false };
  tab.setPointerCapture(e.pointerId);
});
tab.addEventListener('pointermove', (e) => {
  if (!press) return;
  if (!press.moved && Math.abs(e.screenY - press.y) < 5) return;
  press.moved = true;
  window.yw.peek('move');
});
tab.addEventListener('pointerup', () => {
  if (!press) return;
  window.yw.peek(press.moved ? 'moved' : 'click');
  press = null;
});
tab.addEventListener('pointercancel', () => { press = null; });

// 拖着东西移到鹈鹕上：看板临时出来，接着就能放进去
for (const type of ['dragenter', 'dragover']) {
  window.addEventListener(type, (e) => { e.preventDefault(); window.yw.peek('drag'); });
}
