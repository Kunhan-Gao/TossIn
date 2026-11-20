// 由主进程调用：换成当前外观的颜色，然后把"接住"的动作从头放一遍
window.play = function play(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.remove('go');
  void root.offsetWidth; // 让浏览器先应用"没有动画"的状态，动画才会重新开始
  root.classList.add('go');
};
