import { getAgentTerminalGuidance } from './terminalShell';

/**
 * Classify tool errors so the model can diagnose them and continue.
 * This module deliberately contains no repeat counter, signature, suppression,
 * or run-stopping policy.
 */
export function isToolFailureResult(result: string): boolean {
  if (/^(?:Tool gagal:|Tool ditahan:|Tool tidak dikenal:|Akses ditolak|Path ditolak|Memory ditolak|Pengguna menolak)/i.test(result.trim())) return true;
  if (/^Status:\s*(?:failed|timed_out|cancelled)/im.test(result)) return true;
  if (/dihentikan karena melewati batas/i.test(result)) return true;
  const exitCode = result.match(/(?:^|\n)Exit code:\s*(-?\d+)/);
  return exitCode ? Number(exitCode[1]) !== 0 : false;
}

/**
 * Return a diagnostic hint alongside the real tool output. A hint never
 * suppresses the next tool call or ends the agent run.
 */
export function getToolRecoveryHint(toolName: string, result: string): string {
  if (toolName === 'todo_write') {
    return [
      'Todo List hanya panel progres opsional dan bukan prasyarat pekerjaan.',
      'Jika pembaruan Todo gagal, lewati sementara dan lanjutkan pekerjaan file/terminal utama.',
      'Jangan menghabiskan giliran hanya untuk memperbaiki status Todo.',
    ].join(' ');
  }

  if (toolName === 'run_terminal') {
    const shellGuidance = getAgentTerminalGuidance();
    const syntaxHint = /is not recognized as an internal or external command|is not recognized as the name of a cmdlet|The term .+ is not recognized|filename, directory name, or volume label syntax is incorrect|ParserError|Unexpected token|Missing expression/i.test(result)
      ? 'Error tampak terkait executable atau sintaks shell. Perbaiki sintaks/command sesuai shell aktif; jangan mengubah source code project untuk menutupi kesalahan shell.'
      : 'Gunakan stdout, stderr, exit code, dan pesan error untuk memilih langkah berikutnya.';
    return 'Panduan pemulihan terminal: ' + shellGuidance + ' ' + syntaxHint + ' Jika command gagal, perbaiki penyebabnya atau pilih pendekatan lain. Timeout satu command tidak menghentikan agent; agent dapat melanjutkan dengan tool lain.';
  }

  return 'Panduan pemulihan tool: baca error lengkap, periksa prasyarat dan konteksnya, lalu lanjutkan dengan tool atau pendekatan yang sesuai. Kegagalan tool bukan alasan untuk menghentikan seluruh run. Jangan mengklaim operasi berhasil ketika hasil tool menyatakan gagal.';
}
