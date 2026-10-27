// Setup Monaco untuk renderer Ruang Kerja.
//
// Worker dimuat sebagai aset relatif hasil bundling Vite (bukan CDN) supaya
// aplikasi tetap berjalan dari file:// di dalam Electron. Monaco 0.57 memakai
// export map `monaco-editor/*` -> `esm/vs/*`, jadi jalur import tidak boleh
// memakai prefix `esm/vs` lagi.
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker';
import {
  JsxEmit,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  javascriptDefaults,
  typescriptDefaults,
} from 'monaco-editor/languages/features/typescript/register';
import type { CompilerOptions } from 'monaco-editor/languages/features/typescript/register';
import { jsonDefaults } from 'monaco-editor/languages/features/json/register';
import { cssDefaults, lessDefaults, scssDefaults } from 'monaco-editor/languages/features/css/register';
import { registerBuiltinTheme } from './extensionRuntime';

/** Nama tema bawaan Ruang Kerja. */
export const DEFAULT_THEME = 'rk-dark';

type WorkerFactory = (workerId: string, label: string) => Worker;

// self.MonacoEnvironment tidak ada di typing Window, jadi dipasang lewat cast.
(self as unknown as { MonacoEnvironment?: { getWorker: WorkerFactory } }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      default:
        return new EditorWorker();
    }
  },
};

/** Ekstensi file -> language id Monaco. */
const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  php: 'php',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'csharp',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  xml: 'xml',
  svg: 'xml',
  vue: 'html',
  dockerfile: 'dockerfile',
};

/** Bahasa Monaco dari path absolut. */
export function languageForPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile';
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  return LANGUAGE_BY_EXT[lower.slice(dot + 1)] ?? 'plaintext';
}

/** Model Monaco per path. Model tidak ikut dibuang saat pane unmount. */
const models = new Map<string, monaco.editor.ITextModel>();
/** View state (scroll + kursor) per path, dipakai lagi saat file dibuka ulang. */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();

export function modelUri(path: string): monaco.Uri {
  return monaco.Uri.file(path);
}

/** Ambil/buat model untuk path. Model dipakai bersama antar pane. */
export function ensureModel(path: string, language: string, value: string): monaco.editor.ITextModel {
  const uri = modelUri(path);
  const cached = models.get(path);
  if (cached && !cached.isDisposed()) {
    if (cached.getLanguageId() !== language) monaco.editor.setModelLanguage(cached, language);
    return cached;
  }
  const existing = monaco.editor.getModel(uri);
  if (existing && !existing.isDisposed()) {
    if (existing.getLanguageId() !== language) monaco.editor.setModelLanguage(existing, language);
    models.set(path, existing);
    return existing;
  }
  const model = monaco.editor.createModel(value, language, uri);
  models.set(path, model);
  return model;
}

export function getViewState(path: string): monaco.editor.ICodeEditorViewState | null {
  return viewStates.get(path) ?? null;
}

export function setViewState(path: string, state: monaco.editor.ICodeEditorViewState | null): void {
  if (state) viewStates.set(path, state);
  else viewStates.delete(path);
}

/** Buang semua model + view state. Dipanggil saat project/root berganti. */
export function disposeModels(): void {
  for (const model of models.values()) {
    if (!model.isDisposed()) model.dispose();
  }
  models.clear();
  viewStates.clear();
}

function configureDefaults(): void {
  const compilerOptions: CompilerOptions & { allowNonTsExtensions?: boolean } = {
    target: ScriptTarget.ESNext,
    module: ModuleKind.ESNext,
    // NodeNext (99) belum ada di typing Monaco 0.57; nilai tetap diteruskan ke worker TS.
    moduleResolution: 99 as ModuleResolutionKind,
    jsx: JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    noEmit: true,
    strict: false,
    esModuleInterop: true,
    skipLibCheck: true,
  };
  typescriptDefaults.setCompilerOptions(compilerOptions);
  javascriptDefaults.setCompilerOptions(compilerOptions);
  // Validasi aktif: inilah sumber isi panel Problems.
  typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true });
  cssDefaults.setOptions({ validate: true });
  scssDefaults.setOptions({ validate: true });
  lessDefaults.setOptions({ validate: true });
  // HTML/Handlebars/Razor: validasi aktif secara bawaan, tidak perlu diubah.
}

configureDefaults();
registerBuiltinTheme();

export { monaco };
