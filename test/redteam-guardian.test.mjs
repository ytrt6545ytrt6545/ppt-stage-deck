import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DeckStateMachine, DECK_ACTIONS } from '../src/core/deck-state-machine.mjs';
import { createPptStageServer } from '../server.mjs';

const SAMPLE_PPT_POOL = [
  {
    id: 'deck-alpha',
    fileName: 'alpha.pptx',
    title: 'Alpha Presentation',
    slideCount: 3,
    slides: [
      { index: 1, clickCount: 2, previewUrl: '/previews/deck-alpha/slide-1.png' },
      { index: 2, clickCount: 0, previewUrl: '/previews/deck-alpha/slide-2.png' },
      { index: 3, clickCount: 1, previewUrl: '/previews/deck-alpha/slide-3.png' }
    ]
  },
  {
    id: 'deck-beta',
    fileName: 'beta.pptx',
    title: 'Beta Presentation',
    slideCount: 2,
    slides: [
      { index: 1, clickCount: 0, previewUrl: '/previews/deck-beta/slide-1.png' },
      { index: 2, clickCount: 0, previewUrl: '/previews/deck-beta/slide-2.png' }
    ]
  }
];

const SAMPLE_VIDEO_POOL = [
  {
    id: 'vid-intro',
    fileName: 'intro.mp4',
    title: 'Intro Video',
    url: '/videos/intro.mp4'
  }
];

// ============================================================================
// 維度 A：畸形與極端輸入注入 (Fuzzing & Invalid Inputs)
// ============================================================================

test('[維度 A-1] dispatch 傳入 null payload 或非法 Action 時，不得拋出 TypeError 崩潰', () => {
  const sm = new DeckStateMachine({ pptPool: SAMPLE_PPT_POOL, videoPool: SAMPLE_VIDEO_POOL });

  assert.doesNotThrow(() => {
    sm.dispatch(DECK_ACTIONS.LOAD_PGM, null);
    sm.dispatch(DECK_ACTIONS.PGM_GOTO, null);
    sm.dispatch(DECK_ACTIONS.TOGGLE_BLACK, null);
    sm.dispatch(DECK_ACTIONS.PLAY_VIDEO, null);
    sm.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, null);
    sm.dispatch(DECK_ACTIONS.REFRESH_POOLS, null);
    sm.dispatch('__NON_EXISTENT_ACTION__', null);
    sm.dispatch(null, null);
  });
});

test('[維度 A-2] 頁碼與動畫步數注入 NaN、浮點數、非數字字串、負數或超大數時，currentSlide 與 clickIndex 必須保持合法正整數/非負整數', () => {
  const sm = new DeckStateMachine({ pptPool: SAMPLE_PPT_POOL, videoPool: SAMPLE_VIDEO_POOL });

  // 注入非數字字串與浮點數至 LOAD_PGM
  sm.dispatch(DECK_ACTIONS.LOAD_PGM, { deckId: 'deck-alpha', slide: 'invalid-slide' });
  let state = sm.getState();
  assert.equal(Number.isInteger(state.pgm.currentSlide), true, 'LOAD_PGM slide="invalid-slide" 不應產生 NaN 頁碼');
  assert.equal(state.pgm.currentSlide >= 1 && state.pgm.currentSlide <= 3, true);

  sm.dispatch(DECK_ACTIONS.LOAD_PGM, { deckId: 'deck-alpha', slide: 2.75 });
  state = sm.getState();
  assert.equal(Number.isInteger(state.pgm.currentSlide), true, 'LOAD_PGM slide=2.75 應強制取整，不得為浮點數');

  // 注入浮點數、負數與超大數至 PGM_GOTO
  sm.dispatch(DECK_ACTIONS.PGM_GOTO, { slide: 1.8 });
  state = sm.getState();
  assert.equal(Number.isInteger(state.pgm.currentSlide), true, 'PGM_GOTO slide=1.8 不得產生浮點數頁碼');

  sm.dispatch(DECK_ACTIONS.PGM_GOTO, { slide: -999 });
  assert.equal(sm.getState().pgm.currentSlide, 1);

  sm.dispatch(DECK_ACTIONS.PGM_GOTO, { slide: 999999 });
  assert.equal(sm.getState().pgm.currentSlide, 3);

  // 注入 NaN 至 SYNC_PPT_RUNTIME
  sm.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, {
    slot: 'pgm',
    currentSlide: NaN,
    totalSlides: NaN,
    clickIndex: NaN,
    clickCount: NaN
  });
  state = sm.getState();
  assert.equal(Number.isInteger(state.pgm.currentSlide), true, 'SYNC_PPT_RUNTIME currentSlide=NaN 不得汙染狀態');
  assert.equal(Number.isInteger(state.pgm.clickIndex), true, 'SYNC_PPT_RUNTIME clickIndex=NaN 不得汙染狀態');
});

