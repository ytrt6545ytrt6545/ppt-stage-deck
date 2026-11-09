# PPT Stage Deck - 開發與踩坑日誌 (DEVLOG)

## [v1.0.0] - 2026-11-08
### 新增與架構突破
1. **PowerPoint COM 雙放映視窗 (`ShowType = 2`) 第二螢幕無邊框定位**：
   - **問題**：預設 PowerPoint 全螢幕放映 (`ShowType = 1`) 僅允許單一 `SlideShowWindow` 且容易觸發備忘稿視窗佔用主螢幕。
   - **解法**：設定 `ShowPresenterView = 0`、`ShowType = 2` (`ppShowTypeWindow`)、`ShowScrollbar = 0`，搭配 Win32 API `SetWindowLong` (`WS_POPUP`) 與 `SetWindowPos` 強制鎖定至第二螢幕 (`\\.\DISPLAY2`)，實現 2 份 `.pptx` 同時在背景維持熱放映狀態，點擊 `CUT_SWAP` 時以 Win32 Z-Order 瞬間切換，且 100% 保留頁內分段點擊動畫。
2. **HTTP 206 零雜訊影片池無縫插播**：
   - 移植 `amrtf-desk` 零雜訊影音秒播架構，支援 `assets/videos/*.mp4` 分段串流與 `VIDEO_ENDED` 播畢自動切回當前 PPT 畫面。
3. **Material LIFF 介面風格與四重硬鎖驗收**：
   - 對標 `projects/material-liff-study` 設計 Token (`#f8fafc` 淺底、`#ffffff` 16px 圓角卡片、`#0ea5e9` 圓角按鈕)，通過 `npm test` 三大測試套件（0-DOM 解耦、狀態機、Live Reality E2E 真機快照）。

