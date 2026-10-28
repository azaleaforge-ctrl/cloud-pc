import { createHash } from 'node:crypto';
import { getAgentTerminalGuidance } from './terminalShell';

export function isToolFailureResult(result: string): boolean {
  if (/^(?:Tool gagal:|Tool ditahan:|Tool tidak dikenal:|Akses ditolak|Path ditolak|Memory ditolak|Pengguna menolak)/i.test(result.trim())) return true;
  if (/^Status:\s*(?:failed|timed_out|cancelled)/im.test(result)) return true;
  if (/dihentikan karena melewati batas/i.test(result)) return true;
  const exitCode = result.match(/(?:^|\n)Exit code:\s*(-?\d+)/);
  return exitCode ? Number(exitCode[1]) !== 0 : false;
}

/**
 * Return a privacy-preserving and stable signature for failures that have the
 * same probable root cause. Tool arguments are intentionally excluded so tiny
 * model-generated changes don't bypass the loop guard.
 */
export function repeatedFailureSignature(toolName: string, result: string): string | null {
  if (!isToolFailureResult(result)) return null;

  let category = '';
  if (toolName === 'todo_write') {
    if (/Task hanya bisa menjadi completed setelah berstatus in_progress/i.test(result)) {
      category = 'todo-completed-before-active';
    } else if (/bukti (?:verifikasi|penyelesaian)|completionEvidence/i.test(result)) {
      category = 'todo-completion-evidence';
    } else if (/Task belum bisa completed|membutuhkan build\/test\/lint\/typecheck/i.test(result)) {
      category = 'todo-terminal-verification-required';
    } else if (/prasyarat|dependensi|blockedBy/i.test(result)) {
      category = 'todo-dependency-transition';
    } else if (/task baru tidak boleh langsung completed/i.test(result)) {
      category = 'todo-new-task-completed';
    } else if (/Todo List tidak boleh menghapus task/i.test(result)) {
      category = 'todo-task-removed';
    } else if (/siklus/i.test(result)) {
      category = 'todo-dependency-cycle';
    }
  }

  if (!category && toolName === 'run_terminal') {
    if (/is not recognized as an internal or external command|is not recognized as the name of a cmdlet|The term .+ is not recognized/i.test(result)) {
      category = 'terminal-executable-not-found';
    } else if (/The filename, directory name, or volume label syntax is incorrect/i.test(result)) {
      category = 'terminal-shell-syntax';
    } else if (/ParserError|Unexpected token|Missing expression|The string is missing the terminator/i.test(result)) {
      category = 'terminal-parser-error';
    } else if (/npm ERR!.*ERESOLVE|ERESOLVE unable to resolve dependency tree/i.test(result)) {
      category = 'terminal-npm-dependency-conflict';
    } else if (/ENOENT.*(?:package\.json|package-lock\.json)|Could not read package\.json/i.test(result)) {
      category = 'terminal-missing-package-manifest';
    }
  }

  if (!category) {
    // Drop transient duration, timestamps, and leading shell-profile information.
    const normalized = result
      .replace(/^Shell:.*\r?\n/m, '')
      .replace(/^Durasi:\s*\d+(?:\.\d+)? detik\s*$/gim, 'Durasi: <elapsed>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2400);
    category = createHash('sha256').update(normalized).digest('hex');
  }

  return toolName + ':' + category;
}

export function getToolRecoveryHint(toolName: string, result: string): string {
  if (toolName === 'todo_write') {
    return [
      'Panduan pemulihan Todo (wajib diikuti): jangan kirim ulang pembaruan yang sama.',
      'Panggil todo_read untuk melihat status yang benar-benar tersimpan. Pertahankan semua ID task dan dependensinya.',
      'Task hanya boleh menjadi completed jika pada pembaruan todo_write yang sudah diterima sebelumnya statusnya in_progress, lalu pekerjaan dan kriteria verification telah benar-benar diperiksa, serta completionEvidence menjelaskan bukti nyata minimal 8 karakter.',
      'Jika task masih pending, ubah task itu menjadi in_progress dalam todo_write tersendiri yang berhasil diterima. Baru setelah itu lakukan/verifikasi pekerjaan dan tandai completed pada pembaruan berikutnya. Jangan menandai task selesai dan aktif pada pembaruan yang sama.',
      'Jangan membuat ulang seluruh rencana untuk menghindari validator. Jika prasyarat belum selesai, kerjakan prasyarat terlebih dahulu atau tandai blocked dengan alasan yang spesifik.',
    ].join(' ');
  }

  if (toolName === 'run_terminal') {
    const shellGuidance = getAgentTerminalGuidance();
    const syntaxHint = /is not recognized as an internal or external command|is not recognized as the name of a cmdlet|The term .+ is not recognized|filename, directory name, or volume label syntax is incorrect|ParserError|Unexpected token|Missing expression/i.test(result)
      ? 'Error tampak terkait executable atau sintaks shell. Perbaiki sintaks/command sesuai shell aktif, jangan mengubah source code project untuk menutupi kesalahan shell.'
      : 'Baca stdout, stderr, dan exit code sebelum menentukan langkah berikutnya.';
    return 'Panduan pemulihan terminal: ' + shellGuidance + ' ' + syntaxHint + ' Jangan mengulangi command yang sama tanpa mengubah penyebab kegagalannya. Runner sudah mengembalikan exit code; jangan menambahkan wrapper untuk mencetak $? atau exit code.';
  }

  return 'Panduan pemulihan tool: baca error lengkap, periksa prasyarat dan konteksnya, lalu ubah pendekatan sebelum mencoba lagi. Jangan mengulangi pemanggilan dengan argumen yang sama tanpa alasan teknis baru, dan jangan mengklaim operasi berhasil ketika hasil tool menyatakan gagal.';
}
