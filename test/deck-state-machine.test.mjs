// ============================================================================
// 🧠 Test Suite 2: 雙軌 PPT (PGM/PVW) 無縫切換、頁內動畫步進與影片池狀態機單元測試
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { DeckStateMachine, DECK_ACTIONS } from '../src/core/deck-state-machine.mjs';

const samplePptPool = [
  {
    id: '01_Main',
    fileName: '01_Main.pptx',
    title: '01 主講簡報',
    slideCount: 3,
    slides: [
      { index: 1, clickCount: 2, previewUrl: '/previews/01_Main/slide-1.png' },
      { index: 2, clickCount: 1, previewUrl: '/previews/01_Main/slide-2.png' },
      { index: 3, clickCount: 0, previewUrl: '/previews/01_Main/slide-3.png' }
    ]
  },
  {
    id: '02_Sub',
    fileName: '02_Sub.pptx',
    title: '02 互動提問簡報',
    slideCount: 3,
    slides: [
      { index: 1, clickCount: 1, previewUrl: '/previews/02_Sub/slide-1.png' },
      { index: 2, clickCount: 0, previewUrl: '/previews/02_Sub/slide-2.png' },
      { index: 3, clickCount: 0, previewUrl: '/previews/02_Sub/slide-3.png' }
    ]
  }
];

const sampleVideoPool = [
  { id: '01_前行緣念', fileName: '01_前行緣念.mp4', title: '前行緣念', sizeMB: 9.8, url: '/videos/01_前行緣念.mp4' }
];

test('[State-1] 初始雙槽位載入與頁內分段動畫步進 (情況 2 支援)', () => {
  const sm = new DeckStateMachine({ pptPool: samplePptPool, videoPool: sampleVideoPool });
  let s = sm.getState();

  assert.equal(s.pgm.deckId, '01_Main');
  assert.equal(s.pvw.deckId, '02_Sub');
  assert.equal(s.pgm.currentSlide, 1);
  assert.equal(s.pgm.clickIndex, 0);
  assert.equal(s.pgm.clickCount, 2);

  // 第 1 頁有 2 個動畫步驟，按兩次 PGM_NEXT 應推進 clickIndex 1 -> 2，第 3 次才翻到第 2 頁
  s = sm.dispatch(DECK_ACTIONS.PGM_NEXT);
  assert.equal(s.pgm.currentSlide, 1);
  assert.equal(s.pgm.clickIndex, 1);

  s = sm.dispatch(DECK_ACTIONS.PGM_NEXT);
  assert.equal(s.pgm.currentSlide, 1);
  assert.equal(s.pgm.clickIndex, 2);

  s = sm.dispatch(DECK_ACTIONS.PGM_NEXT);
  assert.equal(s.pgm.currentSlide, 2);
  assert.equal(s.pgm.clickIndex, 0);
  assert.equal(s.pgm.clickCount, 1);
});

test('[State-2] 預覽槽 (PVW) 獨立翻頁與 CUT_SWAP 雙 PPT 無縫互切', () => {
  const sm = new DeckStateMachine({ pptPool: samplePptPool, videoPool: sampleVideoPool });

  // 先在預覽區將第 2 份 PPT 翻到第 2 頁待命，不影響正在播出的第 1 份 PPT
  sm.dispatch(DECK_ACTIONS.PVW_NEXT); // 動畫 0 -> 1
  let s = sm.dispatch(DECK_ACTIONS.PVW_NEXT); // 翻到第 2 頁
  assert.equal(s.pvw.deckId, '02_Sub');
  assert.equal(s.pvw.currentSlide, 2);
  assert.equal(s.pgm.deckId, '01_Main');
  assert.equal(s.pgm.currentSlide, 1);

  // 按下 CUT_SWAP 無縫切換上台
  s = sm.dispatch(DECK_ACTIONS.CUT_SWAP);
  assert.equal(s.pgm.deckId, '02_Sub');
  assert.equal(s.pgm.currentSlide, 2);
  assert.equal(s.pvw.deckId, '01_Main');
  assert.equal(s.pvw.currentSlide, 1);
});

test('[State-3] 影片池全螢幕插播與播畢 (VIDEO_ENDED) 自動無縫切回當前 PPT', () => {
  const sm = new DeckStateMachine({ pptPool: samplePptPool, videoPool: sampleVideoPool });
  sm.dispatch(DECK_ACTIONS.PGM_GOTO, { slide: 3 });

  let s = sm.dispatch(DECK_ACTIONS.PLAY_VIDEO, { videoId: '01_前行緣念' });
  assert.equal(s.outputMode, 'video');
  assert.equal(s.activeVideo.id, '01_前行緣念');
  assert.equal(s.pgm.currentSlide, 3, '播放影片期間應完整保留當前 PPT 頁碼');

  // 影片播畢自動切回 PPT 第 3 頁
  s = sm.dispatch(DECK_ACTIONS.VIDEO_ENDED);
  assert.equal(s.outputMode, 'ppt');
  assert.equal(s.activeVideo, null);
  assert.equal(s.pgm.currentSlide, 3);
});

