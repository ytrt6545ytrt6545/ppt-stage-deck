// ============================================================================
// 📦 PPT Stage Deck 免安裝綠色隨身包打包工具 (Portable Builder)
// 產出：dist/PPT-Stage-Deck-Portable/ 與 dist/PPT-Stage-Deck-Portable.zip
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const distRoot = path.join(projectRoot, 'dist');
const portableDir = path.join(distRoot, 'PPT-Stage-Deck-Portable');
const zipPath = path.join(distRoot, 'PPT-Stage-Deck-Portable.zip');

console.log('📦 [1/4] 準備免安裝隨身包目錄...');
if (fs.existsSync(portableDir)) {
  fs.rmSync(portableDir, { recursive: true, force: true });
}
fs.mkdirSync(portableDir, { recursive: true });

// 1. 複製當前 Node.js 執行檔至專案 runtime/ 與隨身包 runtime/
const nodeExeSrc = process.execPath;
console.log(`⚙️ [2/4] 內嵌免安裝 Node.js 執行環境: ${nodeExeSrc}`);

const localRuntimeDir = path.join(projectRoot, 'runtime');
fs.mkdirSync(localRuntimeDir, { recursive: true });
const localNodeDest = path.join(localRuntimeDir, 'node.exe');
if (!fs.existsSync(localNodeDest)) {
  try { fs.copyFileSync(nodeExeSrc, localNodeDest); } catch {}
}

const portableRuntimeDir = path.join(portableDir, 'runtime');
fs.mkdirSync(portableRuntimeDir, { recursive: true });
fs.copyFileSync(nodeExeSrc, path.join(portableRuntimeDir, 'node.exe'));

// 2. 複製核心程式碼與依賴套件
console.log('📂 [3/4] 複製主控台程式碼与必要套件...');
for (const file of ['server.mjs', 'package.json', 'start-ppt-deck.bat']) {
  const src = path.join(projectRoot, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(portableDir, file));
  }
}

for (const dir of ['public', 'src', 'node_modules']) {
  const srcDir = path.join(projectRoot, dir);
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, path.join(portableDir, dir), { recursive: true });
  }
}

// 複製 scripts/ppt-com-worker.ps1 與 build-portable.mjs
const portableScriptsDir = path.join(portableDir, 'scripts');
fs.mkdirSync(portableScriptsDir, { recursive: true });
for (const sFile of ['ppt-com-worker.ps1', 'build-portable.mjs']) {
  const sPath = path.join(projectRoot, 'scripts', sFile);
  if (fs.existsSync(sPath)) {
    fs.copyFileSync(sPath, path.join(portableScriptsDir, sFile));
  }
}

// 建立乾淨的空白素材資料夾結構
for (const assetSub of ['slides', 'videos', 'images', 'audios', 'previews', 'key-visual']) {
  fs.mkdirSync(path.join(portableDir, 'assets', assetSub), { recursive: true });
}

// 寫入中文使用說明
const readmeText = `======================================================================
  🎬 PPT 現場導播控場台 (Stage Deck) · 免安裝綠色隨身版
======================================================================

【系統需求】
1. 作業系統：Windows 10 / Windows 11 (64位元)
2. 必備軟體：
   - Microsoft PowerPoint 桌面版（用於驅動原生簡報動畫與匯出高畫質縮圖）
   - Microsoft Edge 或 Google Chrome 瀏覽器
   ※ 本隨身包已內建 runtime\\node.exe，完全不需要另外安裝 Node.js！

【啟動方式】
1. 將本資料夾（PPT-Stage-Deck-Portable）放在電腦任意位置（如桌面或 D 槽）。
   ⚠️ 注意：若下載的是 .zip 壓縮檔，請務必先「解壓縮」成一般資料夾後再執行！
2. 雙擊執行「start-ppt-deck.bat」。
3. 系統會自動啟動背景伺服器，並自動在第一螢幕開啟「主控台」、在第二螢幕開啟「全螢幕放映艙」。

【如何放入簡報、影片、音訊】
- 方法 A（最直覺）：開啟主控台網頁後，直接把電腦裡的 PPT、MP4 影片、圖片或 MP3 音訊拖拉進左側「現場流程隊列」，或點選「📥 抓取檔案」。
- 方法 B（放資料夾）：直接把檔案放進本目錄下的 assets\\slides（簡報）、assets\\videos（影片）、assets\\audios（音訊）、assets\\images（圖片），再按網頁右上角的「重掃」即可。

【關閉系統與自動清理】
- 點擊主控台網頁右上角的紅色「退出系統」按鈕，或直接關閉主控台視窗（X），系統即會自動關閉所有投影視窗與背景程序，並一併清空本次載入於 assets 內的所有簡報、影片、音訊、圖片、縮圖與主視覺底圖。
======================================================================
`;
fs.writeFileSync(path.join(portableDir, '使用說明.txt'), readmeText, 'utf8');

// 3. 壓縮成 .zip 方便傳送
console.log('🗜️ [4/4] 正在壓縮為單一 ZIP 隨身包...');
if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true });
}
execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path "${portableDir}\\*" -DestinationPath "${zipPath}" -Force`
], { stdio: 'inherit' });

const zipStat = fs.statSync(zipPath);
const sizeMB = (zipStat.size / (1024 * 1024)).toFixed(1);
console.log(`✅ 免安裝隨身包打包完成！`);
console.log(`   📁 資料夾路徑: ${portableDir}`);
console.log(`   📦 ZIP 檔案路徑: ${zipPath} (${sizeMB} MB)`);
