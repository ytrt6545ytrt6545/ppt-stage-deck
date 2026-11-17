// ============================================================================
// 🚀 PPT Stage Deck - GitHub 自動版本檢測與一鍵更新模組 (Updater Engine)
// 支援 Git 倉庫直連拉取 (git pull) 與免安裝綠色隨身版 (GitHub Zipball 熱覆蓋)
// 遵循憲法規範：100% 絕對保護 assets/ 與使用者個人簡報、影片素材不受干擾
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * 比較兩語意化版本號 (Semver Compare)
 * @param {string} a - 版本 A (例: '1.0.1' 或 'v1.0.1')
 * @param {string} b - 版本 B (例: '1.0.0' 或 'v1.0.0')
 * @returns {number} 1 若 a > b; -1 若 a < b; 0 若 a === b
 */
export function compareSemver(a, b) {
  const clean = (v) => String(v || '').trim().replace(/^v/i, '');
  const pa = clean(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = clean(b).split('.').map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export class Updater {
  /**
   * @param {Object} options
   * @param {string} options.projectRoot - 專案根目錄
   * @param {string} [options.repo] - GitHub 倉庫路徑 'owner/repo'
   */
  constructor({ projectRoot, repo = 'ytrt6545ytrt6545/ppt-stage-deck' } = {}) {
    this.projectRoot = projectRoot || process.cwd();
    this.repo = repo;
    this.cachedUpdate = null;
    this.lastCheckTime = 0;
  }

  /**
   * 取得本地當前版本號
   */
  getCurrentVersion() {
    try {
      const pkgPath = path.join(this.projectRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.version || '1.0.0';
      }
    } catch {}
    return '1.0.0';
  }

  /**
   * 向 GitHub Releases 檢查是否有更新版本
   * @param {Object} [opts]
   * @param {boolean} [opts.force=false] - 是否強制略過 60 秒暫存快取
   * @param {Function} [opts.fetchFn] - 可注入的 fetch 函數 (便於測試)
   */
  async checkUpdate({ force = false, fetchFn = globalThis.fetch } = {}) {
    const now = Date.now();
    const currentVersion = this.getCurrentVersion();

    // 60 秒記憶體快取，避免前端頻繁請求觸發 GitHub API 次數限制
    if (!force && this.cachedUpdate && now - this.lastCheckTime < 60000) {
      return {
        ...this.cachedUpdate,
        currentVersion,
        hasUpdate: compareSemver(this.cachedUpdate.latestVersion, currentVersion) > 0
      };
    }

    const apiUrl = `https://api.github.com/repos/${this.repo}/releases/latest`;
    try {
      const res = await fetchFn(apiUrl, {
        headers: {
          'User-Agent': 'ppt-stage-deck-updater',
          'Accept': 'application/vnd.github.v3+json'
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
      });

      if (!res.ok) {
        // 若為 404 (尚無正式 release) 或受限
        return {
          ok: false,
          currentVersion,
          latestVersion: currentVersion,
          hasUpdate: false,
          status: res.status,
          message: `GitHub 回應狀態代碼: ${res.status}`
        };
      }

      const data = await res.json();
      const latestTag = data.tag_name || `v${currentVersion}`;
      const latestVersion = latestTag.replace(/^v/i, '');
      const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

      const result = {
        ok: true,
        currentVersion,
        latestVersion,
        latestTag,
        hasUpdate,
        releaseNotes: data.body || '',
        releaseName: data.name || latestTag,
        publishedAt: data.published_at || '',
        releaseUrl: data.html_url || `https://github.com/${this.repo}/releases/latest`,
        zipUrl: data.zipball_url || `https://github.com/${this.repo}/archive/refs/tags/${latestTag}.zip`
      };

      this.cachedUpdate = result;
      this.lastCheckTime = now;
      return result;
    } catch (err) {
      return {
        ok: false,
        currentVersion,
        latestVersion: currentVersion,
        hasUpdate: false,
        error: err.message
      };
    }
  }

  /**
   * 執行一鍵更新
   * @param {Object} [opts]
   * @param {Function} [opts.fetchFn]
   */
  async performUpdate({ fetchFn = globalThis.fetch } = {}) {
    const check = await this.checkUpdate({ force: true, fetchFn });
    if (!check.hasUpdate) {
      return {
        ok: true,
        alreadyLatest: true,
        currentVersion: check.currentVersion,
        latestVersion: check.latestVersion,
        message: '當前已是最新版本，無需更新。'
      };
    }

    const hasGit = fs.existsSync(path.join(this.projectRoot, '.git'));
    if (hasGit) {
      return await this._updateViaGit(check);
    } else {
      return await this._updateViaZip(check, fetchFn);
    }
  }

  /**
   * 透過本機 Git 進行快速拉取更新
   */
  async _updateViaGit(check) {
    return new Promise((resolve) => {
      // 依序執行 git fetch origin 與 git pull --ff-only
      const cmd = `git fetch origin && git pull --ff-only origin master`;
      const child = spawn('cmd.exe', ['/d', '/s', '/c', cmd], {
        cwd: this.projectRoot,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });

      child.on('close', (code) => {
        if (code === 0) {
          this.cachedUpdate = null;
          resolve({
            ok: true,
            method: 'git',
            currentVersion: check.currentVersion,
            latestVersion: check.latestVersion,
            message: `Git 更新成功！已更新至最新版本 v${check.latestVersion}。`,
            details: stdout.trim()
          });
        } else {
          resolve({
            ok: false,
            method: 'git',
            error: `Git 更新失敗 (Exit Code: ${code}): ${stderr || stdout}`
          });
        }
      });
    });
  }

  /**
   * 免安裝隨身版：下載 Release ZIP 並熱覆蓋非素材核心檔案
   * 🛡️ 鐵律保護：排除 assets/、runtime/、dist/、.env 等敏感或素材檔案
   */
  async _updateViaZip(check, fetchFn) {
    try {
      const zipUrl = check.zipUrl;
      const res = await fetchFn(zipUrl, {
        headers: { 'User-Agent': 'ppt-stage-deck-updater' }
      });
      if (!res.ok) {
        return { ok: false, method: 'zip', error: `下載更新包失敗: HTTP ${res.status}` };
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const tempDir = path.join(this.projectRoot, '.tmp_update');
      const tempZip = path.join(this.projectRoot, '.tmp_update.zip');

      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(tempZip, buffer);

      // 透過 PowerShell 解壓縮
      await new Promise((resolve, reject) => {
        const psCmd = `Expand-Archive -Path '${tempZip}' -DestinationPath '${tempDir}' -Force`;
        const cp = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { windowsHide: true });
        cp.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Expand-Archive 退出代碼: ${code}`));
        });
      });

      // 找到解壓後的頂層資料夾
      const extractedEntries = fs.readdirSync(tempDir, { withFileTypes: true });
      const innerFolder = extractedEntries.find((e) => e.isDirectory())?.name;
      const sourceRoot = innerFolder ? path.join(tempDir, innerFolder) : tempDir;

      // 複製白名單/排除黑名單清單
      const shouldCopy = (relPath) => {
        const norm = relPath.replace(/\\/g, '/');
        // 🛡️ 嚴格排除資產、隨身環境與機密設定
        if (norm.startsWith('assets/') || norm === 'assets') return false;
        if (norm.startsWith('runtime/') || norm === 'runtime') return false;
        if (norm.startsWith('dist/') || norm === 'dist') return false;
        if (norm.startsWith('.tmp_') || norm.startsWith('.git/')) return false;
        if (norm === '.env' || norm === 'start-ppt-deck.bat') return false; // 保護使用者自訂啟動檔
        return true;
      };

      const copyRecursive = (src, dest, rel = '') => {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
          const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
          if (!shouldCopy(entryRel)) continue;

          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);

          if (entry.isDirectory()) {
            if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
            copyRecursive(srcPath, destPath, entryRel);
          } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      };

      copyRecursive(sourceRoot, this.projectRoot);

      // 清理暫存檔案
      try {
        if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}

      this.cachedUpdate = null;
      return {
        ok: true,
        method: 'zip',
        currentVersion: check.currentVersion,
        latestVersion: check.latestVersion,
        message: `隨身版熱覆蓋更新成功！已更新至 v${check.latestVersion}。`
      };
    } catch (err) {
      return {
        ok: false,
        method: 'zip',
        error: `解壓縮或覆蓋更新發生錯誤: ${err.message}`
      };
    }
  }
}
