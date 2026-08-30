/**
 * Fon vazifalari — taymerlar server tomonda ishlaydi (2.3, 9.2, 11.2).
 * Har daqiqada bir marta yuriladi; har vazifa alohida himoyalangan.
 */
import { processExpirations } from './requests';
import { autoConfirmStaleDeals, remindPendingConfirmations } from './deals';
import { processSubscriptions } from './clinics';
import { syncLinkedClinics } from './clinicSync';
import { purgeUsedTickets } from './clinicLink';

const TICK_MS = 60_000;

/**
 * banisa bilan sinxronizatsiya har daqiqada emas, 10 daqiqada.
 *
 * Yo'nalishlar kuniga bir necha marta o'zgaradi — har daqiqada
 * so'rash qo'shni xizmatni bekorga bezovta qilardi. 10 daqiqalik
 * kechikish esa hech kimga sezilmaydi.
 */
const BANISA_EVERY = 10;

let timer: NodeJS.Timeout | null = null;
let ticks = 0;

function safe<T>(name: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    console.error(`[scheduler] ${name} xatosi:`, err);
    return null;
  }
}

/**
 * Tarmoqqa chiqadigan vazifa — alohida, chunki u `async`.
 *
 * Xatosi yutiladi: banisa vaqtincha javob bermasa, KlinikaTop'ning
 * qolgan ishi to'xtamasligi kerak. Keyingi yugurishda o'zi
 * to'g'rilanadi — tortish usulining asosiy afzalligi shu.
 */
async function syncBanisa() {
  try {
    const r = await syncLinkedClinics();
    if (r.added || r.removed || r.suspended) {
      console.log(
        `[banisa] klinika: ${r.clinics}, qo'shildi: ${r.added}, ` +
          `olindi: ${r.removed}, to'xtatildi: ${r.suspended} (${r.durationMs} ms)`,
      );
    }
  } catch (err: any) {
    console.error('[banisa] sinxronizatsiya xatosi:', err?.message ?? err);
  }
}

export function tick() {
  const exp = safe('processExpirations', processExpirations);
  const subs = safe('processSubscriptions', processSubscriptions);
  const confirms = safe('remindPendingConfirmations', remindPendingConfirmations);
  // Javobsiz qolgan bitimlar — komissiya yo'qolib ketmasligi uchun
  const autoClosed = safe('autoConfirmStaleDeals', autoConfirmStaleDeals);

  // Ishlatilgan biletlar abadiy saqlanmasin
  safe('purgeUsedTickets', purgeUsedTickets);

  if (++ticks % BANISA_EVERY === 1) void syncBanisa();

  if (exp?.expired || exp?.warned || subs?.suspended || confirms || autoClosed) {
    console.log(
      `[scheduler] bekor: ${exp?.expired ?? 0}, ogohlantirildi: ${exp?.warned ?? 0}, ` +
        `obuna to'xtatildi: ${subs?.suspended ?? 0}, tasdiq eslatmasi: ${confirms ?? 0}, ` +
        `avto-yopildi: ${autoClosed ?? 0}`,
    );
  }
}

export function startScheduler() {
  if (timer) return;
  tick();
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  console.log(`[scheduler] ishga tushdi (har ${TICK_MS / 1000}s)`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
