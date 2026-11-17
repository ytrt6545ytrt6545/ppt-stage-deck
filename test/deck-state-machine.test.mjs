// ============================================================================
// 🧠 Test Suite 2: 雙軌 PPT (PGM/PVW) 無縫切換、頁內動畫步進與多媒體流程狀態機單元測試
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeckStateMachine, DECK_ACTIONS } from '../src/core/deck-state-machine.mjs';
import { MediaPoolManager } from '../src/core/media-pool-manager.mjs';
import { createPptStageServer } from '../server.mjs';

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

const sampleImagePool = [
  { id: 'welcome', fileName: 'welcome.jpg', title: '活動歡迎主視覺', sizeKB: 320, url: '/images/welcome.jpg' }
];

const sampleAudioPool = [
  { id: 'bgm-calm', fileName: 'calm.mp3', title: '前行柔和音樂', sizeMB: 4.2, url: '/audios/calm.mp3' }
];

test('[State-0] (長官鐵律) 現場伺服器建構狀態機 (cleanColdBoot) 時，PGM 與 PVW 必須 100% 絕對純淨空白（空槽待命 STANDBY）', () => {
  const sm = new DeckStateMachine({ cleanColdBoot: true, pptPool: samplePptPool, videoPool: sampleVideoPool });
  const s = sm.getState();

  assert.equal(s.pgm.deckId, null, 'PGM 預設不得自動綁定任何簡報素材');
  assert.equal(s.pgm.type, 'empty', 'PGM 預設必須為 empty 空槽');
  assert.equal(s.pvw.deckId, null, 'Preview 預設不得自動綁定任何簡報素材');
  assert.equal(s.pvw.type, 'empty', 'Preview 預設必須為 empty 空槽');
  assert.equal(s.outputMode, 'empty');
});

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

test('[State-4] (A+B+C) 影片上 PVW 預覽 (靜音) + 時間點拖曳 + CUT_SWAP 接續起播閉環', () => {
  const sm = new DeckStateMachine({ pptPool: samplePptPool, videoPool: sampleVideoPool });

  // 1. 將影片載入 PVW 預覽
  let s = sm.dispatch(DECK_ACTIONS.LOAD_PVW_VIDEO, { videoId: '01_前行緣念', currentTime: 15.5 });
  assert.ok(s.pvwVideo, 'pvwVideo 必須存在');
  assert.equal(s.pvwVideo.id, '01_前行緣念');
  assert.equal(s.pvwVideo.currentTime, 15.5);
  assert.equal(s.pvwVideo.muted, true, '預覽影片必須強制標記 muted: true');
  assert.equal(s.outputMode, 'ppt', '預覽影片時，PGM 放映端應不受干擾維持 PPT');

  // 2. 調整預覽進度時間點
  s = sm.dispatch(DECK_ACTIONS.SEEK_PVW_VIDEO, { currentTime: 28.0 });
  assert.equal(s.pvwVideo.currentTime, 28.0);

  // 3. 按下 CUT_SWAP 將預覽影片推上 PGM (第二螢幕)，並從 28.0 秒接續播放
  s = sm.dispatch(DECK_ACTIONS.CUT_SWAP);
  assert.equal(s.outputMode, 'video');
  assert.ok(s.activeVideo);
  assert.equal(s.activeVideo.id, '01_前行緣念');
  assert.equal(s.activeVideo.startTime, 28.0, '起播秒數必須精準等於剛才在 PVW 預覽的時間點');
  assert.equal(s.activeVideo.muted, false, '推上 PGM 播出必須解除靜音 (muted: false)');
  assert.equal(s.pvwVideo, null, 'CUT 上台後 PVW 影片預覽自動清空');
});

