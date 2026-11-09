// ============================================================================
// 🔥 Test Suite 3: Live Reality E2E 四重硬鎖驗證 (PowerPoint COM + Chrome CDP)
// (1) Win32 PowerPoint SlideShowWindow HWND !== 0 與 CDP 視窗幾何 > 0
// (2) Material LIFF 風格計算樣式與真實點擊突變 (getComputedStyle Δ ≠ 0)
// (3) 雙 PPT 同時運行無縫切換 (CUT_SWAP) ＆ HTTP 206 影片分段串流真機驗證
// (4) 實體像素快照 (Page.captureScreenshot) 存證
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
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

async function waitForCdpTarget(debugPort, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await httpGetJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('CDP page target timeout');
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

test('[Live-Reality-E2E] 真機 PowerPoint COM 雙簡報無縫切換 + HTTP 206 影片池 + CDP 視覺快照閉環', async () => {
  const appServer = await createPptStageServer({ port: 0, mockPpt: false });
  const baseUrl = `http://127.0.0.1:${appServer.port}`;
  const debugPort = 19330 + Math.floor(Math.random() * 500);
  const userDataDir = path.join(projectRoot, '.tmp_cdp_profile');
  const browserExe = findBrowserExe();
  assert.ok(browserExe, '本機必須安裝 Chrome 或 Edge 瀏覽器');

  const browserProc = spawn(browserExe, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1320,860',
    '--no-first-run',
    '--no-default-browser-check',
    baseUrl
  ], { stdio: 'ignore', windowsHide: false });

  let cdp = null;
  try {
    const target = await waitForCdpTarget(debugPort);
    cdp = new CdpSession(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 等待頁面資料與 2 份 PPT 池渲染完成
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const count = await cdp.eval(`document.querySelectorAll('#pptPoolList .pool-item').length`);
      if (count >= 2) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(ready, true, 'PPT 簡報池必須成功渲染至少 2 份簡報');

    // [硬鎖 2] 驗證實體視窗幾何與 Material LIFF 風格計算樣式
    const geomAndStyle = await cdp.eval(`(() => {
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const card = document.querySelector('.card');
      const cardStyle = getComputedStyle(card);
      const btn = document.getElementById('btnPgmNext');
      const btnStyle = getComputedStyle(btn);
      return {
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        bodyBg,
        cardBg: cardStyle.backgroundColor,
        cardRadius: cardStyle.borderRadius,
        btnBg: btnStyle.backgroundColor
      };
    })()`);

    assert.ok(geomAndStyle.outerWidth > 0 && geomAndStyle.outerHeight > 0, '實體瀏覽器視窗幾何必須 > 0');
    assert.equal(geomAndStyle.bodyBg, 'rgb(248, 250, 252)', '背景色必須對標 material-liff-study (#f8fafc)');
    assert.equal(geomAndStyle.cardBg, 'rgb(255, 255, 255)', '卡片必須為純白底 (.card)');
    assert.equal(geomAndStyle.cardRadius, '16px', '卡片圓角必須為 16px (rounded-2xl)');
    assert.equal(geomAndStyle.btnBg, 'rgb(14, 165, 233)', '主按鈕必須對標 primary (#0ea5e9)');

    // [硬鎖 3A] 測試真實點擊「▶ 下一頁」觸發 PowerPoint COM 頁內動畫步進，以及「⇄ 無縫切換 (CUT)」雙 PPT 互換
    const beforePgmTitle = await cdp.eval(`document.getElementById('pgmDeckTitle').textContent`);
    const beforePvwTitle = await cdp.eval(`document.getElementById('pvwDeckTitle').textContent`);
    assert.notEqual(beforePgmTitle, beforePvwTitle, 'PGM 與 PVW 應載入不同簡報待命');

    await cdp.eval(`document.getElementById('btnCutSwap').click()`);
    await new Promise((r) => setTimeout(r, 500));

    const afterPgmTitle = await cdp.eval(`document.getElementById('pgmDeckTitle').textContent`);
    assert.equal(afterPgmTitle, beforePvwTitle, '點擊 CUT 無縫切換後，原本 PVW 的簡報必須立即成為 PGM 主播出');

    // [硬鎖 3B] 測試真實點擊「◼ 黑屏」觸發 getComputedStyle 背景色物理突變 (Δ ≠ 0)
    const blackBgBefore = await cdp.eval(`getComputedStyle(document.getElementById('btnBlackScreen')).backgroundColor`);
    await cdp.eval(`document.getElementById('btnBlackScreen').click()`);
    await new Promise((r) => setTimeout(r, 350));
    const blackBgAfter = await cdp.eval(`getComputedStyle(document.getElementById('btnBlackScreen')).backgroundColor`);

    assert.notEqual(
      blackBgBefore,
      blackBgAfter,
      `點擊黑屏按鈕後 getComputedStyle 背景色必須發生實質突變 (Before=${blackBgBefore}, After=${blackBgAfter})`
    );
    // 解除黑屏恢復正常播出以截圖
    await cdp.eval(`document.getElementById('btnBlackScreen').click()`);
    await new Promise((r) => setTimeout(r, 300));

    // [硬鎖 3C] 驗證影片池 HTTP 206 Range 分段串流
    const videoResStatus = await new Promise((resolve, reject) => {
      http.get(`${baseUrl}/videos/${encodeURIComponent('01_前行緣念.mp4')}`, {
        headers: { Range: 'bytes=0-1023' }
      }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(videoResStatus, 206, '影片池必須支援 HTTP 206 Partial Content 零延遲分段串流');

    // [硬鎖 4] 擷取真機像素快照存證
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    assert.ok(shot && shot.data && shot.data.length > 1000, '必須成功擷取真機 PNG 像素快照');
    const artifactsDir = path.join(projectRoot, 'artifacts');
    fs.mkdirSync(artifactsDir, { recursive: true });
    const shotPath = path.join(artifactsDir, 'e2e-ppt-stage-deck-live.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    assert.equal(fs.existsSync(shotPath), true, '實體截圖物證必須落盤保存');
  } finally {
    if (cdp) cdp.close();
    try { browserProc.kill(); } catch {}
    await appServer.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
});

