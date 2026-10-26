import { EventEmitter } from 'node:events';
import type { AppState } from '../shared/types';

/** Store tunggal untuk state aplikasi; perubahan langsung dipush ke renderer. */
export class StateStore {
  private state: AppState;
  private emitter = new EventEmitter();

  constructor(initial: AppState) {
    this.state = { ...initial };
  }

  get(): AppState {
    return this.state;
  }

  patch(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    this.emitter.emit('change', this.state);
  }

  onChange(cb: (state: AppState) => void): () => void {
    this.emitter.on('change', cb);
    return () => this.emitter.off('change', cb);
  }
}
