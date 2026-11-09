# PPT Stage Deck (現場雙軌 PPT 無縫切換與零雜訊影片池導播控場台) - 專案藍圖

---

## 一、 系統願景與設計哲學 (Vision & Principles)

**PPT Stage Deck** 是專為現場活動、研討與講台控場打造的「雙軌 PPT (PGM/PVW) 無縫切換 ＋ 零雜訊全螢幕影片池導播控場台」：
1. **原生 PowerPoint COM 雙槽位熱待命（支援情況 2 頁內動畫）**：透過背景 PowerShell COM 常駐引擎（`scripts/ppt-com-worker.ps1`）同時開啟並預熱 2 份 `.pptx` 簡報放映視窗（`SlideShowWindow`），鎖定強制投放到「第二螢幕（`DISPLAY2`）」，支援單頁內分段點擊動畫（`View.Next()` / `View.Previous()`）與 0 秒無縫互切（`CUT_SWAP`）。
2. **雙監視器預覽（PGM 現在播出 ／ PVW 準備播出）**：自動匯出高清投影片預覽縮圖，主控台與手機遙控端可同時預覽「現在正在播的 PPT」與「將要播的下一份 PPT」，並可在預覽區先行翻頁待命。
3. **零雜訊全螢幕影片池（對標 `amrtf-desk` 前行影片架構）**：內建 `assets/videos/` 影片池與 HTTP 206 Partial Content 分段串流，一鍵於第二螢幕全螢幕純黑無雜訊播放，播畢自動無縫切回當前 PPT 畫面。
4. **Material LIFF 清爽卡片美學（對標 `material-liff-study`）**：採用 `#f8fafc` 溫潤淺灰底、純白圓角卡片（`.card rounded-2xl`）、天青藍主色圓角大按鈕（`#0ea5e9`）與圓形狀態膠囊（`.badge`）。

---

## 二、 核心目錄與模組架構 (Architecture)

* [server.mjs](file:///d:/AI-made/projects/ppt-stage-deck/server.mjs)：HTTP / WebSocket 雙向同步伺服器與 HTTP 206 影片分段串流中樞（Port 8890）。
* [src/core/deck-state-machine.mjs](file:///d:/AI-made/projects/ppt-stage-deck/src/core/deck-state-machine.mjs)：0-DOM 無頭雙軌 PPT (PGM/PVW) 與影片池狀態機。
* [src/core/ppt-com-engine.mjs](file:///d:/AI-made/projects/ppt-stage-deck/src/core/ppt-com-engine.mjs)：Node.js ⇄ PowerShell COM 常駐佇列橋接器。
* [scripts/ppt-com-worker.ps1](file:///d:/AI-made/projects/ppt-stage-deck/scripts/ppt-com-worker.ps1)：Windows 原生 PowerPoint COM 雙視窗無邊框第二螢幕鎖定與預覽圖導出引擎。
* [public/index.html](file:///d:/AI-made/projects/ppt-stage-deck/public/index.html) / [public/app.js](file:///d:/AI-made/projects/ppt-stage-deck/public/app.js)：Material LIFF 風格雙監視器主控台與手機掃碼遙控介面。
* [public/stage.html](file:///d:/AI-made/projects/ppt-stage-deck/public/stage.html)：第二螢幕零雜訊全螢幕影片與黑屏放映艙。

