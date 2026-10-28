import type { IdeWorkbench } from './types';
import { IconX } from '../icons';
import { FileTypeIcon } from '../FileTypeIcon';

interface Props {
  wb: IdeWorkbench;
  reportActivity: () => void;
}

/** Baris tab file terbuka: dirty dot, tombol tutup, middle-click menutup. */
export function TabBar({ wb, reportActivity }: Props) {
  if (wb.openFiles.length === 0) {
    return <div className="ed-tabbar" aria-hidden="true" />;
  }

  return (
    <div className="ed-tabbar" role="tablist" aria-label="File terbuka">
      {wb.openFiles.map((file) => {
        const active = file.path === wb.activePath;
        return (
          <div
            key={file.path}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={file.path}
            className={`ed-tab${active ? ' active' : ''}`}
            onClick={() => {
              if (!active) {
                wb.activateFile(file.path);
                reportActivity();
              }
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                wb.closeFile(file.path);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !active) {
                wb.activateFile(file.path);
                reportActivity();
              }
            }}
          >
            <FileTypeIcon path={file.path} size="tab" />
            <span className="ed-tab-name">{file.name}</span>
            <button
              type="button"
              className={`ed-tab-close${file.dirty ? ' has-dirty' : ''}`}
              aria-label={`Tutup ${file.name}`}
              title="Tutup (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation();
                wb.closeFile(file.path);
              }}
              onAuxClick={(e) => e.stopPropagation()}
            >
              {file.dirty ? <span className="ed-dirty-dot" aria-label="Belum disimpan" /> : <IconX size={13} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
