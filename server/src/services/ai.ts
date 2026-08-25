/**
 * AI operatsiya aniqlash (3-bo'lim).
 *
 * Bemor "o't pufagimda tosh bor" deydi — "laparoskopik xoletsistektomiya" demaydi.
 * Vazifa: erkin matndan operatsiya KATEGORIYASINI taklif qilish.
 *
 * Xavfsizlik qoidalari (majburiy):
 *  1. AI TASHXIS QO'YMAYDI — faqat "ehtimoliy yo'nalish" deydi.
 *  2. Har javobda ogohlantirish: yakuniy so'zni shifokor aytadi.
 *  3. Bemor tasdiqlamaguncha so'rovga o'tilmaydi (bu qoida route darajasida).
 *  4. Hech narsa aniqlanmasa — katalog + shifokorga murojaat tavsiyasi.
 *
 * Manba: Claude API (mavjud bo'lsa) yoki lokal kalit so'z heuristikasi.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../lib/config';
import { normalize } from '../lib/format';
import { listOperations } from './catalog';
import type { AiResult, AiSuggestion, Lang, Operation } from '../../../shared/types';

export const DISCLAIMER: Record<Lang, string> = {
  uz: 'Bu — taxminiy yo‘nalish, tashxis emas. Yakuniy so‘zni shifokor aytadi.',
  ru: 'Это предположительное направление, а не диагноз. Окончательное слово за врачом.',
};

const client = config.ai.apiKey ? new Anthropic({ apiKey: config.ai.apiKey }) : null;

export const aiEnabled = () => client !== null;

/* ─────────────────────────  Lokal heuristika (fallback)  ───────────────────────── */

/**
 * Kalit so'zlar bo'yicha ball. API kaliti bo'lmasa yoki AI ishlamasa ishlaydi —
 * platforma AI'siz ham to'liq funksional bo'lib qoladi.
 */
