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

function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function findWindowForIde(ide: IdeInfo, folder: string): Promise<{ hwnd: bigint; pid: number } | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const exePath = psQuote(ide.exe.toLowerCase());
  const exeName = psQuote(ide.exe.split(/[\\/]/).pop() ?? '');
  const folderName = psQuote(folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '');
  const script = WIN32_TYPE + [
    '$exePath = ' + exePath,
    '$exeName = ' + exeName,
    '$folderName = ' + folderName,
    '$processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,Name,ExecutablePath,CommandLine',
    '$ids = New-Object System.Collections.Generic.HashSet[int]',
    'foreach ($proc in $processes) {',
    '  $path = ([string]$proc.ExecutablePath).ToLowerInvariant()',
    '  if ($proc.Name -ieq $exeName -or ($path -and $path -eq $exePath)) { [void]$ids.Add([int]$proc.ProcessId) }',
    '}',
    '$found = New-Object System.Collections.ArrayList',
    '[void][RuangKerjaWin32]::EnumWindows({ param($h,$l)',
    '  if (-not [RuangKerjaWin32]::IsWindowVisible($h)) { return $true }',
    '  $windowPid = 0',
    '  [void][RuangKerjaWin32]::GetWindowThreadProcessId($h, [ref]$windowPid)',
    '  if (-not $ids.Contains([int]$windowPid)) { return $true }',
    '  $sb = New-Object System.Text.StringBuilder 1024',
    '  [void][RuangKerjaWin32]::GetWindowText($h, $sb, $sb.Capacity)',
    '  if ($sb.Length -eq 0) { return $true }',
    '  $title = $sb.ToString()',
    '  $score = 1',
    '  if ($folderName -and $title.IndexOf($folderName, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $score = 100 }',
    '  [void]$found.Add([pscustomobject]@{ Handle=$h.ToInt64(); Pid=[int]$windowPid; Title=$title; Score=$score })',
    '  return $true',
    '}, [IntPtr]::Zero)',
    '$best = $found | Sort-Object Score -Descending | Select-Object -First 1',
    'if ($best) { Write-Output ($best.Handle.ToString() + "|" + $best.Pid.ToString()) }',
  ].join('\n');
  return ps(script, 5000).then((out) => {
    const pair = out.split(/\r?\n/).pop()?.trim().split('|') ?? [];
    if (pair.length !== 2) return null;
    try {
      const hwnd = BigInt(pair[0]);
      const pid = Number(pair[1]);
      return hwnd > 0n && Number.isFinite(pid) ? { hwnd, pid } : null;
    } catch { return null; }
  });
}

function mutateWindow(mode: 'embed' | 'unembed', hwnd: bigint, parent: bigint, width = 0, height = 0): Promise<boolean> {
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
    '  Write-Output "RK_WINDOW_OK"',
    '  exit 0',
    '}',
    '[void][RuangKerjaWin32]::SetParent($h, [IntPtr]::Zero)',
    '$style = 0x10CF0000',
    '[void][RuangKerjaWin32]::SetWindowLongPtr($h, $GWL_STYLE, [IntPtr]::new($style))',
    '$ex = [RuangKerjaWin32]::GetWindowLongPtr($h, $GWL_EXSTYLE).ToInt64()',
    '$ex = $ex -bor $WS_EX_APPWINDOW',
    '[void][RuangKerjaWin32]::SetWindowLongPtr($h, $GWL_EXSTYLE, [IntPtr]::new($ex))',
    '[void][RuangKerjaWin32]::ShowWindow($h, $SW_MINIMIZE)',
    'Write-Output "RK_WINDOW_OK"',
    'exit 0',
  ].join('\n');
  return ps(script, 6_000).then((out) => out.split(/\r?\n/).some((line) => line.trim() === 'RK_WINDOW_OK'));
}

export async function openEmbeddedIde(ide: IdeInfo, folder: string, win: BrowserWindow): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.platform !== 'win32') return { ok: false, error: 'IDE terintegrasi saat ini hanya didukung di Windows.' };
  await closeEmbeddedIde();
  if (!ide.exe) return { ok: false, error: 'Lokasi IDE tidak diketahui.' };
  const extension = ide.exe.split('.').pop()?.toLowerCase() ?? '';
  const supportsNewWindowFlag = ['vscode', 'cursor', 'antigravity', 'windsurf', 'trae'].includes(ide.id);
  const args = supportsNewWindowFlag ? ['--new-window', folder] : [folder];
  const child = extension === 'cmd' || extension === 'bat'
    ? spawn('cmd.exe', ['/d', '/s', '/c', '"' + ide.exe + '" ' + args.map((arg) => '"' + arg.replace(/"/g, '\\"') + '"').join(' ')], { windowsHide: true, detached: false, stdio: 'ignore' })
    : spawn(ide.exe, args, { windowsHide: false, detached: false, stdio: 'ignore' });
  let launchError: string | null = null;
  child.once('error', (err) => { launchError = err.message; });
  // VS Code forks may forward the folder to an existing main process and exit.
  // Match actual top-level windows by executable identity and project title instead of launcher's PID tree.
  const startedAt = Date.now();
  let match: { hwnd: bigint; pid: number } | null = null;
  while (Date.now() - startedAt < LAUNCH_TIMEOUT_MS) {
    match = await findWindowForIde(ide, folder);
    if (match) break;
    if (launchError) return { ok: false, error: `Gagal menjalankan ${ide.name}: ${launchError}` };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (!match) return { ok: false, error: `Tidak dapat menemukan jendela ${ide.name} untuk proyek ini. Periksa apakah IDE mendukung pembukaan folder sebagai jendela baru, lalu coba lagi.` };
  const parentHwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
  const bounds = win.getContentBounds();
  const embedded = await mutateWindow('embed', match.hwnd, parentHwnd, bounds.width, bounds.height);
  if (!embedded) return { ok: false, error: `Windows menolak menanamkan jendela ${ide.name} ke Ruang Kerja. IDE ini mungkin tidak kompatibel dengan native embedding.` };
  session = { ide, process: child, pid: match.pid, hwnd: match.hwnd };
  // Do not clear the embedded session when an IDE launcher exits after handing
  // the folder to a long-lived IDE process. The selected window belongs to match.pid.
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
  await mutateWindow('unembed', current.hwnd, 0n).catch(() => false);
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