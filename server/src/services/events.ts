/**
 * Realtime hodisa shinasi (bus).
 * Kanal nomlari: `user:<id>`, `request:<id>`, `deal:<id>`, `clinic:<id>`.
 * WebSocket serveri shu shinaga ulanadi (transport alohida).
 */
import { EventEmitter } from 'node:events';
import type { ServerEvent } from '../../../shared/types';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export type ChannelListener = (channel: string, event: ServerEvent) => void;

export const bus = {
  publish(channel: string, event: ServerEvent) {
    emitter.emit('event', channel, event);
  },
  /** Bir nechta kanalga bir xil hodisa. */
  publishAll(channels: string[], event: ServerEvent) {
    for (const c of new Set(channels)) emitter.emit('event', c, event);
  },
  onEvent(listener: ChannelListener) {
    emitter.on('event', listener);
    return () => emitter.off('event', listener);
  },
};

export const ch = {
  user: (id: number) => `user:${id}`,
  request: (id: number) => `request:${id}`,
  deal: (id: number) => `deal:${id}`,
  clinic: (id: number) => `clinic:${id}`,
};
