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

test('[Lock-1D] 流程隊列 (Run-of-Show) 支援拖曳排序與素材移出機制審查', () => {
  const appJs = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(projectRoot, 'public', 'styles.css'), 'utf8');

  // 1. HTML 結構包含重設按鈕
  assert.ok(
    indexHtml.includes('id="btnResetFlowQueue"'),
    'index.html 現場流程隊列必須提供 btnResetFlowQueue 重置按鈕'
  );

  // 2. CSS 包含拖曳與移出樣式
  assert.ok(stylesCss.includes('.is-dragging'), 'styles.css 必須定義 .is-dragging 拖曳中樣式');
  assert.ok(stylesCss.includes('.drag-handle'), 'styles.css 必須定義 .drag-handle 手柄樣式');
  assert.ok(stylesCss.includes('.btn-remove-flow-item'), 'styles.css 必須定義 .btn-remove-flow-item 移出按鈕樣式');

  // 3. app.js 包含拖曳與移出邏輯
  assert.ok(appJs.includes('draggable = true'), 'app.js 流程卡片必須標註 draggable = true');
  assert.ok(appJs.includes('dragstart'), 'app.js 必須監聽 dragstart 事件');
  assert.ok(appJs.includes('drop'), 'app.js 必須監聽 drop 事件');
  assert.ok(appJs.includes('btn-remove-flow-item'), 'app.js 必須處理 btn-remove-flow-item 移出事件');
  assert.ok(appJs.includes('stage_deck_flow_order_keys'), 'app.js 必須持久化流程自訂排序');
  assert.ok(appJs.includes('stage_deck_removed_flow_keys'), 'app.js 必須持久化已移出清單');
});

