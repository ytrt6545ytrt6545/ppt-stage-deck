// ============================================================================
// ⚡ PptComEngine (PowerPoint COM 雙軌常駐行程池與 FIFO 佇列引擎 · 0-DOM)
// 遵循 mcp-hardware-software-architecture.md：常駐長連線、FIFO Mutex、Base64 UTF-8
// ============================================================================

import { spawn } from 'child_process';
import path from 'path';
import readline from 'readline';

export class PptComEngine {
  constructor({ workerScriptPath, mockMode = false } = {}) {
    this.workerScriptPath = workerScriptPath;
    this.mockMode = mockMode;
    this.proc = null;
    this.reqSeq = 0;
    this.pending = new Map();
    this.screenInfo = {
      deviceName: '\\\\.\\DISPLAY2',
      primary: false,
      x: -1920,
      y: 0,
      width: 1920,
      height: 1080
    };
    this.readyPromise = null;
  }

  async start() {
    if (this.mockMode) {
      return this.screenInfo;
    }
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve) => {
      this.proc = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', this.workerScriptPath
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      const rl = readline.createInterface({ input: this.proc.stdout });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('PPT_RES:')) return;
        const b64 = trimmed.slice('PPT_RES:'.length);
        try {
          const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
          const msg = JSON.parse(jsonStr);
          if (msg.type === 'READY') {
            if (msg.screen) this.screenInfo = msg.screen;
            resolve(this.screenInfo);
            return;
          }
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve: resFn } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            resFn(msg);
          }
        } catch (err) {
          // ignore malformed line
        }
      });

      this.proc.on('exit', () => {
        for (const [, p] of this.pending.entries()) {
          p.resolve({ ok: false, error: 'Worker exited' });
        }
        this.pending.clear();
        this.proc = null;
        this.readyPromise = null;
      });
    });

    return this.readyPromise;
  }

  async sendCommand(cmd, payload = {}, timeoutMs = 15000) {
    if (this.mockMode) {
      return { ok: true, mock: true, cmd, payload };
    }
    await this.start();
    if (!this.proc || !this.proc.stdin.writable) {
      return { ok: false, error: 'PowerPoint worker not writable' };
    }

    const id = `req_${++this.reqSeq}_${Date.now()}`;
    const envelope = { id, cmd, payload };
    const b64 = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ ok: false, error: `Command ${cmd} timed out` });
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        }
      });

      this.proc.stdin.write(b64 + '\n');
    });
  }

  async scanAndExport({ slidesDir, previewsDir }) {
    return this.sendCommand('SCAN_AND_EXPORT', { slidesDir, previewsDir }, 30000);
  }

  async setSlots({ pgmDeckId, pvwDeckId, stageMode = 'ppt' }) {
    return this.sendCommand('SET_SLOTS', { pgmDeckId, pvwDeckId, stageMode });
  }

  async stepSlot({ slot = 'pgm', direction = 'next', slide = null }) {
    return this.sendCommand('STEP_SLOT', { slot, direction, slide });
  }

  async cutSwap() {
    return this.sendCommand('CUT_SWAP', {});
  }

  async setStageMode(mode) {
    return this.sendCommand('SET_STAGE_MODE', { mode });
  }

  async captureStage(outputPath) {
    return this.sendCommand('CAPTURE_STAGE', { outputPath });
  }

  async shutdown() {
    if (this.mockMode || !this.proc) return;
    try {
      await this.sendCommand('SHUTDOWN', {}, 3000);
    } catch {}
    try {
      this.proc.kill();
    } catch {}
    this.proc = null;
    this.readyPromise = null;
  }
}

