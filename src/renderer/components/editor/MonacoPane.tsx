// Pane editor Monaco: satu instance editor, model di-cache per path oleh
// `monaco.ts` (model tidak dibuang saat pane unmount, hanya saat project ganti).
import { useEffect, useRef } from 'react';
import type { CursorInfo, ProblemItem, RevealRequest } from './types';
import { ensureModel, getViewState, monaco, setViewState } from './monaco';

/** Glyph breakpoint. Inline karena styles.css tidak boleh disentuh lane ini. */
const BREAKPOINT_CSS = `
.rk-monaco .rk-monaco-breakpoint {
  background: #fb7185;
  border-radius: 50%;
  width: 9px;
  height: 9px;
  margin-left: 4px;
  box-shadow: 0 0 0 2px rgba(251, 113, 133, 0.22);
}
`;

function severityOf(value: monaco.MarkerSeverity): ProblemItem['severity'] {
  if (value === monaco.MarkerSeverity.Error) return 'error';
  if (value === monaco.MarkerSeverity.Warning) return 'warning';
  return 'info';
}

export function MonacoPane({
  path,
  value,
  language,
  theme,
  reveal,
  breakpoints,
  onChange,
  onSave,
  onCursor,
  onToggleBreakpoint,
  onMarkers,
}: {
  path: string;
  value: string;
  language: string;
  theme: string;
  reveal: RevealRequest | null;
  breakpoints: number[];
  onChange: (v: string) => void;
  onSave: () => void;
  onCursor: (c: CursorInfo) => void;
  onToggleBreakpoint: (line: number) => void;
  onMarkers: (problems: ProblemItem[]) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelPathRef = useRef<string | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const markerTimerRef = useRef<number | null>(null);
  const applyingExternalRef = useRef(false);

  // Handler & nilai terbaru selalu dibaca dari ref agar effect tidak perlu dipasang ulang.
  const latest = useRef({ path, value, language, reveal, breakpoints, onChange, onSave, onCursor, onToggleBreakpoint, onMarkers });
  latest.current = { path, value, language, reveal, breakpoints, onChange, onSave, onCursor, onToggleBreakpoint, onMarkers };

  const emitCursorRef = useRef<() => void>(() => undefined);
  const collectMarkersRef = useRef<() => void>(() => undefined);

  // ---- siklus hidup editor ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initial = latest.current;
    const editor = monaco.editor.create(host, {
      model: ensureModel(initial.path, initial.language, initial.value),
      theme,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, 'JetBrains Mono', 'Courier New', monospace",
      fontLigatures: true,
      lineHeight: 20,
      minimap: { enabled: false },
      lineNumbers: 'on',
      glyphMargin: true,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 10, bottom: 12 },
      automaticLayout: false,
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: 'active' },
      stickyScroll: { enabled: true },
      wordWrap: 'off',
      renderLineHighlight: 'all',
      lineNumbersMinChars: 4,
      lineDecorationsWidth: 8,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      overviewRulerBorder: false,
      fixedOverflowWidgets: true,
      contextmenu: true,
      multiCursorModifier: 'alt',
      unicodeHighlight: { ambiguousCharacters: false },
    });
    editorRef.current = editor;
    modelPathRef.current = initial.path;

    const disposables: Array<{ dispose(): void }> = [];
    disposables.push(editor.onDidChangeModelContent(() => {
      if (applyingExternalRef.current) return;
      const model = editor.getModel();
      if (!model) return;
      latest.current.onChange(model.getValue());
    }));
    disposables.push(editor.onDidChangeCursorPosition(() => emitCursorRef.current()));
    disposables.push(editor.onDidChangeCursorSelection(() => emitCursorRef.current()));
    disposables.push(editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = event.target.position?.lineNumber;
      if (line) latest.current.onToggleBreakpoint(line);
    }));

    editor.addAction({
      id: 'rk.save',
      label: 'Simpan File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => { latest.current.onSave(); },
    });
    editor.addAction({
      id: 'rk.toggleBreakpoint',
      label: 'Alihkan Breakpoint',
      keybindings: [monaco.KeyCode.F9],
      run: () => {
        const line = editor.getPosition()?.lineNumber;
        if (line) latest.current.onToggleBreakpoint(line);
      },
    });

    const markerSubscription = monaco.editor.onDidChangeMarkers(() => collectMarkersRef.current());
    disposables.push(markerSubscription);

    // Panel sering disembunyikan (display:none) -> jangan layout dengan ukuran 0.
    let frame = 0;
    const layout = () => {
      frame = 0;
      const element = hostRef.current;
      const current = editorRef.current;
      if (!element || !current) return;
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      current.layout({ width: element.clientWidth, height: element.clientHeight });
    };
    const scheduleLayout = () => {
      if (frame) return;
      frame = requestAnimationFrame(layout);
    };
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(host);
    window.addEventListener('resize', scheduleLayout);
    scheduleLayout();
    // Layout bisa terlambat (tab baru dibuka / panel berubah): coba ulang beberapa kali.
    const lateLayouts = [60, 250, 700].map((ms) => window.setTimeout(scheduleLayout, ms));

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleLayout);
      for (const timer of lateLayouts) window.clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
      const current = editorRef.current;
      if (current?.getModel()) setViewState(modelPathRef.current ?? initial.path, current.saveViewState());
      for (const disposable of disposables) disposable.dispose();
      if (markerTimerRef.current !== null) {
        window.clearTimeout(markerTimerRef.current);
        markerTimerRef.current = null;
      }
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // ---- kursor ----
  emitCursorRef.current = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (!editor || !model || !position) return;
    const selection = editor.getSelection();
    const selected = selection ? model.getValueInRange(selection).length : 0;
    latest.current.onCursor({ line: position.lineNumber, column: position.column, selected });
  };

  // ---- markers -> problems ----
  collectMarkersRef.current = () => {
    if (markerTimerRef.current !== null) window.clearTimeout(markerTimerRef.current);
    markerTimerRef.current = window.setTimeout(() => {
      markerTimerRef.current = null;
      const model = editorRef.current?.getModel();
      if (!model) return;
      const problems = monaco.editor.getModelMarkers({ resource: model.uri }).map<ProblemItem>((marker) => ({
        path: marker.resource.fsPath,
        line: marker.startLineNumber,
        column: marker.startColumn,
        severity: severityOf(marker.severity),
        message: marker.message,
        source: marker.source,
      }));
      latest.current.onMarkers(problems);
    }, 300);
  };

  // ---- ganti file ----
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || modelPathRef.current === path) return;
    const previous = editor.getModel();
    if (previous) setViewState(modelPathRef.current ?? path, editor.saveViewState());
    editor.setModel(ensureModel(path, latest.current.language, latest.current.value));
    modelPathRef.current = path;
    const view = getViewState(path);
    if (view) editor.restoreViewState(view);
    else editor.setPosition({ lineNumber: 1, column: 1 });
    collectMarkersRef.current();
  }, [path]);

  // ---- nilai dari luar (disk / realtime): hanya timpa bila berbeda ----
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || modelPathRef.current !== path) return;
    if (model.getValue() === value) return;
    const position = editor.getPosition();
    applyingExternalRef.current = true;
    try {
      // pushEditOperations mempertahankan undo stack, setValue tidak.
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null);
    } finally {
      applyingExternalRef.current = false;
    }
    if (position) editor.setPosition(position);
  }, [value, path]);

  // ---- bahasa ----
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model || modelPathRef.current !== path) return;
    if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
  }, [language, path]);

  // ---- tema ----
  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [theme]);

  // ---- reveal (klik hasil search / debug) ----
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !reveal || reveal.path !== path) return;
    const model = editor.getModel();
    if (!model) return;
    const line = Math.min(Math.max(1, reveal.line), model.getLineCount());
    const column = Math.min(Math.max(1, reveal.column), model.getLineMaxColumn(line));
    editor.setPosition({ lineNumber: line, column });
    editor.revealLineInCenter(line);
    editor.focus();
    emitCursorRef.current();
  }, [reveal?.token, reveal?.path, path]);

  // ---- breakpoint ----
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || modelPathRef.current !== path) return;
    const max = model.getLineCount();
    const decorations = breakpoints
      .filter((line) => line >= 1 && line <= max)
      .map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: 'rk-monaco-breakpoint',
          glyphMarginHoverMessage: { value: 'Breakpoint baris ' + line },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      }));
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
  }, [breakpoints, path]);

  return (
    <div
      className="rk-monaco"
      style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, width: '100%', height: '100%', background: '#0b0f17' }}
    >
      <style>{BREAKPOINT_CSS}</style>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
