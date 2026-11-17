// ============================================================================
// 🚀 PPT Stage Deck Server (雙軌 PPT PGM/PVW 無縫切換 ＋ HTTP 206 零雜訊影片池中樞)
// ============================================================================

import fs from 'fs';
import path from 'path';
import http from 'http';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { DeckStateMachine, DECK_ACTIONS } from './src/core/deck-state-machine.mjs';
import { MediaPoolManager } from './src/core/media-pool-manager.mjs';
import { PptComEngine } from './src/core/ppt-com-engine.mjs';
import { Updater } from './src/core/updater.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getLanIPv4() {
  try {
    const nets = os.networkInterfaces();
    let fallback = '';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          if (/wi-?fi|wlan|ethernet|乙太/i.test(name)) return net.address;
          if (!fallback) fallback = net.address;
        }
      }
    }
    return fallback || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFallbackSvg(deckId, slideNum) {
  const safeDeckId = escapeXml(deckId);
  const safeSlideNum = escapeXml(slideNum);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#0f172a"/>
  <rect x="48" y="48" width="1184" height="624" rx="24" fill="#1e293b" stroke="#0ea5e9" stroke-width="4"/>
  <text x="640" y="320" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-size="46" font-weight="bold">${safeDeckId}</text>
  <text x="640" y="410" text-anchor="middle" fill="#38bdf8" font-family="sans-serif" font-size="36">Slide ${safeSlideNum}</text>
</svg>`;
}

export async function createPptStageServer({
  port = 8890,
  mockPpt = false,
  targetDisplay = process.env.TARGET_DISPLAY || '',
  slidesDir = path.join(__dirname, 'assets', 'slides'),
  videosDir = path.join(__dirname, 'assets', 'videos'),
  previewsDir = path.join(__dirname, 'assets', 'previews'),
  imagesDir = path.join(__dirname, 'assets', 'images'),
  audiosDir = path.join(__dirname, 'assets', 'audios'),
  keyVisualDir = path.join(__dirname, 'assets', 'key-visual')
} = {}) {
  const poolManager = new MediaPoolManager({ slidesDir, videosDir, previewsDir, imagesDir, audiosDir });
  const pptEngine = new PptComEngine({
    workerScriptPath: path.join(__dirname, 'scripts', 'ppt-com-worker.ps1'),
    mockMode: mockPpt,
    targetDisplay
  });
  const updater = new Updater({ projectRoot: __dirname });

  if (!fs.existsSync(keyVisualDir)) {
    fs.mkdirSync(keyVisualDir, { recursive: true });
  }

  let initialKeyVisualUrl = null;
  try {
    const existingKvFiles = fs.readdirSync(keyVisualDir).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f));
    if (existingKvFiles.length > 0) {
      initialKeyVisualUrl = `/key-visual/${encodeURIComponent(existingKvFiles[0])}`;
    }
  } catch {}

  const screenInfo = await pptEngine.start();
  let pptMetaMap = {};
  if (!mockPpt) {
    const scanRes = await pptEngine.scanAndExport({ slidesDir, previewsDir });
    if (scanRes && scanRes.ok && scanRes.metadata) {
      pptMetaMap = scanRes.metadata;
    }
  }

  const initialPptPool = poolManager.scanSlides(pptMetaMap);
  const initialVideoPool = poolManager.scanVideos();
  const initialImagePool = poolManager.scanImages();
  const initialAudioPool = poolManager.scanAudios();

  const stateMachine = new DeckStateMachine({
    cleanColdBoot: true, // 長官鐵律：現場伺服器開機預設為純淨雙空槽 (STANDBY)，PGM 與 Preview 絕不預載素材
    pptPool: initialPptPool,
    videoPool: initialVideoPool,
    imagePool: initialImagePool,
    audioPool: initialAudioPool,
    keyVisualUrl: initialKeyVisualUrl,
    targetDisplay: screenInfo.deviceName || '\\\\.\\DISPLAY2'
  });

  // 啟動時預熱雙 PPT (PGM 與 PVW) 於第二螢幕並同步即時預覽幀
  const initState = stateMachine.getState();
  if (!mockPpt && (initState.pgm.deckId || initState.pvw.deckId)) {
    const slotRes = await pptEngine.setSlots({
      pgmDeckId: initState.pgm.deckId,
      pvwDeckId: initState.pvw.deckId,
      stageMode: initState.outputMode
    });
    if (slotRes && slotRes.ok && slotRes.pgm) {
      stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...slotRes.pgm });
    }
    if (slotRes && slotRes.ok && slotRes.pvw) {
      stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...slotRes.pvw });
    }
  }

  const wsClients = new Set();

  function broadcastState() {
    const payload = JSON.stringify({
      type: 'STATE_UPDATE',
      data: stateMachine.getState()
    });
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch { }
      }
    }
  }

  let actionQueue = Promise.resolve();
  function handleAction(action, payload = {}) {
    const next = actionQueue.then(() => executeAction(action, payload));
    actionQueue = next.catch(() => {});
    return next;
  }

  async function executeAction(action, payload = {}) {
    if (action === DECK_ACTIONS.REFRESH_POOLS) {
      if (!mockPpt) {
        const scanRes = await pptEngine.scanAndExport({ slidesDir, previewsDir });
        if (scanRes && scanRes.ok && scanRes.metadata) {
          pptMetaMap = scanRes.metadata;
        }
      }
      stateMachine.setPools({
        pptPool: poolManager.scanSlides(pptMetaMap),
        videoPool: poolManager.scanVideos(),
        imagePool: poolManager.scanImages(),
        audioPool: poolManager.scanAudios()
      });
      broadcastState();
      return stateMachine.getState();
    }

    const nextState = stateMachine.dispatch(action, payload);
    // 先行廣播樂觀狀態，確保前端 UI 即刻更新預覽圖與標題，絕不因背景 PowerPoint COM 耗時而卡住畫面！
    broadcastState();

    if (!mockPpt) {
      const isLoadPgmPpt =
        action === DECK_ACTIONS.LOAD_PGM ||
        (action === DECK_ACTIONS.PLAY_MEDIA_PGM && nextState.outputMode === 'ppt' && nextState.pgm.deckId);
      const isLoadPvwPpt =
        action === DECK_ACTIONS.LOAD_PVW ||
        (action === DECK_ACTIONS.LOAD_MEDIA_PVW && nextState.pvw.type === 'ppt' && nextState.pvw.deckId);

      if (isLoadPgmPpt || isLoadPvwPpt) {
        const slotRes = await pptEngine.setSlots({
          pgmDeckId: nextState.pgm.deckId,
          pvwDeckId: nextState.pvw.deckId,
          stageMode: nextState.outputMode
        });
        if (isLoadPgmPpt && nextState.pgm.currentSlide > 0) {
          const stepRes = await pptEngine.stepSlot({ slot: 'pgm', deckId: nextState.pgm.deckId, direction: 'goto', slide: nextState.pgm.currentSlide });
          if (stepRes && stepRes.ok && stepRes.runtime) {
            stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...stepRes.runtime });
          }
        } else if (slotRes && slotRes.ok && slotRes.pgm) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...slotRes.pgm });
        }
        if (isLoadPvwPpt && nextState.pvw.currentSlide > 0) {
          const stepRes = await pptEngine.stepSlot({ slot: 'pvw', deckId: nextState.pvw.deckId, direction: 'goto', slide: nextState.pvw.currentSlide });
          if (stepRes && stepRes.ok && stepRes.runtime) {
            stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...stepRes.runtime });
          }
        } else if (slotRes && slotRes.ok && slotRes.pvw) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...slotRes.pvw });
        }
      } else if (action === DECK_ACTIONS.CUT_SWAP) {
        if (nextState.outputMode !== 'ppt') {
          // 將 PVW 預覽影片/圖片/音訊/空槽推上 PGM 舞台播出，原 PGM 簡報退居 PVW
          const slotRes = await pptEngine.setSlots({
            pgmDeckId: nextState.pgm.deckId || null,
            pvwDeckId: nextState.pvw.deckId || null,
            stageMode: nextState.outputMode
          });
          if (slotRes && slotRes.ok && slotRes.pvw && nextState.pvw.deckId) {
            stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...slotRes.pvw });
          }
        } else if (nextState.pgm.deckId && nextState.pvw.deckId) {
          // 雙 PPT 互切
          const swapRes = await pptEngine.cutSwap();
          if (swapRes && swapRes.ok && swapRes.pgm) {
            stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...swapRes.pgm });
          }
          if (swapRes && swapRes.ok && swapRes.pvw) {
            stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...swapRes.pvw });
          }
          await pptEngine.setStageMode(nextState.outputMode);
        } else {
          // 單 PPT 從 PVW 切上 PGM（原 PGM 為影片或空槽）
          const slotRes = await pptEngine.setSlots({
            pgmDeckId: nextState.pgm.deckId || null,
            pvwDeckId: nextState.pvw.deckId || null,
            stageMode: 'ppt'
          });
          if (slotRes && slotRes.ok && slotRes.pgm && nextState.pgm.deckId) {
            stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...slotRes.pgm });
          }
        }
      } else if (action === DECK_ACTIONS.PGM_NEXT || action === DECK_ACTIONS.PGM_PREV || action === DECK_ACTIONS.PGM_GOTO) {
        const dir = action === DECK_ACTIONS.PGM_NEXT ? 'next' : action === DECK_ACTIONS.PGM_PREV ? 'prev' : 'goto';
        const stepRes = await pptEngine.stepSlot({ slot: 'pgm', deckId: nextState.pgm.deckId, direction: dir, slide: nextState.pgm.currentSlide });
        if (stepRes && stepRes.ok && stepRes.runtime) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...stepRes.runtime });
        }
      } else if (action === DECK_ACTIONS.PVW_NEXT || action === DECK_ACTIONS.PVW_PREV || action === DECK_ACTIONS.PVW_GOTO) {
        const dir = action === DECK_ACTIONS.PVW_NEXT ? 'next' : action === DECK_ACTIONS.PVW_PREV ? 'prev' : 'goto';
        const stepRes = await pptEngine.stepSlot({ slot: 'pvw', deckId: nextState.pvw.deckId, direction: dir, slide: nextState.pvw.currentSlide });
        if (stepRes && stepRes.ok && stepRes.runtime) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...stepRes.runtime });
        }
      } else if (
        action === DECK_ACTIONS.TOGGLE_BLACK ||
        action === DECK_ACTIONS.PLAY_VIDEO ||
        action === DECK_ACTIONS.STOP_VIDEO ||
        action === DECK_ACTIONS.VIDEO_ENDED ||
        action === DECK_ACTIONS.TOGGLE_KV_MODE ||
        action === DECK_ACTIONS.PLAY_MEDIA_PGM ||
        action === DECK_ACTIONS.STOP_MEDIA
      ) {
        await pptEngine.setStageMode(nextState.outputMode);
      }
    }

    broadcastState();
    return stateMachine.getState();
  }

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = decodeURIComponent(reqUrl.pathname);

    if (pathname === '/api/state' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        lanIp: getLanIPv4(),
        port: server.address()?.port || port,
        screen: screenInfo,
        state: stateMachine.getState()
      }));
      return;
    }

    // 全域連鎖優雅退場 API (主控台右上角 X 或按鈕一鍵退出)
    if (pathname === '/api/shutdown' && (req.method === 'POST' || req.method === 'GET')) {
      const noExit = reqUrl.searchParams.get('noExit') === '1';
      if (noExit) {
        triggerGracefulShutdown({ exitProcess: false, closeHttpServer: false }).then(() => {
          res.on('finish', () => {
            try {
              server.closeAllConnections?.();
              server.close();
            } catch {}
          });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
          res.end(JSON.stringify({ ok: true, purged: true, message: 'Graceful shutdown and asset purge completed.' }));
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, message: 'Graceful shutdown initiated.' }));
      setTimeout(() => triggerGracefulShutdown({ exitProcess: true, closeHttpServer: true }), 100);
      return;
    }

    // 一鍵打開素材目錄 (Windows 檔案總管秒開)
    if (pathname === '/api/open-folder' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { target } = JSON.parse(body || '{}');
          let targetDir = slidesDir;
          if (target === 'videos') targetDir = videosDir;
          if (target === 'images') targetDir = imagesDir;
          if (target === 'audios') targetDir = audiosDir;
          if (target === 'key-visual' || target === 'kv') targetDir = keyVisualDir;
          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
          spawn('explorer.exe', [targetDir], { detached: true, stdio: 'ignore' }).unref();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, opened: targetDir }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // 檢查 GitHub 版本更新
    if (pathname === '/api/check-update' && req.method === 'GET') {
      const force = reqUrl.searchParams.get('force') === '1';
      updater.checkUpdate({ force }).then((result) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      });
      return;
    }

    // 執行一鍵更新
    if (pathname === '/api/perform-update' && req.method === 'POST') {
      updater.performUpdate().then((result) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      });
      return;
    }

    // PPT 修改區：讀取指定投影片頁內文字框
    if (pathname === '/api/ppt-slide-text' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { deckId, slide = 1 } = JSON.parse(body || '{}');
          const result = await pptEngine.getSlideText({ deckId, slide: Number(slide) || 1 });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result || { ok: false, items: [] }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // PPT 修改區：直接修改投影片文字並重繪縮圖
    if (pathname === '/api/ppt-save-text' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { deckId, slide = 1, shapeIndex = 1, text = '' } = JSON.parse(body || '{}');
          const sNum = Number(slide) || 1;
          const result = await pptEngine.setSlideText({
            deckId,
            slide: sNum,
            shapeIndex: Number(shapeIndex) || 1,
            text: String(text ?? ''),
            previewsDir
          });
          // 刷新該簡報預覽圖快取時間戳並通知前端
          stateMachine.setPools({
            pptPool: poolManager.scanSlides(pptMetaMap)
          });
          broadcastState();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: Boolean(result?.ok), state: stateMachine.getState() }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // PPT 修改區：喚起原生 PowerPoint 視窗編輯當前簡報與頁碼
    if (pathname === '/api/ppt-open-edit' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { deckId, slide = 1 } = JSON.parse(body || '{}');
          const deck = stateMachine.findDeck(deckId);
          const filePath = deck ? path.join(slidesDir, deck.fileName) : '';
          const result = await pptEngine.openNativeEdit({ deckId, filePath, slide: Number(slide) || 1 });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: Boolean(result?.ok), deckId, slide }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // PPT 修改區：存檔後一鍵熱重載簡報與重繪全部縮圖
    if (pathname === '/api/ppt-reload-deck' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { deckId } = JSON.parse(body || '{}');
          const deck = stateMachine.findDeck(deckId);
          const filePath = deck ? path.join(slidesDir, deck.fileName) : '';
          const reloadRes = await pptEngine.reloadDeck({ deckId, filePath, previewsDir });
          if (reloadRes && reloadRes.ok && reloadRes.meta) {
            pptMetaMap[deckId] = reloadRes.meta;
          }
          stateMachine.setPools({
            pptPool: poolManager.scanSlides(pptMetaMap)
          });
          broadcastState();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, state: stateMachine.getState() }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // 臨時字卡區：一鍵生成高解析臨時公告字卡並送至預覽 (PVW) 或直接播出 (PGM)
    if (pathname === '/api/quick-notice' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { title = '現場公告', content = '', theme = 'navy', target = 'pvw' } = JSON.parse(body || '{}');
          if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
          const bgMap = {
            navy: { bg: '#0f172a', card: '#1e293b', border: '#38bdf8', titleColor: '#38bdf8', textColor: '#f8fafc' },
            gold: { bg: '#271705', card: '#422006', border: '#f59e0b', titleColor: '#fbbf24', textColor: '#fef3c7' },
            red: { bg: '#450a0a', card: '#7f1d1d', border: '#f87171', titleColor: '#fca5a5', textColor: '#ffffff' }
          };
          const t = bgMap[theme] || bgMap.navy;
          const safeTitle = escapeXml(title || '現場公告');
          const lines = String(content || '請留意現場指引').split(/\r?\n/).slice(0, 4);
          const textTspans = lines.map((line, i) => {
            const dy = i === 0 ? 0 : 74;
            return `<tspan x="640" dy="${dy}">${escapeXml(line)}</tspan>`;
          }).join('');
          const startY = lines.length <= 1 ? 410 : lines.length === 2 ? 375 : 340;
          const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="${t.bg}"/>
  <rect x="56" y="56" width="1168" height="608" rx="28" fill="${t.card}" stroke="${t.border}" stroke-width="5"/>
  <text x="640" y="210" text-anchor="middle" fill="${t.titleColor}" font-family="Microsoft JhengHei, sans-serif" font-size="52" font-weight="bold">${safeTitle}</text>
  <line x1="240" y1="255" x2="1040" y2="255" stroke="${t.border}" stroke-width="2" stroke-opacity="0.45"/>
  <text x="640" y="${startY}" text-anchor="middle" fill="${t.textColor}" font-family="Microsoft JhengHei, sans-serif" font-size="54" font-weight="bold">${textTspans}</text>
</svg>`;
          const noticeFileName = '00_臨時公告字卡.svg';
          fs.writeFileSync(path.join(imagesDir, noticeFileName), svg, 'utf8');
          stateMachine.setPools({
            imagePool: poolManager.scanImages()
          });
          const noticeId = '00_臨時公告字卡';
          const act = target === 'pgm' ? DECK_ACTIONS.PLAY_MEDIA_PGM : DECK_ACTIONS.LOAD_MEDIA_PVW;
          const updatedState = await handleAction(act, { mediaId: noticeId, type: 'image' });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, noticeId, state: updatedState }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // 主視覺上傳 API (支援 Base64 Data URL)
    if (pathname === '/api/upload-key-visual' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 50 * 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Payload Too Large' }));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const dataUrl = parsed.dataUrl;
          const fileName = parsed.fileName || 'kv.png';
          if (!dataUrl || typeof dataUrl !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Missing dataUrl parameter' }));
            return;
          }
          if (!fs.existsSync(keyVisualDir)) {
            fs.mkdirSync(keyVisualDir, { recursive: true });
          }
          const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          let ext = '.png';
          if (fileName) {
            const parsedExt = path.extname(fileName).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(parsedExt)) {
              ext = parsedExt;
            }
          }
          const targetFileName = `kv${ext}`;
          const targetFilePath = path.join(keyVisualDir, targetFileName);

          const buffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(dataUrl, 'base64');
          fs.writeFileSync(targetFilePath, buffer);

          const kvUrl = `/key-visual/${encodeURIComponent(targetFileName)}?t=${Date.now()}`;
          stateMachine.dispatch(DECK_ACTIONS.SET_KEY_VISUAL, { url: kvUrl });
          broadcastState();

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, url: kvUrl }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // 綜合素材二進制分段/串流上傳 API (支援直接把 2GB+ PPT/影片抓進來，絕不吃爆內存)
    if (pathname === '/api/upload-media' && req.method === 'POST') {
      const qFileName = reqUrl.searchParams.get('filename') || req.headers['x-file-name'];
      if (qFileName) {
        // 二進制原始串流寫檔 (直接 pipe 到磁碟，零 Base64 膨脹，支援幾 GB 檔案)
        let rawDecoded = qFileName;
        try { rawDecoded = decodeURIComponent(qFileName); } catch {}
        const safeBaseName = path.basename(rawDecoded)
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
          .trim();
        const ext = path.extname(safeBaseName).toLowerCase();
        let targetDir = null;
        let fileType = null;

        if (['.pptx', '.ppt', '.ppsx', '.pptm', '.ppsm'].includes(ext)) {
          targetDir = slidesDir;
          fileType = 'ppt';
        } else if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) {
          targetDir = videosDir;
          fileType = 'video';
        } else if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext)) {
          targetDir = imagesDir;
          fileType = 'image';
        } else if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) {
          targetDir = audiosDir;
          fileType = 'audio';
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: '不支援的檔案格式' }));
          return;
        }

        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        const targetFilePath = path.join(targetDir, safeBaseName);
        const fileStream = fs.createWriteStream(targetFilePath);

        req.pipe(fileStream);

        fileStream.on('finish', async () => {
          try {
            if (fileType === 'ppt') {
              if (!mockPpt) {
                try {
                  const scanRes = await pptEngine.scanAndExport({ slidesDir, previewsDir });
                  if (scanRes && scanRes.ok && scanRes.metadata) {
                    pptMetaMap = scanRes.metadata;
                  }
                } catch (e) {
                  console.error('[UploadMedia] PPT 預覽掃描警告:', e.message);
                }
              }
            }
            stateMachine.setPools({
              pptPool: poolManager.scanSlides(pptMetaMap),
              videoPool: poolManager.scanVideos(),
              imagePool: poolManager.scanImages(),
              audioPool: poolManager.scanAudios()
            });
            broadcastState();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, fileType, fileName: safeBaseName, state: stateMachine.getState() }));
          } catch (err) {
            console.error('[UploadMedia] 刷新池處理異常:', err);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, fileType, fileName: safeBaseName, state: stateMachine.getState() }));
          }
        });

        fileStream.on('error', (err) => {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
        return;
      }

      // 相容原有 JSON / Base64 上傳 (支援上限放寬至 2GB)
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 2048 * 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: '檔案過大 (限 2GB 內)' }));
          req.destroy();
        }
      });
      req.on('end', async () => {
        try {
          const { dataUrl, fileName } = JSON.parse(body || '{}');
          if (!dataUrl || !fileName) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: '缺少 dataUrl 或 fileName' }));
            return;
          }

          const safeBaseName = path.basename(fileName).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5.]/g, '_');
          const ext = path.extname(safeBaseName).toLowerCase();
          let targetDir = null;
          let fileType = null;

          if (['.pptx', '.ppt', '.ppsx'].includes(ext)) {
            targetDir = slidesDir;
            fileType = 'ppt';
          } else if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) {
            targetDir = videosDir;
            fileType = 'video';
          } else if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext)) {
            targetDir = imagesDir;
            fileType = 'image';
          } else if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) {
            targetDir = audiosDir;
            fileType = 'audio';
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: '僅支援 PPT 簡報檔、影片檔、圖片檔或音訊檔' }));
            return;
          }

          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
          const targetFilePath = path.join(targetDir, safeBaseName);
          const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          const buffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(dataUrl, 'base64');
          fs.writeFileSync(targetFilePath, buffer);

          await handleAction(DECK_ACTIONS.REFRESH_POOLS);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, fileType, fileName: safeBaseName, state: stateMachine.getState() }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    if (pathname === '/api/action' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const updatedState = await handleAction(parsed.action, parsed.payload || {});
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, state: updatedState }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // 投影片預覽圖服務 (/previews/<deckId>/slide-<n>.png)
    if (pathname.startsWith('/previews/')) {
      const rel = pathname.slice('/previews/'.length);
      const resolvedRoot = path.resolve(previewsDir);
      const filePath = path.resolve(previewsDir, rel);
      const isInsideRoot = filePath.startsWith(resolvedRoot + path.sep);
      if (!isInsideRoot && filePath !== resolvedRoot) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      if (isInsideRoot && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      const parts = rel.split('/');
      const dId = parts[0] || 'Deck';
      const sMatch = (parts[1] || '').match(/slide-(\d+)/i);
      const sNum = sMatch ? sMatch[1] : '1';
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
      res.end(buildFallbackSvg(dId, sNum));
      return;
    }

    // 主視覺底圖服務 (/key-visual/<filename>)
    if (pathname.startsWith('/key-visual/')) {
      const rel = pathname.slice('/key-visual/'.length);
      const resolvedRoot = path.resolve(keyVisualDir);
      const filePath = path.resolve(keyVisualDir, rel);
      const isInsideRoot = filePath.startsWith(resolvedRoot + path.sep);
      if (!isInsideRoot && filePath !== resolvedRoot) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      if (isInsideRoot && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        let mime = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        else if (ext === '.webp') mime = 'image/webp';
        else if (ext === '.svg') mime = 'image/svg+xml';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Key Visual Not Found');
      return;
    }

    // 影片池 HTTP 206 Range 零雜訊分段串流 (對標 projects/amrtf-desk)
    if (pathname.startsWith('/videos/')) {
      const fileName = path.basename(pathname);
      const filePath = path.join(videosDir, fileName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes'
          });
          res.end();
          return;
        }

        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
          if (!match || (match[1] === '' && match[2] === '')) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
            res.end();
            return;
          }
          const start = match[1] !== '' ? parseInt(match[1], 10) : 0;
          const rawEnd = match[2] !== '' ? parseInt(match[2], 10) : fileSize - 1;
          const end = Math.min(rawEnd, fileSize - 1);

          if (
            Number.isNaN(start) ||
            Number.isNaN(end) ||
            start < 0 ||
            start >= fileSize ||
            start > end
          ) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
            res.end();
            return;
          }

          const maxChunkSize = 8 * 1024 * 1024; // 每次上限 8MB，完整涵蓋長片 4.4MB moov 索引並防止 1.6GB 塞爆內存
          const requestedChunk = (end - start) + 1;
          const actualEnd = requestedChunk > maxChunkSize ? start + maxChunkSize - 1 : end;
          const chunkSize = (actualEnd - start) + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${actualEnd}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4',
            'Cache-Control': 'no-store'
          });
          const videoStream = fs.createReadStream(filePath, { start, end: actualEnd });
          res.on('close', () => videoStream.destroy());
          videoStream.pipe(res);
        } else {
          // 嚴禁無 Range 情況下全量灌入 1.6GB 檔案導致瀏覽器 OOM！預設回傳前 2MB
          const defaultEnd = Math.min(2 * 1024 * 1024 - 1, fileSize - 1);
          const chunkSize = defaultEnd + 1;
          res.writeHead(206, {
            'Content-Range': `bytes 0-${defaultEnd}/${fileSize}`,
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
          });
          fs.createReadStream(filePath, { start: 0, end: defaultEnd }).pipe(res);
        }
        return;
      }
    }

    // 靜態圖片服務 (/images/<filename>)
    if (pathname.startsWith('/images/')) {
      const fileName = path.basename(pathname);
      const filePath = path.join(imagesDir, fileName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        let mime = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        else if (ext === '.webp') mime = 'image/webp';
        else if (ext === '.svg') mime = 'image/svg+xml';
        else if (ext === '.gif') mime = 'image/gif';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    // 音訊檔 HTTP 206 Range 串流服務 (/audios/<filename>)
    if (pathname.startsWith('/audios/')) {
      const fileName = path.basename(pathname);
      const filePath = path.join(audiosDir, fileName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const ext = path.extname(filePath).toLowerCase();
        let mime = 'audio/mpeg';
        if (ext === '.wav') mime = 'audio/wav';
        else if (ext === '.m4a' || ext === '.aac') mime = 'audio/mp4';
        else if (ext === '.ogg') mime = 'audio/ogg';

        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': mime,
            'Accept-Ranges': 'bytes'
          });
          res.end();
          return;
        }

        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
          if (!match || (match[1] === '' && match[2] === '')) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
            res.end();
            return;
          }
          const start = match[1] !== '' ? parseInt(match[1], 10) : 0;
          const rawEnd = match[2] !== '' ? parseInt(match[2], 10) : fileSize - 1;
          const end = Math.min(rawEnd, fileSize - 1);

          if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= fileSize || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
            res.end();
            return;
          }

          const chunkSize = (end - start) + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': mime
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': mime,
            'Accept-Ranges': 'bytes'
          });
          fs.createReadStream(filePath).pipe(res);
        }
        return;
      }
    }

    // 靜態前端資源
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'));
      return;
    }
    if (pathname === '/stage' || pathname === '/stage.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'stage.html'), 'utf8'));
      return;
    }
    if (pathname === '/styles.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8'));
      return;
    }
    if (pathname === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8'));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  let isShuttingDown = false;
  let activeDeskConnections = 0;
  let shutdownTimer = null;

  async function triggerGracefulShutdown({ exitProcess = true, closeHttpServer = true } = {}) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n🛑 收到退出信號，正在執行全域連鎖優雅銷毀與素材清空 (Graceful Shutdown & Purge)...');

    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(JSON.stringify({ type: 'SHUTDOWN' })); } catch { }
      }
    }

    try {
      await pptEngine.shutdown();
    } catch { }

    // 長官指令兜底：確保在退出系統時將 PowerPoint 之 ShowPresenterView 與 UseMonMgr 恢復為 1 (啟用)
    try {
      if (process.platform === 'win32') {
        const restoreScript = `Get-ChildItem "HKCU:\\Software\\Microsoft\\Office" -ErrorAction SilentlyContinue | ForEach-Object { $optPath = Join-Path $_.PSPath "PowerPoint\\Options"; if (Test-Path $optPath) { Set-ItemProperty -Path $optPath -Name "UseMonMgr" -Value 1 -Type DWord -ErrorAction SilentlyContinue; Set-ItemProperty -Path $optPath -Name "ShowPresenterView" -Value 1 -Type DWord -ErrorAction SilentlyContinue } }`;
        const cp = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', restoreScript], { stdio: 'ignore', windowsHide: true });
        cp.unref();
      }
    } catch { }

    // 正常退場時一併清空 slides, videos, previews, images, audios, key-visual 所有已載入檔案
    try {
      poolManager.purgeAllAssets([keyVisualDir]);
      stateMachine.setPools({
        pptPool: [],
        videoPool: [],
        imagePool: [],
        audioPool: []
      });
      stateMachine.dispatch(DECK_ACTIONS.CLEAR_KEY_VISUAL);
    } catch { }

    for (const client of wsClients) {
      try { client.terminate(); } catch { }
    }
    wsClients.clear();

    if (closeHttpServer) {
      try {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      } catch { }
    }

    console.log('✅ 全場投影放映視窗、PowerPoint COM 行程、已載入素材檔案與伺服器已全數乾淨釋放，系統安全退出。');
    if (exitProcess) {
      setTimeout(() => {
        process.exit(0);
      }, 400);
    }
  }

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    wsClients.add(ws);
    const reqUrl = req?.url || '';
    const isDesk = reqUrl.includes('client=desk');
    if (isDesk) {
      activeDeskConnections++;
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
      }
    }

    if (!mockPpt && reqUrl.includes('client=stage')) {
      setTimeout(() => {
        const curMode = stateMachine.getState().outputMode;
        pptEngine.setStageMode(curMode).catch(() => {});
      }, 250);
    }
    ws.send(JSON.stringify({
      type: 'INIT_INFO',
      data: {
        lanIp: getLanIPv4(),
        port: server.address()?.port || port,
        screen: screenInfo
      }
    }));
    ws.send(JSON.stringify({
      type: 'STATE_UPDATE',
      data: stateMachine.getState()
    }));
    ws.on('close', () => {
      wsClients.delete(ws);
      if (isDesk) {
        activeDeskConnections = Math.max(0, activeDeskConnections - 1);
        if (activeDeskConnections === 0 && !isShuttingDown) {
          shutdownTimer = setTimeout(() => {
            if (activeDeskConnections === 0 && !isShuttingDown) {
              console.log('\n[StageDeck] 偵測到主控台視窗已關閉 (X)，自動觸發全域連鎖退出...');
              triggerGracefulShutdown();
            }
          }, 2500);
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
  const actualPort = server.address().port;

  return {
    server,
    wss,
    port: actualPort,
    stateMachine,
    pptEngine,
    screenInfo,
    handleAction,
    close: async () => {
      for (const client of wsClients) {
        try { client.terminate(); } catch { }
      }
      wsClients.clear();
      await pptEngine.shutdown();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

function findBrowserExe() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase()) {
  const port = Number(process.env.PORT) || 8890;
  createPptStageServer({ port }).then(({ port: boundPort, screenInfo }) => {
    const lanIp = getLanIPv4();
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  🎛️ PPT 現場導播控場台 (PPT Stage Deck · Material LIFF Style)');
    console.log(`  🖥️ 電腦主控台: http://127.0.0.1:${boundPort}`);
    console.log(`  📱 手機遙控台: http://${lanIp}:${boundPort}`);
    console.log(`  🎬 第二螢幕艙: http://127.0.0.1:${boundPort}/stage (${screenInfo.deviceName})`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (!process.env.NO_BROWSER) {
      const browser = findBrowserExe();
      if (browser) {
        const stageProfileDir = path.join(os.tmpdir(), 'ppt-stage-deck-stage-profile');
        const deskProfileDir = path.join(os.tmpdir(), 'ppt-stage-deck-desk-profile');
        // 1. 於第二螢幕開啟零雜訊影片、簡報與黑屏放映艙 (獨立 Profile + Kiosk 真無邊框滿版全螢幕)
        spawn(browser, [
          `--user-data-dir=${stageProfileDir}`,
          '--kiosk',
          `--window-position=${screenInfo.x},${screenInfo.y}`,
          `--window-size=${screenInfo.width},${screenInfo.height}`,
          '--disable-session-crashed-bubble',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=CalculateNativeWinOcclusion',
          '--no-first-run',
          '--no-default-browser-check',
          '--hide-scrollbars',
          `http://127.0.0.1:${boundPort}/stage`
        ], { detached: true, stdio: 'ignore' }).unref();

        // 2. 於第一螢幕開啟主控台
        spawn(browser, [
          `--user-data-dir=${deskProfileDir}`,
          `--app=http://127.0.0.1:${boundPort}`,
          '--window-position=40,40',
          '--window-size=1240,800',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=CalculateNativeWinOcclusion',
          '--no-first-run',
          '--no-default-browser-check'
        ], { detached: true, stdio: 'ignore' }).unref();
      }
    }
  }).catch((err) => {
    console.error('[FATAL SERVER ERROR]', err);
  });
}

