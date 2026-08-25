/**
 * Fon vazifalari — taymerlar server tomonda ishlaydi (2.3, 9.2, 11.2).
 * Har daqiqada bir marta yuriladi; har vazifa alohida himoyalangan.
 */
import { processExpirations } from './requests';
import { autoConfirmStaleDeals, remindPendingConfirmations } from './deals';
import { processSubscriptions } from './clinics';

const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

function safe<T>(name: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    console.error(`[scheduler] ${name} xatosi:`, err);
    return null;
  }
}

export function tick() {
  const exp = safe('processExpirations', processExpirations);
  const subs = safe('processSubscriptions', processSubscriptions);
  const confirms = safe('remindPendingConfirmations', remindPendingConfirmations);
  // Javobsiz qolgan bitimlar — komissiya yo'qolib ketmasligi uchun
  const autoClosed = safe('autoConfirmStaleDeals', autoConfirmStaleDeals);

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
