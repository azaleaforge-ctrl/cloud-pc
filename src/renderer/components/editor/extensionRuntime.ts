// Menjalankan kontribusi ekstensi yang didukung: tema warna dan snippet
// (format VS Code JSON). Semua fungsi di sini defensif: file kontribusi yang
// rusak hanya diabaikan, tidak boleh menjatuhkan editor.
import * as monaco from 'monaco-editor';
import type { EditorSnippetContribution, EditorThemeContribution } from '../../../shared/editor';

interface RawSnippet {
  prefix?: string | string[];
  body?: string | string[];
  description?: string;
}

interface RawTokenColor {
  scope?: string | string[];
  settings?: { foreground?: string; fontStyle?: string };
}

interface RawTheme {
  colors?: Record<string, string>;
  tokenColors?: RawTokenColor[];
}

/** Provider snippet per id kontribusi, supaya bisa dipasang ulang tanpa duplikat. */
const snippetProviders = new Map<string, monaco.IDisposable[]>();

/** Warna UI yang aman dipakai ulang dari tema ekstensi. */
const SAFE_COLORS = [
  'editor.background',
  'editor.foreground',
  'editorLineNumber.foreground',
  'editorCursor.foreground',
  'editor.selectionBackground',
];

/** '#abc' / '#aabbcc' / '#aabbccdd' -> hex tanpa '#', atau null. */
function hexOf(value: string | undefined, allowAlpha: boolean): string | null {
  if (!value) return null;
  const raw = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3,8}$/i.test(raw)) return null;
  const full = raw.length === 3 || raw.length === 4
    ? raw.split('').map((char) => char + char).join('')
    : raw;
  if (allowAlpha) return full.length === 8 || full.length === 6 ? full : null;
  return full.length >= 6 ? full.slice(0, 6) : null;
}

/** Scope VS Code -> token Monaco: ambil scope pertama, buang prefix source./meta. */
function tokenOfScope(scope: string | string[] | undefined): string | null {
  const first = Array.isArray(scope) ? scope[0] : scope;
  const head = first?.split(',')[0]?.trim();
  if (!head) return null;
  const cleaned = head
    .replace(/^source\./, '')
    .replace(/^meta\./, '')
    .trim();
  if (!cleaned) return null;
  // Scope gabungan ("keyword.control.ts") tetap dipakai apa adanya; spasi berarti
  // selector turunan yang tidak bisa dipetakan ke token Monaco.
  return cleaned.split(/\s+/)[0] ?? null;
}

/** Daftarkan snippet ekstensi. Provider lama untuk id yang sama dibuang dulu. */
export async function registerExtensionSnippets(
  snippets: EditorSnippetContribution[],
  read: (path: string) => Promise<string>,
): Promise<void> {
  for (const contribution of snippets) {
    disposeSnippets(contribution.id);
    try {
      const parsed = JSON.parse(await read(contribution.file)) as Record<string, RawSnippet>;
      const language = contribution.language || 'plaintext';
      if (typeof parsed !== 'object' || parsed === null) continue;
      const provider = monaco.languages.registerCompletionItemProvider(language, {
        provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const suggestions: monaco.languages.CompletionItem[] = [];
          for (const [name, snippet] of Object.entries(parsed)) {
            const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
            if (!body) continue;
            const prefixes = Array.isArray(snippet.prefix)
              ? snippet.prefix
              : snippet.prefix
                ? [snippet.prefix]
                : [];
            for (const prefix of prefixes) {
              suggestions.push({
                label: prefix,
                kind: monaco.languages.CompletionItemKind.Snippet,
                detail: snippet.description ? `${name} — ${snippet.description}` : name,
                documentation: snippet.description,
                insertText: body,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              });
            }
          }
          return { suggestions };
        },
      });
      snippetProviders.set(contribution.id, [provider]);
    } catch {
      // Snippet tidak valid: lewati, ekstensi lain tetap aktif.
    }
  }
}

/** Buang provider snippet milik satu kontribusi. */
export function disposeSnippets(id: string): void {
  const providers = snippetProviders.get(id);
  if (!providers) return;
  for (const provider of providers) provider.dispose();
  snippetProviders.delete(id);
}

