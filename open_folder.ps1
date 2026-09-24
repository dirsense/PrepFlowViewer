param([string]$FolderPath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExplorerForeground {
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flag);
    [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr process);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    public static bool Raise(IntPtr hwnd) {
        hwnd = GetAncestor(hwnd, 2);
        // Preserve a maximized window; restore only a minimized one.
        ShowWindowAsync(hwnd, IsIconic(hwnd) ? 9 : 5);
        uint current = GetCurrentThreadId();
        uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        uint target = GetWindowThreadProcessId(hwnd, IntPtr.Zero);
        bool attached = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
        bool targetAttached = target != 0 && target != current && target != foreground && AttachThreadInput(current, target, true);
        try {
            // Remove the previous implementation's always-on-top state, including
            // on an already-open Explorer. Never set HWND_TOPMOST again.
            SetWindowPos(hwnd, new IntPtr(-2), 0, 0, 0, 0, 0x53);
            BringWindowToTop(hwnd);
            SetActiveWindow(hwnd);
            SetForegroundWindow(hwnd);
        } finally {
            if (targetAttached) AttachThreadInput(current, target, false);
            if (attached) AttachThreadInput(current, foreground, false);
        }
        return IsWindowVisible(hwnd) && (GetWindowLongW(hwnd, -20) & 8) == 0 && GetAncestor(GetForegroundWindow(), 2) == hwnd;
    }
}
'@

$shellApp = New-Object -ComObject Shell.Application
function Find-TargetWindow([string]$targetFolder) {
    foreach ($window in $shellApp.Windows()) {
        try {
            $location = [string]$window.Document.Folder.Self.Path
            if ([String]::Equals($location.TrimEnd('\'), $targetFolder.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
                return [IntPtr]([long]$window.HWND)
            }
        } catch { }
    }
    return [IntPtr]::Zero
}
function Open-TargetFolder([string]$path) {
$targetFolder = [IO.Path]::GetFullPath($path)
if (-not [IO.Directory]::Exists($targetFolder)) { throw 'Folder does not exist.' }
$targetWindow = Find-TargetWindow $targetFolder
if ($targetWindow -eq [IntPtr]::Zero) {
    $shellApp.Open($targetFolder)
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 100
        $targetWindow = Find-TargetWindow $targetFolder
    } while ($targetWindow -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
}
if ($targetWindow -eq [IntPtr]::Zero) { throw 'Explorer window was not found.' }
$shown = [ExplorerForeground]::Raise($targetWindow)
if (-not $shown) {
    # A newly created or minimized Explorer can finish showing asynchronously.
    Start-Sleep -Milliseconds 150
    $shown = [ExplorerForeground]::Raise($targetWindow)
}
if (-not $shown) { throw 'Explorer could not be brought to the foreground.' }
}
if ($FolderPath) {
    Open-TargetFolder $FolderPath
    Write-Output 'foreground'
} else {
    # Keep COM and native bindings warm instead of starting and compiling for
    # each click. EOF shuts this helper down with its owning Viewer process.
    [Console]::Out.WriteLine('ready')
    while ($null -ne ($requestLine = [Console]::ReadLine())) {
        try {
            $request = $requestLine | ConvertFrom-Json
            Open-TargetFolder ([string]$request.folder)
            [Console]::Out.WriteLine('{"ok":true}')
        } catch {
            [Console]::Out.WriteLine('{"ok":false}')
        }
    }
}
