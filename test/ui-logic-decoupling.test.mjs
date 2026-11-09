// ============================================================================
// 🛡️ Test Suite 1: 介面與邏輯物理解耦 (0-DOM) ＆ 信令合約差集為 0 硬鎖
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECK_ACTIONS } from '../src/core/deck-state-machine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('[Lock-1A] Logic 層 (src/core/*.mjs) 0-DOM 物理隔離審查', () => {
  const coreDir = path.join(projectRoot, 'src', 'core');
  const files = fs.readdirSync(coreDir).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length >= 3, 'src/core 應包含至少 3 個核心模組');

  const forbiddenDomPatterns = [
    /\bdocument\./,
    /\bwindow\./,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bHTMLElement\b/,
    /\bquerySelector\b/
  ];

  for (const file of files) {
    const content = fs.readFileSync(path.join(coreDir, file), 'utf8');
    // 移除註解後檢查
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const pattern of forbiddenDomPatterns) {
      assert.equal(
        pattern.test(stripped),
        false,
        `Logic 模組 ${file} 物理違規引用瀏覽器 DOM API: ${pattern}`
      );
    }
  }
});

test('[Lock-1B] View 層與 Logic 層信令合約 (Action/Handler) 差集為 0 硬鎖', () => {
  const appJs = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
  const stageHtml = fs.readFileSync(path.join(projectRoot, 'public', 'stage.html'), 'utf8');
  const stateMachineCode = fs.readFileSync(
    path.join(projectRoot, 'src', 'core', 'deck-state-machine.mjs'),
    'utf8'
  );

  const dispatchedActions = new Set();
  for (const m of appJs.matchAll(/dispatchAction\(\s*['"]([A-Z_]+)['"]/g)) {
    dispatchedActions.add(m[1]);
  }
  for (const m of stageHtml.matchAll(/action:\s*['"]([A-Z_]+)['"]/g)) {
    dispatchedActions.add(m[1]);
  }

  assert.ok(dispatchedActions.size >= 8, '前端應至少派發 8 種語意化 Action');

  const definedActions = new Set(Object.values(DECK_ACTIONS));
  const missingInLogic = [...dispatchedActions].filter((a) => !definedActions.has(a));

  assert.deepEqual(
    missingInLogic,
    [],
    `前端派發之 Action 在 DeckStateMachine 中缺失處理器: ${missingInLogic.join(', ')}`
  );

  for (const act of dispatchedActions) {
    assert.ok(
      stateMachineCode.includes(`DECK_ACTIONS.${act}`),
      `DeckStateMachine.dispatch 必須實質處理 DECK_ACTIONS.${act}`
    );
  }
});

