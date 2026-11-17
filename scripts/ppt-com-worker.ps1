# ============================================================================
# PowerPoint COM Persistent Dual-Deck Worker (100% 7-Bit ASCII Safe)
# Uses ShowType=1 (screenClass native fullscreen) + Per-Monitor DPI V2 (-4)
# + Real-time PrintWindow Live Frame Preview + WindowFromPoint Z-Order Truth
# ============================================================================
$ErrorActionPreference = "Continue"

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class PptWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT pt);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

    public static void RestoreFocus(IntPtr targetHwnd) {
        if (targetHwnd == IntPtr.Zero) return;
        IntPtr fg = GetForegroundWindow();
        if (fg == targetHwnd) return;
        uint dummy;
        uint fgTid = GetWindowThreadProcessId(fg, out dummy);
        uint curTid = GetCurrentThreadId();
        if (fgTid != 0 && fgTid != curTid) {
            AttachThreadInput(curTid, fgTid, true);
            SetForegroundWindow(targetHwnd);
            AttachThreadInput(curTid, fgTid, false);
        } else {
            SetForegroundWindow(targetHwnd);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    // Native (C#) slideshow window finder: avoids PowerShell scriptblock delegate callbacks
    public static IntPtr FindSlideShow(string baseName) {
        IntPtr exact = IntPtr.Zero;
        IntPtr anyScreen = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            StringBuilder cb = new StringBuilder(64);
            GetClassName(h, cb, 64);
            if (cb.ToString() == "screenClass") {
                if (anyScreen == IntPtr.Zero) anyScreen = h;
                StringBuilder tb = new StringBuilder(512);
                GetWindowText(h, tb, 512);
                string title = tb.ToString();
                if (!String.IsNullOrEmpty(baseName) && title.IndexOf(baseName, StringComparison.OrdinalIgnoreCase) >= 0) {
                    exact = h;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);
        return (exact != IntPtr.Zero) ? exact : anyScreen;
    }

    public static void HideAllSlideShows() {
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            StringBuilder cb = new StringBuilder(64);
            GetClassName(h, cb, 64);
            if (cb.ToString() == "screenClass") {
                SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                SetWindowPos(h, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                ShowWindow(h, 0);
            }
            return true;
        }, IntPtr.Zero);
    }

    public static void WakeStageDisplay() {
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            StringBuilder tb = new StringBuilder(512);
            GetWindowText(h, tb, 512);
            string title = tb.ToString();
            if (title.IndexOf("Stage Display", StringComparison.OrdinalIgnoreCase) >= 0 ||
                title.IndexOf("第二螢幕零雜訊放映艙", StringComparison.OrdinalIgnoreCase) >= 0) {
                ShowWindow(h, 8);
                SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE);
                SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE);
            }
            return true;
        }, IntPtr.Zero);
    }

    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
}
"@

