import { execFile } from 'node:child_process';
import { isEmbeddedIdeForeground } from './nativeHost';

const POWERSHELL = 'powershell.exe';
const TICK_MS = 4_000;

function queryProcessActivity(): Promise<{ agent: boolean; terminal: boolean }> {
  if (process.platform !== 'win32') return Promise.resolve({ agent: false, terminal: false });
  const script = [
    'Add-Type @''',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class RKActivity { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid); }',
    '''@',
    '$fg = [RKActivity]::GetForegroundWindow()',
    '$fgPid = 0',
    '[void][RKActivity]::GetWindowThreadProcessId($fg, [ref]$fgPid)',
    '$ps = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,Name,CommandLine',
    '$agent = $false; $terminal = $false',
    'foreach ($p in $ps) {',
    '  $name = [string]$p.Name',
    '  if ($name -match "(?i)claude|codex|opencode|aider|gemini|copilot|cline|goose|continue|kilocode") { $agent = $true }',
    '  if ([int]$p.ProcessId -eq [int]$fgPid -and $name -match "(?i)cmd|powershell|pwsh|wt|windowsterminal|conhost") { $terminal = $true }',
    '}',
    '[pscustomobject]@{agent=$agent;terminal=$terminal} | ConvertTo-Json -Compress',
  ].join('\n');
  return new Promise((resolve) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true, timeout: 3_000, maxBuffer: 512 * 1024,
    }, (_error, stdout) => {
      try {
        const parsed = JSON.parse(String(stdout || '{}').trim());
        resolve({ agent: Boolean(parsed.agent), terminal: Boolean(parsed.terminal) });
      } catch {
        resolve({ agent: false, terminal: false });
      }
    });
  });
}

export type ActivitySource = 'ide' | 'agent' | 'terminal' | 'ui' | 'file';

export function startActivityMonitor(projectPath: string, onActivity: (source: ActivitySource) => void): () => void {
  if (!projectPath) return () => undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (await isEmbeddedIdeForeground()) {
      onActivity('ide');
    } else {
      const info = await queryProcessActivity();
      if (info.agent) onActivity('agent');
      else if (info.terminal) onActivity('terminal');
    }
    if (!stopped) timer = setTimeout(tick, TICK_MS);
    timer?.unref?.();
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}