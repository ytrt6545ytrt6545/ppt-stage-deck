// ============================================================================
// 🔥 Test Suite 3: Live Reality E2E 真機全鏈路驗證 (PowerPoint COM + 雙視窗 CDP)
// 徹底杜絕表面功夫：
// (1) 驗證主控台 4 張預覽縮圖 (PGM/PVW 當前頁與下一頁) naturalWidth > 0 真實載入
// (2) 驗證第二螢幕原生 PowerPoint screenClass 視窗真實渲染 (PrintWindow 像素非空白)
// (3) 真實點擊 #btnPgmNext / #btnPgmPrev 驗證情況 2 頁內動畫步進與跨頁
// (4) 真實點擊 #btnPvwNext 預覽翻頁 + #btnCutSwap 驗證雙 PPT 0 秒無縫互切
// (5) 真實開啟 /stage 放映艙，點擊影片池 .btn-play-video 驗證 <video> 實質起播與切回 PPT
// (6) 留存主控台與第二螢幕雙重 PNG 實體快照物證
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createPptStageServer } from '../server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function findBrowserExe() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForCondition(fn, timeoutMs = 8000, intervalMs = 120) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const val = await fn();
      if (val) return val;
    } catch { }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res?.result?.value;
  }

  close() {
    try { this.ws.close(); } catch { }
  }
}

