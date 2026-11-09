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

function buildFallbackSvg(deckId, slideNum) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#0f172a"/>
  <rect x="48" y="48" width="1184" height="624" rx="24" fill="#1e293b" stroke="#0ea5e9" stroke-width="4"/>
  <text x="640" y="320" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-size="46" font-weight="bold">${deckId}</text>
  <text x="640" y="410" text-anchor="middle" fill="#38bdf8" font-family="sans-serif" font-size="36">Slide ${slideNum}</text>
</svg>`;
}

export async function createPptStageServer({
  port = 8890,
  mockPpt = false,
  slidesDir = path.join(__dirname, 'assets', 'slides'),
  videosDir = path.join(__dirname, 'assets', 'videos'),
  previewsDir = path.join(__dirname, 'assets', 'previews')
} = {}) {
  const poolManager = new MediaPoolManager({ slidesDir, videosDir, previewsDir });
  const pptEngine = new PptComEngine({
    workerScriptPath: path.join(__dirname, 'scripts', 'ppt-com-worker.ps1'),
    mockMode: mockPpt
  });

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

  const stateMachine = new DeckStateMachine({
    pptPool: initialPptPool,
    videoPool: initialVideoPool,
    targetDisplay: screenInfo.deviceName || '\\\\.\\DISPLAY2'
  });

  // 啟動時預熱雙 PPT (PGM 與 PVW) 於第二螢幕
  const initState = stateMachine.getState();
  if (!mockPpt && (initState.pgm.deckId || initState.pvw.deckId)) {
    await pptEngine.setSlots({
      pgmDeckId: initState.pgm.deckId,
      pvwDeckId: initState.pvw.deckId,
      stageMode: initState.outputMode
    });
  }

  const wsClients = new Set();

  function broadcastState() {
    const payload = JSON.stringify({
      type: 'STATE_UPDATE',
      data: stateMachine.getState()
    });
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch {}
      }
    }
  }

  async function handleAction(action, payload = {}) {
    if (action === DECK_ACTIONS.REFRESH_POOLS) {
      if (!mockPpt) {
        const scanRes = await pptEngine.scanAndExport({ slidesDir, previewsDir });
        if (scanRes && scanRes.ok && scanRes.metadata) {
          pptMetaMap = scanRes.metadata;
        }
      }
      stateMachine.setPools({
        pptPool: poolManager.scanSlides(pptMetaMap),
        videoPool: poolManager.scanVideos()
      });
      broadcastState();
      return stateMachine.getState();
    }

    const nextState = stateMachine.dispatch(action, payload);

    if (!mockPpt) {
      if (action === DECK_ACTIONS.LOAD_PGM || action === DECK_ACTIONS.LOAD_PVW) {
        const slotRes = await pptEngine.setSlots({
          pgmDeckId: nextState.pgm.deckId,
          pvwDeckId: nextState.pvw.deckId,
          stageMode: nextState.outputMode
        });
        if (action === DECK_ACTIONS.LOAD_PGM && nextState.pgm.currentSlide > 0) {
          const stepRes = await pptEngine.stepSlot({ slot: 'pgm', direction: 'goto', slide: nextState.pgm.currentSlide });
          if (stepRes && stepRes.ok && stepRes.runtime) {
            stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...stepRes.runtime });
          }
        } else if (slotRes && slotRes.ok && slotRes.pgm) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...slotRes.pgm });
        }
        if (action === DECK_ACTIONS.LOAD_PVW && nextState.pvw.currentSlide > 0) {
          const stepRes = await pptEngine.stepSlot({ slot: 'pvw', direction: 'goto', slide: nextState.pvw.currentSlide });
          if (stepRes && stepRes.ok && stepRes.runtime) {
            stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...stepRes.runtime });
          }
        } else if (slotRes && slotRes.ok && slotRes.pvw) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...slotRes.pvw });
        }
      } else if (action === DECK_ACTIONS.CUT_SWAP) {
        const swapRes = await pptEngine.cutSwap();
        if (swapRes && swapRes.ok && swapRes.pgm) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...swapRes.pgm });
        }
        if (swapRes && swapRes.ok && swapRes.pvw) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...swapRes.pvw });
        }
      } else if (action === DECK_ACTIONS.PGM_NEXT || action === DECK_ACTIONS.PGM_PREV) {
        const dir = action === DECK_ACTIONS.PGM_NEXT ? 'next' : 'prev';
        const stepRes = await pptEngine.stepSlot({ slot: 'pgm', direction: dir });
        if (stepRes && stepRes.ok && stepRes.runtime) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pgm', ...stepRes.runtime });
        }
      } else if (action === DECK_ACTIONS.PVW_NEXT || action === DECK_ACTIONS.PVW_PREV) {
        const dir = action === DECK_ACTIONS.PVW_NEXT ? 'next' : 'prev';
        const stepRes = await pptEngine.stepSlot({ slot: 'pvw', direction: dir });
        if (stepRes && stepRes.ok && stepRes.runtime) {
          stateMachine.dispatch(DECK_ACTIONS.SYNC_PPT_RUNTIME, { slot: 'pvw', ...stepRes.runtime });
        }
      } else if (
        action === DECK_ACTIONS.TOGGLE_BLACK ||
        action === DECK_ACTIONS.PLAY_VIDEO ||
        action === DECK_ACTIONS.STOP_VIDEO ||
        action === DECK_ACTIONS.VIDEO_ENDED
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
      const filePath = path.join(previewsDir, rel);
      if (fs.existsSync(filePath)) {
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

    // 影片池 HTTP 206 Range 零雜訊分段串流 (對標 projects/amrtf-desk)
    if (pathname.startsWith('/videos/')) {
      const fileName = path.basename(pathname);
      const filePath = path.join(videosDir, fileName);
      if (fs.existsSync(filePath)) {
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
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunkSize = (end - start) + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4'
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
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

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
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
    ws.on('close', () => wsClients.delete(ws));
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
        try { client.terminate(); } catch {}
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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
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
        // 1. 於第二螢幕開啟零雜訊影片與黑屏基底艙 (獨立 Profile 確保 Autoplay 與座標定位 100% 生效)
        spawn(browser, [
          `--user-data-dir=${stageProfileDir}`,
          `--app=http://127.0.0.1:${boundPort}/stage`,
          `--window-position=${screenInfo.x},${screenInfo.y}`,
          `--window-size=${screenInfo.width},${screenInfo.height}`,
          '--autoplay-policy=no-user-gesture-required',
          '--no-first-run',
          '--no-default-browser-check'
        ], { detached: true, stdio: 'ignore' }).unref();

        // 2. 於第一螢幕開啟主控台
        spawn(browser, [
          `--user-data-dir=${deskProfileDir}`,
          `--app=http://127.0.0.1:${boundPort}`,
          '--window-position=60,40',
          '--window-size=1320,860',
          '--no-first-run',
          '--no-default-browser-check'
        ], { detached: true, stdio: 'ignore' }).unref();
      }
    }
  });
}

