import { spawnSync } from 'node:child_process';

export type TerminalShellFamily = 'powershell' | 'cmd' | 'posix';

export interface TerminalShellProfile {
  file: string;
  name: string;
  family: TerminalShellFamily;
  interactiveArgs: string[];
  commandArgs: string[];
}

export interface TerminalCommandInvocation {
  file: string;
  args: string[];
  shellName: string;
  shellFamily: TerminalShellFamily;
}

let cachedProfile: TerminalShellProfile | null = null;

function isOnPath(executable: string): boolean {
  try {
    const result = spawnSync('where.exe', [executable], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'ignore',
      timeout: 1500,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function executableName(file: string): string {
  return file.split(/[\\/]/).pop() || file;
}

/**
 * Resolve one shell profile for both the interactive editor terminal and the
 * AI command runner. That prevents the model and runtime from silently using
 * different command languages on the same Windows machine.
 */
export function resolveTerminalShell(): TerminalShellProfile {
  if (cachedProfile) return { ...cachedProfile, interactiveArgs: [...cachedProfile.interactiveArgs], commandArgs: [...cachedProfile.commandArgs] };

  if (process.platform === 'win32') {
    if (isOnPath('pwsh.exe')) {
      cachedProfile = {
        file: 'pwsh.exe',
        name: 'PowerShell 7 (pwsh.exe)',
        family: 'powershell',
        interactiveArgs: ['-NoLogo', '-NoProfile'],
        commandArgs: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
      };
    } else if (isOnPath('powershell.exe')) {
      cachedProfile = {
        file: 'powershell.exe',
        name: 'Windows PowerShell (powershell.exe)',
        family: 'powershell',
        interactiveArgs: ['-NoLogo', '-NoProfile'],
        commandArgs: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
      };
    } else {
      const file = process.env.ComSpec?.trim() || 'cmd.exe';
      cachedProfile = {
        file,
        name: 'Command Prompt (cmd.exe)',
        family: 'cmd',
        interactiveArgs: [],
        commandArgs: ['/d', '/s', '/c'],
      };
    }
  } else {
    const file = process.env.SHELL?.trim() || '/bin/bash';
    cachedProfile = {
      file,
      name: executableName(file) + ' (POSIX shell)',
      family: 'posix',
      interactiveArgs: [],
      commandArgs: ['-lc'],
    };
  }

  return { ...cachedProfile, interactiveArgs: [...cachedProfile.interactiveArgs], commandArgs: [...cachedProfile.commandArgs] };
}

function wrapPowerShellCommand(command: string): string {
  // Base64 avoids quoting/injection problems when the user's command is passed
  // as one PowerShell argument. The command itself is still executed as code,
  // exactly as approved by the user.
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
  return [
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$scriptText = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('" + encodedCommand + "'))",
    '& ([scriptblock]::Create($scriptText))',
    '$commandSucceeded = $?',
    '$nativeExitCode = $global:LASTEXITCODE',
    'if ($null -ne $nativeExitCode) { exit [int]$nativeExitCode }',
    'if (-not $commandSucceeded) { exit 1 }',
    'exit 0',
  ].join('; ');
}

/**
 * Build the exact process invocation used by the AI runner, including a
 * PowerShell wrapper that propagates native command exit codes instead of
 * appending shell-specific snippets such as "echo EXIT_CODE: $?".
 */
export function buildTerminalCommandInvocation(
  command: string,
  profile: TerminalShellProfile = resolveTerminalShell(),
): TerminalCommandInvocation {
  const args = profile.family === 'powershell'
    ? [...profile.commandArgs, wrapPowerShellCommand(command)]
    : [...profile.commandArgs, command];

  return {
    file: profile.file,
    args,
    shellName: profile.name,
    shellFamily: profile.family,
  };
}

export function getAgentTerminalGuidance(profile: TerminalShellProfile = resolveTerminalShell()): string {
  if (profile.family === 'powershell') {
    return 'Shell terminal aktif: ' + profile.name + '. Gunakan sintaks PowerShell, bukan Bash atau CMD. Contoh: Get-Location, Get-ChildItem, Set-Location, dan pemisah command ";". Untuk operasi native seperti npm, node, git, composer, atau dotnet, panggil executable langsung. Runner mengembalikan exit code proses secara otomatis; jangan menambahkan wrapper echo EXIT_CODE, "$?", atau $LASTEXITCODE.';
  }
  if (profile.family === 'cmd') {
    return 'Shell terminal aktif: ' + profile.name + '. Gunakan sintaks CMD Windows. Untuk lokasi gunakan "cd" atau "cd /d <path>"; gunakan "dir" untuk daftar file dan "&&" untuk menjalankan command berikutnya hanya jika sebelumnya berhasil. Jangan memakai sintaks Bash/PowerShell. Runner mengembalikan exit code command secara otomatis; jangan menambahkan wrapper echo EXIT_CODE.';
  }
  return 'Shell terminal aktif: ' + profile.name + '. Gunakan sintaks POSIX shell/Bash; gunakan pwd, ls, cd, pemisah command ";" atau "&&", dan "$?" hanya jika memang dibutuhkan dalam skrip. Runner mengembalikan exit code proses secara otomatis; jangan menambahkan wrapper echo EXIT_CODE.';
}
