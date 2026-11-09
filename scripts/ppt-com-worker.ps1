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
} catch {
    [PptWin32]::SetProcessDPIAware() | Out-Null
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:globalPreviewsDir = ""

function Get-TargetScreen {
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $sec = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
    if ($null -ne $sec) { return $sec }
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
        hwnd = $root.ToInt64()
        className = $sb.ToString()
        title = $tb.ToString()
        rect = "$($rc.Left),$($rc.Top) $($rc.Right - $rc.Left)x$($rc.Bottom - $rc.Top)"
        probePt = "$($pt.X),$($pt.Y)"
    }
}

function Find-SlideShowHwnd([string]$baseName) {
    $script:foundHwnd = [IntPtr]::Zero
    [PptWin32]::EnumWindows({
        param($hWnd, $lParam)
        $sb = New-Object System.Text.StringBuilder 256
        [PptWin32]::GetClassName($hWnd, $sb, 256) | Out-Null
        $cls = $sb.ToString()
        if ($cls -eq "screenClass") {
            $tb = New-Object System.Text.StringBuilder 512
            [PptWin32]::GetWindowText($hWnd, $tb, 512) | Out-Null
            $title = $tb.ToString()
            if ($title.IndexOf($baseName, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $script:foundHwnd = $hWnd
                return $false
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null
    return $script:foundHwnd
}

function Place-SlideShowOnTargetScreen($entry, [bool]$bringToFront) {
    if ($null -eq $entry -or $entry.hwnd -eq [IntPtr]::Zero) { return }
    $hwnd = $entry.hwnd
    $scr = Get-TargetScreen
    $b = $scr.Bounds
    $rc = New-Object PptWin32+RECT
    [PptWin32]::GetWindowRect($hwnd, [ref]$rc) | Out-Null

    $needsMove = ($rc.Left -ne $b.X) -or ($rc.Top -ne $b.Y)
    if ($bringToFront) {
        [PptWin32]::ShowWindow($hwnd, 5) | Out-Null
        try { $entry.ssw.Activate() } catch {}
        if ($needsMove) {
            [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_TOPMOST, $b.X, $b.Y, $b.Width, $b.Height, [PptWin32]::SWP_SHOWWINDOW) | Out-Null
        } else {
            [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_TOPMOST, 0, 0, 0, 0, ([PptWin32]::SWP_NOMOVE -bor [PptWin32]::SWP_NOSIZE -bor [PptWin32]::SWP_SHOWWINDOW)) | Out-Null
        }
    } else {
        [PptWin32]::ShowWindow($hwnd, 8) | Out-Null
        if ($needsMove) {
            [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_NOTOPMOST, $b.X, $b.Y, $b.Width, $b.Height, [PptWin32]::SWP_NOACTIVATE) | Out-Null
        } else {
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
            } elseif ($px.R -eq 0 -and $px.G -eq 0 -and $px.B -eq 0 -and $bgPx.R -gt 240) {
                $nonBlankSamples++
            }
        }
    }

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    return @{ ok = $true; nonBlankSamples = $nonBlankSamples; width = $w; height = $ht }
}

$pptApp = $null
$openDecks = @{}
$slots = @{
    pgm = $null
    pvw = $null
}
$stageMode = "ppt"

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
        } catch {
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

    for ($i = 1; $i -le $count; $i++) {
        $sl = $pres.Slides.Item($i)
        $cCount = 0
        try { $cCount = $sl.TimeLine.MainSequence.Count } catch {}
        $clicks += $cCount
        $pngPath = Join-Path $deckPrevDir ("slide-" + $i + ".png")
        if (-not (Test-Path $pngPath)) {
            try { $sl.Export($pngPath, "PNG", 1280, 720) } catch {}
        }
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($filePath)
    $entry = @{
        deckId = $deckId
        filePath = $filePath
        baseName = $baseName
        pres = $pres
        ssw = $null
        hwnd = [IntPtr]::Zero
        slideCount = $count
        slideClicks = $clicks
    }
    $script:openDecks[$deckId] = $entry
    return $entry
}

function Ensure-SlideShowWindow($entry) {
    if ($null -ne $entry.ssw) {
        try {
            $null = $entry.ssw.View.CurrentShowPosition
            if ($entry.hwnd -eq [IntPtr]::Zero) {
                $entry.hwnd = Find-SlideShowHwnd $entry.baseName
            }
            return $entry.ssw
        } catch {
            $entry.ssw = $null
            $entry.hwnd = [IntPtr]::Zero
        }
    }
    $pres = $entry.pres
    $pres.SlideShowSettings.ShowPresenterView = 0
    $pres.SlideShowSettings.ShowType = 1
    $ssw = $pres.SlideShowSettings.Run()
    for ($retry = 0; $retry -lt 10; $retry++) {
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

    if ($script:stageMode -eq "video") {
        foreach ($k in $script:openDecks.Keys) {
            $h = $script:openDecks[$k].hwnd
            if ($h -ne [IntPtr]::Zero) {
                [PptWin32]::ShowWindow($h, 0) | Out-Null
            }
        }
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
        if (-not [string]::IsNullOrEmpty($script:globalPreviewsDir)) {
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
        deckId = $deckId
        hwnd = $entry.hwnd.ToInt64()
        topCenterHwnd = $topInfo.hwnd
        topCenterClass = $topInfo.className
        topCenterTitle = $topInfo.title
        visible = $vis
        rect = @{
            x = $rc.Left
            y = $rc.Top
            width = ($rc.Right - $rc.Left)
            height = ($rc.Bottom - $rc.Top)
        }
        currentSlide = $pos
        totalSlides = $entry.slideCount
        clickIndex = $clickIdx
        clickCount = $clickCnt
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
    type = "READY"
    screen = @{
        deviceName = $scrInfo.DeviceName
        primary = $scrInfo.Primary
        x = $scrInfo.Bounds.X
        y = $scrInfo.Bounds.Y
        width = $scrInfo.Bounds.Width
        height = $scrInfo.Bounds.Height
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
                $files = Get-ChildItem -Path $slidesDir -File | Where-Object { $_.Extension -match "^\.(pptx|ppt|ppsx)$" -and -not $_.Name.StartsWith("~$") }
                foreach ($f in $files) {
                    $dId = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
                    $entry = Ensure-DeckLoaded $dId $f.FullName $previewsDir
                    $meta[$dId] = @{
                        deckId = $dId
                        fileName = $f.Name
                        slideCount = $entry.slideCount
                        slideClicks = $entry.slideClicks
                    }
                }
                Send-Response @{ id = $reqId; ok = $true; metadata = $meta }
            }
            "SET_SLOTS" {
                if ($p.pgmDeckId) { $script:slots.pgm = $p.pgmDeckId }
                if ($p.pvwDeckId) { $script:slots.pvw = $p.pvwDeckId }
                if ($p.stageMode) { $script:stageMode = $p.stageMode }
                Sync-WindowZOrder
                Start-Sleep -Milliseconds 150
                Send-Response @{
                    id = $reqId
                    ok = $true
                    pgm = (Get-SlotRuntime $script:slots.pgm "pgm")
                    pvw = (Get-SlotRuntime $script:slots.pvw "pvw")
                }
            }
            "STEP_SLOT" {
                $slotName = if ($p.slot -eq "pvw") { "pvw" } else { "pgm" }
                $dId = $script:slots[$slotName]
                if ($null -ne $dId -and $script:openDecks.ContainsKey($dId)) {
                    $entry = $script:openDecks[$dId]
                    $ssw = Ensure-SlideShowWindow $entry
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
                            $ssw.View.GotoSlide($oldPos + 1)
                        }
                    } elseif ($dir -eq "prev") {
                        if ($oldClick -gt 0) {
                            $ssw.View.Previous()
                        } elseif ($oldPos -gt 1) {
                            $ssw.View.GotoSlide($oldPos - 1)
                        }
                    } elseif ($dir -eq "goto" -and $p.slide) {
                        $ssw.View.GotoSlide([int]$p.slide)
                    }
                    if ($slotName -eq "pgm") {
                        $script:stageMode = "ppt"
                    }
                    Sync-WindowZOrder
                    Start-Sleep -Milliseconds 260
                }
                Send-Response @{
                    id = $reqId
                    ok = $true
                    slot = $slotName
                    runtime = (Get-SlotRuntime $dId $slotName)
                }
            }
            "CUT_SWAP" {
                $oldPgm = $script:slots.pgm
                $oldPvw = $script:slots.pvw
                $script:slots.pgm = $oldPvw
                $script:slots.pvw = $oldPgm
                $script:stageMode = "ppt"
                Sync-WindowZOrder
                Start-Sleep -Milliseconds 150
                Send-Response @{
                    id = $reqId
                    ok = $true
                    pgm = (Get-SlotRuntime $script:slots.pgm "pgm")
                    pvw = (Get-SlotRuntime $script:slots.pvw "pvw")
                }
            }
            "SET_STAGE_MODE" {
                $script:stageMode = $p.mode
                if ($p.mode -eq "black" -and $script:slots.pgm -and $script:openDecks.ContainsKey($script:slots.pgm)) {
                    try { $script:openDecks[$script:slots.pgm].ssw.View.State = 3 } catch {}
                } elseif ($p.mode -eq "ppt" -and $script:slots.pgm -and $script:openDecks.ContainsKey($script:slots.pgm)) {
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
                    id = $reqId
                    ok = $capRes.ok
                    outputPath = $outPath
                    width = $capRes.width
                    height = $capRes.height
                    nonBlankSamples = $capRes.nonBlankSamples
                    topCenterHwnd = $topInfo.hwnd
                    topCenterClass = $topInfo.className
                    topCenterTitle = $topInfo.title
                    topCenterRect = $topInfo.rect
                    probePt = $topInfo.probePt
                }
            }
            "SHUTDOWN" {
                foreach ($k in $script:openDecks.Keys) {
                    $e = $script:openDecks[$k]
                    try { if ($null -ne $e.ssw) { $e.ssw.View.Exit() } } catch {}
                    try { if ($null -ne $e.pres) { $e.pres.Saved = -1; $e.pres.Close() } } catch {}
                }
                Send-Response @{ id = $reqId; ok = $true }
                break
            }
            default {
                Send-Response @{ id = $reqId; ok = $false; error = "Unknown cmd: $cmd" }
            }
        }
    } catch {
        Send-Response @{ id = $reqId; ok = $false; error = $_.Exception.Message }
    }
}