test('[維度 A-3] 建構子與 setPools 傳入 null 或畸形結構時應安全降級而非崩潰', () => {
  assert.doesNotThrow(() => {
    const sm1 = new DeckStateMachine(null);
    const sm2 = new DeckStateMachine({ pptPool: null, videoPool: null });
    sm1.setPools(null);
    sm2.setPools(undefined);
  });
});

// ============================================================================
// 維度 B：狀態機非法跳轉與邊界風暴 (State Machine Abuse)
// ============================================================================

test('[維度 B-1] 空簡報池與空影片池下強行觸發 CUT_SWAP、NEXT、PREV、GOTO、PLAY_VIDEO，狀態必須維持安全空槽', () => {
  const sm = new DeckStateMachine({ pptPool: [], videoPool: [] });

  sm.dispatch(DECK_ACTIONS.CUT_SWAP);
  sm.dispatch(DECK_ACTIONS.PGM_NEXT);
  sm.dispatch(DECK_ACTIONS.PGM_PREV);
  sm.dispatch(DECK_ACTIONS.PGM_GOTO, { slide: 5 });
  sm.dispatch(DECK_ACTIONS.PVW_NEXT);
  sm.dispatch(DECK_ACTIONS.PVW_PREV);
  sm.dispatch(DECK_ACTIONS.PVW_GOTO, { slide: 3 });
  sm.dispatch(DECK_ACTIONS.PLAY_VIDEO, { videoId: 'ghost-video' });

  const state = sm.getState();
  assert.equal(state.pgm.deckId, null);
  assert.equal(state.pgm.currentSlide, 0);
  assert.equal(state.pvw.deckId, null);
  assert.equal(state.activeVideo, null);
});

test('[維度 B-2] 首頁繼續倒退 (PREV) 與末頁末段動畫繼續步進 (NEXT) 邊界風暴測試', () => {
  const sm = new DeckStateMachine({ pptPool: SAMPLE_PPT_POOL });

  // 在第 1 頁 click 0 連續倒退 10 次
  for (let i = 0; i < 10; i++) {
    sm.dispatch(DECK_ACTIONS.PGM_PREV);
  }
  let state = sm.getState();
  assert.equal(state.pgm.currentSlide, 1);
  assert.equal(state.pgm.clickIndex, 0);

  // 跳至最後一頁 (Slide 3, clickCount: 1)，連續步進 20 次
  sm.dispatch(DECK_ACTIONS.PGM_GOTO, { slide: 3 });
  for (let i = 0; i < 20; i++) {
    sm.dispatch(DECK_ACTIONS.PGM_NEXT);
  }
  state = sm.getState();
  assert.equal(state.pgm.currentSlide, 3);
  assert.equal(state.pgm.clickIndex, 1);

  // 從末頁末段動畫倒退一步應回到 Slide 3 clickIndex 0，再倒退一步應回到 Slide 2 clickIndex 0
  sm.dispatch(DECK_ACTIONS.PGM_PREV);
  assert.equal(sm.getState().pgm.currentSlide, 3);
  assert.equal(sm.getState().pgm.clickIndex, 0);
  sm.dispatch(DECK_ACTIONS.PGM_PREV);
  assert.equal(sm.getState().pgm.currentSlide, 2);
  assert.equal(sm.getState().pgm.clickIndex, 0);
});

