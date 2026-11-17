# PPT Stage Deck - 開發與踩坑日誌 (DEVLOG)

## [v1.0.40] - 2026-11-14 (長官指令大落地 · 全面支援 `.pptm` 與 `.ppsm` 啟用巨集簡報檔匯入與預覽掃描 ＋ 26/26 全綠)
### 需求與實裝落地
1. **【長官指令】「無法匯入PPTM檔案 幫我查查 —— 開始製作」**：
   - **原因定位**：既有後端上傳白名單、素材池掃描器、PowerPoint COM 預覽導出腳本與前端檔案挑選器僅允許 `.pptx`、`.ppt`、`.ppsx`，漏掉了 `.pptm`（啟用巨集的 PowerPoint 簡報）與 `.ppsm`（啟用巨集的播放檔）。
   - **四位一體擴充支援**：
     - [server.mjs](file:///d:/AI-made/projects/ppt-stage-deck/server.mjs#L376-L378) 與 [server.mjs](file:///d:/AI-made/projects/ppt-stage-deck/server.mjs#L461-L463)：`/api/upload-media` 串流與 Base64 上傳白名單擴充為 `['.pptx', '.ppt', '.ppsx', '.pptm', '.ppsm']`。
     - [media-pool-manager.mjs](file:///d:/AI-made/projects/ppt-stage-deck/src/core/media-pool-manager.mjs#L35-L41)：`scanSlides()` 副檔名正則擴充為 `/\.(pptx|ppt|ppsx|pptm|ppsm)$/i`。
     - [ppt-com-worker.ps1](file:///d:/AI-made/projects/ppt-stage-deck/scripts/ppt-com-worker.ps1#L555)：`SCAN_AND_EXPORT` 擴充為 `^\.(pptx|ppt|ppsx|pptm|ppsm)$`。
     - [index.html](file:///d:/AI-made/projects/ppt-stage-deck/public/index.html#L47)：`#mediaDropFileInput` 之 `accept` 屬性加入 `.pptm,.ppsm`。
2. **測試鎖定與驗收**：
   - 於 [deck-state-machine.test.mjs](file:///d:/AI-made/projects/ppt-stage-deck/test/deck-state-machine.test.mjs#L307-L357) 新增 `[State-8]` 驗證 `.pptm` 串流匯入與 `.ppsm` 掃描閉環；
   - 專案標準指令 `npm test`：**26/26 測試 100% 全數通過（Exit Code 0）**！


## [v1.0.39] - 2026-11-14 (長官指令大落地 · 徹底根治「PPT 退回預覽 (PVW) 時主預覽區變成全黑」 ＋ 隱藏視窗 PrintWindow 黑圖攔截 ＋ 狀態機預覽圖重算與 25/25 全綠)
### 需求與實裝落地
1. **【長官指令】「PPT退回預覽時就沒有顯示了（附現場雙螢幕截圖）」**：
   - **截圖物證解剖與兩大底層致命死穴**：
     - **物理物證**：檢視長官上傳截圖與磁碟快照，發現 `assets/previews/_live_pvw.png` 為一張 10,143 Bytes（1920x1080 100% 純黑）的 PNG 圖片！因此右上角「預覽 (PVW)」卡片中，右下角「下一頁」子母畫面縮圖（讀取靜態 `/previews/<deckId>/slide-7.png`）正常顯示，但主預覽大圖（讀取 `/previews/_live_pvw.png`）卻變成一片漆黑！
     - **死穴 1（隱藏視窗 `ShowWindow(0)` 後立即呼叫 `PrintWindow` 擷取全黑位圖）**：
       當 PPT 從 PGM 退回 PVW（例如切換至「主視覺 KV」或與「影片」執行 `CUT 切換`）時，[server.mjs](file:///d:/AI-made/projects/ppt-stage-deck/server.mjs) 呼叫 `pptEngine.setSlots({ pgmDeckId: null, pvwDeckId: ..., stageMode: 'kv' | 'video' })`。在 [ppt-com-worker.ps1](file:///d:/AI-made/projects/ppt-stage-deck/scripts/ppt-com-worker.ps1) 的 `SET_SLOTS` 中，先執行 `Sync-WindowZOrder` 將所有 PowerPoint `screenClass` 放映視窗執行 `ShowWindow($h, 0)` 隱藏（以露出底層主視覺或影片），隨即在下一行呼叫 `Get-SlotRuntime $script:slots.pvw "pvw"` 對**剛剛被隱藏的 `screenClass` 視窗**執行 `Capture-WindowLivePng` (`PrintWindow`)！Windows 對 `SW_HIDE` 隱藏視窗執行 `PrintWindow` 會回傳全黑位圖，且舊版 `Capture-WindowLivePng` 無條件執行 `$bmp.Save($outPath)` 並回傳 `livePreviewUrl = "/previews/_live_pvw.png?t=..."`，直接把 PVW 預覽圖覆寫成黑畫面！
     - **死穴 2（`CUT_SWAP` 淺拷貝殘留舊 `_live_pgm.png` 動態路徑）**：
       在 [deck-state-machine.mjs](file:///d:/AI-made/projects/ppt-stage-deck/src/core/deck-state-machine.mjs) 的 `CUT_SWAP`（以及 `LOAD_PGM`/`LOAD_PVW` 對調分支）中，原 PGM 退回 PVW 時直接以 `{ ...oldPgm }` 淺拷貝，導致 `oldPgm` 在步進動畫期間被覆寫的 `/previews/_live_pgm.png?t=...` 一併帶入 `state.pvw.previewUrl`，未還原為該頁標準靜態預覽圖 `/previews/<deckId>/slide-<n>.png`。
   - **三重根治措施**：
     - **措施 1（`Get-SlotRuntime` 僅對可見視窗執行實時擷取 ＋ `Capture-WindowLivePng` 全黑位圖防禦攔截）**：
       於 [ppt-com-worker.ps1](file:///d:/AI-made/projects/ppt-stage-deck/scripts/ppt-com-worker.ps1) 的 `Get-SlotRuntime` 中，嚴格限制僅在 `$vis = [PptWin32]::IsWindowVisible($entry.hwnd)` 為 `$true` 時才執行 `Capture-WindowLivePng`；並在 `Capture-WindowLivePng` 中驗證位圖具備非黑像素或背景亮度（`$isValidCapture`），全黑無效位圖一律拒絕存檔並回傳 `ok = $false`（`livePreviewUrl = $null`）。（同時避開 PowerShell 迴圈內誤用 `>` 造成檔案重導向之陷阱，一律使用 `-gt`）。
     - **措施 2（`deck-state-machine.mjs` 退回 PVW 時以 `buildSlotState` 重建標準靜態預覽 URL）**：
       於 [deck-state-machine.mjs](file:///d:/AI-made/projects/ppt-stage-deck/src/core/deck-state-machine.mjs) 中，當 PPT 在 `CUT_SWAP`、`LOAD_PGM` 或 `LOAD_PVW` 發生槽位互換時，透過 `buildSlotState(deck, currentSlide, clickIndex)` 重新建構槽位狀態，確保 `previewUrl` 100% 指向對應頁碼之高清靜態預覽圖 `/previews/<deckId>/slide-<n>.png`。
     - **措施 3（`_meta.json` 快取加速與 COM 佇列序列化）**：
       於 [ppt-com-worker.ps1](file:///d:/AI-made/projects/ppt-stage-deck/scripts/ppt-com-worker.ps1) 新增投影片頁數與動畫點擊數 `_meta.json` 快取，避免每次啟動重複掃描大型簡報；並於 [server.mjs](file:///d:/AI-made/projects/ppt-stage-deck/server.mjs) 加入 `actionQueue` 序列化與樂觀狀態廣播。
2. **測試鎖定與驗收**：
   - 於 [deck-state-machine.test.mjs](file:///d:/AI-made/projects/ppt-stage-deck/test/deck-state-machine.test.mjs) 新增 `[State-7]` 單元測試；
   - 於 [e2e-live-reality.test.mjs](file:///d:/AI-made/projects/ppt-stage-deck/test/e2e-live-reality.test.mjs) 新增 `pvwPptPreviewDuringVideo` 真機像素抽樣斷言（驗證 PPT 退回 PVW 後主預覽圖 `naturalWidth > 0` 且像素非全黑 `nonBlackSamples > 0`）；
   - 專案標準指令 `npm test`：**25/25 測試 100% 全數通過（Exit Code 0）**！


## [v1.0.38] - 2026-11-14 (長官指令大落地 · 徹底根治「第一次 PPT 與影片 CUT 交換時沒有出現影片、按截圖才出現」 ＋ DWM 放映艙強制喚醒 ＋ 同源媒體快取分流與 24/24 全綠)
### 需求與實裝落地
1. **【長官指令】「當第一次PPT與影片要cut交換時 會沒有出現影片 但是當我要截圖回報時 按下截圖 他就出現了 之後再做一次 他就可以馬上出現 幫我檢查看看 —— 請開始製作」**：
   - **痛點排查與三大底層連動死穴解密**：
     - **死穴 1（Windows DWM / Chromium 視窗遮擋休眠 `CalculateNativeWinOcclusion`）**：
       當 PPT 在 PGM 播出時，PowerPoint 的 `screenClass` 放映視窗以 `HWND_TOPMOST` 置頂完全覆蓋第二螢幕 `/stage` 瀏覽器視窗；Chromium 的 `CalculateNativeWinOcclusion` 偵測到 `/stage` 被原生視窗 100% 遮蔽後，會將 `/stage` 標記為 `Occluded` 並暫停合成繪製。當第一次按 `CUT 切換` 時，背景僅執行 `ShowWindow($h, 0)`，未解除 `HWND_TOPMOST` 也未主動喚醒 `/stage` 視窗，直到長官按下截圖快捷鍵（`Win + Shift + S`）觸發 Windows DWM 全螢幕合成重繪，`/stage` 才瞬間醒來顯示畫面！
     - **死穴 2（`CUT_SWAP` 在 PPT 與影片互切時，PowerShell `$script:slots` 槽位狀態未同步）**：
       先前 `server.mjs` 在 `CUT_SWAP` 切換為影片（`outputMode === 'video'`）時僅呼叫 `setStageMode('video')`，未將原 PGM 簡報退居 PVW 同步至 `ppt-com-worker.ps1`；且 `SET_SLOTS` 先前忽略 `null` 值，導致第二次 `CUT_SWAP` 時槽位錯位。
     - **死穴 3（Chromium 同源 `<video>` 快取排他鎖）**：
       當影片先送入 PVW（`pvwVideoPlayer` 暫停）與右下播控艙（`deskVideoMasterPlayer`）時，三個 `<video>` 共用完全相同的 `/videos/...` URL，且回應未帶 `Cache-Control: no-store`，導致第一次切上 PGM 時 `pgmVideoPlayer` 與 `stageVideo` 等待舊 paused 連線釋放快取鎖。
   - **五重根治措施**：
     - **措施 1（`HideAllSlideShows` ＋ `WakeStageDisplay` 強制喚醒第二螢幕放映艙）**：於 [ppt-com-worker.ps1](file:///d:/AI-made/projects/ppt-stage-deck/scripts/ppt-com-worker.ps1) 新增 C# `HideAllSlideShows()`（先解除 `HWND_TOPMOST` 壓入 `HWND_BOTTOM` 再 `ShowWindow(0)`）與 `WakeStageDisplay()`（以 `SWP_SHOWWINDOW | SWP_NOACTIVATE` 對 `/stage` 視窗執行 `HWND_TOPMOST -> HWND_NOTOPMOST` 瞬時重繪喚醒，不搶奪主控台焦點）。
     - **措施 2（關閉 Chromium 視窗遮擋休眠）**：於 [server.mjs](file:///d:/AI-made/projects/ppt-stage-deck/server.mjs) 啟動瀏覽器參數加入 `--disable-features=CalculateNativeWinOcclusion`、`--disable-backgrounding-occluded-windows`、`--disable-renderer-backgrounding`。
     - **措施 3（`CUT_SWAP` 全模態雙向槽位對齊）**：於 [deck-state-machine.mjs](file:///d:/AI-made/projects/ppt-stage-deck/src/core/deck-state-machine.mjs)、[server.mjs](file:///d:/AI-made/projects/ppt-stage-deck/server.mjs) 與 [ppt-com-worker.ps1](file:///d:/AI-made/projects/ppt-stage-deck/scripts/ppt-com-worker.ps1) 完整同步 PPT $\leftrightarrow$ 影片互切時的 `pgmDeckId` 與 `pvwDeckId`（支援清空為 `null`）。
     - **措施 4（同源媒體快取分流與串流主動釋放）**：於 `/videos/` 路由加上 `Cache-Control: no-store`，並於 [app.js](file:///d:/AI-made/projects/ppt-stage-deck/public/app.js) 與 [stage.html](file:///d:/AI-made/projects/ppt-stage-deck/public/stage.html) 為四個播放器加上獨立 `?slot=pgm|pvw|dock|stage` 參數、先行執行 `removeAttribute('src'); load();` 釋放舊連線，以及掛載 `loadeddata` / `canplay` 首幀起播保證。
2. **測試鎖定與驗收**：
   - 於 [e2e-live-reality.test.mjs](file:///d:/AI-made/projects/ppt-stage-deck/test/e2e-live-reality.test.mjs) 新增「第一次 PPT 與影片 CUT 交換即刻出畫面 ＋ 無 `screenClass` 遮擋 ＋ 再次 CUT 換回 PPT」真機測試；
   - 專案標準指令 `npm test`：**24/24 測試 100% 全數通過（Exit Code 0）**！


## [v1.0.37] - 2026-11-14 (長官指令大落地 · 鍵盤與無線簡報筆翻頁/逐個動畫步進支援 ＋ 控台焦點防搶奪自動歸還 ＋ 移除頂部字體縮放與手機按鈕 ＋ 24/24 全綠)
### 需求與實裝落地
1. **【長官指令】「PPT的下一頁 要按鍵盤或簡報筆可以下一頁」**：
   - **支援全套鍵盤與無線簡報筆（USB HID Presenter Remote）按鍵**：
     - **下一頁 / 下一個動畫（`PGM_NEXT`）**：`PageDown`（簡報筆下翻鍵）、`ArrowRight`（右方向鍵）、`ArrowDown`（下方向鍵）、`Space`（空白鍵）、`Enter`、`N`；
     - **上一頁 / 上一個動畫（`PGM_PREV`）**：`PageUp`（簡報筆上翻鍵）、`ArrowLeft`（左方向鍵）、`ArrowUp`（上方向鍵）、`Backspace`、`P`；
     - **黑屏切換（`TOGGLE_BLACK`）**：`.`（簡報筆黑屏鍵）、`B`；
   - **防誤觸與焦點自動歸還（`Save-ControllerFocus` / `Restore-ControllerFocus`）**：
     - 在 [app.js](file:///d:/AI-made/projects/ppt-stage-deck/public/app.js) 中點擊任何按鈕後自動釋放按鈕焦點（`blur()`），防止後續按 `Space` 或 `Enter` 誤觸舊按鈕；並以 Promise 佇列序列化連按訊號，確保快速連按簡報筆時動畫依序推進；
     - 在 [stage.html](file:///d:/AI-made/projects/ppt-stage-deck/public/stage.html) 同步掛載鍵盤／簡報筆監聽，無論焦點在主控台或第二螢幕放映艙皆可翻頁；
     - 在 [ppt-com-worker.ps1](file:///d:/AI-made/projects/ppt-stage-deck/scripts/ppt-com-worker.ps1) 中新增 `Save-ControllerFocus` 與 `Restore-ControllerFocus`：當 PowerPoint 投影視窗（`screenClass`）完成動畫渲染與截圖後，自動透過 Win32 `AttachThreadInput` + `SetForegroundWindow` 將鍵盤焦點歸還主控台視窗，同時維持第二螢幕投影視窗 `HWND_TOPMOST` 置頂無遮擋。
2. **【長官指令】「字體大小修改拿掉 手機功能也拿掉」**：
   - 於 [index.html](file:///d:/AI-made/projects/ppt-stage-deck/public/index.html) 與 [styles.css](file:///d:/AI-made/projects/ppt-stage-deck/public/styles.css) 移除頂部導覽列「字體縮放滑桿（`.font-scale-control`）」與「手機遙控按鈕／QR 彈窗（`#btnQrRemote`、`#qrModal`）」，頂部工具列更精簡清爽。
3. **測試鎖定與驗收**：
   - 於 [e2e-live-reality.test.mjs](file:///d:/AI-made/projects/ppt-stage-deck/test/e2e-live-reality.test.mjs) 新增簡報筆 `PageDown` / `PageUp` 逐個動畫推進與跨頁驗證；
   - 專案標準指令 `npm test`：**24/24 測試 100% 全數通過（Exit Code 0）**！


## [v1.0.36] - 2026-11-13 (長官指令大落地 · 徹底排查與根治「PPT 內動畫全部一次出來無法逐個出現」 ＋ PowerPoint COM GotoSlide 重設旗標補正 ＋ 24/24 全綠)
### 需求與實裝落地
1. **【長官指令】「PPT內的動畫 不能一個一個出來 是全部出來（附現場雙螢幕實體截圖）」**：
   - **痛點排查與微軟底層致命死穴解密**：
     - 長官截圖顯示：投影放映螢幕中，第 2 頁簡報的 9 個動畫對話氣泡（人際問題、憂鬱症、農藥化肥...）一次性全部爆出，沒有按一下出一個；主控台顯示「動畫 0 / 0」；
     - 經實機取證分析 `TimeLine.MainSequence`，該頁確實具備 9 個點擊觸發動畫（`TriggerType=1`）；
     - **致命死穴定位**：在 `scripts/ppt-com-worker.ps1` 的 `STEP_SLOT` 換頁邏輯中，調用了微軟官方 API `$ssw.View.GotoSlide($oldPos + 1)`。
     - **微軟 PowerPoint COM API 致命陷阱**：`GotoSlide(Index, [ResetSlide])` 的第二個參數預設為 `0` (`msoFalse`)！微軟官方定義 `0` 的行為是「將投影片顯示為其最終狀態（All animations finished）」，導致一翻到第 2 頁，微軟底層直接將該頁所有動畫一次性全部展開完畢！
     - 且在翻頁時若未傳入 `-1` (`msoTrue`) 重設動畫，微軟會跳過動畫起點，造成無法一個一個點出。
   - **廣播級精準逐個動畫步進修復**：
     - **措施 1（翻頁與跳頁強制重設動畫回第 0 步）**：在 `scripts/ppt-com-worker.ps1` 中，所有 `GotoSlide` 呼叫強制補上 `-1` (`msoTrue`) 旗標：`$ssw.View.GotoSlide([int]$newSlide, -1)`，強制微軟重設動畫為初始未展開態，杜絕一次性全部爆出！
     - **措施 2（動畫逐個點擊步進保證）**：在 `STEP_SLOT` next 邏輯中，嚴格判定 `$oldClick -lt $maxClick` 時精準調用 `$ssw.View.Next()` 推進動畫，按一下彈出一個動畫氣泡；當前頁動畫播畢後才換頁。
     - **措施 3（精準統計實際點擊數）**：在 `Ensure-DeckLoaded` 中精準過濾 `TriggerType -eq 1`（OnPageClick）之動畫點擊次數，控台精準同步進度。
2. **測試鎖定與驗收**：
   - 專案標準指令 `npm test`：**24/24 測試 100% 全數通過（含真機 COM E2E 全鏈路雙螢幕驗證，Exit Code 0）**！


## [v1.0.35] - 2026-11-13 (長官指令大落地 · 徹底排查與修復「抓取檔案抓不進來」 ＋ 移除隊列自動解鎖 ＋ 影音秒級刷新 ＋ 24/24 全綠)
### 需求與實裝落地
1. **【長官指令】「現在抓取檔案抓不進來了，你看看為什麼」**：
   - **痛點排查與三大隱蔽原因**：
     - **原因 1（伺服器重啟離線）**：先前因切換至其他專案，Port 8890 伺服器離線，導致瀏覽器上傳 API 請求被拒；
     - **原因 2（隊列移除封鎖 Bug）**：先前若操作者在流程隊列點過「✕」移除某素材，該素材會留在 `localStorage['stage_deck_removed_flow_keys']` 封鎖名單中；即使重新抓取上傳成功，前端渲染時因 `removedKeys.has(flowKey)` 依然被隱藏，導致操作者誤以為檔案抓不進來！
     - **原因 3（非 PPT 素材過度觸發 PowerPoint 掃描）**：先前上傳任何影片/音訊/圖片時，後端無差別調用 `pptEngine.scanAndExport`，若 COM 忙碌易導致上傳回調超時；
   - **三合一修復與強固措施**：
     - **措施 1（新抓取檔案自動解鎖與置頂）**：在 `app.js` 的 `uploadSingleBinaryFile` 中，只要新抓入檔案，自動將其從 `removedFlowKeys` 徹底移除解鎖，並自動加到 `flowOrderKeys` 最前面置頂，保證 100% 抓得進來且立即可見！
     - **措施 2（影音與圖片 0.01 秒秒級極速掃描刷新）**：在 `server.mjs` 中對非 PPT 檔案（影片、圖片、音訊）走專屬秒級快速通道，絕不阻塞等待 COM PowerPoint 掃描；
     - **措施 3（服務重新拉起與開機）**：重新拉起 Port 8890 主控台服務，真機測試 24/24 項全部通過！


## [v1.0.34] - 2026-11-13 (長官指令大落地 · CUT_SWAP 廣播級真正雙向無縫互換 ＋ 解決切換時影片消失暗坑 ＋ 24/24 全綠)
### 需求與實裝落地
1. **【長官指令】「pgm與preview在切換時影片會不見，你看看為什麼 —— 請開始製作」**：
   - **痛點排查與根本原因**：
     - 先前 `deck-state-machine.mjs` 中的 `CUT_SWAP` 邏輯僅單向考慮「把 PVW 推上 PGM」，但忽略了「當 PGM 原本正在播影片時，按 CUT 切換的對調處置」；
     - 舊版代碼在切換 PPT 或空槽時，直接執行了 `this.state.activeVideo = null`，完全沒有將 PGM 播出的影片移轉收回 PVW 預覽槽，導致影片在 CUT 當下直接被強制銷毀、瞬間蒸發；
   - **廣播級真正雙向無縫互換（Full Bidirectional Swap）徹底落地**：
     - **閉環 1（PGM 影片優雅退回 PVW 停格待命）**：
       - 在 `CUT_SWAP` 中全面重構狀態快照比對：若原 PGM 是影片，按 CUT 時系統自動讀取當前播放進度（`pgmCurrentTime`），將其打包封裝並存入 `this.state.pvwVideo`（靜音、停格待命）；
       - 影片 100% 毫秒級無損移轉至 PVW 預覽槽，畫面與秒數穩固釘住，絕對不再憑空消失！
     - **閉環 2（PVW 內容無縫推上 PGM）**：
       - PVW 準備好的內容（PPT、另一部影片、圖片或空槽）正常登台 PGM 播出；
     - **閉環 3（再次 CUT 即時回歸續播）**：
       - 操作者若隨時想把剛才退回 PVW 的影片切回 PGM，只需再次點擊「CUT 切換」，影片立刻從剛才暫停的秒數無縫推上舞台大螢幕續播，兩邊對調同生共死！
     - **閉環 4（前端按鈕帶入當前秒數）**：
       - `app.js` 的 `btnCutSwap` 事件監聽器自動擷取 `pgmVideoPlayer.currentTime` 並作為 payload 派發，保證切換瞬間零秒差無縫封存！
2. **測試鎖定與驗收**：
   - 新增 `[State-4B]` 專屬測試：`影片在 PGM 播出時按 CUT_SWAP：原影片必須優雅退回 PVW 槽位停格待命，絕對不得憑空消失！`；
   - 專案標準指令 `npm test`：**24/24 測試 100% 全數通過（含真機 COM E2E 全鏈路雙螢幕驗證，Exit Code 0）**！


## [v1.0.33] - 2026-11-11 (長官指令大落地 · 徹底消滅多重播放與不一致 ＋ 廣播級 PGM/PVW 槽位互斥硬鎖 ＋ PGM 播放器時鐘連動 ＋ 23/23 全綠)
### 需求與實裝落地
1. **【長官指令】「還是發生多重播放跟不一致，你檢查看看。（附帶現場實機截圖）」**：
   - **截圖物證解剖與致命死穴排查**：
     - 長官上傳之實機截圖顯示：隊列第 01 項素材「1 佛門禮儀 合掌問訊」同時掛起「🔴 播出中」與「🟢 預覽待命」**兩個徽章**！
     - PGM 視窗中顯示「影片播出中」畫面在動；右邊 PVW 視窗同時顯示「影片預覽中 (靜音) 00:17 / 04:23」畫面停格；右下播控艙顯示「⏸ PGM 已暫停 (停格中) 00:17 / 04:23」；
     - **根本原因**：
       1. 狀態機中當某影片被推上 PGM 播出時（`PLAY_VIDEO` / `PLAY_MEDIA_PGM`），沒有自動釋放 PVW 槽位，導致 `pvwVideo` 依然殘留該影片；
       2. 系統中同時存在多個 `<video>` 播放器實體（主控台 PGM、主控台 PVW、第二螢幕 Stage）；
       3. 且主控台 `pgmVideoPlayer` 先前缺少 `timeupdate` 監聽器，導致 PGM 影片播放時，右下播控艙沒有每秒流暢跟隨推動，時間停留於舊數值；
       4. 隊列渲染中若同時符合 PGM 與 PVW，兩個 badge 都被畫出，造成認知混淆。
   - **廣播導播台四大鐵律根治實裝**：
     - **鐵律 1（素材互斥與單一駐留硬鎖）**：
       - 在 `deck-state-machine.mjs` 之 `PLAY_VIDEO` 與 `PLAY_MEDIA_PGM` 中：只要某素材被推上 PGM 播出，若其 ID 存在於 PVW 槽位，**一律自動清空 PVW（`this.state.pvwVideo = null; this.state.pvwMedia = null;`）**！
       - 反向防禦：在 `LOAD_PVW_VIDEO` 與 `LOAD_MEDIA_PVW` 中，若該素材當前正在 PGM 播出中，拒絕重複載入 PVW 槽位，徹底消滅第二個播放器實體！
     - **鐵律 2（PVW 退出時物理銷毀播放器實體）**：
       - 在 `app.js` 的 `renderState` 中：當 PVW 槽位變為待命空槽（`isPvwEmpty`）時，強制執行 `pvwVideoPlayer.pause(); pvwVideoPlayer.removeAttribute('src');`，徹底釋放 DOM 媒體實體與記憶體緩存！
     - **鐵律 3（PGM 視窗播放器全雙工時鐘連動）**：
       - 為 `pgmVideoPlayer` 掛載 `timeupdate`、`play`、`pause` 事件監聽器；
       - 當影片在 PGM 播出時，右下播控艙的進度條（`deskMasterVideoSeek`）與時間顯示（`deskMasterVideoTimeDisplay`）毫秒級即時跟隨推動，徹底消滅數值不一致！
       - 點擊播控艙按鈕時精確判定 PGM 狀態，原地停格與原地續播 100% 精準生效。
     - **鐵律 4（隊列徽章互斥）**：
       - `renderScheduleQueue` 中新增防禦：`if (isPgm) isPvw = false;`，同一素材處於播出中時絕不重複亮起「🟢 預覽待命」，畫面整潔純淨。
2. **測試鎖定與驗收**：
   - 專案標準指令 `npm test`：**23/23 測試 100% 全數通過（含真機 COM E2E 雙螢幕與多維度極端邊界測試，Exit Code 0）**！


## [v1.0.32] - 2026-11-11 (長官指令大落地 · PGM 影片原地停格暫停 ＋ 絕不誤退回主視覺 ＋ 播控艙與舞台螢幕 100% 雙向連動 ＋ 23/23 全綠)
### 需求與實裝落地
1. **【長官指令】「影片在 PGM 播的時候，如果我在播放器按暫停，它就退回來了，變成主視覺。他不應該退回來，只要暫停就好了」**：
   - **痛點排查與根本原因**：
     - 先前在處理唯一播放互斥時，誤將「PGM 播放器暫停」與「媒體下架退台（STOP_MEDIA）」混為一談；
     - 點擊播控艙按鈕時觸發了 `STOP_MEDIA`，後端狀態機將 `activeVideo` 設為 null 並將 `outputMode` 切換為 `'kv'`（主視覺），導致舞台投影與主控台影片徹底關閉退出；
   - **原地停格暫停與原地續播閉環（四重架構實裝）**：
     - **閉環 1（後端狀態機新信令 `TOGGLE_PGM_VIDEO` 與 `SEEK_PGM_VIDEO`）**：
       - 新增專屬 Action，執行時僅切換 `activeVideo.isPaused` 旗標與更新 `currentTime`，`activeVideo` 物件與 `outputMode === 'video'` 永遠剛性保留，絕不退出退回主視覺；
     - **閉環 2（第二螢幕放映艙 `/stage` 即時響應原地停格）**：
       - `stage.html` 接收到 `activeVideo.isPaused === true` 時，大螢幕 `videoEl.pause()` 原地定格在當前幀；收到 `isPaused === false` 時立即從原地繼續播放；收到 `currentTime` 時精確跳轉；
     - **閉環 3（主控台 PGM 視窗與播控艙狀態對齊）**：
       - 影片登上 PGM 播出時，播控艙自動對齊 PGM 狀態，按鈕精確顯示為「⏸ 原地暫停 (PGM)」；
       - 操作者點擊時派發 `TOGGLE_PGM_VIDEO`，畫面上立即可靠原地停格，按鈕變為「▶ 繼續播放 (PGM)」；再次點擊無縫接續開播；
     - **閉環 4（PGM 播出中拖動進度條即時 Seek）**：
       - 在播控艙拖動進度桿時，直接透過 `SEEK_PGM_VIDEO` 推動 PGM 播放器與舞台放映艙畫面跳轉，操作體驗全雙工絕對受控！
2. **測試鎖定與驗收**：
   - 強化 `[Lock-1E]` 硬鎖測試，嚴格審查 `TOGGLE_PGM_VIDEO` 與 `SEEK_PGM_VIDEO` 原地停格信令；
   - 專案標準指令 `npm test`：**23/23 測試 100% 全數通過（含真機 COM E2E 全鏈路，Exit Code 0）**！

## [v1.0.31] - 2026-11-11 (長官指令大落地 · Preview 與播控艙共用同一 Play 核心 ＋ 一鍵雙停 ＋ 徹底根除脫節與數值誤差 ＋ 23/23 全綠)
### 需求與實裝落地
1. **【長官指令】「我剛剛在播影片的時候，播放控制器暫停，但是暫停不了；好像 Review 跟播放控制器是分開的，有時候兩邊的數值還是不太一樣，沒有完全可以控制。如果兩邊用同一個 play，會有什麼問題嗎？—— 請開始製作」**：
   - **痛點排查與根本原因**：
     - 先前在右下播控艙點擊「⏸ 暫停」時，程式碼僅調用了本機小視窗播放器 `deskVideoMaster.pause()`，完全沒有去暫停大畫面 Preview 播放器 `pvwVideoEl`，導致 Preview 影片依然持續前進，使導播感覺「按了暫停卻停不下來」；
     - 兩個播放器實體各自在背後觸發 `timeupdate` 計時器，互相覆蓋進度條，導致雙邊數值抖動且無法完全受控。
   - **共用同一 Play 核心（Single Play Core）徹底根治落地**：
     - **閉環 1（統一播放控制器 `toggleUnifiedPlayback`）**：
       - 當素材處於 Preview 預覽中時，系統以 Preview 播放器（`pvwVideoEl`）為全場唯一真實播放實體；
       - 無論點擊 Preview 卡片上的「暫停預覽/播放預覽」，或是點擊右下播控艙的「⏸ 暫停/▶ 試播」，**100% 同時調用 `toggleUnifiedPlayback`，一鍵雙停！**
       - 按暫停時：`pvwVideoEl.pause()` 立即執行，Preview 畫面立刻釘住，後端信令同步落鎖；
     - **閉環 2（雙按鈕狀態鏡像同步 `updateUnifiedPlayButtons`）**：
       - 監聽 `pvwVideoEl` 之 `play`、`pause`、`ended` 事件，只要一方狀態改變，右下播控艙按鈕與 Preview 按鈕文字毫秒級同步變更為「⏸ 暫停」或「▶ 試播」；
     - **閉環 3（單一時鐘源，徹底消滅雙時鐘競爭）**：
       - 素材在預覽槽時，所有時間碼（`pvwVideoTimeDisplay`、`deskMasterVideoTimeDisplay`）與進度條（`pvwVideoSeekSlider`、`deskMasterVideoSeek`）統一以 `pvwVideoEl` 為唯一時鐘源，拉桿與時間數值 100% 絕對同生共死，完全受控！
2. **測試鎖定與驗收**：
   - 強化 `[Lock-1E]` 硬鎖測試，嚴格審查 `toggleUnifiedPlayback` 與 `updateUnifiedPlayButtons` 統一播控核心實裝；
   - 專案標準指令 `npm test`：**23/23 測試 100% 全數通過（含真機 COM E2E 全鏈路，Exit Code 0）**！

## [v1.0.30] - 2026-11-11 (長官指令大落地 · 影片規格全面對標音訊 ＋ 試播拉桿即時跳播 ＋ 暫停續播 ＋ PGM 唯一播放互斥 ＋ 23/23 全綠)
### 需求與實裝落地
1. **【長官指令】「影片應該也和聲音一樣。不用做一個純播放，邏輯一樣就好」**：
   - **全面對標聲音邏輯（四重規格落地）**：
     - **規格 1（播控艙試播拉到哪播到哪）**：在播控艙試播影片時拉動進度桿，`input` 與 `change` 事件即時更新 `deskVideoMaster.currentTime`，畫面即拉即播；加入 `isDraggingDeskSeek` 狀態防護，拖動期間徹底屏蔽 `timeupdate` 反向覆蓋；
     - **規格 2（停止後拉桿再播接續起播）**：按下「⏸ 暫停」後拉動進度條，畫面停格在目標幀；放開後再次點擊「▶ 試播」，100% 精準從拉到的秒數繼續往下播放，絕不重置回 0；播放結束（`ended`）時自動還原按鈕為「▶ 試播」並重置滑桿；
     - **規格 3（同一個影片檔案唯一播放通道互斥）**：
       - 當影片被推上 PGM 主畫面播出時（透過隊列點播、播控艙「直接播出」或 CUT 切換），系統於 `renderState` 第一時間自動執行 `deskVideoMaster.pause()` 並更新按鈕為「▶ 試播」，徹底防止本機與輸出端雙重併播；
       - 若影片正在 PGM 播出中，操作者於播控艙手動點擊「▶ 試播」時，自動派發 `STOP_MEDIA` 切斷 PGM 輸出並轉由本機試播；
     - **規格 4（Preview 數值絕對跟隨播放器）**：
       - 影片在播控艙播放或拉動到一半時點擊「送至預覽 (PVW)」，Preview 畫面、進度條（`pvwVideoSeekSlider`）與時間顯示（`pvwVideoTimeDisplay`）即刻同步對齊該數值；
       - 在 Preview 拉動進度條與在播控艙拉動進度條維持 100% 雙向鏡像連動！
2. **測試鎖定與驗收**：
   - 強化 `[Lock-1E]` 硬鎖測試，嚴格審查影片登上 PGM 互斥暫停與唯一播放防護邏輯；
   - 專案標準指令 `npm test`：**23/23 測試 100% 全數通過（含真機 COM E2E 全鏈路，Exit Code 0）**！

## [v1.0.29] - 2026-11-11 (長官指令大落地 · Preview 預覽數值絕對跟隨播放控制器 ＋ 送至預覽無縫接續當前秒數 ＋ 23/23 全綠)
### 需求與實裝落地
1. **【長官指令】「Preview 的數值應該是跟著播放控制器變化才對。當播放控制器已經播一半，如果按了放到 preview 的時候，preview 應該要跟著播放器的數值」**：
   - **痛點排查與根本原因**：
     - 先前點擊播控艙「送至預覽 (PVW)」按鈕或隊列卡片「送至預覽」時，派發之 `LOAD_MEDIA_PVW` 信令未帶入播控艙當前秒數，且狀態機中將影音物件預設值寫死為 `currentTime: 0`；
     - 前端 PVW 接收到預覽素材時，若元素未觸發 `loadedmetadata` 或屬非同步媒體，未能第一時間將進度條（`pvwVideoSeekSlider`）與時間顯示（`pvwVideoTimeDisplay`）即時設置為播放控制器目前的數值，導致預覽槽永遠顯示在開頭。
   - **全鏈路狀態跟隨閉環（三重精準落實）**：
     - **閉環 1（後端狀態機 `LOAD_MEDIA_PVW` 參數承接）**：狀態機新增解構 `currentTime = 0, isPlaying = false`，並進行安全數值校驗，讓後端全域狀態精確保存送入時之播放時間指針；
     - **閉環 2（前端發送端即時採集播放器秒數）**：
       - 在播控艙點擊「送至預覽 (PVW)」或隊列點擊「送至預覽」時，系統即時取得當前播放控制器之真實秒數（音訊取 `bgPlayer.currentTime` 或滑桿換算；影片取 `deskVideoMaster.currentTime` 或滑桿換算）；
       - 將 `currentPlaybackTime` 一併包裝於信令傳送給 PVW；
     - **閉環 3（前端 PVW 接收即刻套用與雙向對齊）**：
       - PVW 載入時立即呼叫 `applyPvwPlaybackState`，即時設定 `pvwVideoPlayer.currentTime`、`pvwVideoSeekSlider.value` 與 `pvwVideoTimeDisplay`；
       - 若為新素材亦註冊 `loadedmetadata` 確保元數據就緒後再次校正，**保證 Preview 的數值 100% 精準跟隨播放控制器當前播到的數值**！
2. **測試鎖定與驗收**：
   - 強化 `[Lock-1E]` 硬鎖測試，驗證 `LOAD_MEDIA_PVW` 承接 `currentTime` 與 PVW 渲染時即時套用當前播放器數值；
   - 專案標準指令 `npm test`：**23/23 測試 100% 全數通過（含真機 COM E2E 全鏈路，Exit Code 0）**！

## [v1.0.28] - 2026-11-11 (長官指令大落地 · 音訊唯一發聲互斥鐵律 ＋ 播控艙與 Preview 進度條雙向鏡像 ＋ 23/23 全綠)
### 需求與實裝落地
1. **【長官指令】「同一個音訊檔案不能在純播放播 又同時在 PGM 裡面播。換句話說，同一個檔案只能在一個地方播，而且播放控制器跟 Preview 裡面的進度條應該是一樣的」**：
   - **痛點排查與架構梳理**：
     - 先前純播放走客戶端背景音訊（`bgAudioPlayer`），而 PGM 走伺服器全域信令主控（`activeMedia`），若操作者同時在兩處點擊，會造成背景音訊與現場主監聽雙重發聲疊音；
     - Preview（預覽槽）內部進度條（`pvwVideoSeekSlider`）與右下播控艙進度條（`deskMasterVideoSeek`）原本由各自的事件獨立更新，在素材送至 PVW 預覽時未能完全鏡像同步。
   - **全雙工互斥排他與雙向鏡像閉環（雙核心修復）**：
     - **互斥鐵律 1（PGM 登台即停純播放）**：在 `renderState` 廣播狀態監聽中，凡偵測到音訊檔案（`type === 'audio'`）被推上 PGM 主畫面播出（無論透過「🔴 直接播出」或「CUT 切換」），第一時間強制執行 `bgPlayer.pause()` 並清空背景純播放，純播放徽章自動熄滅，徹底杜絕雙重疊音；
     - **互斥鐵律 2（純播放啟動即停 PGM 播出）**：若某音訊已在 PGM 播出中，操作者一旦手動觸發純播放，系統自動派發 `STOP_MEDIA` 切斷 PGM 輸出並轉入純播放通道，保證全場同時間同一個檔案只在一個通道發聲；
     - **進度條雙向鏡像同步（Single Source of Truth）**：
       - **音訊 Preview 預載解鎖**：預覽音訊時同步載入 `pvwVideoPlayer.src` 並強制靜音（`muted: true`），讓 Preview 具備完整的 duration 與時間碼走動能力；
       - **播控艙 ➔ Preview 鏡像**：在播控艙拉動 `deskSeek` 時，若素材正處於 PVW 預覽中，即時同步更新 `pvwVideoEl.currentTime`、`pvwSeekSlider.value` 與 `pvwVideoTimeDisplay`，並派發 `SEEK_PVW_VIDEO`；
       - **Preview ➔ 播控艙鏡像**：在 PVW 面板拉動 `pvwSeekSlider` 或播放時，透過 `timeupdate` 即時同步更新播控艙進度條與時間碼；兩處進度條位置與秒數 100% 絕對一致！
2. **測試鎖定與驗收**：
   - 強化 `[Lock-1E]` 硬鎖測試，嚴格驗證 PGM/純播放唯一發聲互斥機制與 Preview/播控艙進度條雙向連動；
   - 專案標準指令 `npm test`：**23/23 測試 100% 全數通過（含真機 COM E2E 全鏈路，Exit Code 0）**！

## [v1.0.27] - 2026-11-11 (長官指令大落地 · 純播放拖曳進度桿即時跳播 ＋ 停止播放後拉桿再播無縫接續 ＋ 23/23 全綠)
### 需求與實裝落地
1. **【長官指令】「純播放時，應該要可以拉進度桿，拉到哪裡就播到哪裡。按停止播放後拉進度桿，放開後再按播放，就從那個地方播放」**：
   - **痛點排查與根本原因**：
     - 先前進度桿（`deskSeek`）在 `input` 事件中僅更新了試播用的靜音元件 `deskVideoMaster.currentTime`，未同步真正現場放音的背景音訊元件 `bgAudioPlayer`；
     - 當音訊為暫停狀態時，點擊停止播放會將 `currentPurePlayingAudio` 清空為 `null`，且隊列按鈕與播控艙在重新起播時未正確鎖定目前拖曳後的時間碼（甚至隊列點擊寫死 `startTime = 0`），導致每次暫停後重新播放皆跳回開頭；
     - 缺乏拖曳狀態旗標保護，拖桿時易被頻繁觸發的 `timeupdate` 反向覆蓋。
   - **全雙工即時跳轉與接續續播閉環（四重精準修復）**：
     - **防線 1（即時跳轉拉到哪播到哪）**：在 `deskSeek` 的 `input` 與 `change` 事件中，針對音訊素材即時設置 `bgPlayer.currentTime = targetTime`。播放中拖曳時，音訊播放器立即跳轉至目標時間點並無縫繼續放音；
     - **防線 2（停止播放保留音訊上下文）**：點擊「⏸ 停止播放」時執行 `bgPlayer.pause()`，但完整保留目前音訊參考與指針。停止狀態下拖曳進度條，`bgPlayer.currentTime` 精準定位在目標時間碼，時間顯示同步更新；
     - **防線 3（放開後接續起播）**：無論是在播控艙點擊【`🔊 純播放`】或是從流程隊列點擊【`🔊 純播放`】，起播時自動偵測剛才拖曳後之精確秒數（`resumeTime = bgPlayer.currentTime`），放開再按播放 100% 精準從該處繼續放音；
     - **防線 4（拖曳防覆蓋硬鎖）**：加入 `isDraggingDeskSeek` 指標監聽（`pointerdown`/`pointerup`/`mousedown`/`mouseup`/`touchstart`/`touchend`），拖曳滑桿期間徹底屏蔽 `timeupdate` 反向寫入，滑桿手感極致絲滑零跳動。
2. **測試鎖定與驗收**：
   - 強化 `[Lock-1E]` 硬鎖測試，驗證進度桿即時同步、防反向干擾機制與續播秒數接續邏輯；
   - 專案標準指令 `npm test`：**23/23 測試 100% 全數綠燈（含真機 COM E2E 全鏈路，Exit Code 0）**！

## [v1.0.26] - 2026-11-10 (長官指令大落地 · 音訊獨立「純播放」背景放音 ＋ 播控艙秒數選取直播 ＋ 23/23 全綠)
### 需求與實裝落地
1. **【長官指令】「音訊類的檔案可以多一個按鈕，叫做「純播放」，它可以不用排進去 PGM 或 PreView 裡面，按了直接播出聲音；但是選它的時候，也要同步放在右邊的播放器裡，只是選完秒數之後，如果直接按純播放，就直接播，不用進 Preview 或 PGM」**：
   - **音訊卡片專屬【🔊 純播放】按鈕**：
     - 左側現場流程隊列中，凡是音訊檔案（`type === 'audio'`），卡片操作列多出專屬紫色【`🔊 純播放`】按鈕；
     - 點擊後不干擾、不排進 PGM（主畫面）與 PVW（預覽畫面），現場直接背景放音（`muted: false`）；
     - 播放中按鈕自動變為【`⏸ 停止播放`】（紅色高亮），再按一次隨時停止。
   - **右下角播控艙（Master Transport Dock）同步聯動與推桿選秒直播**：
     - 點選音訊卡片時，播控艙自動同步對接音訊檔名與時間碼；
     - 導播可任意拖曳時間軸推桿選取起始秒數（例如 `01:30`）；
     - 播控艙左側配置專屬紫色【`🔊 純播放`】按鈕，選完秒數直接點擊，音訊立即從該時間點背景播放，完全無需登台或進入預覽！
   - **頂部背景音訊守護徽章**：
     - 頂部導航列即時顯現微光徽章 `🎵 背景音：[檔名]`，導播隨時可視察並可一鍵點擊停止。
2. **測試鎖定與驗收**：
   - 新增 `[Lock-1E] 音訊獨立「純播放」機制與播控艙背景放音硬鎖審查` 單元測試；
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**23/23 測試 100% 全數綠燈（含真機 COM E2E 全鏈路，Exit Code 0）**！
   - 實體快照已親眼檢視：卡片與播控艙雙重【🔊 純播放】按鈕佈局完美，PGM/PVW 乾淨空槽無干擾。

## [v1.0.25] - 2026-11-10 (根除長檔名撐破卡片 ＋ 右上角【✕】剛性絕對定位釘死 ＋ 文字溢位自動省略 ＋ 22/22 全綠)
### 故障排查與實裝落地
1. **長官截圖故障復盤：`名稱太長，會按不到「✕」取消佇列`**：
   - **根本原因**：
     - 當音訊或影片檔名非常長時（例如 `02 1.生活品質提升 轉彎 911110 00 00 00 00 02`），卡片未強制截斷，長字串把卡片寬度撐爆；
     - 原本【`✕`】按鈕放置於 flex 尾端，直接被擠出卡片可視範圍外，導致使用者完全按不到。
   - **雙重剛性防禦修復**：
     - **防線 1（右上角剛性絕對定位）**：將【`✕`】按鈕從 flex 尾端提取，改為卡片直接子元素並設為 `position: absolute; top: 8px; right: 8px; z-index: 10;`，不論卡片多窄或檔名多長，【`✕`】按鈕永遠 100% 釘死在右上角；
     - **防線 2（文字排版剛性避讓與強制截斷）**：`.pool-item-row-top` 強制加上 `padding-right: 28px;` 避開右上角的按鈕區；`.pool-item-name` 標註 `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`，超長文字自動以 `...` 優雅收縮，徹底杜絕寬度溢位。
2. **測試鎖定與驗收**：
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**22/22 測試 100% 全數通過（含真機 COM E2E 全鏈路，Exit Code 0）**！
   - 實體快照已親眼檢視：超長檔名（項次 06、07）右側【`✕`】按鈕清晰可見、左側序號整齊不偏移。

## [v1.0.24] - 2026-11-10 (長官裁示落地 · 流程隊列切換為「徹底刪除模式」 ＋ 重置僅重排順序絕不復活檔案 ＋ 22/22 全綠)
### 需求與實裝落地
1. **【長官指令】「徹底刪除模式」**：
   - **痛點根除**：
     - 先前頂部「↺ 重置」按鈕會將已刪除的檔案名單一併清空，導致點擊重置時已刪除的檔案全部重新冒出來，不符合現場操作直覺。
   - **徹底刪除模式貫徹**：
     - 卡片右上角點擊【`✕`】刪除後，素材永久自現場流程隊列消失；
     - 頂部按鈕明確更名為【`↺ 重置順序`】（`btnResetFlowQueue`），點擊時**僅重置隊列卡片的上下排列順序（`saveFlowOrderKeys([])`）**；
     - **絕對不再觸碰已刪除檔案名單（`removedFlowKeys`）**，已刪除的檔案永遠維持刪除狀態，杜絕死灰復燃！
2. **測試鎖定與驗收**：
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**22/22 測試 100% 全數綠燈（Exit Code 0）**！

## [v1.0.23] - 2026-11-10 (長官鐵律落地 · PGM 與 Preview 預設完全空白零素材 ＋ 空槽待命視覺 ＋ 22/22 全綠)
### 故障排查與架構矯正
1. **【長官指令】「PGM 跟 Preview 的預設應該是沒有素材的，空白的」**：
   - **根本原因排查**：
     - 先前 `server.mjs` 在實例化 `DeckStateMachine` 時未傳遞 `cleanColdBoot: true`；
     - 導致狀態機在 `safePptPool.length > 0` 時，自動將第 1 份與第 2 份 PPT 分別塞入 PGM 與 PVW，並觸發 PowerPoint COM 自動預熱開檔。
   - **全面矯正與雙空槽落地**：
     - **後端狀態機與伺服器預設空槽**：
       - `server.mjs` 強制掛載 `cleanColdBoot: true`，冷啟動時 PGM 與 PVW 強制為 `{ type: 'empty', deckId: null }`；
       - 若目錄存在主視覺底圖則第二螢幕展示純淨 KV，否則進入純淨黑底待命，絕不擅自開啟任何 PPT 視窗。
     - **前端雙卡空槽待命專用視覺 (`slot-empty-placeholder`)**：
       - PGM 空槽時：無 KV 狀態下顯示深黑微光空槽佔位卡片與提示文字；
       - PVW 空槽時：100% 絕對純淨空白，顯示「⚪ PVW 空槽待命中（點選左側流程佇列或素材『送至預覽』）」，導播按鈕列與「下一頁」預覽懸浮框全數優雅隱藏。
2. **測試鎖定與唯一裁判**：
   - 新增 `[State-0] (長官鐵律) 現場伺服器建構狀態機 (cleanColdBoot) 時，PGM 與 PVW 必須 100% 絕對純淨空白` 單元測試；
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**22/22 測試 100% 全綠（含真機 COM E2E 全鏈路），Exit Code 0**；
   - 產出開機冷啟動純淨雙空槽實體快照：`projects/ppt-stage-deck/artifacts/clean-coldboot-empty-slots.png`。

## [v1.0.22] - 2026-11-10 (現場流程隊列素材移出 ＋ 滑鼠按住上下拖曳排序 ＋ 本地持久化 ＋ 21/21 全綠)
### 需求與實裝落地
1. **【長官指令】「進入現場流程隊列的素材也要可以移除；素材可以用滑鼠按住移動，上下移動。請開始製作」**：
   - **現場流程隊列支援自訂上下拖曳排序 (Drag-and-Drop Reordering)**：
     - 卡片加入 HTML5 原生拖曳屬性（`draggable="true"`）與手柄符號（`⋮⋮`，`cursor: grab`）；
     - 拖曳懸停時具備細膩的藍色位置指示條（`.drag-over-top` / `.drag-over-bottom`），拖曳中具備半透明反饋（`.is-dragging`）；
     - 放開（`drop`）後立即重新計算順序並儲存至 `localStorage`（`stage_deck_flow_order_keys`）；
     - 序號（`01`, `02`, `03`...）隨拖曳順序自動重新編碼，即時局部重繪。
   - **現場流程隊列素材移出功能**：
     - 每張流程卡片右上角配備幽靈邊框小按鈕【`✕`】（`.btn-remove-flow-item`），懸停變紅底高亮；
     - 點擊移出按鈕將該項 ID 標記移出，並儲存至 `localStorage`（`stage_deck_removed_flow_keys`），重開網頁維持移出狀態，且不刪除硬碟實體檔案；
     - 頂部隊列標題列新增【`↺ 重置`】按鈕（`#btnResetFlowQueue`），方便隨時一鍵還原初始排程與召回被移出的素材。
2. **測試鎖定與驗收**：
   - 新增 `[Lock-1D] 流程隊列 (Run-of-Show) 支援拖曳排序與素材移出機制審查` 單元測試；
   - 專案唯一裁判指令 `npm --prefix projects/ppt-stage-deck test`：**21/21 測試全數通過（含真機 COM E2E 雙螢幕閉環），Exit Code 0**！
   - 實體快照存證：`projects/ppt-stage-deck/artifacts/e2e-ppt-stage-deck-live.png`。

## [v1.0.21] - 2026-11-10 (長官指令大升級 · 影片與 MP3 選取/預覽/播出三態全自動聯動右下播控艙 ＋ 20/20 全綠)
### 需求與實裝落地
1. **【長官指令】「除了 PPT跟圖片外，影片跟 MP3 被選取、被放到『預覽』或被放到『播出』的時候，都要可以在右下角的控制器進行控制。請開始製作」**：
   - **右下播控艙（Transport Dock）雙模自我調適**：
     - 當前對象為**影片**時：呈現原生 16:9 視訊框；
     - 當前對象為 **MP3 音訊**時：無縫切換為高質感波形卡片 `🎵 [音訊] 檔名` 與「音訊播控中」專屬視覺指示。
   - **三態全自動智慧捕獲與優先級同步 (`syncMediaDock`)**：
     - **優先級 1（播出中 PGM）**：一旦影片或音訊登上舞台（紅色 `🔴 播出中`），右下播控艙即刻同步掌控現場播出進度；
     - **優先級 2（預覽中 PVW）**：若 PGM 無影音，而預覽槽載入了影片或音訊（綠色 `🟢 PVW 預覽中 (靜音)`），播控艙立即接管 PVW 靜音試聽與定位；
     - **優先級 3（點擊選取）**：在左側流程跑道中單純點擊任何影片或音訊卡片時，播控艙自動切換鎖定該項目（藍色 `已選取 (待命)`）。
   - **推桿與動作鍵全雙工自動適配**：
     - 點擊【▶ 試播/暫停】自動根據類型播放 MP4 或 MP3；
     - 點擊【送至預覽 (PVW)】：影片發送 `LOAD_PVW_VIDEO`，音訊發送 `LOAD_MEDIA_PVW`；
     - 點擊【🔴 直接播出 (PGM)】：影片發送 `PLAY_VIDEO`，音訊發送 `PLAY_MEDIA_PGM`，時間碼與進度完美繼承！
2. **現場物證驗收**：
   - 專案唯一裁判指令 `npm --prefix projects/ppt-stage-deck test`：**20/20 測試全數通過（含真機 COM E2E 雙螢幕閉環），Exit Code 0**！

## [v1.0.20] - 2026-11-10 (根除前端瀏覽器 Out of Memory 崩潰 · HTTP 206 串流硬鎖 2MB 步長 ＋ 零預載 preload="none" ＋ 按需載入 ＋ 20/20 全綠)
### 故障根本原因與防爆自癒
1. **長官截圖故障復盤：`糟糕！顯示這個網頁時發生錯誤。錯誤代碼：Out of Memory`**：
   - **根本原因排查**：
     - `assets/videos/` 中存在 **1.63 GB（1,710,977,325 位元組）** 超大型長影片（`【大悲懺法會】...mp4`）。
     - 先前 `public/app.js` 在冷啟動時，會自動把第一部影片塞入右下角的 `<video id="deskVideoMasterPlayer">`，且 `<video>` 預設為自動預載（`preload="auto"`）。
     - 同時後端 `/videos/` 串流路由在無 Range 標頭時直接透過 `fs.createReadStream` **將 1.63GB 全量串流推送給瀏覽器**，導致 Chrome/Edge 渲染進程的 V8 堆疊內存瞬間飆破 2GB~4GB 上限，觸發硬體 OOM 崩潰！
2. **三重防禦性架構修復**：
   - **第一道防線（後端 HTTP 206 串流硬鎖 2MB 步長上限）**：
     - 在 `server.mjs` 中設置 `maxChunkSize = 2MB`。即便瀏覽器要求更大範圍，單次傳輸強制以 2MB 為上限分段投遞；
     - 若瀏覽器發送無 Range 請求，**嚴禁全量串流**，強制降級為僅回傳前 2MB 分段，從根本上物理阻斷記憶體洩漏。
   - **第二道防線（前端 `<video>` 標籤一律加上 `preload="none"`）**：
     - `public/index.html` 中的 `pgmVideoPlayer`、`pvwVideoPlayer`、`deskVideoMasterPlayer` 一律強制加上 `preload="none"`，未經使用者主動點擊播放前，絕不佔用任何影音緩衝區記憶體。
   - **第三道防線（右下播控艙改為「按需載入 (On-Demand)」）**：
     - 取消冷啟動自動設定 `src` 的行為，僅綁定選取 ID 與標題；唯有在使用者點擊【▶ 試播】或【送至預覽】時才動態載入，維持常態 0 記憶體消耗。
3. **驗收成果**：
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**20/20 測試全數通過（含真機 COM E2E 雙螢幕閉環），Exit Code 0**！

## [v1.0.19] - 2026-11-10 (長官新思維大變更大滿貫 · 冷啟動開機雙空槽 ＋ 萬能多媒體流程佇列 ＋ 預覽絕對靜音 ＋ 20/20 全綠)
### 需求與新思維全面貫通
1. **【長官全新指示】「現在整個思維不一樣了，不用一開始就把兩個 PPT 放上去。PPT、影片、圖片、音檔都可以放在佇列裡面，每個素材都可以直接播出，或者放到預覽。放到預覽的就不會發出聲音。PGM 跟 Preview 一開始都是沒有東西的。請開始製作」**：
   - **冷啟動開機純淨待命狀態 (Clean Cold-Boot Zero State)**：
     - 開機啟動時，PGM 與 PVW 監視器不再硬性綁定前兩份 PPT，預設為「⚪ 空槽待命 (STANDBY)」。
     - 第二螢幕初始展示純淨底層主視覺 (Key Visual) 或黑屏，絕不洩漏未就緒內容。
   - **萬能多媒體流程隊列 (Universal Media Flow Queue)**：
     - 左側現場大跑道全面升級為萬能佇列，平等收納【📑 PPT】、【🎬 影片】、【🖼️ 靜態圖片】與【🎵 純音訊檔】。
     - 每一項素材提供最純粹的雙動作：【送至預覽 (PVW)】與【直接播出 (PGM)】。
   - **預覽強制靜音鐵律 (Zero-Sound Preview)**：
     - 任何多媒體（影片、音訊）送至預覽槽位 (PVW) 或於播控艙試播時，強制加上 `muted = true`，**絕對不發出半點聲音干擾現場**！
     - 唯有在按下【直接播出 (PGM)】或透過中央【CUT 切換】正式登上主舞台時，才會自動解開靜音 (`muted = false`) 串接現場音響。
   - **伺服器後端與放映視窗同步升級**：
     - 新增 `assets/images` 與 `assets/audios` 資產目錄，支援 HTTP 206 串流與圖片動態載入。
     - 擴充 `/api/upload-media` 支援直接拖放 PPT、影片、圖片或音訊自動分類入池。
     - `public/stage.html` 放映艙支援多層級無縫覆蓋：底層主視覺 ➔ PPT/圖片放映 ➔ 頂層視訊全螢幕 ➔ 頂級黑幕救場。
2. **驗證與防作弊防禦性審查**：
   - 新增 `[State-6] 冷啟動開機初始雙空槽 (STANDBY) ＋ 萬能多媒體預覽與播出閉環` 單元測試。
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**20/20 測試全數通過（含真機 COM E2E 雙螢幕閉環），Exit Code 0**！
   - 親眼檢視最新主控台快照 [artifacts/e2e-ppt-stage-deck-live.png](file:///D:/AI-made/projects/ppt-stage-deck/artifacts/e2e-ppt-stage-deck-live.png)。

## [v1.0.18] - 2026-11-10 (極致極簡操作艙完工 · 徹底移除右下重複素材池 ＋ 雙監視器巨型舒展 ＋ 廣播級專用影片播控艙 ＋ 19/19 全綠)
### 需求與架構昇華
1. **【長官指令】「右下的PPT與影片池不要了，你覺得呢？請開始製作」**：
   - **消滅功能重疊，讓介面回歸純粹**：
     - 徹底移除右下角重複的素材清單，將左側【📋 現場流程 (Run-of-Show)】確立為全場**唯一主動脈**。
     - 在流程頂部提供【📥 抓取檔案】按鈕與拖放提示區，支援直接將 `.pptx` 或 `.mp4` 拖入加入流程。
   - **右上雙監視器（PGM / PVW）巨型開闊化**：
     - 預覽視窗高度從先前的 155px 大幅釋放至 260px~320px，16:9 原生清晰大畫面，細小字體、圖表與頁內動畫一覽無遺！
     - 中央【CUT 切換】大按鈕獨立置中，醒目無遮擋。
   - **右下進化為「🎬 廣播級專用影片播控艙 (Transport Dock)」**：
     - 包含 160x90 實質影片試播視窗、大標題、超長高精度時間推桿、以及專屬【▶ 試播】、【🟢 送至預覽 (PVW)】、【🔴 直接播出 (PGM)】巨型按鍵。
     - 點擊左側流程中的任何影片項目，右下播控艙秒級聯動載入，試聽、拉進度一氣呵成！
2. **驗收物證**：
   - 親眼檢視最新 [artifacts/e2e-ppt-stage-deck-live.png](file:///D:/AI-made/projects/ppt-stage-deck/artifacts/e2e-ppt-stage-deck-live.png) 快照：雙監視器畫面大了一倍，字體超清晰；右下專用影片艙極致專業，全場 100vh 零外部捲軸！
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**19/19 測試全數通過（含真機 COM E2E 雙螢幕閉環），Exit Code 0**。

## [v1.0.17] - 2026-11-10 (方案 1 旗艦操作艙完工交付 · 左垂直大跑道 ＋ 右主控雙監 ＋ 綜合素材池與抓取檔案 ＋ 19/19 全綠)
### 需求與架構大蛻變
1. **【長官全新架構指令】「PPT與影片池不要了，給一個綜合池，把要的檔案抓進來就好，影片控制區保留，流程範圍從上到下放著（方案 1）」**：
   - **全面重構為「左流程大跑道 ＋ 右主控與綜合池」黃金旗艦佈局**：
     - **左側大欄（佔寬約 36%，100% 垂直高度）**：【📋 現場流程 (Run-of-Show)】從頂到下一路貫通，垂直視野翻倍，可看 8~10 項流程。卡片採「上層資訊 ＋ 下層雙大按鈕」雙層防擠壓架構，標題完整舒展，徹底終結文字掉字與折行慘況！
     - **右上層（主控雙監視器）**：PGM 播出 ⇄ CUT 切換 ⇄ PVW 預覽橫向開闊舒展（自然 16:9），中央 CUT 導播中柱採獨立剛性封裝，**徹底根治先前的按鈕遮擋變形問題，完整呈現「CUT 切換」**！
     - **右下層（影片播控 ＋ 綜合素材池）**：
       - **常駐吸頂**：【🎬 影片專用播控區】（迷你試播器 + 超長流暢時間推桿 + 試播/送預覽/直接播出按鈕）。
       - **主體**：【📦 綜合素材池】（砍掉原本分散的 PPT 池與影片池，整合為一），支援分類標籤（全部 / PPT / 影片）快速篩選。
       - **「把檔案抓進來」**：支援桌面與資料夾檔案直接拖曳（Drag & Drop）進瀏覽器，或點擊「📥 抓取檔案」，後端自動識別副檔名（`.pptx` 或 `.mp4`）儲存並自動刷新入池！
2. **頂部導航列安全鎖死**：
   - 精簡控制項寬度，確保最右側【◼ 黑屏】救場按鈕與【退出系統】在任何解析度下 100% 完整露臉，杜絕現場操作安全隱患。
3. **雙重拖曳把手（Splitters）**：
   - 主垂直分隔條（左右調整流程跑道寬度）＋ 右側水平分隔條（上下調整雙監與素材區高度），支援雙擊還原與本機記憶。
4. **驗收物證**：
   - 親眼檢視 [artifacts/e2e-ppt-stage-deck-live.png](file:///D:/AI-made/projects/ppt-stage-deck/artifacts/e2e-ppt-stage-deck-live.png) 最新真機全景快照，左流程大跑道寬敞大氣、CUT 按鈕居中耀眼、右下綜合池與影片推桿開闊舒展，零水平溢位！
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**19/19 測試全數通過（含真機 COM E2E 雙螢幕閉環），Exit Code 0**。

## [v1.0.16] - 2026-11-10 (切片 3 完工交付 · 上下主控與素材區域 ＋ 下半部三模組 Splitter 拖曳伸縮 ＋ 本機記憶與雙擊還原閉環)
### 需求與實作落地
1. **【長官指令】「切片 3」**（「這三個區域可以調整範圍大小，不要摺疊」）：
   - **上下主區域水平拖曳分隔條 (`#horizontalSplitter`)**：
     - 位於上半部雙監視器主控區與下半部素材區之間，支援上下拖曳伸縮。
     - 動態調配 `--master-deck-height` 與 `--preview-max-height`，向上推可讓出更多空間給下方清單，向下拉可等比放大 16:9 投影片預覽視窗。
     - 設有安全邊界保護（最小 175px，最大保留下方 180px 安全高度）。
     - 支援雙擊（Double Click）立即還原為自然高度。
   - **下半部三模組垂直拖曳分隔條 (`.splitter-vertical`)**：
     - 在【現場流程】與【PPT 簡報庫】之間、以及【PPT 簡報庫】與【影片播控庫】之間各內嵌一條垂直分隔條。
     - 支援左右拖曳動態計算 `--col1-flex`、`--col2-flex`、`--col3-flex`，依據當天活動焦點自由拉寬特定模組。
     - 設有最小安全寬度（160px / 220px），防止模組內容被擠壓折損。
     - 支援雙擊（Double Click）立即還原為預設平衡比例。
   - **本機記憶持久化 (`localStorage`)**：
     - 自動記憶導播手感高度與寬度比例（`ppt_deck_v_split` 與 `ppt_deck_h_splits`），重啟系統或重新整理頁面自動還原。
2. **驗收物證**：
   - 親眼檢視 [artifacts/e2e-ppt-stage-deck-live.png](file:///D:/AI-made/projects/ppt-stage-deck/artifacts/e2e-ppt-stage-deck-live.png) 快照，水平把手與垂直把手細緻優雅，零破版、零水平溢位。
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**19/19 測試全數通過（含真機 COM E2E 雙螢幕閉環與切片 3 分界條幾何驗收），Exit Code 0**。

## [v1.0.15] - 2026-11-10 (切片 2 完工交付 · PGM 上半橫向舒展 ＋ 下方三素材模組獨立並列 ＋ 影片面板固定 ＋ 19/19 全綠)
### 需求與實作落地
1. **【長官指令】「可以切片2了」**：
   - 全面完成切片 2（結構重構與三大模組獨立展開）：
     - **上半部（主控區）**：PGM 播出 ⇄ CUT 切換 ⇄ PVW 預覽橫向自然開闊舒展（16:9 原生比例），徹底告別直立怪異拉長。
     - **下半部（素材區）**：將原本需要點擊 Tab 切換的內容，直接拆分為三大常駐獨立並列模組：
       - `[模組 1]` **📋 現場流程 (Run-of-Show)**：整合所有簡報與影音檔之時間線隊列，支援獨立捲軸。
       - `[模組 2]` **📑 全部 PPT 簡報庫**：所有投影片清單、資料夾捷徑與送預覽/播出按鈕，支援獨立捲軸。
       - `[模組 3]` **🎬 影片播控庫**：吸頂固定式控制面板（迷你試播器 + 時間條 + 試播/送預覽/直接播出按鈕），僅下方影片清單內部獨立平滑滾動。
2. **修復與調優**：
   - 解決 `selectedVideoItem` 變數提升與生命週期範疇問題，確保首頁初次載入即自動預載第 1 部影片至迷你試播器。
   - 優化黑屏樣式突變測試非同步 microtask 等待，確保 E2E 測試完全符合真實廣播級反應。
3. **驗收物證**：
   - 親眼檢視 `artifacts/e2e-ppt-stage-deck-live.png` 主控台全景快照，三大模組舒展並存，文字清晰，完全零外部捲軸。
   - 專案標準指令 `npm --prefix projects/ppt-stage-deck test`：**19/19 測試全數通過（含真機 COM E2E 閉環），Exit Code 0**。

## [v1.0.14] - 2026-11-10 (影片播控庫控制面板吸頂固化 · 獨立清單平滑滾動閉環)
### 需求與實作落地
1. **【長官需求】「影片的控制面板要固定不動，會動的只有下面的影片列表選擇」**：
   - 將包含迷你影片試播器、時間進度條、試播預覽按鈕、送預覽與直接播出按鈕的控制面板（`.video-control-dock`）從滾動容器抽出，吸頂固化（`flex-shrink: 0;`）。
   - 僅將下方影片選擇清單（`#videoPoolList`）保留在獨立的滾動區塊（`.module-body`）中。
   - 導播無論如何滑動、瀏覽幾十部影片，上方試播畫面與控制按鍵永遠物理鎖死在視線頂部，隨選隨試播！
2. **驗證**：19/19 測試（含真機 COM E2E）100% 綠燈通過。

## [v1.0.13] - 2026-11-10 (長官真實摩擦點根除 · PGM 上半部橫向舒展 ＋ 下方空間釋放三大獨立素材模組)
### 需求與實作落地
1. **【長官現場反饋】「中間PGM下面的空間可以空出來給其他人用，拉那麼長，很奇怪」**：
   - 徹底消滅中欄被硬撐 100vh 導致 PGM/PVW 變成細長怪異柱子、上下留下大面積死黑的版面缺陷。
2. **全新黃金操作艙佈局**：
   - **上半部（主控雙監視器區）**：PGM 播出 ⇄ CUT 切換 ⇄ PVW 預覽橫向開闊舒展，投影片預覽維持自然 16:9 比例（`max-height: 155px`），按鈕緊湊好按，不再垂直拉長。
   - **下半部（PGM 下方釋出空間）**：同時並列展開三大獨立模組：
     - `[模組 1]` **📋 現場流程 (Run-of-Show)**：流程時間線清單，內部獨立平滑滾動。
     - `[模組 2]` **📑 全部 PPT 簡報庫**：簡報清單與開啟資料夾按鈕，隨時可送預覽或直接播出。
     - `[模組 3]` **🎬 影片播控庫**：包含頂部迷你影片試播器（帶進度條、試播、預覽、直接上台按鈕）與影片清單。
   - **徹底消滅 Tab 切換**：導播左眼看流程、中看簡報、右看影片，三者同時並存、一眼看盡！
3. **驗證**：
   - 通過全套 19 項測試（含真機 COM E2E、零水平溢位、0-DOM 檢查）。

## [v1.0.12] - 2026-11-10 (切片 1 落地 · 頂部單行硬化 ＋ 三欄專業操作艙佈局 ＋ 100vh 零大捲軸)
### 需求與架構落地
1. **【切片 1】頂部單行硬化 ＋ 佈局三欄平移**：
   - 頂部導航列鎖定單行（`height: 48px; flex-wrap: nowrap; overflow-x: auto;`），徹底消滅字級放大時按鈕被折成兩列霸佔畫面的問題。
   - 頁面高度 100vh 嚴格鎖死（`overflow: hidden;`），整頁不再產生大垂直捲軸。
   - 建立三欄專業廣播操作艙骨架：
     - **左欄（`.col-schedule`）**：現場流程隊列獨立面板，內部平滑滾動。
     - **中欄（`.col-master`）**：PGM 播出 ⇄ CUT 切換 ⇄ PVW 預覽心臟居中固化，投影片預覽視窗加大至 260px，清晰易讀。
     - **右欄（`.col-media`）**：媒體素材庫（PPT 簡報庫與影片播控庫），內部獨立滾動。
2. **驗證**：
   - 通過 `test/e2e-live-reality.test.mjs` 零水平溢位捲軸硬鎖（`scrollWidth <= clientWidth`）。
   - 全套 19 項測試（含真機 COM E2E 與 0-DOM 信令檢查）100% 綠燈通過。

## [v1.0.11] - 2026-11-10 (主控台面板 50% ~ 150% 無段字級縮放滑桿 ＋ 本機記憶 ＋ 一鍵還原閉環)
### 需求與實作落地
1. **【長官需求】面板字體可調整（50% ~ 150% 無段調整滑桿）**：
   - 提供 50% ~ 150% 無段平滑縮放滑桿，即時動態等比縮放主控台所有文字（標題、按鈕、頁碼、動畫計數器、流程隊列、簡報池等）。
2. **架構與防禦性設計**：
   - **CSS 全域變數驅動 (`--font-scale`)**：以 `:root { --font-scale: 1; }` 統一驅動所有介面字級 (`calc(XXpx * var(--font-scale, 1))`)，平滑無段縮放，絕不擠壓破壞雙監視器 16:9 比例與視窗幾何。
   - **本機偏好持久化**：透過 `localStorage.getItem('ppt_deck_font_scale')` 記憶導播偏好，再次啟動自動還原。
   - **一鍵重設 (Reset)**：點擊百分比數字標籤（例如 `125%`）可立即平滑還原為 `100%` 預設值。
3. **驗證**：全套 19 項測試（含真機 COM E2E 與 0-DOM 信令檢查）100% 綠燈通過。

## [v1.0.10] - 2026-11-10 (第二螢幕主視覺底圖 Key Visual · 四層堆疊 ＋ 選圖上傳 ＋ 一鍵露出展示閉環)
### 需求與架構落地
1. **【長官需求】主視覺當底 ＋ 選取圖片按鈕 ＋ 堆疊架構**：
   - 「我想加一個主視覺當底，我想要加一個按鈕，按了之後可以去選主視覺的圖，這個主視覺在延伸螢幕是最下面的圖，上面可能會覆蓋 PPT 或影片，這些都沒有之後，最下面的就是這張圖」。
2. **第二螢幕四層標準廣播圖層堆疊（由底至頂）**：
   - `[Z-00]` **主視覺底圖 (`#stageKeyVisualImg`)**：`position: fixed; inset: 0; object-fit: cover; z-index: 5;`，當延伸螢幕未播 PPT 或影片時，觀眾看到的就是大氣震撼的活動主視覺。
   - `[Z-10]` **簡報層 (`#stageSlideImg`)**：`z-index: 10; background-color: transparent;`，當有 PPT 且處於 `ppt` 模式時覆蓋其上；若無 PPT 或切換至 `kv` 模式時自動隱藏，露出底圖。
   - `[Z-20]` **影片層 (`#stageVideo`)**：`z-index: 20;`，插播影片時全螢幕播放覆蓋；停止或播畢後隱藏，回復底層簡報或主視覺。
   - `[Z-50]` **黑屏遮罩 (`#blackCurtain`)**：`z-index: 50;`，最高優先級純黑保護閥。
3. **主控台功能與信令閉環**：
   - **頂部操作列**：新增【🖼️ 主視覺底圖】選圖按鈕、隱藏式 `<input type="file">`、縮圖預覽徽章、清除按鈕（`✖`）以及【回主視覺 / 切回簡報】快速切換按鈕。
   - **伺服器端**：新增 `/api/upload-key-visual` POST 路由（支援 Base64 上傳儲存至 `assets/key-visual/kv.png`）與 `/key-visual/<filename>` 靜態路由（遵循 DEF-04A 與 DEF-04B 安全防禦規範）。
   - **信令合約差集為 0**：定義 `SET_KEY_VISUAL`、`CLEAR_KEY_VISUAL`、`TOGGLE_KV_MODE`，雙端 Handler 與 StateMachine 嚴格對齊。
4. **測試與驗證**：
   - 追加 `test/deck-state-machine.test.mjs` 之 `[State-5]` 主視覺載入、覆蓋層級與模式切換閉環測試。
   - 全套 19 項測試（包含 0-DOM 檢查、差集為 0 硬鎖、靜態安全掃描與真機 E2E）100% 綠燈通過。

## [v1.0.9] - 2026-11-09 (PVW 影片預覽按 CUT 切換精準推上 PGM 播出與雙端視圖閉環)
### 症狀與根本原因剖析
1. **【嚴重操作斷層】長官反饋「影片到預覽，按切換，出去的是 PPT，應該是影片才是」**：
   - **根本原因剖析 (雙端斷層)**：
     1. **後端信令脫節**：當 `action === CUT_SWAP` 時，伺服器一律呼叫 `pptEngine.cutSwap()` 切換 PPT，完全未判斷此時 PVW 正在預覽影片（`nextState.outputMode === 'video'`）。導致 PowerPoint COM 強制將 PPT 視窗推上第二螢幕，死死蓋住正在播放影片的 Chrome 舞台放映艙；
     2. **主控台 PGM 監視器無影片視圖**：前端 `index.html` 與 `app.js` 的左側 PGM 監視器只有投影片 `<img>`，缺乏動態影片 `<video id="pgmVideoPlayer">`。當影片播出時，PGM 依舊顯示 PPT 縮圖與標題，導致導播在主控台與大螢幕皆誤判為 PPT。
   - **解法 (雙端徹底打通閉環)**：
     1. **後端信令分流**：在 `server.mjs` 中，若 `CUT_SWAP` 後 `nextState.outputMode === 'video'`，立即呼叫 `pptEngine.setStageMode('video')`，命令 PowerPoint COM 所有放映視窗隱藏（`SW_HIDE`），第二螢幕全螢幕聚焦於 Chrome 影片播放；僅在 PPT 互切時呼叫 `pptEngine.cutSwap()`；
     2. **主控台 PGM 監視器雙模切換**：PGM 卡片增設 `#pgmVideoPlayer` 與 `#pgmVideoNavRow`。影片播出時，PGM 標題動態變更為「影片播出：[名稱]」、頁碼標籤顯示「影片播出中」、畫面同步呈現影片動態播放，並提供醒目的紅色「停止影片並切回簡報」巨型按鈕；
     3. **第二螢幕 loadedmetadata 時間錨定防呆**：在 `stage.html` 增設 `loadedmetadata` 監聽器，確保預覽拖曳之 `startTime` 在瀏覽器解析元資料完成後 100% 精準定位；
     4. **測試覆蓋**：`test/e2e-live-reality.test.mjs` 追加【長官真實回報閉環 6B】：送影片至 PVW 靜音預覽 ➔ 點擊 CUT ➔ 驗證主控台 PGM 與舞台皆為影片播出 ➔ 點擊 PGM 紅色停止鍵無縫切回 PPT，18/18 測試 Exit Code 0 通過。

## [v1.0.8] - 2026-11-09 (真機視窗頂部標題列外洩與跨 DPI 算錯偏左未置中根本根治)
### 症狀與根本原因剖析
1. **【重大】第二螢幕放映視窗頂部出現 Windows 原生白色標題列（最小化/最大化/關閉）且畫面偏左文字被切、右邊露出大黑邊（「算錯沒有置中」）**：
   - **現場物證排查**：長官傳回現場雙螢幕全景實體截圖，左側投影螢幕（DISPLAY2）文字「02 互動提問與公告簡報 (第二頁)」之「互動」左緣硬生生遭視窗邊界裁切，右側出現數百像素黑色死區，頂部帶有 Windows 視窗標題列。
   - **深度根因剖析 (雙重物理原因疊加)**：
     1. **Chrome 啟動參數 `--app` 壓制 `--kiosk`**：在 `server.mjs` 中同時傳入 `--app=URL` 與 `--kiosk` 時，Chrome 會以普通 App 視窗模式啟動並強制附帶白色原生標題列（`_ □ ✕`），破壞全螢幕 Kiosk 沉浸感；
     2. **Windows 跨螢幕 DPI 虛擬化空間扭曲**：長官筆電主螢幕（DISPLAY1）物理解析度 1920x1080 開啟 125% 縮放（邏輯解析度 1536x864），而第二螢幕（DISPLAY2）為 100% 物理 1920x1080（Bounds X=-1920）。當進程在 System DPI 虛擬化下運算時，若未解耦物理座標與邏輯座標，會將視窗強制縮放並推移至負坐標超出界線處，導致左邊文字遭螢幕邊緣硬切、右邊形成大面積黑色空隙；
     3. **PowerPoint COM 視窗搶佔 HWND_TOPMOST 遮擋 Web 放映艙**：背景 `ppt-com-worker.ps1` 在切換簡報時強制呼叫 `SetWindowPos` 將原生 `screenClass` 視窗拉至最上層，蓋住了已由 Flexbox 完美置中的 Chrome `/stage` 放映艙，且因尺寸強改破壞了 PowerPoint 內部全螢幕配置。
   - **解法 (全面根治與像素閉環)**：
     1. **Chrome 啟動參數淨化**：移除 `--app`，改由 `--kiosk http://127.0.0.1:${boundPort}/stage` 直接傳入，加上 `--hide-scrollbars`，100% 確保無邊框純淨真 Kiosk；
     2. **Web 放映艙全權接管舞台輸出**：Chrome `/stage` 放映艙以現代 CSS Flexbox + `object-fit: contain; object-position: center center; margin: auto;` 實踐真・幾何絕對垂直水平對稱置中，任何 4:3 或 16:9 簡報皆居中呈現、絕不拉伸、絕不切字；
     3. **前端腳本語法錯誤與變數作用域清零**：修復 `app.js` 缺失之 `export function renderState` 宣告與 `videoPool` 內 `isPvw` 變數作用域，補齊頂部「停止影片」按鈕與事件防禦；
     4. **Live Reality E2E 四重硬鎖 100% 通過**：真機驗證 18/18 測試全綠（Exit Code 0），實體截圖親眼檢驗，雙監視器與舞台輸出完全置中無瑕疵。

## [v1.0.7] - 2026-11-09 (A+B+C 旗艦架構落地 · 現場流程單一隊列 ＋ 影片靜音預覽/時間定位 CUT 接續 ＋ 底部三大分頁)
### 症狀與根本原因剖析
1. **【重大升級】現場導播需同時兼顧 PPT 與影片播控，下半部兩欄並排過於擁擠且無法預覽影片與時間錨定**：
   - **解法 (A+B+C 旗艦架構閉環)**：
     1. **保持上半部雙監視器 (PGM 播出 / PVW 預覽) 不動**：
        - PVW 預覽槽擴展支援視訊播放器 (`pvwVideoPlayer`)；
        - 影片送至預覽時**嚴格靜音**，不干擾現場；
        - 提供時間軸滑桿，可拖曳定位至指定秒數；
        - 按下 **`[CUT 切換]`** 時，影片自動推入 PGM 放映端（第二螢幕）並**精準從該時間點接續有聲起播**！
     2. **下半部三大寬版功能分頁 (Tabs)**：
        - **分頁 1【現場流程 (Run-of-Show)】**：將 PPT 與影片依順序排列成單一隊列，每項皆有「送至預覽」與「直接播出」；
        - **分頁 2【PPT 簡報庫】**：全寬檢視所有 PPT 簡報；
        - **分頁 3【影片播控庫】**：內建大尺寸主播放器、巨型試播鍵、時間碼顯示、送至預覽與直接上台按鈕；
     3. 全面通過 `npm test` 18/18 考卷與 E2E 真機閉環。

## [v1.0.6] - 2026-11-09 (廣播級現場操作艙極致降噪 · 移除全部 Emoji 小圖示與多餘解釋文字)
### 症狀與根本原因剖析
1. **【介面降噪】操作介面存在過多說明文字、括弧備註與 Emoji 小圖示干擾導播視線**：
   - **解法 (對標 broadcast-ui-ux 零贅字鐵律)**：
     1. **徹底移除所有 Emoji 小圖示**：將 `🎬`、`📊`、`📱`、`🚪`、`📁`、`↻`、`◼`、`🟢`、`🔴`、`⇄` 等小圖示全面清除，回歸廣播設備硬體純淨視覺；
     2. **剔除所有教學解釋贅字**：中央切換區移除「點一下立即將右側...」「雙 PPT 待命互切」，按鈕精簡為極度純粹之「CUT 切換」；
     3. **素材池與頂部功能精簡**：移除「可同時載入 2 份 PPT...」「點擊直接於第二螢幕...」「(HTTP 206 零雜訊秒播)」，按鈕一律簡化為「重新掃描」「手機遙控」「黑屏」「退出系統」「開啟資料夾」「停止影片」「全螢幕播放」；
     4. 全面通過 `npm test` 17/17 綠燈考卷驗收。

## [v1.0.5] - 2026-11-09 (素材池一鍵打開 Windows 檔案總管與放映艙 Flexbox 幾何雙軸置中)
### 症狀與根本原因剖析
1. **【操作便捷】現場導播增減修改 PPT 或影片素材時，需繁瑣手動切換至檔案總管尋找路徑**：
   - **解法**：在主控台「📊 PPT 簡報池」與「🎬 影片池」標題及右側增設「📁 開啟資料夾」按鈕；點擊後呼叫後端 `/api/open-folder`，秒級喚出原生 Windows 檔案總管（分別開啟 `assets/slides/` 與 `assets/videos/`），增修後點擊「↻ 重新掃描素材池」立即熱更新。
2. **【重大】放映艙非 16:9 或手動縮放視窗時，圖片靠左貼死右邊留大黑條（「算錯沒有置中」）**：
   - **原因**：原本圖片使用 `display: block` 且容器無 Flex 居中約束，在非滿版視窗下被瀏覽器預設靠左排版。
   - **解法**：`stage.html` 容器全面導入 `display: flex !important; justify-content: center !important; align-items: center !important;`，且圖片與影片鎖定 `object-position: center center !important; margin: auto !important;`，達成幾何正中心對稱對齊。

## [v1.0.4] - 2026-11-09 (一鍵連鎖優雅退場機制 · 關閉主控台 ❌ 0 殘留全自動清理)
### 症狀與根本原因剖析
1. **【操作痛點】長官關閉主控台視窗後，第二螢幕放映視窗、PowerPoint COM 背景放映與 Node.js 伺服器持續殘留**：
   - **原因**：原本各模組生命週期各自獨立，主控台關閉時未主動發送全局終止訊號，導致人類必須手動開啟工作管理員逐一尋找並強制結束 `node`、`POWERPNT` 與第二螢幕視窗。
   - **解法 (三層連鎖優雅退場)**：
     1. **視窗關閉攔截與退場信標**：主控台視窗點擊右上角「❌」時，透過 `window.onbeforeunload` 觸發 `navigator.sendBeacon('/api/shutdown')`；
     2. **心跳失聯防線**：後端 WebSocket 監測 `client=desk` 連線數，當所有主控台離線達 2.5 秒（排除 F5 重新整理）自動觸發 `triggerGracefulShutdown()`；
     3. **全域連鎖自毀三部曲**：向第二螢幕放映艙發送 `{ type: 'SHUTDOWN' }` 自動 `window.close()`、呼叫 `$script:pptApp.Quit()` 徹底釋放 PowerPoint COM 記憶體與視窗、關閉 HTTP/WS 伺服器並以 `process.exit(0)` 終結命令列視窗；
     4. **操作艙專用按鈕**：頂部導航列增設醒目的紅色「🚪 關閉退出」按鈕，長官亦可隨時一鍵主動安全退出。

## [v1.0.3] - 2026-11-09 (多螢幕環境下第二螢幕拓撲誤判與投影螢幕智慧鎖定)
### 症狀與根本原因剖析
1. **【重大】三螢幕環境下投影視窗跑至右側虛擬螢幕（`DISPLAY4` 800x600）導致左側投影主螢幕（`DISPLAY2` 1920x1080）全黑**：
   - **原因**：`scripts/ppt-com-worker.ps1` 原使用 `$screens | Where-Object { -not $_.Primary } | Select-Object -First 1`，Windows `AllScreens` 陣列順序恰好將右側輔助屏 `\\.\DISPLAY4` (X=1920, 800x600) 排在第一順位，導致 `/stage` 視窗與 PowerPoint COM 放映艙誤打入右側小螢幕，左側實體主投影幕 `\\.\DISPLAY2` (X=-1920, 1920x1080) 無任何訊號維持全黑。
   - **解法 (方案 C)**：
     1. **環境變數手動優先**：支援 `$env:TARGET_DISPLAY`（如 `DISPLAY2` 或 `\\.\DISPLAY2`）精準鎖定指定顯示器。
     2. **廣播 16:9 面積智慧降序**：若未指定，自動計算所有非主螢幕之面積（`Width * Height`）降序排序，由 1080P/4K 等高解析度大螢幕優先奪標，自動排除 800x600 等虛擬屏或微型視訊屏。
     3. **Node 引擎傳遞**：`server.mjs` 與 `PptComEngine` 全面打通 `targetDisplay` 參數與環境變數對齊，`npm test` 17/17 測試全綠通過。

## [v1.0.2] - 2026-11-09 (二次深層實測：DPI 實體座標、即時動畫預覽、Z-Order 覆蓋與版面溢位根治)
### 症狀與根本原因剖析
1. **【重大】Per-Monitor DPI 混合縮放（主螢幕 125% + 第二螢幕 100%）導致第二螢幕座標虛報為 `2400,0 1000x750`**：
   - **原因**：`SetProcessDPIAware()` 僅為舊版 System DPI Awareness（跟隨主螢幕 125%），且 `powershell.exe` 進程初始化後單獨呼叫 `SetProcessDpiAwarenessContext(-4)` 可能回傳 `$false`，導致第二螢幕（實際物理座標 `1920,0 800x600`）被虛報為 `2400,0`，若觸發 `SetWindowPos` 搬移視窗將使簡報偏出螢幕右方 480px。
   - **解法**：在 `scripts/ppt-com-worker.ps1` 頂部同步調用 `SetThreadDpiAwarenessContext([IntPtr](-4))` 與 `SetProcessDpiAwarenessContext([IntPtr](-4))`，使 `Screen.AllScreens` 100% 精準回報第二螢幕物理座標 `1920,0 800x600`。
2. **【重大】主控台預覽圖原本僅顯示靜態 `Slide.Export` 圖片，無法反映「情況 2」頁內分段動畫即時進度**：
   - **原因**：`Slide.Export()` 匯出的是整頁全部動畫結束後的靜態縮圖；當講者在頁內按下一頁（`動畫 0/1 -> 動畫 1/1`）時，主控台預覽圖不會隨之變化。
   - **解法**：在 `Get-SlotRuntime` 中每次翻頁或觸發頁內動畫後，對 `PGM` 與 `PVW` 之 `screenClass` 視窗調用 `PrintWindow($hwnd, $hdc, 2)` 擷取即時畫面存為 `_live_pgm.png` / `_live_pvw.png`，並透過 `SYNC_PPT_RUNTIME` 推播 `livePreviewUrl`，使主控台預覽畫面與第二螢幕頁內動畫 100% 同步。
3. **【重大】主控台瀏覽器視窗跨螢幕溢位與 `/stage` 啟動時覆蓋第二螢幕 PowerPoint**：
   - **原因**：透過 `WindowFromPoint(2320, 300)` 真實探測第二螢幕正中央最上層視窗時，抓出兩處遮擋問題：(a) 新 Profile 啟動 Chrome 時預設視窗寬度達 `2483px`（自第一螢幕 `x=91` 跨越 `1920` 邊界蓋到第二螢幕 `x=2320`）；(b) `server.mjs` 先啟動 PowerPoint 再開啟 `/stage` 視窗時，後開啟的 `/stage` 會浮在 PowerPoint 上方。
   - **解法**：(a) 鎖定主控台視窗尺寸 `1240x800` 於第一螢幕 `(40,40)` 並在 `app.js` 加入防跨螢幕邊界自適應；(b) `/stage` 連線 WebSocket (`/?client=stage`) 後自動延遲 250ms 重新觸發 `pptEngine.setStageMode(curMode)` 將 `PGM` 簡報拉回第二螢幕 `HWND_TOPMOST` 最上層。
4. **【重大】影片池播畢 (`STOP_VIDEO` / `VIDEO_ENDED`) 切回 PPT 後，預覽槽 (`PVW`) 視窗維持 `SW_HIDE` 隱藏狀態**：
   - **原因**：`video` 模式會對所有 PowerPoint `screenClass` 視窗呼叫 `ShowWindow($h, 0)` (`SW_HIDE`)；切回 `ppt` 模式時，`Place-SlideShowOnTargetScreen $pvwEntry $false` 未呼叫 `ShowWindow($hwnd, 8)` (`SW_SHOWNA`)，導致 `PVW` 視窗持續隱藏無法擷取即時預覽。
   - **解法**：在 `Place-SlideShowOnTargetScreen` 的非置頂分支補上 `[PptWin32]::ShowWindow($hwnd, 8)` (`SW_SHOWNA`)，不搶焦點恢復可見並置於 `HWND_BOTTOM`。
5. **【UI 版面】CSS Grid `1fr` 預設 `min-width: auto` 造成 `1200px` 視窗下水平捲軸與右側頁碼裁切**：
   - **原因**：檢視 E2E 實體截圖 `e2e-ppt-stage-deck-live.png` 時發現 `.dual-monitor-grid` 與 `.pools-grid` 使用 `1fr` 而非 `minmax(0, 1fr)`，內部 `white-space: nowrap` 標題撐開網格造成水平捲軸。
   - **解法**：改為 `minmax(0, 1fr)` 並為 `.card` 與 `.slot-header` 加上 `min-width: 0`，同時於 E2E 測試新增 `scrollWidth <= clientWidth` 零水平溢位硬鎖。

## [v1.0.1] - 2026-11-09 (真機深層實測與 5 大隱蔽 Bug 根治)
### 症狀與根本原因剖析
1. **【重大】第二螢幕 PPT 視窗白屏死白（`ShowType = 2` + `SetWindowLong` 破壞子視窗裁切）**：
   - **原因**：原以為 `ShowType = 1` 無法同時開 2 個放映視窗，而改用 `ShowType = 2` (`PPTFrameClass`) 並強制呼叫 `SetWindowLong(GWL_STYLE, WS_POPUP)`，導致 `WS_CLIPCHILDREN` 被抹除，PowerPoint 內部畫面呈現全白；且未在載入 `System.Windows.Forms` 前呼叫 `SetProcessDPIAware()`，導致 125% DPI 下座標偏移。
   - **解法**：實測證實 PowerPoint 16.0 在 `ShowType = 1` (`ppShowTypeSpeaker` + `ShowPresenterView = 0`) 下原生支援同時開啟 2 個 `screenClass` 全螢幕無邊框視窗！移除破壞性的 `SetWindowLong`，改由 `SetProcessDPIAware()` + `SetWindowPos(..., SWP_NOMOVE | SWP_NOSIZE)` 控制 `HWND_TOPMOST` / `HWND_NOTOPMOST` Z-Order 切換，並以 `PrintWindow` 像素取樣斷言第二螢幕畫面絕非空白。
2. **【重大】背景預覽視窗 (`PVW`) 在動畫播畢後呼叫 `View.Next()` 無法跨頁**：
   - **原因**：當焦點在瀏覽器主控台或 `PGM` 視窗在前景時，背景的 `PVW` `SlideShowWindow` 呼叫 `View.Next()` 雖可推進頁內動畫（`ClickIndex 0 -> 1`），但在 `ClickIndex == ClickCount` 時 PowerPoint COM 會忽略非焦點視窗的跨頁指令。
   - **解法**：在 `scripts/ppt-com-worker.ps1` 的 `STEP_SLOT` 中，先讀取 `$oldClick` 與 `$maxClick`；當 `$oldClick -lt $maxClick` 時呼叫 `$ssw.View.Next()` 觸發頁內動畫，當 `$oldClick -ge $maxClick` 時直接呼叫 `$ssw.View.GotoSlide($oldPos + 1)` 強制跨頁，使前景與背景視窗 100% 穩定翻頁。
3. **【重大】`/stage` 第二螢幕影片池播放遭 Chrome Autoplay 政策阻斷與 Profile 合併**：
   - **原因**：電腦已開啟 Chrome 時，`spawn` 新視窗若未帶獨立 `--user-data-dir`，會併入既有 Chrome 進程並忽略 `--autoplay-policy=no-user-gesture-required`；且 `stage.html` 原 `.catch()` 未靜音重試 `play()`。
   - **解法**：`server.mjs` 為 `/stage` 與主控台配置獨立 `--user-data-dir`，並在 `stage.html` 實裝雙軌自動降級重試（有聲遭拒立即切換靜音起播）。
4. **雙槽位防撞保護（`LOAD_PGM` / `LOAD_PVW`）**：
   - 點選對面槽位正在使用的簡報時，自動將原簡報退入對面槽位，確保 `PGM` 與 `PVW` 永遠維持 2 份獨立簡報待命。
5. **範例簡報首頁標題可見性修正**：
   - 移除 `01_主講簡報_廣海明月導論.pptx` 首頁標題之點擊動畫（僅保留內文條列點擊動畫），確保剛開頁（`動畫 0 / 1`）即有清晰大標題。
