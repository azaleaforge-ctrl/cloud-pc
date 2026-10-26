import { useEffect, useRef, useState } from 'react';
import { IconExternal, IconRefresh } from './icons';

/** Subset API elemen <webview> Electron yang dipakai. */
type RkWebview = HTMLElement & {
  loadURL(url: string): Promise<void>;
  reload(): void;
};

export function WebTab({ url }: { url: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const [currentUrl, setCurrentUrl] = useState(url);

  useEffect(() => {
    setCurrentUrl(url);
  }, [url]);

  useEffect(() => {
    const w = ref.current;
    if (!w) return;
    const onNavigate = (e: Event) => {
      const nav = e as Event & { url?: string };
      if (nav.url) setCurrentUrl(nav.url);
    };
    w.addEventListener('did-navigate', onNavigate);
    w.addEventListener('did-navigate-in-page', onNavigate);
    return () => {
      w.removeEventListener('did-navigate', onNavigate);
      w.removeEventListener('did-navigate-in-page', onNavigate);
    };
  }, []);

  const reload = () => {
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
        <span className="web-url" title={currentUrl}>
          {currentUrl}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={openExternal}
          aria-label="Buka di browser eksternal"
          title="Buka di browser eksternal"
        >
          <IconExternal size={16} />
        </button>
      </div>
      <webview ref={ref} src={url} className="web-frame" allowpopups={true} />
    </div>
  );
}