/** Buang semua provider snippet (dipakai saat ekstensi di-uninstall). */
export function disposeAllSnippets(): void {
  for (const id of Array.from(snippetProviders.keys())) disposeSnippets(id);
}

/** Ubah tema VS Code JSON menjadi tema Monaco. */
export async function applyExtensionTheme(
  theme: EditorThemeContribution,
  read: (path: string) => Promise<string>,
): Promise<void> {
  const parsed = JSON.parse(await read(theme.file)) as RawTheme;
  const rules: monaco.editor.ITokenThemeRule[] = [];
  for (const entry of parsed.tokenColors ?? []) {
    const token = tokenOfScope(entry.scope);
    if (!token) continue;
    const foreground = hexOf(entry.settings?.foreground, false);
    const fontStyle = entry.settings?.fontStyle?.trim();
    if (!foreground && !fontStyle) continue;
    rules.push({ token, foreground: foreground ?? undefined, fontStyle: fontStyle || undefined });
  }
  const colors: Record<string, string> = {};
  for (const key of SAFE_COLORS) {
    const value = hexOf(parsed.colors?.[key], true);
    if (value) colors[key] = '#' + value;
  }
  monaco.editor.defineTheme(theme.id, {
    base: theme.uiTheme === 'vs' ? 'vs' : 'vs-dark',
    inherit: true,
    rules,
    colors,
  });
}

/** Tema bawaan Ruang Kerja, selalu tersedia. */
export function registerBuiltinTheme(): void {
  monaco.editor.defineTheme('rk-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd7e0ea' },
      { token: 'comment', foreground: '5c6b7a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a78bfa' },
      { token: 'keyword.control', foreground: 'a78bfa' },
      { token: 'keyword.operator', foreground: '5eead4' },
      { token: 'operator', foreground: '5eead4' },
      { token: 'string', foreground: '86efac' },
      { token: 'string.escape', foreground: '2dd4bf' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'regexp', foreground: 'fcd34d' },
      { token: 'type', foreground: '7dd3fc' },
      { token: 'type.identifier', foreground: '7dd3fc' },
      { token: 'entity.name.type', foreground: '7dd3fc' },
      { token: 'function', foreground: '93c5fd' },
      { token: 'identifier', foreground: 'd7e0ea' },
      { token: 'variable', foreground: '5eead4' },
      { token: 'variable.parameter', foreground: 'd7e0ea' },
      { token: 'tag', foreground: 'f472b6' },
      { token: 'attribute.name', foreground: '2dd4bf' },
      { token: 'attribute.value', foreground: '86efac' },
      { token: 'delimiter', foreground: '93a4b8' },
      { token: 'invalid', foreground: 'fb7185' },
    ],
    colors: {
      'editor.background': '#0b0f17',
      'editor.foreground': '#d7e0ea',
      'editorLineNumber.foreground': '#4b5a6b',
      'editorLineNumber.activeForeground': '#93a4b8',
      'editor.lineHighlightBackground': '#111a26',
      'editor.selectionBackground': '#1d4ed84d',
      'editor.inactiveSelectionBackground': '#1d4ed826',
      'editorCursor.foreground': '#2dd4bf',
      'editorIndentGuide.background1': '#1b2430',
      'editorIndentGuide.activeBackground1': '#2dd4bf55',
      'editorWhitespace.foreground': '#2a3441',
      'editorBracketHighlight.foreground1': '#2dd4bf',
      'editorBracketHighlight.foreground2': '#a78bfa',
      'editorBracketHighlight.foreground3': '#fbbf24',
      'editorGutter.background': '#0b0f17',
      'editorStickyScroll.background': '#0b0f17',
      'editorWidget.background': '#0c111d',
      'editorWidget.border': '#1e293b',
      'editorSuggestWidget.background': '#0c111d',
      'editorSuggestWidget.selectedBackground': '#1d4ed833',
      'editorHoverWidget.background': '#0c111d',
      'editorHoverWidget.border': '#1e293b',
      'editorError.foreground': '#fb7185',
      'editorWarning.foreground': '#fbbf24',
      'editorInfo.foreground': '#2dd4bf',
      'scrollbarSlider.background': '#94a3b814',
      'scrollbarSlider.hoverBackground': '#94a3b826',
      'scrollbarSlider.activeBackground': '#2dd4bf55',
    },
  });
}
