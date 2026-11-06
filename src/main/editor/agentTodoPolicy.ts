/**
 * Todo planning policy for the agent runtime.
 *
 * Read-only discovery must remain available before a plan exists. Requiring a
 * Todo before listing/reading/searching project files deadlocks the agent:
 * it cannot inspect the workspace to create a fact-based plan.
 */
const READ_ONLY_DISCOVERY_TOOLS = new Set([
  'list_project_files',
  'read_project_file',
  'search_project_files',
  'todo_read',
  'read_session_memory',
  'search_web',
  'read_web_page',
  'check_package_version',
  'get_current_time',
]);

export function shouldBlockToolUntilTodoPlan(
  requiresTodoPlan: boolean,
  hasActiveTodo: boolean,
  toolName: string,
): boolean {
  if (!requiresTodoPlan || hasActiveTodo) return false;
  if (toolName === 'todo_write' || READ_ONLY_DISCOVERY_TOOLS.has(toolName)) return false;
  // Unknown/plugin tools are treated as potentially state-changing.
  return true;
}

/**
 * Detect explicit change intent without treating generic nouns like "project"
 * or "application" as proof that the user requested a multi-step mutation.
 */
export function requiresTodoPlanForRequest(userText: string): boolean {
  return /\\b(buat|bikin|ubah|edit|perbaiki|perbaikan|fix|implement|implementasi|refactor|tambah|tambahkan|hapus|delete|create|write|modify|change|update|build|migrasi)\\b/i.test(userText);
}