test('[維度 B-3] 播放影片 (outputMode="video") 期間強行執行 CUT_SWAP 或黑屏切換之狀態一致性', () => {
  const sm = new DeckStateMachine({ pptPool: SAMPLE_PPT_POOL, videoPool: SAMPLE_VIDEO_POOL });

  sm.dispatch(DECK_ACTIONS.PLAY_VIDEO, { videoId: 'vid-intro' });
  assert.equal(sm.getState().outputMode, 'video');
  assert.equal(sm.getState().activeVideo?.id, 'vid-intro');

  // 播放影片時切換黑屏再解除，應回到 video 模式
  sm.dispatch(DECK_ACTIONS.TOGGLE_BLACK);
  assert.equal(sm.getState().outputMode, 'black');
  sm.dispatch(DECK_ACTIONS.TOGGLE_BLACK);
  assert.equal(sm.getState().outputMode, 'video');

  // 播放影片時強行 CUT_SWAP，應切回 ppt 模式並清除 activeVideo
  sm.dispatch(DECK_ACTIONS.CUT_SWAP);
  assert.equal(sm.getState().outputMode, 'ppt');
  assert.equal(sm.getState().activeVideo, null);
  assert.equal(sm.getState().pgm.deckId, 'deck-beta');
});

// ============================================================================
// 維度 C：引用隔離與狀態不可變性 (Immutability & Mutation Leak)
// ============================================================================

test('[維度 C-1] 外部竄改傳入建構子/setPools 的陣列元素或竄改 getState() 回傳物件，不得汙染內部狀態', () => {
  const externalPool = structuredClone(SAMPLE_PPT_POOL);
  const sm = new DeckStateMachine({ pptPool: externalPool, videoPool: SAMPLE_VIDEO_POOL });

  // 1. 竄改 getState() 的回傳快照
  const snap = sm.getState();
  snap.pgm.currentSlide = 999;
  snap.pptPool[0].slideCount = 888;
  assert.equal(sm.getState().pgm.currentSlide, 1);
  assert.equal(sm.getState().pptPool[0].slideCount, 3);

  // 2. 竄改原本傳入建構子的 externalPool 內部巢狀物件
  externalPool[0].slideCount = 777;
  externalPool[0].slides[0].clickCount = 555;

  // 若內部僅做淺拷貝 [...pptPool]，後續 dispatch 將讀到被外部汙染的 slideCount / clickCount！
  sm.dispatch(DECK_ACTIONS.PGM_GOTO, { slide: 1 });
  const afterState = sm.getState();
  assert.equal(afterState.pgm.totalSlides, 3, '建構子應深拷貝 pptPool，防止外部巢狀物件竄改汙染內部狀態');
  assert.equal(afterState.pgm.clickCount, 2, '建構子應深拷貝 slides 陣列，防止外部竄改 clickCount');
});

// ============================================================================
// 維度 D：HTTP / API 安全性與路徑穿越防禦 (Security & Path Traversal / Malformed Range)
// ============================================================================

test('[維度 D-1] /previews/ 路由必須阻擋 URL 編碼路徑穿越 (..%2Fsecret.txt) 讀取任意檔案', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-rt-'));
  const slidesDir = path.join(tmpDir, 'slides');
  const videosDir = path.join(tmpDir, 'videos');
  const previewsDir = path.join(tmpDir, 'previews');
  fs.mkdirSync(slidesDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });
  fs.mkdirSync(previewsDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'secret.txt'), 'TOP_SECRET_CREDENTIAL=12345');

  const app = await createPptStageServer({
    port: 0,
    mockPpt: true,
    slidesDir,
    videosDir,
    previewsDir
  });
  t.after(async () => {
    app.server.closeAllConnections?.();
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 使用 %2F 繞過 URL 標準化，測試 decodeURIComponent 後的 path.join 穿越
  const res = await fetch(`http://127.0.0.1:${app.port}/previews/..%2Fsecret.txt`, {
    headers: { Connection: 'close' },
    signal: AbortSignal.timeout(1500)
  });
  const text = await res.text();
  assert.equal(
    text.includes('TOP_SECRET_CREDENTIAL'),
    false,
    '路徑穿越漏洞：/previews/..%2Fsecret.txt 成功洩漏了 previewsDir 外部的機密檔案！'
  );
});