test('[State-4B] (長官鐵律) 影片在 PGM 播出時按 CUT_SWAP：原影片必須優雅退回 PVW 槽位停格待命，絕對不得憑空消失！', () => {
  const sm = new DeckStateMachine({ pptPool: samplePptPool, videoPool: sampleVideoPool });

  // 1. PGM 正在播出影片，進度播至第 45.2 秒
  sm.dispatch(DECK_ACTIONS.PLAY_VIDEO, { videoId: '01_前行緣念' });
  sm.dispatch(DECK_ACTIONS.SEEK_PGM_VIDEO, { currentTime: 45.2 });

  // 2. PVW 準備了另一份簡報 (02_Sub 第 2 頁)
  sm.dispatch(DECK_ACTIONS.LOAD_PVW, { deckId: '02_Sub', slide: 2 });

  // 3. 現場按下 CUT_SWAP：進行雙向對調！
  let s = sm.dispatch(DECK_ACTIONS.CUT_SWAP, { pgmCurrentTime: 45.2 });

  // 斷言 PGM 成功接手 PPT 播出
  assert.equal(s.outputMode, 'ppt', 'PGM 應無縫接手顯示 PPT');
  assert.equal(s.pgm.deckId, '02_Sub');
  assert.equal(s.pgm.currentSlide, 2);
  assert.equal(s.activeVideo, null, 'PGM 不再是影片模式');

  // 斷言原影片被優雅移入 PVW 槽位停格待命，秒數 100% 保持，絕不丟失！
  assert.ok(s.pvwVideo, '原 PGM 影片必須被收回 PVW 槽位，絕對不能消失！');
  assert.equal(s.pvwVideo.id, '01_前行緣念');
  assert.equal(s.pvwVideo.currentTime, 45.2, '影片秒數必須保留在 45.2 秒');
  assert.equal(s.pvwVideo.muted, true, '退回 PVW 必須維持靜音');
  assert.equal(s.pvwVideo.isPlaying, false, '退回 PVW 必須原地停格');

  // 4. 再次按下 CUT_SWAP：影片再從 45.2 秒無縫推回 PGM，PPT 退回 PVW！
  s = sm.dispatch(DECK_ACTIONS.CUT_SWAP);
  assert.equal(s.outputMode, 'video', '再次 CUT 影片成功回歸 PGM');
  assert.ok(s.activeVideo);
  assert.equal(s.activeVideo.id, '01_前行緣念');
  assert.equal(s.activeVideo.startTime, 45.2, '從 45.2 秒接續起播');
  assert.equal(s.pvw.deckId, '02_Sub', 'PPT 再次退回 PVW');
});

test('[State-5] 主視覺底圖 (Key Visual) 載入、覆蓋層級與 TOGGLE_KV_MODE 切換閉環', () => {
  const sm = new DeckStateMachine({
    pptPool: samplePptPool,
    videoPool: sampleVideoPool,
    keyVisualUrl: '/key-visual/default-stage.png'
  });

  let s = sm.getState();
  assert.equal(s.keyVisualUrl, '/key-visual/default-stage.png');
  assert.equal(s.outputMode, 'ppt', '初始有 PPT 時預設為 ppt 模式');

  // 1. 切換至純主視覺展示 (TOGGLE_KV_MODE)
  s = sm.dispatch(DECK_ACTIONS.TOGGLE_KV_MODE);
  assert.equal(s.outputMode, 'kv', '切換為 kv 模式，延伸螢幕隱藏 PPT 露出主視覺底圖');

  // 2. 在 KV 模式下插播影片：影片覆蓋在最上層
  s = sm.dispatch(DECK_ACTIONS.PLAY_VIDEO, { videoId: '01_前行緣念' });
  assert.equal(s.outputMode, 'video');
  assert.ok(s.activeVideo);

  // 3. 影片停止：自動回復到 PPT 或主視覺底圖
  s = sm.dispatch(DECK_ACTIONS.STOP_VIDEO);
  assert.equal(s.outputMode, 'ppt');

  // 4. 設定新主視覺底圖
  s = sm.dispatch(DECK_ACTIONS.SET_KEY_VISUAL, { url: '/key-visual/event-2026.png' });
  assert.equal(s.keyVisualUrl, '/key-visual/event-2026.png');

  // 5. 清除主視覺底圖
  s = sm.dispatch(DECK_ACTIONS.CLEAR_KEY_VISUAL);
  assert.equal(s.keyVisualUrl, null);
});

