import { useEffect, useRef, useState, useCallback } from 'react';
import { IconExternal, IconRefresh, IconSearch, IconEdit, IconChevronLeft, IconChevronRight } from './icons';
import { normalizeWebNavigationUrl } from '../../shared/webNavigation';

/** Subset API elemen <webview> Electron yang dipakai. */
type RkWebview = HTMLElement & {
  loadURL(url: string): Promise<void>;
  reload(): void;
  goBack(): void;
  goForward(): void;
};
type WebviewNavigate = Event & { url?: string };
type WebviewFailure = Event & { errorCode?: number; errorDescription?: string; validatedURL?: string; isMainFrame?: boolean };

interface WebTabProps {
  url: string;
  projectPath: string | null;
  onUrlChange: (url: string) => void;
}

function detectProjectUrl(projectPath: string | null): string | null {
  if (!projectPath) return null;
  // This is a placeholder - actual detection would need main process access
  // For now, return common defaults based on framework
  return null;
}

export function WebTab({ url, projectPath, onUrlChange }: WebTabProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setCurrentUrl(url);
    setInputUrl(url);
    setLoadError(null);
    setLoading(true);
    setEditing(false);
  }, [url]);

  const navigate = useCallback((targetUrl: string) => {
    const normalized = normalizeWebNavigationUrl(targetUrl);
    if (!normalized) {
      setLoadError('URL ditolak. Gunakan alamat HTTP/HTTPS yang valid tanpa kredensial tertanam.');
      return;
    }
    setInputUrl(normalized);
    setCurrentUrl(normalized);
    setLoadError(null);
    setLoading(true);
    setEditing(false);
    onUrlChange(normalized);
    (ref.current as RkWebview | null)?.loadURL(normalized);
  }, [onUrlChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      navigate(e.currentTarget.value);
    } else if (e.key === 'Escape') {
      setInputUrl(currentUrl);
      setEditing(false);
    }
  };

  useEffect(() => {
    const webview = ref.current;
    if (!webview) return;
    const onWillNavigate = (event: Event) => {
      const navigation = event as WebviewNavigate;
      if (!normalizeWebNavigationUrl(navigation.url ?? '')) {
        event.preventDefault();
        setLoading(false);
        setLoadError('Navigasi diblokir: browser hanya mengizinkan URL HTTP/HTTPS.');
      }
    };
    const onNavigate = (event: Event) => {
      const nav = event as WebviewNavigate;
      const normalized = normalizeWebNavigationUrl(nav.url ?? '');
      if (normalized) {
        setCurrentUrl(normalized);
        setInputUrl(normalized);
        onUrlChange(normalized);
      }
    };
    const onStart = () => { setLoading(true); setLoadError(null); };
    const onFinish = () => { setLoading(false); setLoadError(null); };
    const onFail = (event: Event) => {
      const failure = event as WebviewFailure;
      if (failure.errorCode === -3 || failure.isMainFrame === false) return;
      setLoading(false);
      setLoadError((failure.errorDescription || 'Tidak diketahui') +
        (failure.validatedURL ? ' — ' + failure.validatedURL : ''));
    };
    webview.addEventListener('will-navigate', onWillNavigate);
    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    webview.addEventListener('did-start-loading', onStart);
    webview.addEventListener('did-stop-loading', onFinish);
    webview.addEventListener('did-finish-load', onFinish);
    webview.addEventListener('did-fail-load', onFail);
    return () => {
      webview.removeEventListener('will-navigate', onWillNavigate);
      webview.removeEventListener('did-navigate', onNavigate);
      webview.removeEventListener('did-navigate-in-page', onNavigate);
      webview.removeEventListener('did-start-loading', onStart);
      webview.removeEventListener('did-stop-loading', onFinish);
      webview.removeEventListener('did-finish-load', onFinish);
      webview.removeEventListener('did-fail-load', onFail);
    };
  }, [onUrlChange]);

  const reload = () => {
    setLoadError(null);
    setLoading(true);
    (ref.current as RkWebview | null)?.reload();
  };

  const goBack = () => {
    (ref.current as RkWebview | null)?.goBack();
  };

  const goForward = () => {
    (ref.current as RkWebview | null)?.goForward();
  };

  const openExternal = () => {
    const safeUrl = normalizeWebNavigationUrl(currentUrl);
    if (!safeUrl) {
      setLoadError('URL tidak dapat dibuka di browser eksternal karena skemanya tidak didukung.');
      return;
    }
    window.open(safeUrl, '_blank', 'noopener');
  };

  const startEdit = () => {
    setEditing(true);
    setTimeout(() => {
      const input = document.querySelector('.web-url-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 0);
  };

  return (
    <div className="tab-web">
      <div className="web-toolbar">
        <button type="button" className="icon-btn" onClick={goBack} aria-label="Kembali" title="Kembali">
          <IconChevronLeft size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={goForward} aria-label="Maju" title="Maju">
          <IconChevronRight size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={reload} aria-label="Muat ulang" title="Muat ulang">
          <IconRefresh size={16} />
        </button>
        {editing ? (
          <input
            type="text"
            className="web-url-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setEditing(false)}
            placeholder="Masukkan URL (http://...)"
            autoComplete="off"
          />
        ) : (
          <span className="web-url" title={currentUrl} onClick={startEdit}>{currentUrl}</span>
        )}
        {editing && (
          <button type="button" className="icon-btn" onClick={() => navigate(inputUrl)} aria-label="Buka URL" title="Buka">
            <IconSearch size={16} />
          </button>
        )}
        {loading ? <span className="web-loading-status">Memuat…</span> : null}
        <button type="button" className="icon-btn" onClick={openExternal} aria-label="Buka di browser eksternal" title="Buka di browser eksternal">
          <IconExternal size={16} />
        </button>
      </div>
      {loadError ? (
        <div className="web-load-error" role="alert">
          <strong>Website tidak berhasil dimuat di Ruang Kerja.</strong>
          <span>{loadError}</span>
          <span>Pastikan server merespons HTTP, kemudian coba Muat Ulang atau buka di browser eksternal.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={openExternal}>Buka di browser</button>
        </div>
      ) : null}
      <webview ref={ref} src={currentUrl} className="web-frame" />
    </div>
  );
}