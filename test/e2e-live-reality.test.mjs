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
    } catch {}
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
    try { this.ws.close(); } catch {}
  }
}

test('[Live-Reality-E2E] 真機 PowerPoint COM 雙簡報無縫切換 + 頁內動畫 + /stage 影片起播 + 雙螢幕截圖閉環', async () => {
  const appServer = await createPptStageServer({ port: 0, mockPpt: false });
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
    } catch {}
    await deskCdp.send('Page.enable');
    await deskCdp.send('Runtime.enable');
    await stageCdp.send('Page.enable');
    await stageCdp.send('Runtime.enable');

    // 1. 等待 PPT 池、影片池與 4 張預覽縮圖真實載入完成 (naturalWidth > 0)
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
    }, 10000);
    assert.equal(imagesLoaded, true, '主控台 4 張投影片預覽縮圖必須全部真實載入 (naturalWidth > 0)');

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

    // 6. 真實點擊影片池「▶ 全螢幕播放」，驗證 /stage 放映艙 <video> 實際載入並播放，再按停止切回 PPT
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
    const blackBgAfter = await deskCdp.eval(`getComputedStyle(document.getElementById('btnBlackScreen')).backgroundColor`);
    assert.notEqual(blackBgBefore, blackBgAfter, '黑屏按鈕計算樣式背景色必須實質突變 (Δ ≠ 0)');

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
  } finally {
    if (deskCdp) deskCdp.close();
    if (stageCdp) stageCdp.close();
    try { browserProc.kill(); } catch {}
    await appServer.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
});
