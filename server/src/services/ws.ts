/**
 * WebSocket transporti (4-bo'lim).
 *
 * Klient kanallarga obuna bo'ladi; server har obunani EGALIK bo'yicha tekshiradi —
 * bemor faqat o'z so'rovini, klinika faqat o'z kanalini eshitadi (tibbiy maxfiylik).
 */
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../db';
import { config } from '../lib/config';
import { mapUser } from '../lib/mappers';
import { verifyInitData } from '../lib/telegram';
import { upsertUser } from '../middleware/auth';
import { personFor, resolveSession } from './webAuth';
import { bus, ch } from './events';
import type { ClientEvent, ServerEvent, User } from '../../../shared/types';

interface Client {
  socket: WebSocket;
  user: User;
  channels: Set<string>;
  alive: boolean;
}

const clients = new Set<Client>();

/**
 * Veb sessiya tokeni shu prefiks bilan `Sec-WebSocket-Protocol` da keladi.
 * Prefiks kerak: sarlavhada boshqa protokol nomlari ham bo'lishi mumkin.
 */
const TOKEN_PROTOCOL_PREFIX = 'klinikatop.web.';

/**
 * Soketni kim ochdi.
 *
 * IKKI yo'l bor, chunki platformada ikki xil sessiya bor:
 *
 *   bemor          → Telegram `initData` (manzil qatorida)
 *   veb kabinet     → sessiya tokeni (`Sec-WebSocket-Protocol` sarlavhasida)
 *
 * Ilgari faqat birinchisi qabul qilinardi. Natijada klinika kabineti va
 * admin paneli brauzerda soketni ocholmasdi: server uni 4401 bilan
 * yopar, mijoz esa qayta-qayta ulanishga urinardi. Ya'ni kabinetda
 * REAL VAQT umuman ishlamasdi — yangi so'rov, chat xabari va
 * bildirishnoma sahifani qo'lda yangilamaguncha ko'rinmasdi. Takliflar
 * kechikishining sabablaridan biri aynan shu edi.
 *
 * Token nega sarlavhada, manzilda emas: manzil qatori nginx kirish
 * jurnaliga to'liq yoziladi va sessiya tokeni o'sha yerda ochiq
 * qolardi. Brauzerning WebSocket API'si esa ixtiyoriy sarlavha
 * qo'shishga yo'l qo'ymaydi — yagona yo'l `Sec-WebSocket-Protocol`.
 */
function authenticateSocket(req: IncomingMessage): User | null {
  const offered = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const bearer = offered.find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX));
  if (bearer) {
    const session = resolveSession(bearer.slice(TOKEN_PROTOCOL_PREFIX.length));
    if (!session) return null;
    return personFor(session.user.id);
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const initData = url.searchParams.get('initData') ?? '';
  if (!initData || !config.telegram.botToken) return null;

  const res = verifyInitData(initData);
  return res.ok ? upsertUser(res.user) : null;
}

/** Kanalga obuna bo'lish huquqi. */
function canSubscribe(user: User, channel: string): boolean {
  const [kind, rawId] = channel.split(':');
  const id = Number(rawId);
  if (!Number.isFinite(id)) return false;

  switch (kind) {
    case 'user':
      return id === user.id;
    case 'clinic':
      return id === user.clinicId;
    case 'request': {
      const row = db.prepare(`SELECT patient_id FROM requests WHERE id = ?`).get(id) as
        | { patient_id: number }
        | undefined;
      return row?.patient_id === user.id;
    }
    case 'deal': {
      const row = db.prepare(`SELECT patient_id, clinic_id FROM deals WHERE id = ?`).get(id) as
        | { patient_id: number; clinic_id: number }
        | undefined;
      if (!row) return false;
      return row.patient_id === user.id || row.clinic_id === user.clinicId;
    }
    default:
      return false;
  }
}

function send(client: Client, event: ServerEvent) {
  if (client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(event));
  }
}

/** Ochiq soketlarni yopish uchun — `closeWebSocket()` shuni ishlatadi. */
let wssRef: WebSocketServer | null = null;

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    /*
     * Taklif qilingan protokolni qaytarib beramiz.
     *
     * Brauzer `Sec-WebSocket-Protocol` yuborsa, server javobida ham
     * o'shani kutadi — aks holda qo'l berishni O'ZI bekor qiladi va
     * ulanish tokendan qat'i nazar uzilardi.
     */
    handleProtocols: (protocols) => {
      for (const p of protocols) if (p.startsWith(TOKEN_PROTOCOL_PREFIX)) return p;
      return false;
    },
  });
  wssRef = wss;

  wss.on('connection', (socket, req) => {
    const user = authenticateSocket(req);
    if (!user || user.blockedAt) {
      socket.close(4401, 'unauthorized');
      return;
    }

    const client: Client = { socket, user, channels: new Set(), alive: true };
    clients.add(client);

    // Har foydalanuvchi o'z bildirishnoma kanaliga avtomatik ulanadi
    client.channels.add(ch.user(user.id));
    if (user.clinicId) client.channels.add(ch.clinic(user.clinicId));

    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('message', (raw) => {
      let msg: ClientEvent;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      switch (msg.type) {
        case 'subscribe':
          if (canSubscribe(user, msg.channel)) client.channels.add(msg.channel);
          break;
        case 'unsubscribe':
          client.channels.delete(msg.channel);
          break;
        case 'typing': {
          const channel = ch.deal(msg.dealId);
          if (!canSubscribe(user, channel)) break;
          for (const other of clients) {
            if (other !== client && other.channels.has(channel)) {
              send(other, { type: 'chat:typing', dealId: msg.dealId, userId: user.id });
            }
          }
          break;
        }
        case 'ping':
          send(client, { type: 'pong' });
          break;
      }
    });

    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });

  // Shina → soketlar
  bus.onEvent((channel, event) => {
    for (const client of clients) {
      if (client.channels.has(channel)) send(client, event);
    }
  });

  // O'lik ulanishlarni tozalash
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  return wss;
}

export const connectedCount = () => clients.size;

/**
 * Ochiq soketlarni yopish — server to'xtayotganda.
 *
 * Busiz `server.close()` hech qachon tugamasdi: u BARCHA ulanishlar
 * yopilishini kutadi, WebSocket esa o'zi yopilmaydi. Natijada har
 * qayta ishga tushirish 5 soniyalik taymerga borib, `exit(1)` bilan
 * tugardi — systemd buni nosozlik deb yozardi va ulangan brauzerlar
 * uzilishni "server yiqildi" deb ko'rardi.
 *
 * 1001 "going away" — brauzer buni kutilgan uzilish deb tushunadi va
 * darhol qayta ulanishga urinadi.
 */
export function closeWebSocket(): void {
  for (const client of clients) {
    try {
      client.socket.close(1001, 'server restarting');
    } catch {
      /* soket allaqachon yopilgan bo'lishi mumkin */
    }
  }
  clients.clear();
  wssRef?.close();
  wssRef = null;
}
