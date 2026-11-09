# PPT Stage Deck - 開發與踩坑日誌 (DEVLOG)

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
