// 演示视频的时间表（秒）。画面（stage.js）和声音（audio.html）都按这一份走，所以音效能卡在动作发生的那一帧。
// 段落的切点都落在半秒上：音乐是每分钟 120 拍，半秒正好一拍。
const FPS = 30;
const DURATION = 40;

const T = {
  // 开头：三句提问各 1.5 秒，然后鹈鹕把三样东西一口接住
  questions: [0, 1.5, 3.0, 4.5],
  fly: [4.5, 4.65, 4.8],
  birdRise: [3.6, 4.1], birdOpen: [4.15, 4.45], birdClose: [5.3, 5.5], birdNod: [5.5, 5.8],
  title: [5.0, 5.4], hookOut: [5.75, 6.0],

  deskIn: [5.85, 6.3], deskOut: [35.8, 36.15],
  // 字幕：[出现, 第二行亮起, 消失]
  cues: [[6.0, 13.7, 15.0], [15.0, 16.6, 19.0], [19.0, 21.4, 23.0], [23.0, 29.2, 31.0], [31.0, 32.6, 35.9]],
  keys: [
    { t0: 6.9, t1: 8.8, keys: ['Ctrl', 'V'], hint: 'paste', press: 7.5 },
    { t0: 9.0, t1: 11.2, keys: [], hint: 'drag' },
    { t0: 12.0, t1: 13.7, keys: ['Ctrl', 'Alt', 'V'], hint: 'hot', press: 12.6 },
    { t0: 18.1, t1: 19.0, keys: ['Ctrl', 'V'], hint: 'paste', press: 18.5 },
  ],
  others: [
    { t0: 11.5, t1: 13.6, mode: 'note' },
    { t0: 17.0, t1: 22.4, mode: 'memo' },
    { t0: 30.9, t1: 99, mode: 'memo', behind: true },
  ],
  pasted: 18.5, slotOver: [20.9, 21.4], slotFilled: 21.4,
  ghosts: [{ t0: 9.1, t1: 10.3, kind: 'file' }, { t0: 20.3, t1: 21.4, kind: 'image' }],
  cursor: [[9.1, 10.7], [15.3, 22.3], [31.3, 35.3]],
  clicks: [16.4, 18.1, 20.3, 21.4, 32.3, 34.5],
  glows: [{ t0: 7.5, what: 'image' }, { t0: 10.3, what: 'file' }, { t0: 12.6, what: 'code' }, { t0: 29.3, what: 'door' }],
  warp: [24.0, 29.0], warpDays: 8.4, days: [23.6, 30.6],
  tuck: [32.3, 32.65], reveal: [34.5, 34.85], peekIn: [32.55, 32.8], peekHover: [34.1, 34.3],
  end: 36.05,
};

module.exports = { FPS, DURATION, T };
