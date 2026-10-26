import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import type { IdeInfo } from '../shared/types';

const POWERSHELL = 'powershell.exe';
const TOOLBAR_HEIGHT = 46;
const POLL_MS = 250;
const LAUNCH_TIMEOUT_MS = 20_000;

interface NativeIdeSession { ide: IdeInfo; process: ChildProcess; pid: number; hwnd: bigint; }
let session: NativeIdeSession | null = null;

function ps(script: string, timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (_error, stdout) => resolve(String(stdout ?? '').trim()));
  });
}

const WIN32_TYPE = "Add-Type @'\nusing System;\nusing System.Text;\nusing System.Runtime.InteropServices;\npublic static class RuangKerjaWin32 {\n  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);\n  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);\n  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd);\n  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);\n  [DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);\n  [DllImport(\"user32.dll\")] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);\n  [DllImport(\"user32.dll\", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);\n  [DllImport(\"user32.dll\", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr value);\n  [DllImport(\"user32.dll\", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint flags);\n  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);\n  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();\n}\n'@\n";

function findWindowForPid(pid: number): Promise<bigint | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script = WIN32_TYPE + [
    '$root = ' + pid,
    '$p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,ParentProcessId',
    '$ids = New-Object System.Collections.Generic.HashSet[int]',
    '[void]$ids.Add($root)',
    '$changed = $true',
    'while ($changed) {',
    '  $changed = $false',
    '  foreach ($row in $p) {',
    '    $child = [int]$row.ProcessId; $parent = [int]$row.ParentProcessId',
    '    if ($ids.Contains($parent) -and -not $ids.Contains($child)) { [void]$ids.Add($child); $changed = $true }',
    '  }',
    '}',
    '$found = 0',
    '[void][RuangKerjaWin32]::EnumWindows({ param($h,$l)',
    '  if (-not [RuangKerjaWin32]::IsWindowVisible($h)) { return $true }',
    '  $windowPid = 0',
    '  [void][RuangKerjaWin32]::GetWindowThreadProcessId($h, [ref]$windowPid)',
    '  if (-not $ids.Contains([int]$windowPid)) { return $true }',
    '  $sb = New-Object System.Text.StringBuilder 512',
    '  [void][RuangKerjaWin32]::GetWindowText($h, $sb, $sb.Capacity)',
    '  if ($sb.Length -eq 0) { return $true }',
    '  $script:found = $h.ToInt64(); return $false',
    '}, [IntPtr]::Zero)',
    'Write-Output $found',
  ].join('\n');
  return ps(script, 5_000).then((out) => {
    if (!out) return null;
    const n = BigInt(out.split(/\r?\n/).pop() || '0');
    return n > 0n ? n : null;
  });
}

