import { useEffect, useRef, useState } from 'react';
import type { IdeWorkbench } from './types';
import { IconTrash } from '../icons';

interface Props {
  wb: IdeWorkbench;
}

/** Panel Output: pemilih channel, isi log, tombol bersihkan. */
export function OutputPane({ wb }: Props) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const channel = wb.outputs.find((c) => c.id === channelId) ?? wb.outputs[0] ?? null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channel?.id, channel?.lines.length]);

  if (wb.outputs.length === 0) {
    return (
      <div className="ed-output">
        <div className="ed-empty">Belum ada channel output.</div>
      </div>
    );
  }

  return (
    <div className="ed-output">
      <div className="ed-output-toolbar">
        <select
          className="ed-select"
          value={channel?.id ?? ''}
          aria-label="Channel output"
          onChange={(e) => setChannelId(e.target.value)}
        >
          {wb.outputs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="ed-icon-btn"
          aria-label="Bersihkan output"
          title="Bersihkan"
          disabled={!channel}
          onClick={() => channel && wb.clearOutput(channel.id)}
        >
          <IconTrash size={14} />
        </button>
      </div>
      <div className="ed-output-scroll" ref={scrollRef}>
        {channel && channel.lines.length > 0 ? (
          channel.lines.map((line, i) => (
            <div key={i}>{line || '\u00a0'}</div>
          ))
        ) : (
          <div className="ed-empty-inline">Belum ada output.</div>
        )}
      </div>
    </div>
  );
}
