/// <reference types="vite/client" />
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { RkApi } from '../shared/types';

// Elemen <webview> Electron (webviewTag aktif di proses main).
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string | undefined;
        allowpopups?: boolean | undefined;
        partition?: string | undefined;
        useragent?: string | undefined;
      };
    }
  }
}

declare global {
  interface Window {
    rk: RkApi;
  }
}

export {};
