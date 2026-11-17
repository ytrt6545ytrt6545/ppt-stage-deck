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

async function waitForCondition(fn, timeoutMs = 8000, intervalMs = 100) {
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

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function run() {
  const appServer = await createPptStageServer({ port: 0, mockPpt: true });
  const baseUrl = `http://127.0.0.1:${appServer.port}`;
  const debugPort = 19600 + Math.floor(Math.random() * 200);
  const userDataDir = path.join(os.tmpdir(), `ppt-stage-cdp-shot-${Date.now()}`);
  const browserExe = findBrowserExe();

  const browserProc = spawn(browserExe, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--window-size=1360,880',
    baseUrl
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    const targets = await waitForCondition(async () => {
      const list = await httpGetJson(`http://127.0.0.1:${debugPort}/json/list`);
      return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    }, 8000);

    cdp = new CdpSession(targets.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 等待初態渲染並選取一個音訊卡片以展示播控艙對接與「🔊 純播放」
    await new Promise((r) => setTimeout(r, 1200));
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const audioBtn = document.querySelector('.btn-pure-play-audio');
        if (audioBtn) {
          const poolItem = audioBtn.closest('.pool-item');
          if (poolItem) poolItem.click();
        }
      })()`
    });
    await new Promise((r) => setTimeout(r, 400));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const artifactsDir = path.join(projectRoot, 'artifacts');
    fs.mkdirSync(artifactsDir, { recursive: true });
    const shotPath = path.join(artifactsDir, 'clean-coldboot-empty-slots.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.log('SCREENSHOT_SAVED:', shotPath);
  } finally {
    if (cdp) cdp.close();
    try { browserProc.kill(); } catch {}
    await appServer.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