test('[State-6] (新思維) 冷啟動開機初始雙空槽 (STANDBY) ＋ 萬能多媒體預覽與播出閉環', () => {
  // 冷啟動：PGM 與 PVW 皆為空槽
  const sm = new DeckStateMachine({
    cleanColdBoot: true,
    pptPool: samplePptPool,
    videoPool: sampleVideoPool,
    imagePool: sampleImagePool,
    audioPool: sampleAudioPool,
    keyVisualUrl: '/key-visual/default-stage.png'
  });

  let s = sm.getState();
  assert.equal(s.pgm.deckId, null);
  assert.equal(s.pgm.type, 'empty');
  assert.equal(s.pvw.deckId, null);
  assert.equal(s.pvw.type, 'empty');
  assert.equal(s.outputMode, 'kv', '初始無任何素材且有 KV 時，第二螢幕乾淨展示主視覺');

  // 1. 從佇列中將圖片送至預覽 (PVW)
  s = sm.dispatch(DECK_ACTIONS.LOAD_MEDIA_PVW, { mediaId: 'welcome', type: 'image' });
  assert.equal(s.pvwMedia.type, 'image');
  assert.equal(s.pvwMedia.id, 'welcome');
  assert.equal(s.outputMode, 'kv', 'PVW 預覽不應干擾第二螢幕展示');

  // 2. 按下 CUT_SWAP 將圖片登上第二螢幕 (PGM)
  s = sm.dispatch(DECK_ACTIONS.CUT_SWAP);
  assert.equal(s.outputMode, 'image');
  assert.equal(s.activeMedia.id, 'welcome');
  assert.equal(s.pvwMedia, null);

  // 3. 將音訊直接播出 (PLAY_MEDIA_PGM)
  s = sm.dispatch(DECK_ACTIONS.PLAY_MEDIA_PGM, { mediaId: 'bgm-calm', type: 'audio' });
  assert.equal(s.outputMode, 'audio');
  assert.equal(s.activeMedia.id, 'bgm-calm');
  assert.equal(s.activeMedia.muted, false, 'PGM 播出之音訊必須發出聲音');

  // 4. 將 PPT 送至預覽 (PVW) 並翻到第 2 頁
  s = sm.dispatch(DECK_ACTIONS.LOAD_PVW, { deckId: '01_Main', slide: 2 });
  assert.equal(s.pvw.deckId, '01_Main');
  assert.equal(s.pvw.currentSlide, 2);

  // 5. 按下 CUT_SWAP 切換簡報登台
  s = sm.dispatch(DECK_ACTIONS.CUT_SWAP);
  assert.equal(s.outputMode, 'ppt');
  assert.equal(s.pgm.deckId, '01_Main');
  assert.equal(s.pgm.currentSlide, 2);
});

test('[State-7] (Bug 修復防回歸) PPT 在 PGM (含 _live_pgm.png) 退回 PVW 預覽待命時（無論與空槽 KV 或影片 CUT 交換），PVW 必須保有標準靜態預覽圖 URL，嚴禁被隱藏視窗之全黑快照覆蓋', () => {
  const sm = new DeckStateMachine({
    cleanColdBoot: true,
    pptPool: samplePptPool,
    videoPool: sampleVideoPool,
    keyVisualUrl: '/key-visual/default-stage.png'
  });

  // 1. 將 PPT 載入 PGM 並翻至第 2 頁，且模擬底層 COM 回報 _live_pgm.png
  sm.dispatch(DECK_ACTIONS.LOAD_PGM, { deckId: '01_Main', slide: 2 });
  sm.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, {
    slot: 'pgm',
    deckId: '01_Main',
    currentSlide: 2,
    totalSlides: 3,
    clickIndex: 1,
    clickCount: 1,
    livePreviewUrl: '/previews/_live_pgm.png?t=1001'
  });
  assert.equal(sm.getState().pgm.previewUrl, '/previews/_live_pgm.png?t=1001');

  // 2. 按下 CUT_SWAP 與空槽交換（PGM 變為主視覺 KV，原 PPT 退回 PVW 第 2 頁）
  let s = sm.dispatch(DECK_ACTIONS.CUT_SWAP);
  assert.equal(s.outputMode, 'kv');
  assert.equal(s.pvw.deckId, '01_Main');
  assert.equal(s.pvw.currentSlide, 2);
  assert.equal(
    s.pvw.previewUrl,
    '/previews/01_Main/slide-2.png',
    '退回 PVW 時必須重建為標準靜態投影片縮圖 URL，不可殘留 _live_pgm.png'
  );

  // 3. 當延伸螢幕處於非 PPT 模式（KV 或 Video），底層視窗已 ShowWindow(0) 隱藏，SYNC_PPT_RUNTIME 傳入 livePreviewUrl: null 時，PVW 必須保持標準縮圖不黑屏
  s = sm.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, {
    slot: 'pvw',
    deckId: '01_Main',
    currentSlide: 2,
    totalSlides: 3,
    clickIndex: 1,
    clickCount: 1,
    livePreviewUrl: null
  });
  assert.equal(
    s.pvw.previewUrl,
    '/previews/01_Main/slide-2.png',
    '當底層 PPT 視窗因 KV/影片模式隱藏 (livePreviewUrl=null) 時，PVW 預覽圖必須保持清晰靜態縮圖，嚴禁黑屏'
  );
});

