/**
 * Fon vazifalari — taymerlar server tomonda ishlaydi (2.3, 9.2, 11.2).
 * Har daqiqada bir marta yuriladi; har vazifa alohida himoyalangan.
 */
import { processExpirations } from './requests';
import { autoConfirmStaleDeals, remindPendingConfirmations } from './deals';
import { processSubscriptions } from './clinics';
import { syncLinkedClinics } from './clinicSync';
import { runSync as runCatalogSync } from './catalogSync';
import { purgeUsedTickets } from './clinicLink';
import { purgePatientAuth } from './patientAuth';

const TICK_MS = 60_000;

/**
 * banisa bilan sinxronizatsiya — ALOHIDA taymerda.
 *
 * U `tick()` ichida emas, chunki `tick()` mahalliy vazifalar uchun:
 * u sinxron, bazadan nariga chiqmaydi va testlar uni to'g'ridan-to'g'ri
 * chaqiradi. Tarmoq so'rovini o'sha yerga qo'shish testlarni qo'shni
 * xizmatga bog'lab qo'yardi va ular tarmoqsiz muhitda yiqilardi.
 *
 * 10 daqiqa: katalog ham, yo'nalishlar ham kuniga bir necha marta
 * o'zgaradi. Har daqiqada so'rash banisa'ni bekorga bezovta qilardi,
 * 10 daqiqalik kechikish esa hech kimga sezilmaydi.
 */
const BANISA_MS = 10 * 60_000;

let timer: NodeJS.Timeout | null = null;
let banisaTimer: NodeJS.Timeout | null = null;

function safe<T>(name: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    console.error(`[scheduler] ${name} xatosi:`, err);
    return null;
  }
}

/**
 * banisa bilan sinxronizatsiya — alohida, chunki u `async`.
 *
 * ═══ Tartib muhim ═══
 *
 * Avval KATALOG, keyin klinika yo'nalishlari. Aks holda zanjir
 * birinchi bo'g'inda uziladi: banisa'da yangi operatsiya qo'shilsa
 * va klinika uni darhol yoqsa, bizda o'sha operatsiya hali yo'q —
 * bog'lanish "noma'lum" deb tashlab yuboriladi va klinika nima uchun
 * ko'rinmayotganini tushunmaydi.
 *
 * ═══ Xato yutiladi ═══
 *
 * banisa vaqtincha javob bermasa, KlinikaTop'ning qolgan ishi
 * to'xtamasligi kerak. Keyingi yugurishda o'zi to'g'rilanadi —
 * tortish usulining asosiy afzalligi shu.
 */
async function syncBanisa() {
  try {
    const cat = await runCatalogSync(null);
    if (cat.added || cat.updated || cat.deactivated) {
      console.log(
        `[banisa] katalog — yangi: ${cat.added}, yangilandi: ${cat.updated}, ` +
          `yashirildi: ${cat.deactivated} (${cat.durationMs} ms)`,
      );
    }
  } catch (err: any) {
    console.error('[banisa] katalog xatosi:', err?.message ?? err);
  }

  try {
    const r = await syncLinkedClinics();
    if (r.added || r.removed || r.suspended) {
      console.log(
        `[banisa] klinika: ${r.clinics}, qo'shildi: ${r.added}, ` +
          `olindi: ${r.removed}, to'xtatildi: ${r.suspended} (${r.durationMs} ms)`,
      );
    }
  } catch (err: any) {
    console.error('[banisa] klinika sinxronizatsiyasi xatosi:', err?.message ?? err);
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
  // Eskirgan bemor sessiyalari va ishlatilgan kodlar
  safe('purgePatientAuth', purgePatientAuth);

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

  /*
   * banisa alohida taymerda. Birinchi yugurish darhol emas, biroz
   * kechikib boshlanadi: server endi ko'tarilgan va ulanishlar hali
   * tayyor bo'lmasligi mumkin.
   */
  setTimeout(() => void syncBanisa(), 5_000).unref();
  banisaTimer = setInterval(() => void syncBanisa(), BANISA_MS);
  banisaTimer.unref();

  console.log(
    `[scheduler] ishga tushdi (har ${TICK_MS / 1000}s, banisa har ${BANISA_MS / 60_000} daq)`,
  );
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  // banisa taymeri ham to'xtasin — aks holda `startScheduler` qayta
  // chaqirilganda ikkinchi nusxa qo'shilib, sinxronizatsiya ikki
  // barobar tez-tez ketardi
  if (banisaTimer) clearInterval(banisaTimer);
  banisaTimer = null;
}