# Enable Per-Monitor DPI Awareness V2 (-4) before loading System.Windows.Forms
try {
    [PptWin32]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
    if (-not [PptWin32]::SetProcessDpiAwarenessContext([IntPtr](-4))) {
        [PptWin32]::SetProcessDPIAware() | Out-Null
    }
}
catch {
    [PptWin32]::SetProcessDPIAware() | Out-Null
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:globalPreviewsDir = ""

function Get-TargetScreen {
    $screens = [System.Windows.Forms.Screen]::AllScreens

    # 1. Explicit display name via environment variable
    if (-not [string]::IsNullOrEmpty($env:TARGET_DISPLAY)) {
        $cleanTarget = $env:TARGET_DISPLAY.Trim()
        $matched = $screens | Where-Object {
            $_.DeviceName -eq $cleanTarget -or
            $_.DeviceName.EndsWith($cleanTarget) -or
            ($_.DeviceName -replace '[^0-9]', '') -eq ($cleanTarget -replace '[^0-9]', '')
        } | Select-Object -First 1
        if ($null -ne $matched) { return $matched }
    }

    # 2. Filter non-primary screens and pick highest resolution/area (broadcast 16:9 priority)
    $secList = @($screens | Where-Object { -not $_.Primary })
    if ($secList.Count -gt 0) {
        $best = $secList | Sort-Object -Descending { ($_.Bounds.Width * $_.Bounds.Height) } | Select-Object -First 1
        if ($null -ne $best) { return $best }
    }

    # 3. Fallback to primary screen
    $pri = $screens | Where-Object { $_.Primary } | Select-Object -First 1
    if ($null -ne $pri) { return $pri }
    return $screens[0]
}

function Get-TopWindowInfoAtTargetScreenCenter {
    $scr = Get-TargetScreen
    $b = $scr.Bounds
    $pt = New-Object PptWin32+POINT
    $pt.X = $b.X + [int]($b.Width / 2)
    $pt.Y = $b.Y + [int]($b.Height / 2)
    $h = [PptWin32]::WindowFromPoint($pt)
    if ($h -eq [IntPtr]::Zero) {
        return @{ hwnd = 0; className = ""; title = "" }
    }
    $root = [PptWin32]::GetAncestor($h, 2)
    if ($root -eq [IntPtr]::Zero) { $root = $h }
    $sb = New-Object System.Text.StringBuilder 256
    [PptWin32]::GetClassName($root, $sb, 256) | Out-Null
    $tb = New-Object System.Text.StringBuilder 512
    [PptWin32]::GetWindowText($root, $tb, 512) | Out-Null
    $rc = New-Object PptWin32+RECT
    [PptWin32]::GetWindowRect($root, [ref]$rc) | Out-Null
    return @{
        hwnd      = $root.ToInt64()
        className = $sb.ToString()
        title     = $tb.ToString()
        rect      = "$($rc.Left),$($rc.Top) $($rc.Right - $rc.Left)x$($rc.Bottom - $rc.Top)"
        probePt   = "$($pt.X),$($pt.Y)"
    }
}

function Find-SlideShowHwnd([string]$baseName) {
    try {
        return [PptWin32]::FindSlideShow($baseName)
    }
    catch {
        return [IntPtr]::Zero
    }
}

function Place-SlideShowOnTargetScreen($entry, [bool]$bringToFront) {
    if ($null -eq $entry -or $entry.hwnd -eq [IntPtr]::Zero) { return }
    $hwnd = $entry.hwnd
    $scr = Get-TargetScreen
    $b = $scr.Bounds
    $rc = New-Object PptWin32+RECT
    [PptWin32]::GetWindowRect($hwnd, [ref]$rc) | Out-Null

    $needsMove = ($rc.Left -ne $b.X) -or ($rc.Top -ne $b.Y) -or (($rc.Right - $rc.Left) -ne $b.Width) -or (($rc.Bottom - $rc.Top) -ne $b.Height)
    if ($bringToFront) {
        [PptWin32]::ShowWindow($hwnd, 5) | Out-Null
        if ($needsMove) {
            [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_NOTOPMOST, $b.X, $b.Y, $b.Width, $b.Height, [PptWin32]::SWP_SHOWWINDOW) | Out-Null
            [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_TOPMOST, $b.X, $b.Y, $b.Width, $b.Height, [PptWin32]::SWP_SHOWWINDOW) | Out-Null
        }
        else {
            [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_NOTOPMOST, 0, 0, 0, 0, ([PptWin32]::SWP_NOMOVE -bor [PptWin32]::SWP_NOSIZE -bor [PptWin32]::SWP_SHOWWINDOW)) | Out-Null
            [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_TOPMOST, 0, 0, 0, 0, ([PptWin32]::SWP_NOMOVE -bor [PptWin32]::SWP_NOSIZE -bor [PptWin32]::SWP_SHOWWINDOW)) | Out-Null
        }
        try { $entry.ssw.Activate() } catch {}
    }
    else {
        [PptWin32]::ShowWindow($hwnd, 8) | Out-Null
        if ($needsMove) {
            [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_NOTOPMOST, $b.X, $b.Y, $b.Width, $b.Height, [PptWin32]::SWP_NOACTIVATE) | Out-Null
        }
        else {
            [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_NOTOPMOST, 0, 0, 0, 0, ([PptWin32]::SWP_NOMOVE -bor [PptWin32]::SWP_NOSIZE -bor [PptWin32]::SWP_NOACTIVATE)) | Out-Null
        }
        [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_BOTTOM, 0, 0, 0, 0, ([PptWin32]::SWP_NOMOVE -bor [PptWin32]::SWP_NOSIZE -bor [PptWin32]::SWP_NOACTIVATE)) | Out-Null
    }
}

function Capture-WindowLivePng([IntPtr]$hwnd, [string]$outPath) {
    if ($hwnd -eq [IntPtr]::Zero -or [string]::IsNullOrEmpty($outPath)) {
        return @{ ok = $false; nonBlankSamples = 0; width = 0; height = 0 }
    }
    $rc = New-Object PptWin32+RECT
    [PptWin32]::GetWindowRect($hwnd, [ref]$rc) | Out-Null
    $w = [Math]::Max(100, ($rc.Right - $rc.Left))
    $ht = [Math]::Max(100, ($rc.Bottom - $rc.Top))
    $bmp = New-Object System.Drawing.Bitmap($w, $ht)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    [PptWin32]::PrintWindow($hwnd, $hdc, 2) | Out-Null
    $g.ReleaseHdc($hdc)

    $nonBlankSamples = 0
    $bgPx = $bmp.GetPixel([int]($w * 0.08), [int]($ht * 0.5))
    for ($sx = [int]($w * 0.15); $sx -lt [int]($w * 0.85); $sx += 8) {
        for ($sy = [int]($ht * 0.2); $sy -lt [int]($ht * 0.8); $sy += 8) {
            $px = $bmp.GetPixel($sx, $sy)
            if ($px.R -lt 200 -and $px.R -gt 0) {
                $nonBlankSamples++
            }
            elseif ($px.R -eq 0 -and $px.G -eq 0 -and $px.B -eq 0 -and $bgPx.R -gt 240) {
                $nonBlankSamples++
            }
            elseif ($bgPx.R -eq 0 -and $bgPx.G -eq 0 -and $bgPx.B -eq 0 -and ($px.R -gt 15 -or $px.G -gt 15 -or $px.B -gt 15)) {
                $nonBlankSamples++
            }
        }
    }

    $isValidCapture = ($nonBlankSamples -gt 0) -or ($bgPx.R -gt 10 -or $bgPx.G -gt 10 -or $bgPx.B -gt 10)
    if ($isValidCapture) {
        $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $g.Dispose()
    $bmp.Dispose()
    return @{ ok = $isValidCapture; nonBlankSamples = $nonBlankSamples; width = $w; height = $ht }
}

$pptApp = $null
$openDecks = @{}
$slots = @{
    pgm = $null
    pvw = $null
}
$stageMode = "ppt"
$script:lastControllerHwnd = [IntPtr]::Zero

function Save-ControllerFocus {
    $fg = [PptWin32]::GetForegroundWindow()
    if ($fg -eq [IntPtr]::Zero) { return }
    $cb = New-Object System.Text.StringBuilder 128
    [PptWin32]::GetClassName($fg, $cb, $cb.Capacity) | Out-Null
    $cls = $cb.ToString()
    if ($cls -ne "screenClass" -and $cls -ne "PPTFrameClass" -and $cls -ne "paneClassDC") {
        $script:lastControllerHwnd = $fg
    }
}

function Restore-ControllerFocus {
    if ($script:lastControllerHwnd -ne [IntPtr]::Zero) {
        [PptWin32]::RestoreFocus($script:lastControllerHwnd)
    }
    if ($script:stageMode -eq "ppt" -and $script:slots.pgm -and $script:openDecks.ContainsKey($script:slots.pgm)) {
        $pgmHwnd = $script:openDecks[$script:slots.pgm].hwnd
        if ($pgmHwnd -ne [IntPtr]::Zero) {
            [PptWin32]::SetWindowPos($pgmHwnd, [PptWin32]::HWND_TOPMOST, 0, 0, 0, 0, ([PptWin32]::SWP_NOMOVE -bor [PptWin32]::SWP_NOSIZE -bor [PptWin32]::SWP_SHOWWINDOW -bor [PptWin32]::SWP_NOACTIVATE)) | Out-Null
        }
    }
}

function Ensure-PptApp {
    if ($null -eq $script:pptApp) {
        $script:pptApp = New-Object -ComObject PowerPoint.Application
    }
    return $script:pptApp
}

function Ensure-DeckLoaded([string]$deckId, [string]$filePath, [string]$previewsDir) {
    $script:globalPreviewsDir = $previewsDir
    $app = Ensure-PptApp
    if ($script:openDecks.ContainsKey($deckId)) {
        $entry = $script:openDecks[$deckId]
        try {
            $null = $entry.pres.Slides.Count
            return $entry
        }
        catch {
            $script:openDecks.Remove($deckId)
        }
    }

    $pres = $app.Presentations.Open($filePath, -1, 0, 0)
    $count = $pres.Slides.Count
    $clicks = @()
    $deckPrevDir = Join-Path $previewsDir $deckId
    if (-not (Test-Path $deckPrevDir)) {
        New-Item -ItemType Directory -Force -Path $deckPrevDir | Out-Null
    }

    $clicksMetaPath = Join-Path $deckPrevDir "_meta.json"
    $loadedFromCache = $false
    if (Test-Path $clicksMetaPath) {
        try {
            $cachedMeta = Get-Content -Path $clicksMetaPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $pngFiles = @(Get-ChildItem -Path $deckPrevDir -Filter "slide-*.png" -ErrorAction SilentlyContinue)
            if ($cachedMeta.slideCount -eq $count -and $pngFiles.Count -ge $count) {
                $clicks = @($cachedMeta.slideClicks)
                $loadedFromCache = $true
            }
        } catch {}
    }

    if (-not $loadedFromCache) {
        for ($i = 1; $i -le $count; $i++) {
            $sl = $pres.Slides.Item($i)
            $cCount = 0
            try {
                $ms = $sl.TimeLine.MainSequence
                if ($null -ne $ms -and $ms.Count -gt 0) {
                    $clickTriggers = 0
                    for ($k = 1; $k -le $ms.Count; $k++) {
                        $trig = try { $ms.Item($k).Timing.TriggerType } catch { 1 }
                        if ($trig -eq 1) { $clickTriggers++ }
                    }
                    $cCount = if ($clickTriggers -gt 0) { $clickTriggers } else { $ms.Count }
                }
            } catch {}
            $clicks += $cCount
            $pngPath = Join-Path $deckPrevDir ("slide-" + $i + ".png")
            if (-not (Test-Path $pngPath)) {
                try { $sl.Export($pngPath, "PNG", 1280, 720) } catch {}
            }
        }
        try {
            @{ slideCount = $count; slideClicks = $clicks } | ConvertTo-Json -Compress | Set-Content -Path $clicksMetaPath -Encoding UTF8
        } catch {}
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($filePath)
    $entry = @{
        deckId      = $deckId
        filePath    = $filePath
        baseName    = $baseName
        pres        = $pres
        ssw         = $null
        hwnd        = [IntPtr]::Zero
        slideCount  = $count
        slideClicks = $clicks
    }
    $script:openDecks[$deckId] = $entry
    return $entry
}

function Ensure-SlideShowWindow($entry, [bool]$isBackground = $false) {
    if ($null -ne $entry.ssw) {
        try {
            $null = $entry.ssw.View.CurrentShowPosition
            if ($entry.hwnd -eq [IntPtr]::Zero) {
                $entry.hwnd = Find-SlideShowHwnd $entry.baseName
            }
            return $entry.ssw
        }
        catch {
            $entry.ssw = $null
            $entry.hwnd = [IntPtr]::Zero
        }
    }
    if ($isBackground -and $script:stageMode -ne "ppt") {
        return $null
    }
    Save-ControllerFocus
    $pres = $entry.pres
    $pres.SlideShowSettings.ShowPresenterView = 0
    $pres.SlideShowSettings.ShowType = 1
    $ssw = $pres.SlideShowSettings.Run()
    for ($retry = 0; $retry -lt 12; $retry++) {
        Start-Sleep -Milliseconds 80
        $hwnd = Find-SlideShowHwnd $entry.baseName
        if ($hwnd -ne [IntPtr]::Zero) { break }
    }
    $entry.ssw = $ssw
    $entry.hwnd = $hwnd
    return $ssw
}

function Sync-WindowZOrder {
    $pgmId = $script:slots.pgm
    $pvwId = $script:slots.pvw

    if ($script:stageMode -ne "ppt" -and $script:stageMode -ne "black") {
        foreach ($k in $script:openDecks.Keys) {
            $h = $script:openDecks[$k].hwnd
            if ($h -ne [IntPtr]::Zero) {
                [PptWin32]::SetWindowPos($h, [PptWin32]::HWND_NOTOPMOST, 0, 0, 0, 0, ([PptWin32]::SWP_NOMOVE -bor [PptWin32]::SWP_NOSIZE -bor [PptWin32]::SWP_NOACTIVATE)) | Out-Null
                [PptWin32]::SetWindowPos($h, [PptWin32]::HWND_BOTTOM, 0, 0, 0, 0, ([PptWin32]::SWP_NOMOVE -bor [PptWin32]::SWP_NOSIZE -bor [PptWin32]::SWP_NOACTIVATE)) | Out-Null
                [PptWin32]::ShowWindow($h, 0) | Out-Null
            }
        }
        [PptWin32]::HideAllSlideShows()
        [PptWin32]::WakeStageDisplay()
        return
    }

    if ($null -ne $pvwId -and $pvwId -ne $pgmId -and $script:openDecks.ContainsKey($pvwId)) {
        $pvwEntry = $script:openDecks[$pvwId]
        Ensure-SlideShowWindow $pvwEntry | Out-Null
        Place-SlideShowOnTargetScreen $pvwEntry $false
    }

    if ($null -ne $pgmId -and $script:openDecks.ContainsKey($pgmId)) {
        $pgmEntry = $script:openDecks[$pgmId]
        Ensure-SlideShowWindow $pgmEntry | Out-Null
        Place-SlideShowOnTargetScreen $pgmEntry $true
    }
}

function Get-SlotRuntime($deckId, [string]$slotTag = "pgm") {
    if ($null -eq $deckId -or -not $script:openDecks.ContainsKey($deckId)) {
        return $null
    }
    $entry = $script:openDecks[$deckId]
    if ($script:stageMode -ne "ppt" -and $script:stageMode -ne "black" -and $null -eq $entry.ssw) {
        return @{
            deckId         = $deckId
            hwnd           = 0
            topCenterHwnd  = 0
            topCenterClass = ""
            topCenterTitle = ""
            visible        = $false
            rect           = @{ x = 0; y = 0; width = 0; height = 0 }
            currentSlide   = 1
            totalSlides    = $entry.slideCount
            clickIndex     = 0
            clickCount     = if ($entry.slideClicks -and $entry.slideClicks.Count -gt 0) { [int]$entry.slideClicks[0] } else { 0 }
            livePreviewUrl = $null
        }
    }
    $ssw = Ensure-SlideShowWindow $entry
    $pos = 1
    $clickIdx = 0
    $clickCnt = 0
    try { $pos = [int]$ssw.View.CurrentShowPosition } catch {}
    try { $clickIdx = [int]$ssw.View.GetClickIndex() } catch {}
    try { $clickCnt = [int]$ssw.View.GetClickCount() } catch {}
    $rc = New-Object PptWin32+RECT
    $vis = $false
    $liveUrl = $null
    if ($entry.hwnd -ne [IntPtr]::Zero) {
        [PptWin32]::GetWindowRect($entry.hwnd, [ref]$rc) | Out-Null
        $vis = [PptWin32]::IsWindowVisible($entry.hwnd)
        if ($vis -and (-not [string]::IsNullOrEmpty($script:globalPreviewsDir))) {
            $liveFile = "_live_" + $slotTag + ".png"
            $livePath = Join-Path $script:globalPreviewsDir $liveFile
            $capRes = Capture-WindowLivePng $entry.hwnd $livePath
            if ($capRes.ok) {
                $ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
                $liveUrl = "/previews/" + $liveFile + "?t=" + $ts
            }
        }
    }
    $topInfo = Get-TopWindowInfoAtTargetScreenCenter
    return @{
        deckId         = $deckId
        hwnd           = $entry.hwnd.ToInt64()
        topCenterHwnd  = $topInfo.hwnd
        topCenterClass = $topInfo.className
        topCenterTitle = $topInfo.title
        visible        = $vis
        rect           = @{
            x      = $rc.Left
            y      = $rc.Top
            width  = ($rc.Right - $rc.Left)
            height = ($rc.Bottom - $rc.Top)
        }
        currentSlide   = $pos
        totalSlides    = $entry.slideCount
        clickIndex     = $clickIdx
        clickCount     = $clickCnt
        livePreviewUrl = $liveUrl
    }
}

function Send-Response($obj) {
    $json = $obj | ConvertTo-Json -Depth 8 -Compress
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
    [Console]::Out.WriteLine("PPT_RES:" + $b64)
    [Console]::Out.Flush()
}

$scrInfo = Get-TargetScreen
Send-Response @{
    type   = "READY"
    screen = @{
        deviceName = $scrInfo.DeviceName
        primary    = $scrInfo.Primary
        x          = $scrInfo.Bounds.X
        y          = $scrInfo.Bounds.Y
        width      = $scrInfo.Bounds.Width
        height     = $scrInfo.Bounds.Height
    }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
    $line = $line.Trim()
    if ($line -eq "") { continue }
    try {
        $rawJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))
        $req = $rawJson | ConvertFrom-Json
        $reqId = $req.id
        $cmd = $req.cmd
        $p = $req.payload

        switch ($cmd) {
            "SCAN_AND_EXPORT" {
                $slidesDir = $p.slidesDir
                $previewsDir = $p.previewsDir
                $script:globalPreviewsDir = $previewsDir
                $meta = @{}
                $files = Get-ChildItem -Path $slidesDir -File | Where-Object { $_.Extension -match "^\.(pptx|ppt|ppsx|pptm|ppsm)$" -and -not $_.Name.StartsWith("~$") }
                foreach ($f in $files) {
                    $dId = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
                    try {
                        $entry = Ensure-DeckLoaded $dId $f.FullName $previewsDir
                        if ($null -ne $entry) {
                            $meta[$dId] = @{
                                deckId      = $dId
                                fileName    = $f.Name
                                slideCount  = $entry.slideCount
                                slideClicks = $entry.slideClicks
                            }
                        }
                    }
                    catch {
                        # Defensive: don't fail entire scan on single heavy file error
                        $meta[$dId] = @{
                            deckId      = $dId
                            fileName    = $f.Name
                            slideCount  = 3
                            slideClicks = @(0, 0, 0)
                        }
                    }
                }
                Send-Response @{ id = $reqId; ok = $true; metadata = $meta }
            }
            "SET_SLOTS" {
                Save-ControllerFocus
                if ($null -ne $p -and $p.PSObject.Properties.Match('pgmDeckId').Count -gt 0) {
                    $script:slots.pgm = if ([string]::IsNullOrEmpty($p.pgmDeckId)) { $null } else { $p.pgmDeckId }
                }
                if ($null -ne $p -and $p.PSObject.Properties.Match('pvwDeckId').Count -gt 0) {
                    $script:slots.pvw = if ([string]::IsNullOrEmpty($p.pvwDeckId)) { $null } else { $p.pvwDeckId }
                }
                if ($p.stageMode) { $script:stageMode = $p.stageMode }
                Sync-WindowZOrder
                Start-Sleep -Milliseconds 150
                $pgmRt = (Get-SlotRuntime $script:slots.pgm "pgm")
                $pvwRt = (Get-SlotRuntime $script:slots.pvw "pvw")
                if ($script:stageMode -ne "ppt" -and $script:stageMode -ne "black") {
                    Sync-WindowZOrder
                }
                Restore-ControllerFocus
                Send-Response @{
                    id  = $reqId
                    ok  = $true
                    pgm = $pgmRt
                    pvw = $pvwRt
                }
            }
            "STEP_SLOT" {
                Save-ControllerFocus
                $slotName = if ($p.slot -eq "pvw") { "pvw" } else { "pgm" }
                if ($p.deckId) { $script:slots[$slotName] = $p.deckId }
                $dId = $script:slots[$slotName]
                if ($null -ne $dId -and $script:openDecks.ContainsKey($dId)) {
                    $entry = $script:openDecks[$dId]
                    $ssw = Ensure-SlideShowWindow $entry
                    if ($slotName -eq "pgm") {
                        $script:stageMode = "ppt"
                    }
                    Sync-WindowZOrder
                    $oldPos = 1
                    $oldClick = 0
                    $maxClick = 0
                    try { $oldPos = [int]$ssw.View.CurrentShowPosition } catch {}
                    try { $oldClick = [int]$ssw.View.GetClickIndex() } catch {}
                    try { $maxClick = [int]$ssw.View.GetClickCount() } catch {}

                    $dir = $p.direction
                    if ($dir -eq "next") {
                        if ($oldClick -lt $maxClick) {
                            $ssw.View.Next()
                        } elseif ($oldPos -lt $entry.slideCount) {
                            try {
                                $ssw.View.GotoSlide($oldPos + 1, -1)
                            } catch {
                                $ssw.View.GotoSlide($oldPos + 1)
                            }
                        }
                    } elseif ($dir -eq "prev") {
                        if ($oldClick -gt 0) {
                            $ssw.View.Previous()
                        } elseif ($oldPos -gt 1) {
                            try {
                                $ssw.View.GotoSlide($oldPos - 1, -1)
                            } catch {
                                $ssw.View.GotoSlide($oldPos - 1)
                            }
                        }
                    } elseif ($dir -eq "goto" -and $p.slide) {
                        try {
                            $ssw.View.GotoSlide([int]$p.slide, -1)
                        } catch {
                            $ssw.View.GotoSlide([int]$p.slide)
                        }
                    }

                    Start-Sleep -Milliseconds 260
                }
                $rt = (Get-SlotRuntime $dId $slotName)
                Restore-ControllerFocus
                Send-Response @{
                    id      = $reqId
                    ok      = $true
                    slot    = $slotName
                    runtime = $rt
                }
            }
            "CUT_SWAP" {
                Save-ControllerFocus
                $oldPgm = $script:slots.pgm
                $oldPvw = $script:slots.pvw
                $script:slots.pgm = $oldPvw
                $script:slots.pvw = $oldPgm
                $script:stageMode = "ppt"
                Sync-WindowZOrder
                Start-Sleep -Milliseconds 150
                $pgmRt = (Get-SlotRuntime $script:slots.pgm "pgm")
                $pvwRt = (Get-SlotRuntime $script:slots.pvw "pvw")
                Restore-ControllerFocus
                Send-Response @{
                    id  = $reqId
                    ok  = $true
                    pgm = $pgmRt
                    pvw = $pvwRt
                }
            }
            "SET_STAGE_MODE" {
                $script:stageMode = $p.mode
                if ($p.mode -eq "black" -and $script:slots.pgm -and $script:openDecks.ContainsKey($script:slots.pgm)) {
                    try { $script:openDecks[$script:slots.pgm].ssw.View.State = 3 } catch {}
                }
                elseif ($p.mode -eq "ppt" -and $script:slots.pgm -and $script:openDecks.ContainsKey($script:slots.pgm)) {
                    try { $script:openDecks[$script:slots.pgm].ssw.View.State = 1 } catch {}
                }
                Sync-WindowZOrder
                Send-Response @{ id = $reqId; ok = $true; mode = $script:stageMode }
            }
            "CAPTURE_STAGE" {
                $outPath = $p.outputPath
                $pgmId = $script:slots.pgm
                $capRes = @{ ok = $false; nonBlankSamples = 0; width = 0; height = 0 }
                if ($null -ne $pgmId -and $script:openDecks.ContainsKey($pgmId) -and $script:openDecks[$pgmId].hwnd -ne [IntPtr]::Zero) {
                    $capRes = Capture-WindowLivePng $script:openDecks[$pgmId].hwnd $outPath
                }
                $topInfo = Get-TopWindowInfoAtTargetScreenCenter
                Send-Response @{
                    id              = $reqId
                    ok              = $capRes.ok
                    outputPath      = $outPath
                    width           = $capRes.width
                    height          = $capRes.height
                    nonBlankSamples = $capRes.nonBlankSamples
                    topCenterHwnd   = $topInfo.hwnd
                    topCenterClass  = $topInfo.className
                    topCenterTitle  = $topInfo.title
                    topCenterRect   = $topInfo.rect
                    probePt         = $topInfo.probePt
                }
            }
            "GET_SLIDE_TEXT" {
                $dId = $p.deckId
                $sNum = if ($p.slide) { [int]$p.slide } else { 1 }
                $items = @()
                if ($null -ne $dId -and $script:openDecks.ContainsKey($dId)) {
                    $entry = $script:openDecks[$dId]
                    if ($sNum -ge 1 -and $sNum -le $entry.slideCount) {
                        $sl = $entry.pres.Slides.Item($sNum)
                        for ($si = 1; $si -le $sl.Shapes.Count; $si++) {
                            try {
                                $sh = $sl.Shapes.Item($si)
                                if ($sh.HasTextFrame -eq -1 -and $sh.TextFrame.HasText -eq -1) {
                                    $txt = $sh.TextFrame.TextRange.Text
                                    $items += @{ shapeIndex = $si; text = $txt }
                                }
                            } catch {}
                        }
                    }
                }
                Send-Response @{ id = $reqId; ok = $true; deckId = $dId; slide = $sNum; items = $items }
            }
            "SET_SLIDE_TEXT" {
                $dId = $p.deckId
                $sNum = if ($p.slide) { [int]$p.slide } else { 1 }
                $shIdx = if ($p.shapeIndex) { [int]$p.shapeIndex } else { 1 }
                $newText = [string]$p.text
                $previewsDir = if ($p.previewsDir) { $p.previewsDir } else { $script:globalPreviewsDir }
                $updated = $false
                if ($null -ne $dId -and $script:openDecks.ContainsKey($dId)) {
                    $entry = $script:openDecks[$dId]
                    if ($sNum -ge 1 -and $sNum -le $entry.slideCount) {
                        $sl = $entry.pres.Slides.Item($sNum)
                        $targetShape = $null
                        if ($shIdx -ge 1 -and $shIdx -le $sl.Shapes.Count) {
                            try {
                                $cand = $sl.Shapes.Item($shIdx)
                                if ($cand.HasTextFrame -eq -1) { $targetShape = $cand }
                            } catch {}
                        }
                        if ($null -eq $targetShape) {
                            for ($si = 1; $si -le $sl.Shapes.Count; $si++) {
                                try {
                                    $cand = $sl.Shapes.Item($si)
                                    if ($cand.HasTextFrame -eq -1) { $targetShape = $cand; break }
                                } catch {}
                            }
                        }
                        if ($null -ne $targetShape) {
                            $targetShape.TextFrame.TextRange.Text = $newText
                            try { $entry.pres.Save() } catch {}
                            if (-not [string]::IsNullOrEmpty($previewsDir)) {
                                $deckPrevDir = Join-Path $previewsDir $dId
                                if (-not (Test-Path $deckPrevDir)) { New-Item -ItemType Directory -Force -Path $deckPrevDir | Out-Null }
                                $pngPath = Join-Path $deckPrevDir ("slide-" + $sNum + ".png")
                                try { $sl.Export($pngPath, "PNG", 1280, 720) } catch {}
                            }
                            # 若該簡報正在 SlideShowWindow 放映中，即刻刷新當前頁面，讓現場大螢幕畫面秒更新！
                            if ($null -ne $entry.ssw) {
                                try {
                                    $curPos = $entry.ssw.View.CurrentShowPosition
                                    if ($curPos -eq $sNum) {
                                        $entry.ssw.View.GotoSlide($sNum)
                                    }
                                } catch {}
                            }
                            $updated = $true
                        }
                    }
                }
                Send-Response @{ id = $reqId; ok = $updated; deckId = $dId; slide = $sNum }
            }
            "OPEN_NATIVE_EDIT" {
                $dId = $p.deckId
                $filePath = $p.filePath
                $sNum = if ($p.slide) { [int]$p.slide } else { 1 }
                $app = Ensure-PptApp
                try { $app.Visible = -1 } catch {}
                if ($null -ne $dId -and $script:openDecks.ContainsKey($dId)) {
                    $entry = $script:openDecks[$dId]
                    try {
                        if ($entry.pres.Windows.Count -eq 0) {
                            $entry.pres.NewWindow() | Out-Null
                        }
                        $win = $entry.pres.Windows.Item(1)
                        $win.Activate()
                        if ($sNum -ge 1 -and $sNum -le $entry.slideCount) {
                            $win.View.GotoSlide($sNum)
                        }
                    } catch {}
                } elseif (-not [string]::IsNullOrEmpty($filePath) -and (Test-Path $filePath)) {
                    try { $app.Presentations.Open($filePath, 0, 0, -1) | Out-Null } catch {}
                }
                Send-Response @{ id = $reqId; ok = $true; deckId = $dId; slide = $sNum }
            }
            "RELOAD_DECK" {
                $dId = $p.deckId
                $filePath = $p.filePath
                $previewsDir = if ($p.previewsDir) { $p.previewsDir } else { $script:globalPreviewsDir }
                if ($null -ne $dId -and $script:openDecks.ContainsKey($dId)) {
                    $oldE = $script:openDecks[$dId]
                    try { if ($null -ne $oldE.ssw) { $oldE.ssw.View.Exit() } } catch {}
                    try { if ($null -ne $oldE.pres) { $oldE.pres.Save(); $oldE.pres.Close() } } catch {}
                    $script:openDecks.Remove($dId)
                }
                if (-not [string]::IsNullOrEmpty($previewsDir) -and -not [string]::IsNullOrEmpty($dId)) {
                    $deckPrevDir = Join-Path $previewsDir $dId
                    if (Test-Path $deckPrevDir) {
                        Remove-Item -Path (Join-Path $deckPrevDir "*") -Force -ErrorAction SilentlyContinue
                    }
                }
                $metaInfo = $null
                if (-not [string]::IsNullOrEmpty($filePath) -and (Test-Path $filePath)) {
                    $entry = Ensure-DeckLoaded $dId $filePath $previewsDir
                    if ($null -ne $entry) {
                        $metaInfo = @{
                            deckId      = $dId
                            fileName    = [System.IO.Path]::GetFileName($filePath)
                            slideCount  = $entry.slideCount
                            slideClicks = $entry.slideClicks
                        }
                    }
                }
                Sync-WindowZOrder
                Send-Response @{ id = $reqId; ok = ($null -ne $metaInfo); deckId = $dId; meta = $metaInfo }
            }
            "SHUTDOWN" {
                foreach ($k in $script:openDecks.Keys) {
                    $e = $script:openDecks[$k]
                    try { if ($null -ne $e.ssw) { $e.ssw.View.Exit() } } catch {}
                    # 長官指令：退出時將簡報放映設定恢復為使用簡報者模式 (msoTrue = -1)
                    try {
                        if ($null -ne $e.pres) {
                            $e.pres.SlideShowSettings.ShowPresenterView = -1
                            $e.pres.Saved = -1
                            $e.pres.Close()
                        }
                    } catch {}
                }
                # 長官指令：全域註冊表恢復，將 Office 各版本之「使用簡報者檢視畫面 (UseMonMgr)」寫回 1 (啟用)
                try {
                    Get-ChildItem "HKCU:\Software\Microsoft\Office" -ErrorAction SilentlyContinue | ForEach-Object {
                        $optPath = Join-Path $_.PSPath "PowerPoint\Options"
                        if (Test-Path $optPath) {
                            Set-ItemProperty -Path $optPath -Name "UseMonMgr" -Value 1 -Type DWord -ErrorAction SilentlyContinue
                            Set-ItemProperty -Path $optPath -Name "ShowPresenterView" -Value 1 -Type DWord -ErrorAction SilentlyContinue
                        }
                    }
                } catch {}
                try {
                    if ($null -ne $script:pptApp -and $script:pptApp.Presentations.Count -eq 0) {
                        $script:pptApp.Quit()
                    }
                } catch {}
                Send-Response @{ id = $reqId; ok = $true }
                break
            }
            default {
                Send-Response @{ id = $reqId; ok = $false; error = "Unknown cmd: $cmd" }
            }
        }
    }
    catch {
        Send-Response @{ id = $reqId; ok = $false; error = $_.Exception.Message }
    }
}
