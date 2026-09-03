/**
 * WebSocket ulanishi — bitta soket, ko'p kanal.
 * Uzilganda avtomatik qayta ulanadi va obunalarni tiklaydi.
 */
import { tg } from './telegram';
import { isCabinetPath, webToken } from './session';
import type { ClientEvent, ServerEvent } from '@shared/types';

type Listener = (event: ServerEvent) => void;

const listeners = new Set<Listener>();
const channels = new Set<string>();

let socket: WebSocket | null = null;
let retry = 0;
let reconnectTimer: number | null = null;
let intentionallyClosed = false;

function wsUrl(): string {
  const base = import.meta.env.VITE_API_URL as string | undefined;
  const origin = base ? new URL(base) : new URL(window.location.origin);
  const protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  if (!isCabinetPath(window.location.pathname) && tg?.initData) params.set('initData', tg.initData);
  return `${protocol}//${origin.host}/ws?${params}`;
}

/**
 * Kabinet sessiyasi soketga QANDAY beriladi.
 *
 * Brauzerning WebSocket API'si ixtiyoriy sarlavha qo'shishga yo'l
 * qo'ymaydi — yagona yo'l ikkinchi argument, ya'ni "subprotokol".
 * Token manzil qatoriga qo'yilmaydi: u nginx kirish jurnaliga
 * to'liq tushardi.
 *
 * Bemor ilovasida token yo'q — u `initData` bilan ulanadi.
 */
function wsProtocols(): string[] | undefined {
  if (!isCabinetPath(window.location.pathname)) return undefined;
  const token = webToken();
  return token ? [`klinikatop.web.${token}`] : undefined;
}

function send(msg: ClientEvent) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function connectWs() {
  intentionallyClosed = false;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  socket = new WebSocket(wsUrl(), wsProtocols());

  socket.onopen = () => {
    retry = 0;
    // Uzilishdan keyin obunalarni tiklaymiz
    for (const channel of channels) send({ type: 'subscribe', channel });
  };

  socket.onmessage = (e) => {
    let event: ServerEvent;
    try {
      event = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const listener of listeners) listener(event);
  };

  socket.onclose = () => {
    socket = null;
    if (intentionallyClosed) return;
    // Eksponensial kechikish, 15 soniyagacha
    const delay = Math.min(15_000, 800 * 2 ** retry++);
    reconnectTimer = window.setTimeout(connectWs, delay);
  };

  socket.onerror = () => socket?.close();
}

export function disconnectWs() {
  intentionallyClosed = true;
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}

/** Kanalga obuna. Qaytgan funksiya obunani bekor qiladi. */
export function subscribe(channel: string): () => void {
  channels.add(channel);
  send({ type: 'subscribe', channel });
  return () => {
    channels.delete(channel);
    send({ type: 'unsubscribe', channel });
  };
}

export function onServerEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sendTyping(dealId: number) {
  send({ type: 'typing', dealId });
}

export const channelFor = {
  user: (id: number) => `user:${id}`,
  request: (id: number) => `request:${id}`,
  deal: (id: number) => `deal:${id}`,
  clinic: (id: number) => `clinic:${id}`,
};
