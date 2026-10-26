import { useEffect, useRef, useState } from 'react';
import { IconExternal, IconRefresh } from './icons';

/** Subset API elemen <webview> Electron yang dipakai. */
type RkWebview = HTMLElement & {
  loadURL(url: string): Promise<void>;
  reload(): void;
};
type WebviewFailure = Event & { errorCode?: number; errorDescription?: string; validatedURL?: string; isMainFrame?: boolean };

export function WebTab({ url }: { url: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentUrl(url);
    setLoadError(null);
    setLoading(true);
  }, [url]);

  useEffect(() => {
    const webview = ref.current;
    if (!webview) return;
    const onNavigate = (event: Event) => {
      const nav = event as Event & { url?: string };
      if (nav.url) setCurrentUrl(nav.url);
    };
    const onStart = () => { setLoading(true); setLoadError(null); };
    const onFinish = () => { setLoading(false); setLoadError(null); };
    const onFail = (event: Event) => {
      const failure = event as WebviewFailure;
      // Electron emits ERR_ABORTED (-3) during normal redirects/navigation.
      if (failure.errorCode === -3 || failure.isMainFrame === false) return;
      setLoading(false);
      setLoadError((failure.errorDescription || 'Tidak diketahui') +
        (failure.validatedURL ? ' — ' + failure.validatedURL : ''));
    };
    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    webview.addEventListener('did-start-loading', onStart);
    webview.addEventListener('did-stop-loading', onFinish);
    webview.addEventListener('did-finish-load', onFinish);
    webview.addEventListener('did-fail-load', onFail);
    return () => {
      webview.removeEventListener('did-navigate', onNavigate);
      webview.removeEventListener('did-navigate-in-page', onNavigate);
      webview.removeEventListener('did-start-loading', onStart);
      webview.removeEventListener('did-stop-loading', onFinish);
      webview.removeEventListener('did-finish-load', onFinish);
      webview.removeEventListener('did-fail-load', onFail);
    };
  }, []);

  const reload = () => {
    setLoadError(null);
    setLoading(true);
    (ref.current as RkWebview | null)?.reload();
  };

  const openExternal = () => {
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="tab-web">
      <div className="web-toolbar">
        <button type="button" className="icon-btn" onClick={reload} aria-label="Muat ulang" title="Muat ulang">
          <IconRefresh size={16} />
        </button>
        <span className="web-url" title={currentUrl}>{currentUrl}</span>
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
      <webview ref={ref} src={url} className="web-frame" allowpopups={true} />
    </div>
  );
}