test('[維度 D-2] /videos/ HTTP 206 路由遭遇倒置 Range (bytes=500-100)、超界 Range (bytes=999999-) 或非數字 Range (bytes=abc-def) 時，必須回傳 416 或 200，嚴禁拋出 RangeError 或掛死連線', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-video-'));
  const slidesDir = path.join(tmpDir, 'slides');
  const videosDir = path.join(tmpDir, 'videos');
  const previewsDir = path.join(tmpDir, 'previews');
  fs.mkdirSync(slidesDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });
  fs.mkdirSync(previewsDir, { recursive: true });
  fs.writeFileSync(path.join(videosDir, 'sample.mp4'), Buffer.alloc(1024, 0x41));

  const app = await createPptStageServer({
    port: 0,
    mockPpt: true,
    slidesDir,
    videosDir,
    previewsDir
  });
  t.after(async () => {
    app.server.closeAllConnections?.();
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${app.port}/videos/sample.mp4`;

  for (const badRange of ['bytes=500-100', 'bytes=999999-', 'bytes=abc-def']) {
    let status = 0;
    try {
      const res = await fetch(baseUrl, {
        headers: { Range: badRange, Connection: 'close' },
        signal: AbortSignal.timeout(1500)
      });
      status = res.status;
      await res.arrayBuffer();
    } catch (err) {
      assert.fail(`請求畸形 Range "${badRange}" 導致伺服器崩潰或連線異常中斷: ${err.message}`);
    }
    assert.equal(
      status === 416 || status === 200,
      true,
      `畸形 Range "${badRange}" 應回傳 HTTP 416 或 200，實際卻回傳 ${status}`
    );
  }
});

test('[維度 D-3] /previews/ 缺省 SVG 動態生成必須防止反射型 XSS 標籤注入，且請求目錄 (/previews/) 不得觸發 EISDIR 掛死回應', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-svg-'));
  const slidesDir = path.join(tmpDir, 'slides');
  const videosDir = path.join(tmpDir, 'videos');
  const previewsDir = path.join(tmpDir, 'previews');
  fs.mkdirSync(slidesDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });
  fs.mkdirSync(previewsDir, { recursive: true });

  const app = await createPptStageServer({
    port: 0,
    mockPpt: true,
    slidesDir,
    videosDir,
    previewsDir
  });
  t.after(async () => {
    app.server.closeAllConnections?.();
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. 請求帶有 <script> 標籤的 deckId 預覽圖
  const xssRes = await fetch(
    `http://127.0.0.1:${app.port}/previews/${encodeURIComponent('<script>alert(1)</script>')}/slide-1.png`,
    { headers: { Connection: 'close' }, signal: AbortSignal.timeout(1500) }
  );
  const svgBody = await xssRes.text();
  assert.equal(
    svgBody.includes('<script>'),
    false,
    'SVG Fallback 存在反射型 XSS：未對 deckId 進行 XML 實體跳脫'
  );

  // 2. 請求 /previews/ 根目錄 (rel 為空字串，filePath 指向 previewsDir 目錄本身)
  const dirRes = await fetch(`http://127.0.0.1:${app.port}/previews/`, {
    headers: { Connection: 'close' },
    signal: AbortSignal.timeout(1500)
  });
  await dirRes.text();
  assert.notEqual(dirRes.headers.get('content-type'), 'image/png', '對目錄本身不得誤當成 PNG 檔案串流讀取');
});