test('[State-8] (長官需求) 支援匯入與掃描 .pptm 與 .ppsm (啟用巨集的 PowerPoint 簡報與播放檔)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-deck-pptm-'));
  const slidesDir = path.join(tmpDir, 'slides');
  const videosDir = path.join(tmpDir, 'videos');
  const previewsDir = path.join(tmpDir, 'previews');
  const imagesDir = path.join(tmpDir, 'images');
  const audiosDir = path.join(tmpDir, 'audios');

  let appServer = null;
  try {
    appServer = await createPptStageServer({
      port: 0,
      mockPpt: true,
      slidesDir,
      videosDir,
      previewsDir,
      imagesDir,
      audiosDir
    });
    const port = appServer.server.address().port;

    // 1. 測試透過 /api/upload-media 二進制串流匯入 .pptm 檔案
    const uploadRes = await fetch(`http://127.0.0.1:${port}/api/upload-media?filename=${encodeURIComponent('巨集互動簡報.pptm')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('DUMMY_PPTM_BINARY_CONTENT')
    });
    assert.equal(uploadRes.status, 200, '/api/upload-media 必須接受 .pptm 副檔名並回傳 HTTP 200');
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.ok, true);
    assert.equal(uploadJson.fileType, 'ppt');
    assert.equal(uploadJson.fileName, '巨集互動簡報.pptm');

    // 2. 驗證匯入後已自動掃描進入 state.pptPool，且 id 已乾淨去除 .pptm 副檔名
    const pptmDeck = uploadJson.state.pptPool.find((d) => d.fileName === '巨集互動簡報.pptm');
    assert.ok(pptmDeck, '匯入之 .pptm 必須立即出現在 pptPool 流程池中');
    assert.equal(pptmDeck.id, '巨集互動簡報');

    // 3. 驗證 MediaPoolManager 同樣支援 .ppsm
    fs.writeFileSync(path.join(slidesDir, '自動播放巨集.ppsm'), 'DUMMY_PPSM');
    const pm = new MediaPoolManager({ slidesDir, videosDir, previewsDir, imagesDir, audiosDir });
    const scanned = pm.scanSlides();
    assert.ok(scanned.some((d) => d.id === '自動播放巨集' && d.fileName === '自動播放巨集.ppsm'));
  } finally {
    if (appServer) {
      await new Promise((r) => appServer.server.close(r));
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test('[State-9] (長官需求) 正常退出系統 (/api/shutdown) 時，一併清空 slides, videos, previews, images, audios 與 key-visual 內所有已載入檔案', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-deck-purge-'));
  const slidesDir = path.join(tmpDir, 'slides');
  const videosDir = path.join(tmpDir, 'videos');
  const previewsDir = path.join(tmpDir, 'previews');
  const imagesDir = path.join(tmpDir, 'images');
  const audiosDir = path.join(tmpDir, 'audios');
  const keyVisualDir = path.join(tmpDir, 'key-visual');

  for (const d of [slidesDir, videosDir, previewsDir, imagesDir, audiosDir, keyVisualDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // 預先放入各類載入檔案與主視覺底圖
  fs.writeFileSync(path.join(slidesDir, 'demo.pptx'), 'PPTX_DATA');
  fs.mkdirSync(path.join(previewsDir, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(previewsDir, 'demo', 'slide-1.png'), 'PNG_DATA');
  fs.writeFileSync(path.join(videosDir, 'intro.mp4'), 'MP4_DATA');
  fs.writeFileSync(path.join(imagesDir, 'poster.png'), 'IMG_DATA');
  fs.writeFileSync(path.join(audiosDir, 'bgm.mp3'), 'MP3_DATA');
  fs.writeFileSync(path.join(keyVisualDir, 'kv.png'), 'KV_DATA');

  try {
    const appServer = await createPptStageServer({
      port: 0,
      mockPpt: true,
      slidesDir,
      videosDir,
      previewsDir,
      imagesDir,
      audiosDir,
      keyVisualDir
    });
    const port = appServer.server.address().port;

    // 確認啟動時有載入這些檔案與主視覺
    const beforeState = appServer.stateMachine.getState();
    assert.equal(beforeState.pptPool.length, 1);
    assert.equal(beforeState.videoPool.length, 1);
    assert.equal(beforeState.imagePool.length, 1);
    assert.equal(beforeState.audioPool.length, 1);
    assert.ok(beforeState.keyVisualUrl, '啟動時應有載入主視覺底圖');

    // 觸發正常退出系統 (/api/shutdown?noExit=1)
    const res = await fetch(`http://127.0.0.1:${port}/api/shutdown?noExit=1`, { method: 'POST' });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.purged, true);

    // 驗證 6 大資料夾內所有檔案皆已被徹底清空，且資料夾本身仍存在
    for (const [label, dir] of [
      ['slides', slidesDir],
      ['videos', videosDir],
      ['previews', previewsDir],
      ['images', imagesDir],
      ['audios', audiosDir],
      ['key-visual', keyVisualDir]
    ]) {
      assert.equal(fs.existsSync(dir), true, `${label} 目錄本身應保留`);
      assert.equal(fs.readdirSync(dir).length, 0, `退出系統後 ${label} 目錄必須 100% 清空`);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});


