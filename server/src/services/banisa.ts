/**
 * banisa.uz Partner API mijozi.
 *
 * ═══ Nima uchun HTTP, baza emas ═══
 *
 * Ilgari katalog banisa'ning Postgres'idan to'g'ridan-to'g'ri
 * o'qilardi. U ishlardi, lekin uch kamchiligi bor edi: banisa
 * sxemasi o'zgarsa bu yer sinardi, ikkala xizmat bir mashinada
 * turishga majbur edi, va bazaga kirish huquqi kerak edi.
 *
 * Partner API bularning uchalasini ham hal qiladi va u banisa
 * tomonida ataylab shu maqsad uchun yozilgan.
 *
 * ═══ Chegaralar ═══
 *
 * Har so'rovga vaqt chegarasi bor: banisa sekinlashsa KlinikaTop
 * u bilan birga to'xtab qolmasligi kerak. Klinika ro'yxati bo'lakka
 * bo'lib so'raladi — bir so'rovda 200 tadan ko'p yuborilmaydi
 * (spetsifikatsiyadagi chegara).
 */
import { config } from '../lib/config';
import { badRequest } from '../lib/errors';

const TIMEOUT_MS = 15_000;
/** Bir so'rovdagi klinikalar soni — banisa tomonidagi chegara */
const BATCH = 100;

export interface BanisaCategory {
  id: string;
  nameUz: string;
  nameRu: string | null;
  nameEn: string | null;
  slug: string | null;
  parentId: string | null;
  sortOrder: number | null;
  /** Daraxtdagi chuqurlik: 0 — xizmat turi, 1 — soha, 2 — bo'lim */
  level: number;
}

export interface BanisaOperation {
  id: string;
  nameUz: string;
  nameRu: string | null;
  nameEn: string | null;
  categoryId: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface BanisaClinic {
  id: string;
  nameUz: string;
  nameRu: string | null;
  region: string | null;
  addressUz: string | null;
  addressRu: string | null;
  phones: string[];
  logo: string | null;
  status: string;
  licenseNumber: string | null;
  licenseExpiresAt: string | null;
}

export interface BanisaClinicOperation {
  clinicId: string;
  operationId: string;
  isActive: boolean;
}

export function banisaConfigured(): boolean {
  return Boolean(config.banisa.url && config.banisa.partnerKey);
}

async function get<T>(path: string): Promise<T> {
  if (!banisaConfigured()) {
    throw badRequest('banisa_not_configured', 'banisa ulanishi sozlanmagan');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${config.banisa.url}/api/partner${path}`, {
      signal: controller.signal,
      headers: {
        // Kalit sarlavhada — manzil satri jurnalga tushadi
        'x-api-key': config.banisa.partnerKey,
        accept: 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`banisa ${res.status}: ${body.slice(0, 200)}`);
    }

    return (await res.json()) as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('banisa javob bermadi (vaqt tugadi)');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Operatsiyalar katalogi — sohalar bilan birga. */
export function fetchCatalog(): Promise<{
  categories: BanisaCategory[];
  operations: BanisaOperation[];
}> {
  return get('/operations');
}

/**
 * Klinika profillari.
 *
 * `ids` majburiy — banisa uni talab qiladi va bu to'g'ri: aks holda
 * bir so'rovda butun baza chiqib ketardi.
 */
export async function fetchClinics(ids: string[]): Promise<BanisaClinic[]> {
  const out: BanisaClinic[] = [];

  for (const chunk of batches(ids)) {
    const data = await get<{ clinics: BanisaClinic[] }>(
      `/clinics?ids=${chunk.map(encodeURIComponent).join(',')}`,
    );
    out.push(...(data.clinics ?? []));
  }

  return out;
}

/** Klinika ↔ operatsiya bog'lanishlari. */
export async function fetchClinicOperations(ids: string[]): Promise<BanisaClinicOperation[]> {
  const out: BanisaClinicOperation[] = [];

  for (const chunk of batches(ids)) {
    const data = await get<{ links: BanisaClinicOperation[] }>(
      `/clinic-operations?clinicIds=${chunk.map(encodeURIComponent).join(',')}`,
    );
    out.push(...(data.links ?? []));
  }

  return out;
}

function* batches(ids: string[]): Generator<string[]> {
  for (let i = 0; i < ids.length; i += BATCH) yield ids.slice(i, i + BATCH);
}

/**
 * Telefonlarni tozalaydi.
 *
 * banisa'da takrorlar bor — haqiqiy ma'lumotda bir klinikaning
 * raqami uch marta yozilgan. Bo'shliq va chiziqchalar ham har xil.
 */
export function cleanPhones(phones: unknown): string[] {
  if (!Array.isArray(phones)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of phones) {
    if (typeof raw !== 'string') continue;
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 9 || seen.has(digits)) continue;
    seen.add(digits);
    out.push(raw.trim());
  }

  return out;
}

/**
 * Manzildan hudud prefiksini olib tashlaydi.
 *
 * banisa'da manzil "tashkent_city, olmazor, Beltepa 1A" shaklida
 * saqlanadi — birinchi bo'lak hudud kaliti va u bemorga ko'rsatiladigan
 * matnda keraksiz.
 */
export function cleanAddress(address: string | null, region: string | null): string {
  let value = (address ?? '').trim();
  if (!value) return '';

  const prefix = (region ?? '').trim();
  if (prefix && value.toLowerCase().startsWith(prefix.toLowerCase())) {
    value = value.slice(prefix.length).replace(/^[\s,]+/, '');
  }

  // Bo'sh bo'laklar: "olmazor, , Forobiy" → "olmazor, Forobiy"
  return value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ');
}
