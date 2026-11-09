# PPT Stage Deck - 開發與踩坑日誌 (DEVLOG)

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
