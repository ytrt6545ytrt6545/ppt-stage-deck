import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanDefensiveViolations } from '../../../scripts/lint-defensive-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('[Lock-1C] 0-Token 紅隊防禦性編碼靜態規則掃描 (DEF-01 ~ DEF-06)', () => {
  const violations = scanDefensiveViolations(projectRoot);
  if (violations.length > 0) {
    const details = violations
      .map((v) => `[${v.rule}] ${v.file}: ${v.reason} (修復: ${v.fix})`)
      .join('\n');
    assert.fail(`偵測到紅隊慣犯漏洞模式：\n${details}`);
  }
  assert.equal(violations.length, 0);
});

