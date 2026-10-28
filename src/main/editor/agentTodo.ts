import type { AgentTodo, AgentTodoPriority, AgentTodoStatus } from '../../shared/agents';

const STATUSES = new Set<AgentTodoStatus>(['pending', 'in_progress', 'completed', 'blocked']);
const PRIORITIES = new Set<AgentTodoPriority>(['low', 'normal', 'high']);
const MAX_TODOS = 50;
const MAX_TITLE_LENGTH = 220;
const MAX_DETAIL_LENGTH = 600;

export interface AgentTodoInput {
  id: string;
  title: string;
  status: AgentTodoStatus;
  priority?: AgentTodoPriority;
  blockedBy?: string[];
  verification?: string;
  blockedReason?: string;
  completionEvidence?: string;
}

function text(value: unknown, label: string, maxLength: number, required = false): string {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return '';
    throw new Error(label + ' harus berupa teks.');
  }
  const result = value.trim();
  if (required && !result) throw new Error(label + ' tidak boleh kosong.');
  if (result.length > maxLength) throw new Error(label + ' terlalu panjang (maksimal ' + maxLength + ' karakter).');
  return result;
}

function stringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TODOS) throw new Error(label + ' harus berupa daftar ID yang valid.');
  const result = value.map((item) => text(item, label, 80, true));
  if (new Set(result).size !== result.length) throw new Error(label + ' tidak boleh berisi ID duplikat.');
  return result;
}