function mutateWindow(mode: 'embed' | 'unembed', hwnd: bigint, parent: bigint, width = 0, height = 0): Promise<void> {
  const child = hwnd.toString();
  const owner = parent.toString();
  const script = WIN32_TYPE + [
    '$h = [IntPtr]::new([long]' + child + ')',
    '$p = [IntPtr]::new([long]' + owner + ')',
    '$GWL_STYLE = -16; $GWL_EXSTYLE = -20',
    '$WS_CHILD = 0x40000000; $WS_VISIBLE = 0x10000000',
    '$WS_CAPTION = 0x00C00000; $WS_THICKFRAME = 0x00040000',
    '$WS_MINIMIZEBOX = 0x00020000; $WS_MAXIMIZEBOX = 0x00010000; $WS_SYSMENU = 0x00080000',
    '$WS_EX_APPWINDOW = 0x00040000',
    '$SW_RESTORE = 9; $SW_MINIMIZE = 6',
    '$SWP_NOZORDER = 0x0004; $SWP_NOACTIVATE = 0x0010; $SWP_SHOWWINDOW = 0x0040',
    "if ('" + mode + "' -eq 'embed') {",
    '  [void][RuangKerjaWin32]::SetParent($h, $p)',
    '  $style = [RuangKerjaWin32]::GetWindowLongPtr($h, $GWL_STYLE).ToInt64()',
    '  $style = ($style -band (-bnot ($WS_CAPTION -bor $WS_THICKFRAME -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX -bor $WS_SYSMENU))) -bor $WS_CHILD -bor $WS_VISIBLE',
    '  [void][RuangKerjaWin32]::SetWindowLongPtr($h, $GWL_STYLE, [IntPtr]::new($style))',
    '  $ex = [RuangKerjaWin32]::GetWindowLongPtr($h, $GWL_EXSTYLE).ToInt64()',
    '  $ex = $ex -band (-bnot $WS_EX_APPWINDOW)',
    '  [void][RuangKerjaWin32]::SetWindowLongPtr($h, $GWL_EXSTYLE, [IntPtr]::new($ex))',
    '  [void][RuangKerjaWin32]::SetWindowPos($h, [IntPtr]::Zero, 0, ' + TOOLBAR_HEIGHT + ', ' + width + ', ' + Math.max(100, height - TOOLBAR_HEIGHT) + ', $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW)',
    '  [void][RuangKerjaWin32]::ShowWindow($h, $SW_RESTORE)',
    '  exit 0',
    '}',
    '[void][RuangKerjaWin32]::SetParent($h, [IntPtr]::Zero)',
    '$style = 0x10CF0000',
    '[void][RuangKerjaWin32]::SetWindowLongPtr($h, $GWL_STYLE, [IntPtr]::new($style))',
    '$ex = [RuangKerjaWin32]::GetWindowLongPtr($h, $GWL_EXSTYLE).ToInt64()',
    '$ex = $ex -bor $WS_EX_APPWINDOW',
    '[void][RuangKerjaWin32]::SetWindowLongPtr($h, $GWL_EXSTYLE, [IntPtr]::new($ex))',
    '[void][RuangKerjaWin32]::ShowWindow($h, $SW_MINIMIZE)',
    'exit 0',
  ].join('\n');
  return ps(script, 6_000).then(() => undefined);
}

export async function openEmbeddedIde(ide: IdeInfo, folder: string, win: BrowserWindow): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.platform !== 'win32') return { ok: false, error: 'IDE terintegrasi saat ini hanya didukung di Windows.' };
  await closeEmbeddedIde();
  if (!ide.exe) return { ok: false, error: 'Lokasi IDE tidak diketahui.' };
  const child = spawn(ide.exe, [folder], { windowsHide: false, detached: false, stdio: 'ignore' });
  if (!child.pid) return { ok: false, error: 'Gagal menjalankan IDE.' };
  const startedAt = Date.now();
  let hwnd: bigint | null = null;
  while (Date.now() - startedAt < LAUNCH_TIMEOUT_MS) {
    hwnd = await findWindowForPid(child.pid);
    if (hwnd) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (!hwnd) { try { child.kill(); } catch {} return { ok: false, error: 'Jendela IDE tidak ditemukan dalam batas waktu.' }; }
  const parentHwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
  const bounds = win.getContentBounds();
  await mutateWindow('embed', hwnd, parentHwnd, bounds.width, bounds.height);
  session = { ide, process: child, pid: child.pid, hwnd };
  child.once('exit', () => { if (session?.pid === child.pid) session = null; });
  return { ok: true };
}

export async function resizeEmbeddedIde(win: BrowserWindow): Promise<void> {
  if (!session || win.isDestroyed()) return;
  const parentHwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
  const bounds = win.getContentBounds();
  await mutateWindow('embed', session.hwnd, parentHwnd, bounds.width, bounds.height);
}

export async function closeEmbeddedIde(): Promise<void> {
  if (!session) return;
  const current = session;
  session = null;
  await mutateWindow('unembed', current.hwnd, 0n).catch(() => undefined);
}

export function getEmbeddedIdePids(): number[] { return session ? [session.pid] : []; }

export function isEmbeddedIdeForeground(): Promise<boolean> {
  if (!session || process.platform !== 'win32') return Promise.resolve(false);
  const script = WIN32_TYPE + [
    '$fg = [RuangKerjaWin32]::GetForegroundWindow()',
    '$pid = 0',
    '[void][RuangKerjaWin32]::GetWindowThreadProcessId($fg, [ref]$pid)',
    'Write-Output $pid',
  ].join('\n');
  return ps(script, 2_500).then((out) => Number(out.split(/\r?\n/).pop() || 0) === session?.pid);
}