export function heuristicSuggest(text: string, limit = 3): AiSuggestion[] {
  const q = normalize(text);
  if (q.length < 3) return [];
  const words = q.split(/[^\p{L}\p{N}']+/u).filter((w) => w.length >= 3);

  const scored = listOperations().map((op) => {
    let score = 0;
    for (const kw of op.keywords) {
      const k = normalize(kw);
      if (!k) continue;
      if (q.includes(k)) score += k.includes(' ') ? 6 : 4;
      else if (words.some((w) => k.startsWith(w) || w.startsWith(k))) score += 2;
    }
    for (const field of [op.aliasUz, op.aliasRu, op.nameUz, op.nameRu]) {
      const f = normalize(field);
      if (f && q.includes(f)) score += 8;
    }
    for (const w of words) {
      if (normalize(op.descUz).includes(w) || normalize(op.descRu).includes(w)) score += 1;
    }
    return { op, score };
  });

  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  if (!hits.length) return [];

  const top = hits[0].score;
  return hits.map(({ op, score }) => ({
    operationId: op.id,
    operationName: op.nameUz,
    // Ballni 0..1 ga keltirish; bitta kuchsiz moslik ishonchni oshirmasin
    confidence: Math.min(0.85, Math.round((score / Math.max(top, 10)) * 100) / 100),
    reason: `Siz yozgan tavsif "${op.aliasUz}" yo‘nalishiga mos keladi.`,
  }));
}

/* ─────────────────────────  Claude API  ───────────────────────── */

const SuggestionSchema = z.object({
  operation_slug: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(400),
});

const ResultSchema = z.object({
  understood: z.boolean(),
  suggestions: z.array(SuggestionSchema).max(3),
  followup_question: z.string().max(300).nullable().optional(),
});

/** Model faqat katalogdagi slug'ni qaytarsin — yopiq ro'yxat eng ishonchli usul. */
function buildOutputSchema(operations: Operation[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['understood', 'suggestions'],
    properties: {
      understood: {
        type: 'boolean',
        description: 'Matndan tibbiy ehtiyojni aniqlab bo‘ldimi',
      },
      suggestions: {
        type: 'array',
        maxItems: 3,
        description: 'Eng mos operatsiyalar, ishonch bo‘yicha kamayish tartibida',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['operation_slug', 'confidence', 'reason'],
          properties: {
            operation_slug: { type: 'string', enum: operations.map((o) => o.slug) },
            confidence: { type: 'number', description: '0 dan 1 gacha ishonch darajasi' },
            reason: {
              type: 'string',
              description:
                'Bemorga tushunarli, 1–2 jumlalik izoh. Tashxis emas — nega shu yo‘nalish mos kelishi.',
            },
          },
        },
      },
      followup_question: {
        type: ['string', 'null'],
        description: 'Ishonch past bo‘lsa — aniqlashtiruvchi bitta savol, aks holda null',
      },
    },
  } as const;
}

function systemPrompt(lang: Lang, operations: Operation[]): string {
  const catalog = operations
    .map((o) => `- ${o.slug}: ${o.nameUz} (${o.aliasUz}) | ${o.nameRu} | kalit: ${o.keywords.join(', ')}`)
    .join('\n');

  return `Sen "KlinikaTop" platformasining yordamchisisan. Bemorlar o'z shikoyatini oddiy tilda yozadi; sening vazifang — ular qaysi operatsiya yo'nalishiga murojaat qilishi mumkinligini TAXMIN qilish.

Qat'iy chegaralar:
- Sen tashxis qo'ymaysan va davolash tayinlamaysan. Faqat mos operatsiya kategoriyasini taklif qilasan.
- "Sizda ... kasalligi bor" deb yozma. "Bu tavsif ... yo'nalishiga mos kelishi mumkin" tarzida yoz.
- Faqat quyidagi katalogdan slug tanla. Katalogda yo'q narsani o'ylab topma.
- Shikoyat noaniq bo'lsa yoki katalogga mos kelmasa: understood=false, suggestions=[] va followup_question ber.
- Shoshilinch xavf belgilari (kuchli qorin og'rig'i, ko'krak og'rig'i, qon ketish, nafas qisilishi) sezilsa — reason ichida darhol shifokorga murojaat qilish kerakligini bir jumla bilan ayt.
- Izohlarni ${lang === 'ru' ? 'rus tilida' : "o'zbek tilida"} yoz. Qisqa va sodda — bemor tibbiy atamalarni bilmaydi.

Katalog:
${catalog}`;
}

export interface AiStreamHandlers {
  /** Model javob yozayotgani haqida signal — UI shimmer/progress uchun. */
  onProgress?: (charsSoFar: number) => void;
}

/**
 * Erkin matndan operatsiya taklifi.
 * Streaming ishlatiladi: uzoq kutishda HTTP timeout bo'lmasin va UI jonli ko'rinsin.
 */
export async function suggestOperations(
  text: string,
  lang: Lang = 'uz',
  handlers: AiStreamHandlers = {},
): Promise<AiResult> {
  const trimmed = (text ?? '').trim();
  const operations = listOperations();

  const fallback = (): AiResult => {
    const suggestions = heuristicSuggest(trimmed);
    return {
      suggestions,
      disclaimer: DISCLAIMER[lang],
      fallbackToCatalog: suggestions.length === 0,
    };
  };

  if (!client || trimmed.length < 3) return fallback();

  try {
    const stream = client.messages.stream({
      model: config.ai.model,
      max_tokens: 2048,
      system: systemPrompt(lang, operations),
      // Sodda tasniflash vazifasi — past effort yetarli va tez javob beradi
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: buildOutputSchema(operations) },
      },
      messages: [{ role: 'user', content: trimmed }],
    } as Anthropic.MessageStreamParams);

    if (handlers.onProgress) {
      let chars = 0;
      stream.on('text', (delta: string) => {
        chars += delta.length;
        handlers.onProgress!(chars);
      });
    }

    const message = await stream.finalMessage();

    // Xavfsizlik klassifikatori rad etsa — jimgina katalogga tushamiz
    if (message.stop_reason === 'refusal') return fallback();

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const parsed = ResultSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.warn('[ai] javob sxemaga mos kelmadi', parsed.error.issues[0]?.message);
      return fallback();
    }

    const bySlug = new Map(operations.map((o) => [o.slug, o]));
    const suggestions: AiSuggestion[] = [];
    for (const s of parsed.data.suggestions) {
      const op = bySlug.get(s.operation_slug);
      if (!op) continue; // enum'ga qaramay — hech qachon ishonmaymiz
      suggestions.push({
        operationId: op.id,
        operationName: lang === 'ru' ? op.nameRu : op.nameUz,
        confidence: Math.max(0, Math.min(1, s.confidence)),
        reason: s.reason,
      });
    }

    if (!parsed.data.understood || suggestions.length === 0) {
      // 3.3 chekka holat: aniqlab bo'lmadi → katalog + shifokorga murojaat
      const heur = heuristicSuggest(trimmed);
      return {
        suggestions: heur,
        disclaimer: parsed.data.followup_question
          ? `${parsed.data.followup_question}\n\n${DISCLAIMER[lang]}`
          : DISCLAIMER[lang],
        fallbackToCatalog: heur.length === 0,
      };
    }

    return { suggestions, disclaimer: DISCLAIMER[lang], fallbackToCatalog: false };
  } catch (err) {
    console.error('[ai] xatolik, heuristikaga o‘tildi:', err);
    return fallback();
  }
}