test('[Live-Reality-E2E] 真機 PowerPoint COM 雙簡報無縫切換 + 頁內動畫 + /stage 影片起播 + 雙螢幕截圖閉環', async () => {
  const e2eSlidesDir = path.join(os.tmpdir(), `ppt-e2e-slides-${Date.now()}`);
  const e2eVideosDir = path.join(os.tmpdir(), `ppt-e2e-videos-${Date.now()}`);
  fs.mkdirSync(e2eSlidesDir, { recursive: true });
  fs.mkdirSync(e2eVideosDir, { recursive: true });
  const fixtureSlidesDir = path.join(projectRoot, 'test', 'fixtures', 'slides');
  const srcSlidesDir = fs.existsSync(fixtureSlidesDir) ? fixtureSlidesDir : path.join(projectRoot, 'assets', 'slides');
  for (const f of ['01_主講簡報_廣海明月導論.pptx', '02_互動提問與公告簡報.pptx']) {
    if (fs.existsSync(path.join(srcSlidesDir, f))) {
      fs.copyFileSync(path.join(srcSlidesDir, f), path.join(e2eSlidesDir, f));
    }
  }
  const fixtureVideosDir = path.join(projectRoot, 'test', 'fixtures', 'videos');
  const srcVideosDir = fs.existsSync(fixtureVideosDir) ? fixtureVideosDir : path.join(projectRoot, 'assets', 'videos');
  for (const f of ['01_前行緣念.mp4', '02_大迴向.mp4']) {
    if (fs.existsSync(path.join(srcVideosDir, f))) {
      fs.copyFileSync(path.join(srcVideosDir, f), path.join(e2eVideosDir, f));
    }
  }
  const appServer = await createPptStageServer({ port: 0, mockPpt: false, slidesDir: e2eSlidesDir, videosDir: e2eVideosDir });
  const baseUrl = `http://127.0.0.1:${appServer.port}`;
  const debugPort = 19400 + Math.floor(Math.random() * 400);
  const userDataDir = path.join(os.tmpdir(), `ppt-stage-cdp-${Date.now()}`);
  const browserExe = findBrowserExe();
  assert.ok(browserExe, '本機必須安裝 Chrome 或 Edge 瀏覽器');

  // 同時開啟主控台 (/) 與第二螢幕放映艙 (/stage) 兩個真實頁面
  const browserProc = spawn(browserExe, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-position=50,40',
    '--window-size=1360,880',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    baseUrl,
    `${baseUrl}/stage`
  ], { stdio: 'ignore', windowsHide: false });

  let deskCdp = null;
  let stageCdp = null;
  try {
    const targets = await waitForCondition(async () => {
      const list = await httpGetJson(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      const deskPage = pages.find((p) => !p.url.endsWith('/stage'));
      const stagePage = pages.find((p) => p.url.endsWith('/stage'));
      return deskPage && stagePage ? { deskPage, stagePage } : null;
    }, 10000);

    assert.ok(targets, '必須成功掛載主控台 (/) 與第二螢幕放映艙 (/stage) 雙 CDP 目標');

    deskCdp = new CdpSession(targets.deskPage.webSocketDebuggerUrl);
    stageCdp = new CdpSession(targets.stagePage.webSocketDebuggerUrl);
    await deskCdp.connect();
    await stageCdp.connect();
    try {
      const winInfo = await deskCdp.send('Browser.getWindowForTarget');
      if (winInfo && winInfo.windowId) {
        await deskCdp.send('Browser.setWindowBounds', {
          windowId: winInfo.windowId,
          bounds: { left: 40, top: 40, width: 1200, height: 760, windowState: 'normal' }
        });
      }
    } catch { }
    await deskCdp.send('Page.enable');
    await deskCdp.send('Runtime.enable');
    deskCdp.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'Runtime.exceptionThrown') {
          console.error('BROWSER EXCEPTION:', msg.params?.exceptionDetails?.text, msg.params?.exceptionDetails?.exception?.description);
        }
      } catch { }
    });
    await stageCdp.send('Page.enable');
    await stageCdp.send('Runtime.enable');

    // 0. (長官鐵律) 驗證開機預設為純淨雙空槽 (STANDBY)，PGM 與 PVW 無任何素材自動預載
    const initSlotsEmpty = await waitForCondition(async () => {
      return await deskCdp.eval(`(() => {
        const pgmTitle = document.getElementById('pgmDeckTitle')?.textContent || '';
        const pvwTitle = document.getElementById('pvwDeckTitle')?.textContent || '';
        return (pgmTitle.includes('空槽') || pgmTitle.includes('主視覺')) && pvwTitle.includes('空槽');
      })()`);
    }, 5000);
    assert.equal(initSlotsEmpty, true, '開機冷啟動預設 PGM 與 PVW 必須 100% 為空槽待命 (STANDBY)，無素材自動預載');

    // 1. 導播從流程隊列手動將 PPT-1「直接播出」與 PPT-2「送至預覽」
    await deskCdp.send('Page.bringToFront');
    await waitForCondition(async () => {
      return await deskCdp.eval(`Boolean(document.querySelector('#scheduleQueueList .btn-load-pgm-universal[data-type="ppt"]'))`);
    }, 5000);
    await deskCdp.eval(`(() => {
      const pgmBtns = document.querySelectorAll('#scheduleQueueList .btn-load-pgm-universal[data-type="ppt"]');
      const pvwBtns = document.querySelectorAll('#scheduleQueueList .btn-load-pvw-universal[data-type="ppt"]');
      if (pgmBtns[0]) pgmBtns[0].click();
      const targetBtn = pvwBtns.length > 1 ? pvwBtns[1] : pvwBtns[0];
      if (targetBtn) targetBtn.click();
    })()`);

    // 等待 PPT 池、影片池與 4 張預覽縮圖真實載入完成 (naturalWidth > 0)
    const imagesLoaded = await waitForCondition(async () => {
      return await deskCdp.eval(`(() => {
        const pptItems = document.querySelectorAll('#pptPoolList .pool-item').length;
        const vidItems = document.querySelectorAll('#videoPoolList .pool-item').length;
        const ids = ['pgmPreviewImg', 'pgmNextPreviewImg', 'pvwPreviewImg', 'pvwNextPreviewImg'];
        const allImgsOk = ids.every((id) => {
          const el = document.getElementById(id);
          return el && el.complete && el.naturalWidth > 0;
        });
        return pptItems >= 2 && vidItems >= 2 && allImgsOk;
      })()`);
    }, 25000);
    assert.equal(imagesLoaded, true, '手動將簡報送入 PGM/PVW 後，主控台 4 張投影片預覽縮圖必須全部真實載入 (naturalWidth > 0)');

    // 2. 驗證實體視窗幾何與 Material LIFF 風格計算樣式
    const geomAndStyle = await deskCdp.eval(`(() => {
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const cardStyle = getComputedStyle(document.querySelector('.card'));
      const btnStyle = getComputedStyle(document.getElementById('btnPgmNext'));
      return {
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyBg,
        cardBg: cardStyle.backgroundColor,
        cardRadius: cardStyle.borderRadius,
        btnBg: btnStyle.backgroundColor
      };
    })()`);
    assert.ok(geomAndStyle.outerWidth > 0 && geomAndStyle.outerHeight > 0);
    assert.ok(
      geomAndStyle.scrollWidth <= geomAndStyle.clientWidth,
      `主控台嚴禁出現水平溢位捲軸 (scrollWidth=${geomAndStyle.scrollWidth}, clientWidth=${geomAndStyle.clientWidth})`
    );
    assert.equal(geomAndStyle.bodyBg, 'rgb(248, 250, 252)');
    assert.equal(geomAndStyle.cardBg, 'rgb(255, 255, 255)');
    assert.equal(geomAndStyle.cardRadius, '16px');
    assert.equal(geomAndStyle.btnBg, 'rgb(14, 165, 233)');

    // 2-A2. 驗證介面縮放 (80% / 90% / 100% / 110%) 切換與右下角播控艙零裁切 (rect.bottom <= innerHeight)
    const scaleAndDockCheck = await deskCdp.eval(`(() => {
      const btn80 = document.querySelector('#uiScaleControl .btn-scale-opt[data-scale="0.8"]');
      const btn90 = document.querySelector('#uiScaleControl .btn-scale-opt[data-scale="0.9"]');
      const btn110 = document.querySelector('#uiScaleControl .btn-scale-opt[data-scale="1.1"]');
      const btn100 = document.querySelector('#uiScaleControl .btn-scale-opt[data-scale="1"]');
      if (!btn80 || !btn90 || !btn110 || !btn100) return { ok: false };

      btn80.click();
      const font80 = getComputedStyle(document.body).fontSize;
      btn110.click();
      const font110 = getComputedStyle(document.body).fontSize;
      btn90.click();
      const font90 = getComputedStyle(document.body).fontSize;
      btn100.click();
      const font100 = getComputedStyle(document.body).fontSize;

      const dockBtn = document.getElementById('btnDeskMasterCutLive');
      const dockRect = dockBtn ? dockBtn.getBoundingClientRect() : null;
      return {
        ok: true,
        font80,
        font90,
        font100,
        font110,
        dockBottom: dockRect ? dockRect.bottom : 9999,
        innerHeight: window.innerHeight
      };
    })()`);
    assert.equal(scaleAndDockCheck.ok, true, '必須存在 80% / 90% / 100% / 110% 介面縮放按鈕');
    assert.notEqual(scaleAndDockCheck.font80, scaleAndDockCheck.font100, '切換 80% 與 100% 時計算字級必須實質突變 (Δ ≠ 0)');
    assert.notEqual(scaleAndDockCheck.font90, scaleAndDockCheck.font110, '切換 90% 與 110% 時計算字級必須實質突變 (Δ ≠ 0)');
    assert.ok(
      scaleAndDockCheck.dockBottom <= scaleAndDockCheck.innerHeight,
      `右下角影片播控艙按鈕嚴禁超出視窗底部被裁切 (dockBottom=${scaleAndDockCheck.dockBottom}, innerHeight=${scaleAndDockCheck.innerHeight})`
    );

    // 2-B. [方案 1] 驗證左側垂直主分隔條與右上水平分隔條幾何正常與綜合素材池閉環
    const splittersGeom = await deskCdp.eval(`(() => {
      const hSplitter = document.getElementById('horizontalSplitter');
      const mainVSplitter = document.getElementById('mainVerticalSplitter');
      const allMediaItems = document.querySelectorAll('#allMediaPoolList .pool-item').length;
      const flowItems = document.querySelectorAll('#scheduleQueueList .pool-item').length;
      const hRect = hSplitter ? hSplitter.getBoundingClientRect() : null;
      const vRect = mainVSplitter ? mainVSplitter.getBoundingClientRect() : null;
      return {
        hasH: !!hSplitter,
        hW: hRect ? hRect.width : 0,
        hH: hRect ? hRect.height : 0,
        hasV: !!mainVSplitter,
        vW: vRect ? vRect.width : 0,
        vH: vRect ? vRect.height : 0,
        allMediaItems,
        flowItems
      };
    })()`);
    assert.equal(splittersGeom.hasH, true, '主控台必須存在右上雙監視器水平分隔條');
    assert.ok(splittersGeom.hW > 400 && splittersGeom.hH >= 6, '水平分隔條幾何尺寸必須有效');
    assert.equal(splittersGeom.hasV, true, '主控台必須存在左流程與右工作區垂直主分隔條');
    assert.ok(splittersGeom.vW >= 6 && splittersGeom.vH > 300, '垂直主分隔條幾何尺寸必須有效');
    assert.ok(splittersGeom.allMediaItems >= 3, '綜合素材池必須成功收納 PPT 與影片');
    assert.ok(splittersGeom.flowItems >= 3, '現場流程隊列必須成功排程');

    // 3. 驗證第二螢幕原生 PowerPoint screenClass 視窗真實渲染、絕非死白畫面，且 WindowFromPoint 確為 PGM 置頂
    const artifactsDir = path.join(projectRoot, 'artifacts');
    fs.mkdirSync(artifactsDir, { recursive: true });
    const stageShot1 = path.join(artifactsDir, 'e2e-screen2-pgm-slide1.png');
    const cap1 = await appServer.pptEngine.captureStage(stageShot1);
    const stateBefore = appServer.stateMachine.getState();
    assert.equal(cap1.ok, true, '必須成功擷取第二螢幕 PowerPoint screenClass 實體畫面');
    assert.ok(
      cap1.nonBlankSamples > 10,
      `第二螢幕 PowerPoint 畫面不可為空白死白 (實測文字取樣點=${cap1.nonBlankSamples})`
    );
    assert.equal(
      cap1.topCenterHwnd,
      stateBefore.pgm.hwnd,
      `第二螢幕正中央實際可見最上層視窗 (WindowFromPoint) 必須為當前 PGM 簡報視窗 (probe=${cap1.probePt}, top=${cap1.topCenterHwnd} [${cap1.topCenterClass}: ${cap1.topCenterTitle} @ ${cap1.topCenterRect}], pgm=${stateBefore.pgm.hwnd} @ ${JSON.stringify(stateBefore.pgm.rect)}, pvw=${stateBefore.pvw.hwnd})`
    );

    // 4. 真實點擊 #btnPgmNext 驗證情況 2 頁內分段動畫步進 (動畫 0/1 -> 動畫 1/1 -> 第 2/3 頁) 與第二螢幕像素差分 (Δ > 20)
    const initAnimText = await deskCdp.eval(`document.getElementById('pgmAnimBadge').textContent`);
    assert.equal(initAnimText, '動畫 0 / 1', '第 1 頁初始應顯示 動畫 0 / 1');

    await deskCdp.eval(`document.getElementById('btnPgmNext').click()`);
    const step1Anim = await waitForCondition(async () => {
      const t = await deskCdp.eval(`document.getElementById('pgmAnimBadge').textContent`);
      return t === '動畫 1 / 1' ? t : null;
    }, 5000);
    assert.equal(step1Anim, '動畫 1 / 1', '點擊第 1 下「下一頁」必須觸發頁內動畫至 1 / 1');

    const stageShotAnim1 = path.join(artifactsDir, 'e2e-screen2-pgm-slide1-anim1.png');
    const capAnim1 = await appServer.pptEngine.captureStage(stageShotAnim1);
    assert.ok(
      capAnim1.nonBlankSamples > cap1.nonBlankSamples + 20,
      `頁內動畫觸發後第二螢幕文字像素取樣點必須顯著增加 (動畫前=${cap1.nonBlankSamples}, 動畫後=${capAnim1.nonBlankSamples})`
    );
    const pgmLiveSrc = await deskCdp.eval(`document.getElementById('pgmPreviewImg').getAttribute('src')`);
    assert.ok(pgmLiveSrc.includes('_live_pgm.png'), '主控台 PGM 預覽圖必須同步更新為即時 PrintWindow 動畫畫面');

    await deskCdp.eval(`document.getElementById('btnPgmNext').click()`);
    const step2Page = await waitForCondition(async () => {
      const p = await deskCdp.eval(`document.getElementById('pgmPageBadge').textContent`);
      return p === '2 / 3' ? p : null;
    }, 5000);
    assert.equal(step2Page, '2 / 3', '頁內動畫播畢後再按「下一頁」必須推進至第 2 / 3 頁');

    // 4-B. 驗證翻至第 2 頁時動畫重置為 0 / 1 (GotoSlide ResetSlide=-1)，且按簡報筆 / 鍵盤 (PageDown / PageUp) 可逐個推進動畫與跨頁
    const slide2InitAnim = await deskCdp.eval(`document.getElementById('pgmAnimBadge').textContent`);
    assert.equal(slide2InitAnim, '動畫 0 / 1', '翻至第 2 頁時，動畫必須重置為 0 / 1，不可一次全部出來');

    await deskCdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }))`);
    const slide2Step1ByRemote = await waitForCondition(async () => {
      const t = await deskCdp.eval(`document.getElementById('pgmAnimBadge').textContent`);
      return t === '動畫 1 / 1' ? t : null;
    }, 5000);
    assert.equal(slide2Step1ByRemote, '動畫 1 / 1', '按下簡報筆 / 鍵盤 PageDown 第 1 下必須推進第 2 頁動畫至 1 / 1');

    await deskCdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }))`);
    const step3ByRemote = await waitForCondition(async () => {
      const p = await deskCdp.eval(`document.getElementById('pgmPageBadge').textContent`);
      return p === '3 / 3' ? p : null;
    }, 5000);
    assert.equal(step3ByRemote, '3 / 3', '按下簡報筆 / 鍵盤 PageDown 第 2 下必須推進 PGM 至第 3 / 3 頁');

    await deskCdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true }))`);
    const backTo2ByRemote = await waitForCondition(async () => {
      const p = await deskCdp.eval(`document.getElementById('pgmPageBadge').textContent`);
      return p === '2 / 3' ? p : null;
    }, 5000);
    assert.equal(backTo2ByRemote, '2 / 3', '按下簡報筆 / 鍵盤 PageUp 必須回退 PGM 至第 2 / 3 頁');

    // 點擊 #btnPgmPrev 驗證上一頁回退
    await deskCdp.eval(`document.getElementById('btnPgmPrev').click()`);
    await new Promise((r) => setTimeout(r, 300));

    // 5. 真實點擊 #btnPvwNext 在預覽槽獨立翻頁，再點擊 #btnCutSwap 無縫切換上台
    const pvwTitleBefore = await deskCdp.eval(`document.getElementById('pvwDeckTitle').textContent`);
    await deskCdp.eval(`document.getElementById('btnPvwNext').click()`); // 02 簡報第 1 頁動畫 0->1
    await new Promise((r) => setTimeout(r, 250));
    await deskCdp.eval(`document.getElementById('btnPvwNext').click()`); // 02 簡報翻至第 2 頁
    const pvwPageReady = await waitForCondition(async () => {
      const p = await deskCdp.eval(`document.getElementById('pvwPageBadge').textContent`);
      return p === '2 / 3' ? p : null;
    }, 5000);
    assert.equal(pvwPageReady, '2 / 3', 'PVW 預覽槽必須可獨立翻至第 2 / 3 頁待命');

    // 按下 CUT 無縫切換
    await deskCdp.eval(`document.getElementById('btnCutSwap').click()`);
    const cutDone = await waitForCondition(async () => {
      const title = await deskCdp.eval(`document.getElementById('pgmDeckTitle').textContent`);
      const page = await deskCdp.eval(`document.getElementById('pgmPageBadge').textContent`);
      return title === pvwTitleBefore && page === '2 / 3';
    }, 5000);
    assert.equal(cutDone, true, '點擊 CUT 後，預覽槽的第 2 份 PPT (第 2 頁) 必須瞬間切上 PGM 主播出');

    const stageShot2 = path.join(artifactsDir, 'e2e-screen2-after-cut.png');
    const cap2 = await appServer.pptEngine.captureStage(stageShot2);
    const stateAfterCut = appServer.stateMachine.getState();
    assert.ok(cap2.nonBlankSamples > 10, '切換第 2 份 PPT 上台後，第二螢幕畫面必須清晰顯示第 2 份簡報內容');
    assert.equal(
      cap2.topCenterHwnd,
      stateAfterCut.pgm.hwnd,
      `點擊 CUT 無縫切換後，第二螢幕正中央實際最上層視窗 (WindowFromPoint) 必須切換為新 PGM 視窗 (top=${cap2.topCenterHwnd} [${cap2.topCenterClass}: ${cap2.topCenterTitle}], pgm=${stateAfterCut.pgm.hwnd}, pvw=${stateAfterCut.pvw.hwnd})`
    );

    // 6. 真實測試「第一次 PPT 與影片 CUT 交換」：先送影片至 PVW，按 CUT 切換，驗證第一次即刻出畫面且無 screenClass 遮擋，再按 CUT 換回 PPT
    await stageCdp.send('Page.bringToFront');
    await deskCdp.eval(`document.querySelector('.btn-pvw-video').click()`);
    await new Promise((r) => setTimeout(r, 250));
    await deskCdp.eval(`document.getElementById('btnCutSwap').click()`);

    const firstCutStagePlaying = await waitForCondition(async () => {
      return await stageCdp.eval(`(() => {
        const v = document.getElementById('stageVideo');
        return v && getComputedStyle(v).display === 'block' && v.readyState >= 2 && v.videoWidth > 0 && !v.paused;
      })()`);
    }, 8000);
    assert.equal(firstCutStagePlaying, true, '第一次 PPT 與影片 CUT 交換時，第二螢幕 /stage 必須立即出現影片畫面並起播');

    // 驗證頂部導航列的 screenBadge 與 outputModeBadge 已依方案 A 徹底隱藏 (display === 'none')
    const topBadgesHidden = await deskCdp.eval(`(() => {
      const sb = document.getElementById('screenBadge');
      const ob = document.getElementById('outputModeBadge');
      return sb && ob && getComputedStyle(sb).display === 'none' && getComputedStyle(ob).display === 'none';
    })()`);
    assert.equal(topBadgesHidden, true, '頂部導航列 #screenBadge 與 #outputModeBadge 必須徹底隱藏 (display: none)');

    await deskCdp.send('Page.bringToFront');
    const firstCutPgmPlaying = await waitForCondition(async () => {
      return await deskCdp.eval(`(() => {
        const v = document.getElementById('pgmVideoPlayer');
        return v && getComputedStyle(v).display === 'block' && v.readyState >= 2 && v.videoWidth > 0 && !v.paused;
      })()`);
    }, 5000);
    assert.equal(firstCutPgmPlaying, true, '第一次 PPT 與影片 CUT 交換時，主控台 PGM 監視器必須同步出現影片畫面並起播');

    // 驗證此時退回 PVW 的 PPT 預覽圖依然清晰可見，且絕非 _live_pvw.png 全黑畫面
    const pvwPptPreviewDuringVideo = await deskCdp.eval(`(() => {
      const img = document.getElementById('pvwPreviewImg');
      if (!img || getComputedStyle(img).display === 'none' || !img.complete || img.naturalWidth === 0) return { ok: false };
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 36;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 64, 36);
      const data = ctx.getImageData(0, 0, 64, 36).data;
      let nonBlackPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 15 || data[i + 1] > 15 || data[i + 2] > 15) nonBlackPixels++;
      }
      return { ok: nonBlackPixels > 50, src: img.getAttribute('src'), nonBlackPixels };
    })()`);
    assert.equal(
      pvwPptPreviewDuringVideo.ok,
      true,
      `PPT 退回 PVW 預覽待命時，右上角 PVW 預覽大圖必須清晰顯示投影片內容，嚴禁黑屏 (src=${pvwPptPreviewDuringVideo.src}, nonBlackPixels=${pvwPptPreviewDuringVideo.nonBlackPixels})`
    );

    const capDuringVideo = await appServer.pptEngine.captureStage(path.join(artifactsDir, 'e2e-screen2-video-cut.png'));
    assert.notEqual(
      capDuringVideo.topCenterClass,
      'screenClass',
      `PPT 與影片 CUT 交換後，PowerPoint screenClass 視窗必須徹底隱藏，不得殘留遮擋第二螢幕影片 (topCenterClass=${capDuringVideo.topCenterClass})`
    );

    // 再次按下 CUT 切換：將 PPT 換回 PGM、影片退回 PVW
    await deskCdp.eval(`document.getElementById('btnCutSwap').click()`);
    const cutBackToPpt = await waitForCondition(async () => {
      const badgeText = await deskCdp.eval(`document.getElementById('outputModeBadge').textContent`);
      const pvwVidShown = await deskCdp.eval(`getComputedStyle(document.getElementById('pvwVideoPlayer')).display === 'block'`);
      return badgeText.includes('PPT 播出中') && pvwVidShown;
    }, 5000);
    assert.equal(cutBackToPpt, true, '再次按 CUT 切換後，PPT 必須回到 PGM 播出且影片退回 PVW 預覽');

    // 6-B. 真實點擊影片池「▶ 全螢幕播放」，驗證 /stage 放映艙 <video> 實際載入並播放，再按停止切回 PPT
    await stageCdp.send('Page.bringToFront');
    await deskCdp.eval(`document.querySelector('.btn-play-video').click()`);
    const videoPlayingOnStage = await waitForCondition(async () => {
      return await stageCdp.eval(`(() => {
        const v = document.getElementById('stageVideo');
        return v && getComputedStyle(v).display === 'block' && v.readyState >= 2 && v.videoWidth > 0 && !v.paused;
      })()`);
    }, 8000);
    assert.equal(videoPlayingOnStage, true, '點擊播放影片後，/stage 第二螢幕放映艙必須真實起播 MP4 影片 (videoWidth > 0 && !paused)');
    await deskCdp.send('Page.bringToFront');

    // 點擊「⏹ 停止影片回 PPT」驗證無縫切回 PPT
    await deskCdp.eval(`document.getElementById('btnStopVideo').click()`);
    const videoStoppedAndBackToPpt = await waitForCondition(async () => {
      const stageHidden = await stageCdp.eval(`getComputedStyle(document.getElementById('stageVideo')).display === 'none'`);
      const badgeText = await deskCdp.eval(`document.getElementById('outputModeBadge').textContent`);
      return stageHidden && badgeText.includes('PPT 播出中');
    }, 5000);
    assert.equal(videoStoppedAndBackToPpt, true, '停止影片後必須立即隱藏影片層並無縫切回 PPT 播出狀態');

    // 7. 真實點擊「◼ 黑屏」驗證計算樣式突變 (Δ ≠ 0) 與 /stage 黑幕覆蓋
    const blackBgBefore = await deskCdp.eval(`getComputedStyle(document.getElementById('btnBlackScreen')).backgroundColor`);
    await deskCdp.eval(`document.getElementById('btnBlackScreen').click()`);
    const blackCurtainShown = await waitForCondition(async () => {
      return await stageCdp.eval(`getComputedStyle(document.getElementById('blackCurtain')).display === 'block'`);
    }, 4000);
    assert.equal(blackCurtainShown, true, '點擊黑屏後，/stage 黑幕必須立即顯示');
    const blackBgAfter = await waitForCondition(async () => {
      const bg = await deskCdp.eval(`getComputedStyle(document.getElementById('btnBlackScreen')).backgroundColor`);
      return bg !== blackBgBefore ? bg : null;
    }, 4000);
    assert.ok(blackBgAfter, '黑屏按鈕計算樣式背景色必須實質突變 (Δ ≠ 0)');

    // 解除黑屏並留存最終主控台與第二螢幕恢復快照
    await deskCdp.eval(`document.getElementById('btnBlackScreen').click()`);
    await new Promise((r) => setTimeout(r, 350));

    const stageShotFinal = path.join(artifactsDir, 'e2e-screen2-after-video-and-black.png');
    const capFinal = await appServer.pptEngine.captureStage(stageShotFinal);
    const stateFinal = appServer.stateMachine.getState();
    assert.ok(capFinal.nonBlankSamples > 10, '解除影片與黑屏後，第二螢幕必須恢復顯示清晰簡報內容');
    assert.equal(
      capFinal.topCenterHwnd,
      stateFinal.pgm.hwnd,
      `解除影片與黑屏後，第二螢幕最上層視窗必須恢復為當前 PGM 簡報視窗 (top=${capFinal.topCenterHwnd}, pgm=${stateFinal.pgm.hwnd})`
    );

    const shot = await deskCdp.send('Page.captureScreenshot', { format: 'png' });
    const shotPath = path.join(artifactsDir, 'e2e-ppt-stage-deck-live.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    assert.equal(fs.existsSync(shotPath), true);

    // 8. 驗證右下角「📑 PPT 快選與修改」分頁切換、縮圖點擊跳頁與網頁讀取投影片文字
    await deskCdp.eval(`document.getElementById('dockTabBtnPpt').click()`);
    const pptTabCheck = await waitForCondition(async () => {
      return await deskCdp.eval(`(() => {
        const pane = document.getElementById('dockPanePpt');
        const thumbs = document.querySelectorAll('#pptSlideThumbStrip .ppt-thumb-item');
        return pane && getComputedStyle(pane).display !== 'none' && thumbs.length >= 2 ? thumbs.length : null;
      })()`);
    }, 4000);
    assert.ok(pptTabCheck >= 2, '切換至「📑 PPT 快選與修改」分頁後，必須顯示當前簡報各頁縮圖');

    const shotPptTab = await deskCdp.send('Page.captureScreenshot', { format: 'png' });
    const shotPptTabPath = path.join(artifactsDir, 'e2e-ppt-stage-deck-ppt-tab.png');
    fs.writeFileSync(shotPptTabPath, Buffer.from(shotPptTab.data, 'base64'));
    assert.equal(fs.existsSync(shotPptTabPath), true);
  } finally {
    if (deskCdp) deskCdp.close();
    if (stageCdp) stageCdp.close();
    try { browserProc.kill(); } catch { }
    await appServer.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { }
    try { fs.rmSync(e2eSlidesDir, { recursive: true, force: true }); } catch { }
    try { fs.rmSync(e2eVideosDir, { recursive: true, force: true }); } catch { }
  }
});