function assertAcyclic(todos: AgentTodo[]): void {
  const byId = new Map<string, AgentTodo>(todos.map((todo): [string, AgentTodo] => [todo.id, todo]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Dependensi Todo List membentuk siklus pada task ' + id + '.');
    if (visited.has(id)) return;
    visiting.add(id);
    const todo = byId.get(id);
    for (const dependencyId of todo?.blockedBy ?? []) visit(dependencyId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const todo of todos) visit(todo.id);
}

/**
 * Validates and applies a complete Todo List submission from the model.
 *
 * Existing IDs must be preserved. The function prevents dependency cycles,
 * concurrent in-progress tasks, premature completion, and activation before
 * prerequisites were completed in a previous update.
 */
export function applyAgentTodoUpdate(
  current: AgentTodo[],
  rawItems: unknown,
  now = Date.now(),
): AgentTodo[] {
  if (!Array.isArray(rawItems)) throw new Error('Todo List harus berupa array.');
  if (rawItems.length === 0 || rawItems.length > MAX_TODOS) {
    throw new Error('Todo List harus berisi 1 sampai ' + MAX_TODOS + ' task.');
  }

  const currentById = new Map<string, AgentTodo>(current.map((todo): [string, AgentTodo] => [todo.id, todo]));
  const seen = new Set<string>();
  const normalized: AgentTodo[] = rawItems.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Task ke-' + (index + 1) + ' bukan objek yang valid.');
    }
    const item = raw as Record<string, unknown>;
    const id = text(item.id, 'ID task', 80, true);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('ID task hanya boleh berisi huruf, angka, garis bawah, dan tanda hubung.');
    if (seen.has(id)) throw new Error('ID task duplikat: ' + id + '.');
    seen.add(id);

    const title = text(item.title, 'Judul task', MAX_TITLE_LENGTH, true);
    const rawStatus = item.status;
    if (typeof rawStatus !== 'string' || !STATUSES.has(rawStatus as AgentTodoStatus)) {
      throw new Error('Status task ' + id + ' tidak valid.');
    }
    const status = rawStatus as AgentTodoStatus;
    const rawPriority = item.priority ?? currentById.get(id)?.priority ?? 'normal';
    if (typeof rawPriority !== 'string' || !PRIORITIES.has(rawPriority as AgentTodoPriority)) {
      throw new Error('Prioritas task ' + id + ' tidak valid.');
    }
    const priority = rawPriority as AgentTodoPriority;
    const blockedBy = stringArray(item.blockedBy ?? currentById.get(id)?.blockedBy, 'blockedBy pada task ' + id);
    if (blockedBy.includes(id)) throw new Error('Task tidak boleh bergantung pada dirinya sendiri: ' + id + '.');

    const verification = text(item.verification ?? currentById.get(id)?.verification, 'Kriteria verifikasi task', MAX_DETAIL_LENGTH);
    const rawBlockedReason = text(item.blockedReason ?? currentById.get(id)?.blockedReason, 'Alasan task terblokir', MAX_DETAIL_LENGTH);
    const existing = currentById.get(id);
    const completionEvidence = text(
      item.completionEvidence ?? existing?.completionEvidence,
      'Bukti penyelesaian task',
      MAX_DETAIL_LENGTH,
    );

    return {
      id,
      title,
      status,
      priority,
      blockedBy,
      verification,
      ...(status === 'blocked' && rawBlockedReason ? { blockedReason: rawBlockedReason } : {}),
      ...(completionEvidence ? { completionEvidence } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  });

  for (const existing of current) {
    if (!seen.has(existing.id)) {
      throw new Error('Todo List tidak boleh menghapus task yang sudah ada: ' + existing.title + '. Ubah statusnya, jangan hilangkan ID-nya.');
    }
  }

  const nextById = new Map<string, AgentTodo>(normalized.map((todo): [string, AgentTodo] => [todo.id, todo]));
  for (const todo of normalized) {
    for (const dependencyId of todo.blockedBy) {
      if (!nextById.has(dependencyId)) {
        throw new Error('Task ' + todo.id + ' bergantung pada ID yang tidak ada: ' + dependencyId + '.');
      }
    }
  }
  assertAcyclic(normalized);

  const active = normalized.filter((todo) => todo.status === 'in_progress');
  if (active.length > 1) throw new Error('Hanya satu task boleh berstatus in_progress agar agent mengerjakan urutan secara terkendali.');

  for (const todo of normalized) {
    const existing = currentById.get(todo.id);
    if (existing?.status === 'completed') {
      if (todo.status !== 'completed') throw new Error('Task yang sudah completed tidak boleh dibuka ulang lewat todo_write: ' + todo.title + '.');
      if (todo.title !== existing.title || todo.blockedBy.join('|') !== existing.blockedBy.join('|')) {
        throw new Error('Judul dan dependensi task completed tidak boleh diubah: ' + todo.title + '.');
      }
      if (todo.completionEvidence !== existing.completionEvidence) {
        throw new Error('Bukti task completed tidak boleh diubah: ' + todo.title + '.');
      }
    }

    if (!existing && todo.status === 'completed') {
      throw new Error('Task baru tidak boleh langsung completed: ' + todo.title + '. Kerjakan dan verifikasi terlebih dahulu.');
    }

    if (todo.status === 'blocked' && !todo.blockedReason) {
      throw new Error('Task blocked harus mempunyai blockedReason: ' + todo.title + '.');
    }

    if (todo.status === 'in_progress' && existing?.status !== 'in_progress') {
      for (const dependencyId of todo.blockedBy) {
        if (currentById.get(dependencyId)?.status !== 'completed') {
          throw new Error('Task ' + todo.title + ' belum boleh dimulai karena prasyarat ' + dependencyId + ' belum completed pada pembaruan sebelumnya.');
        }
      }
    }

    if (todo.status === 'completed' && existing?.status !== 'completed') {
      if (existing?.status !== 'in_progress') {
        throw new Error('Task hanya bisa menjadi completed setelah berstatus in_progress: ' + todo.title + '.');
      }
      if (todo.completionEvidence.length < 8) {
        throw new Error('Task completed memerlukan bukti verifikasi spesifik minimal 8 karakter: ' + todo.title + '.');
      }
      for (const dependencyId of todo.blockedBy) {
        if (currentById.get(dependencyId)?.status !== 'completed') {
          throw new Error('Task ' + todo.title + ' tidak boleh selesai sebelum prasyarat ' + dependencyId + ' completed.');
        }
      }
    }

    if (existing?.status === 'in_progress' && todo.status === 'pending') {
      throw new Error('Task yang sedang dikerjakan tidak boleh dikembalikan ke pending tanpa perencanaan ulang eksplisit: ' + todo.title + '.');
    }
  }

  return normalized;
}