test('[Lock-1E] 音訊獨立「純播放」機制與播控艙背景放音硬鎖審查', () => {
  const appJs = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(projectRoot, 'public', 'styles.css'), 'utf8');

  // 1. HTML 包含播控艙純播放按鈕與獨立音訊節點
  assert.ok(indexHtml.includes('id="btnDeskMasterPurePlay"'), 'index.html 播控艙必須提供 btnDeskMasterPurePlay 純播放按鈕');
  assert.ok(indexHtml.includes('id="bgAudioPlayer"'), 'index.html 必須提供獨立 bgAudioPlayer 背景放音元件');
  assert.ok(indexHtml.includes('id="bgAudioBadge"'), 'index.html 頂部必須提供 bgAudioBadge 背景放音指示標籤');

  // 2. CSS 包含純播放按鈕樣式
  assert.ok(stylesCss.includes('.btn-pure-play-audio'), 'styles.css 必須定義 .btn-pure-play-audio 專用樣式');

  // 3. app.js 具備純播放切換與不干擾 PGM/PVW 機制
  assert.ok(appJs.includes('btn-pure-play-audio'), 'app.js 音訊卡片必須渲染 btn-pure-play-audio 按鈕');
  assert.ok(appJs.includes('togglePurePlayAudio'), 'app.js 必須實現 togglePurePlayAudio 函式');
  assert.ok(appJs.includes('btnDeskMasterPurePlay'), 'app.js 必須監聽播控艙純播放按鈕');

  // 4. (長官鐵律) 純播放進度桿拖曳即時跳轉與停止後續播閉環
  assert.ok(appJs.includes('bgPlayer.currentTime = targetTime'), 'app.js 拖曳進度桿時必須即時同步 bgPlayer.currentTime');
  assert.ok(appJs.includes('isDraggingDeskSeek'), 'app.js 必須防禦進度桿拖曳時被 timeupdate 反向干擾');
  assert.ok(appJs.includes('resumeTime'), 'app.js 停止播放後再按純播放必須支援從當前/暫停拉桿時間點接續起播');

  // 5. (長官最新鐵律) 純播放與 PGM 播出互斥排他性 (同一個音訊檔案只能在一個地方播)
  assert.ok(appJs.includes('isPgmPlayingAudio') && appJs.includes('bgPlayer.pause()'), 'app.js 必須在音訊登上 PGM 時自動終止背景純播放');
  assert.ok(appJs.includes("STOP_MEDIA"), 'app.js 必須在 PGM 音訊播出時點擊純播放自動切斷 PGM 播出');

  // 6. (長官最新鐵律) 播控艙進度條與 Preview 預覽進度條雙向鏡像完全一致
  assert.ok(appJs.includes('pvwSeekSlider.value = deskSeek.value'), 'app.js 播控艙拖動進度條必須同步推動 Preview 進度條');
  assert.ok(appJs.includes('deskSeek.value = percent') || appJs.includes('deskSeek.value = pvwSeekSlider.value'), 'app.js Preview 拖動或播放必須同步推動播控艙進度條');

  // 7. (長官最新鐵律) Preview 數值跟隨播放控制器：送至預覽時必須攜帶並套用當前播放器數值
  assert.ok(appJs.includes('currentPlaybackTime'), 'app.js 送至預覽時必須即時取得播放控制器當前數值');
  assert.ok(appJs.includes('applyPvwPlaybackState'), 'app.js PVW 渲染時必須即時套用並更新進度條與時間顯示');
  const stateMachineJs = fs.readFileSync(path.join(projectRoot, 'src', 'core', 'deck-state-machine.mjs'), 'utf8');
  assert.ok(stateMachineJs.includes('currentTime = 0') && stateMachineJs.includes('safeCurrentTime'), '狀態機 LOAD_MEDIA_PVW 必須支援承接 currentTime 參數');

  // 8. (長官最新鐵律) 影片與聲音邏輯完全一致：試播暫停續播、PGM 唯一播放互斥與 Preview 數值跟隨
  assert.ok(appJs.includes('deskVideoMaster.pause()'), 'app.js 影片登上 PGM 時必須自動暫停播控艙試播');
  assert.ok(appJs.includes('isSameDockMedia'), 'app.js 必須具備影片/多媒體 PGM 登台互斥防護');

  // 9. (長官最新鐵律) Preview 與播控艙共用同一 Play 核心：按暫停絕對立即雙停，消滅雙實體脫節
  assert.ok(appJs.includes('toggleUnifiedPlayback'), 'app.js 必須實現 toggleUnifiedPlayback 統一播控核心');
  assert.ok(appJs.includes('updateUnifiedPlayButtons'), 'app.js 必須實現 updateUnifiedPlayButtons 雙按鈕即時鏡像');

  // 10. (長官最新鐵律) PGM 影片原地暫停與原地續播：絕不調用 STOP_MEDIA，絕不退回主視覺
  assert.ok(appJs.includes('TOGGLE_PGM_VIDEO'), 'app.js 在 PGM 播影片時點擊暫停必須派發 TOGGLE_PGM_VIDEO 原地暫停');
  assert.ok(appJs.includes('SEEK_PGM_VIDEO'), 'app.js 在 PGM 播影片時拖動進度條必須派發 SEEK_PGM_VIDEO 原地跳轉');
  assert.ok(stateMachineJs.includes('TOGGLE_PGM_VIDEO') && stateMachineJs.includes('SEEK_PGM_VIDEO'), '狀態機必須實現 TOGGLE_PGM_VIDEO 與 SEEK_PGM_VIDEO 原地停格');

  // 11. (長官最新指令) 介面縮放比例 (80% / 90% / 100% / 110%) 控制與防爆框緊湊佈局審查
  assert.ok(indexHtml.includes('id="uiScaleControl"'), 'index.html 頂部必須提供 uiScaleControl 介面縮放控制群組');
  for (const s of ['0.8', '0.9', '1', '1.1']) {
    assert.ok(indexHtml.includes(`data-scale="${s}"`), `index.html 必須提供 data-scale="${s}" 縮放按鈕`);
  }
  assert.ok(stylesCss.includes('--ui-scale'), 'styles.css 必須定義並使用 --ui-scale 連動版面緊湊度');
  assert.ok(appJs.includes('applyUiScale') && appJs.includes('stage_deck_ui_scale'), 'app.js 必須實現 applyUiScale 並持久化縮放設定');

  // 12. (長官最新指令) 右下角多功能分頁工作塢 (Multi-Tab Utility Dock: 影音播控 / PPT 快選與修改 / 臨時字卡與回收桶) 審查
  assert.ok(indexHtml.includes('id="dockTabBar"'), 'index.html 必須提供 dockTabBar 分頁導航列');
  assert.ok(indexHtml.includes('id="dockPanePlayer"') && indexHtml.includes('id="dockPanePpt"') && indexHtml.includes('id="dockPaneNotice"'), 'index.html 必須提供三大分頁容器');
  assert.ok(indexHtml.includes('id="pptSlideThumbStrip"'), 'index.html PPT 分頁必須提供 pptSlideThumbStrip 投影片縮圖橫向快選帶');
  assert.ok(indexHtml.includes('id="btnOpenPptNativeEdit"') && indexHtml.includes('id="btnReloadPptDeck"'), 'index.html PPT 分頁必須提供原生編輯與存檔熱重載按鈕');
  assert.ok(indexHtml.includes('id="pptQuickTextInput"') && indexHtml.includes('id="btnSaveSlideText"'), 'index.html PPT 分頁必須提供網頁即時改字輸入框與寫回按鈕');
  assert.ok(indexHtml.includes('id="dockMiniTransportPill"'), 'index.html 分頁列右側必須提供防呆常駐影音迷你控制膠囊');
  assert.ok(appJs.includes('switchDockTab') && appJs.includes('renderPptDock') && appJs.includes('syncMiniTransportPill'), 'app.js 必須實現分頁切換、PPT 縮圖帶渲染與防呆迷你播控膠囊同步');

  // 13. (長官最新指令) 頂部導航列隱藏 DISPLAY2 與播放影片狀態膠囊 (方案 A)
  assert.ok(stylesCss.includes('#screenBadge') && stylesCss.includes('#outputModeBadge') && stylesCss.includes('display: none !important'), 'styles.css 必須強制隱藏 #screenBadge 與 #outputModeBadge');

  // 14. (長官最新指令) 三大模組獨立視窗彈出系統 (Pop-out Architecture: 流程 / 雙監 / 工作塢) 與全域廣播同步審查
  assert.ok(indexHtml.includes('id="btnPopoutFlow"'), 'index.html 流程隊列必須提供 btnPopoutFlow 獨立視窗彈出按鈕');
  assert.ok(indexHtml.includes('id="btnPopoutMonitors"'), 'index.html 主控雙監必須提供 btnPopoutMonitors 獨立視窗彈出按鈕');
  assert.ok(indexHtml.includes('id="btnPopoutDock"'), 'index.html 多功能工作塢必須提供 btnPopoutDock 獨立視窗彈出按鈕');
  assert.ok(indexHtml.includes('id="btnPopoutAll"'), 'index.html 頂部必須提供 btnPopoutAll 一鍵分離三大視窗按鈕');
  assert.ok(indexHtml.includes('id="btnDockAllIn"'), 'index.html 頂部必須提供 btnDockAllIn 全部收回主控台按鈕');
  assert.ok(indexHtml.includes('id="btnDockSelfIn"'), 'index.html 必須提供 btnDockSelfIn 子視窗收回返回主視窗按鈕');

  assert.ok(indexHtml.includes('id="flowPoppedOverlay"'), 'index.html 必須包含 flowPoppedOverlay 流程彈出佔位層');
  assert.ok(indexHtml.includes('id="monitorsPoppedOverlay"'), 'index.html 必須包含 monitorsPoppedOverlay 雙監彈出佔位層');
  assert.ok(indexHtml.includes('id="dockPoppedOverlay"'), 'index.html 必須包含 dockPoppedOverlay 工作塢彈出佔位層');

  assert.ok(stylesCss.includes('body[data-view="flow"]'), 'styles.css 必須定義 body[data-view="flow"] 流程獨立視窗滿版樣式');
  assert.ok(stylesCss.includes('body[data-view="monitors"]'), 'styles.css 必須定義 body[data-view="monitors"] 雙監獨立視窗滿版樣式');
  assert.ok(stylesCss.includes('body[data-view="dock"]'), 'styles.css 必須定義 body[data-view="dock"] 工作塢獨立視窗滿版樣式');
  assert.ok(stylesCss.includes('.panel-popped-overlay'), 'styles.css 必須定義 .panel-popped-overlay 佔位遮罩樣式');

  assert.ok(appJs.includes('initPopoutSystem'), 'app.js 必須實現 initPopoutSystem 視窗初始化管理函式');
  assert.ok(appJs.includes('popoutSyncChannel') || appJs.includes('BroadcastChannel'), 'app.js 必須建立跨視窗廣播通道');
  assert.ok(appJs.includes('POPOUT_HELLO') && appJs.includes('POPOUT_GOODBYE'), 'app.js 必須支援子視窗上線與退場廣播');
  assert.ok(appJs.includes('DOCK_ALL_IN'), 'app.js 必須支援一鍵收回全部獨立視窗');
});



