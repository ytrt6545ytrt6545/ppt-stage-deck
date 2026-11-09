# ============================================================================
# PowerPoint COM Persistent Dual-Deck Worker (100% 7-Bit ASCII Safe)
# Communicates via Base64 UTF-8 JSON lines over stdin/stdout
# ============================================================================
$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class PptWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public const int GWL_STYLE = -16;
    public const int WS_POPUP = unchecked((int)0x80000000);
    public const int WS_VISIBLE = 0x10000000;
    public const uint SWP_FRAMECHANGED = 0x0020;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint SWP_NOACTIVATE = 0x0010;
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
}
"@

function Get-TargetScreen {
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $sec = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
    if ($null -ne $sec) { return $sec }
    return $screens[0]
}

function Find-SlideShowHwnd([string]$baseName) {
    $script:foundHwnd = [IntPtr]::Zero
    [PptWin32]::EnumWindows({
        param($hWnd, $lParam)
        $sb = New-Object System.Text.StringBuilder 256
        [PptWin32]::GetClassName($hWnd, $sb, 256) | Out-Null
        $cls = $sb.ToString()
        if ($cls -eq "PPTFrameClass" -or $cls -eq "screenClass") {
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

function Place-BorderlessOnScreen2([IntPtr]$hwnd, [bool]$bringToFront) {
    if ($hwnd -eq [IntPtr]::Zero) { return }
    $scr = Get-TargetScreen
    $b = $scr.Bounds
    $style = [PptWin32]::WS_POPUP -bor [PptWin32]::WS_VISIBLE
    [PptWin32]::SetWindowLong($hwnd, [PptWin32]::GWL_STYLE, $style) | Out-Null
    if ($bringToFront) {
        [PptWin32]::ShowWindow($hwnd, 5) | Out-Null
        [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_TOPMOST, $b.X, $b.Y, $b.Width, $b.Height, ([PptWin32]::SWP_FRAMECHANGED -bor [PptWin32]::SWP_SHOWWINDOW)) | Out-Null
    } else {
        [PptWin32]::SetWindowPos($hwnd, [PptWin32]::HWND_BOTTOM, $b.X, $b.Y, $b.Width, $b.Height, ([PptWin32]::SWP_FRAMECHANGED -bor [PptWin32]::SWP_NOACTIVATE)) | Out-Null
    }
}

$pptApp = $null
$openDecks = @{} # deckId -> @{ pres, ssw, hwnd, filePath, baseName, slideCount, slideClicks }
$slots = @{
    pgm = $null
    pvw = $null
}
$stageMode = "ppt" # "ppt" | "video" | "black"

function Ensure-PptApp {
    if ($null -eq $script:pptApp) {
        $script:pptApp = New-Object -ComObject PowerPoint.Application
    }
    return $script:pptApp
}

function Ensure-DeckLoaded([string]$deckId, [string]$filePath, [string]$previewsDir) {
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
    $pres.SlideShowSettings.ShowType = 2
    $pres.SlideShowSettings.ShowScrollbar = 0
    $ssw = $pres.SlideShowSettings.Run()
    Start-Sleep -Milliseconds 120
    $hwnd = Find-SlideShowHwnd $entry.baseName
    $entry.ssw = $ssw
    $entry.hwnd = $hwnd
    return $ssw
}

function Sync-WindowZOrder {
    $pgmId = $script:slots.pgm
    $pvwId = $script:slots.pvw

    if ($script:stageMode -ne "ppt") {
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
        Place-BorderlessOnScreen2 $pvwEntry.hwnd $false
    }

    if ($null -ne $pgmId -and $script:openDecks.ContainsKey($pgmId)) {
        $pgmEntry = $script:openDecks[$pgmId]
        Ensure-SlideShowWindow $pgmEntry | Out-Null
        Place-BorderlessOnScreen2 $pgmEntry.hwnd $true
    }
}

function Get-SlotRuntime($deckId) {
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
    return @{
        deckId = $deckId
        hwnd = $entry.hwnd.ToInt64()
        currentSlide = $pos
        totalSlides = $entry.slideCount
        clickIndex = $clickIdx
        clickCount = $clickCnt
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
                Send-Response @{
                    id = $reqId
                    ok = $true
                    pgm = (Get-SlotRuntime $script:slots.pgm)
                    pvw = (Get-SlotRuntime $script:slots.pvw)
                }
            }
            "STEP_SLOT" {
                $slotName = if ($p.slot -eq "pvw") { "pvw" } else { "pgm" }
                $dId = $script:slots[$slotName]
                if ($null -ne $dId -and $script:openDecks.ContainsKey($dId)) {
                    $entry = $script:openDecks[$dId]
                    $ssw = Ensure-SlideShowWindow $entry
                    $dir = $p.direction
                    if ($dir -eq "next") {
                        $ssw.View.Next()
                    } elseif ($dir -eq "prev") {
                        $ssw.View.Previous()
                    } elseif ($dir -eq "goto" -and $p.slide) {
                        $ssw.View.GotoSlide([int]$p.slide)
                    }
                    Sync-WindowZOrder
                }
                Send-Response @{
                    id = $reqId
                    ok = $true
                    slot = $slotName
                    runtime = (Get-SlotRuntime $dId)
                }
            }
            "CUT_SWAP" {
                $oldPgm = $script:slots.pgm
                $oldPvw = $script:slots.pvw
                $script:slots.pgm = $oldPvw
                $script:slots.pvw = $oldPgm
                $script:stageMode = "ppt"
                Sync-WindowZOrder
                Send-Response @{
                    id = $reqId
                    ok = $true
                    pgm = (Get-SlotRuntime $script:slots.pgm)
                    pvw = (Get-SlotRuntime $script:slots.pvw)
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
