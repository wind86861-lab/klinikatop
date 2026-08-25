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
import { bus, ch } from './events';
import type { ClientEvent, ServerEvent, User } from '../../../shared/types';

interface Client {
  socket: WebSocket;
  user: User;
  channels: Set<string>;
  alive: boolean;
}

const clients = new Set<Client>();

function authenticateSocket(req: IncomingMessage): User | null {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // HTTP bilan bir xil qoida: faqat imzolangan initData. Imzosiz yo'l yo'q.
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

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

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
