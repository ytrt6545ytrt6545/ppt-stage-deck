// ============================================================================
// 🧪 Updater 單元測試 (test/updater.test.mjs)
// 驗證 semverCompare 邏輯、GitHub API 降級快取、資產排除保護與各情境安全閉環
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver, Updater } from '../src/core/updater.mjs';

test('[Updater-1] compareSemver 語意化版本比對邏輯', () => {
  assert.equal(compareSemver('1.0.1', '1.0.0'), 1);
  assert.equal(compareSemver('v1.0.1', '1.0.0'), 1);
  assert.equal(compareSemver('1.1.0', '1.0.9'), 1);
  assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('v1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.0.0', '1.0.1'), -1);
  assert.equal(compareSemver('1.0.0', '1.1.0'), -1);
  assert.equal(compareSemver('0.9.9', '1.0.0'), -1);
});

test('[Updater-2] checkUpdate 在 GitHub 回傳新版本時正常解析', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      tag_name: 'v1.0.5',
      name: 'v1.0.5 重要效能修復',
      body: '- 修復雙監視器切換延遲\n- 新增快捷鍵',
      published_at: '2026-11-17T12:00:00Z',
      html_url: 'https://github.com/test/repo/releases/v1.0.5'
    })
  });

  const updater = new Updater({ projectRoot: process.cwd() });
  // 覆寫本地版本為 1.0.0 進行測試
  updater.getCurrentVersion = () => '1.0.0';

  const res = await updater.checkUpdate({ force: true, fetchFn: mockFetch });
  assert.equal(res.ok, true);
  assert.equal(res.hasUpdate, true);
  assert.equal(res.latestVersion, '1.0.5');
  assert.equal(res.currentVersion, '1.0.0');
  assert.match(res.releaseNotes, /修復雙監視器/);
});

test('[Updater-3] checkUpdate 在同版本或較舊版本時標記 hasUpdate: false', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      tag_name: 'v1.0.0',
      name: 'v1.0.0 首發版本',
      body: '初始發布',
      html_url: 'https://github.com/test/repo/releases/v1.0.0'
    })
  });

  const updater = new Updater({ projectRoot: process.cwd() });
  updater.getCurrentVersion = () => '1.0.0';

  const res = await updater.checkUpdate({ force: true, fetchFn: mockFetch });
  assert.equal(res.ok, true);
  assert.equal(res.hasUpdate, false);
  assert.equal(res.latestVersion, '1.0.0');
});

test('[Updater-4] checkUpdate 遭遇網路離線或 404 時優雅降級不崩潰', async () => {
  const mockFetchFail = async () => {
    throw new Error('ENOTFOUND api.github.com');
  };

  const updater = new Updater({ projectRoot: process.cwd() });
  const res = await updater.checkUpdate({ force: true, fetchFn: mockFetchFail });
  assert.equal(res.ok, false);
  assert.equal(res.hasUpdate, false);
  assert.match(res.error, /ENOTFOUND/);
});
