/**
 * Todo planning is presentation-only. Keep this compatibility helper for older
 * callers, but never gate workspace or terminal tools on Todo state.
 */
export function shouldBlockToolUntilTodoPlan(
  _requiresTodoPlan: boolean,
  _hasActiveTodo: boolean,
  _toolName: string,
): boolean {
  return false;
}

/**
 * Classify requests that may benefit from a Todo progress display. This value
 * must never be used to prevent or defer tool execution.
 */
export function requiresTodoPlanForRequest(userText: string): boolean {
  return /\b(buat|bikin|ubah|edit|perbaiki|perbaikan|fix|implement|implementasi|refactor|tambah|tambahkan|hapus|delete|create|write|modify|change|update|build|migrasi)\b/i.test(userText);
}
