/**
 * AI suhbati — bemor shikoyatini yozadi, AI aniqlashtiruvchi savol beradi.
 *
 * Nima uchun suhbat, bitta so'rov emas:
 *   Bitta jumladan operatsiyani aniqlash xato tashxisga olib keladi. AI savol
 *   berib aniqlashtirsa, xato ehtimoli keskin kamayadi. Aniqlab bo'lmasa —
 *   "klinika aytsin" bilan yakunlanadi, ya'ni tupik yo'q.
 *
 * Muhim qoida: bemor yozgan matn AI xulosasidan MUSTAQIL ravishda klinikaga
 * boradi. Klinika AI taxminini emas, bemorning o'z so'zlarini o'qiydi —
 * shuning uchun AI xato qilsa ham klinika to'g'ri narx beradi.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../lib/config';
import { DISCLAIMER, heuristicSuggest } from './ai';
import { listOperations } from './catalog';
import { UNKNOWN_OPERATION_SLUG, type Lang, type Operation } from '../../../shared/types';

const client = config.ai.apiKey ? new Anthropic({ apiKey: config.ai.apiKey }) : null;

/** Suhbat qancha davom etishi mumkin — cheksiz savol bermasin. */
export const MAX_TURNS = 4;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatSuggestion {
  operationId: number;
  operationName: string;
  confidence: number;
  reason: string;
}

export interface AiChatResult {
  /** Bemorga ko'rinadigan javob: savol yoki xulosa */
  reply: string;
  /** Yana aniqlashtirish kerakmi */
  needsMoreInfo: boolean;
  suggestions: AiChatSuggestion[];
  /** Shoshilinch xavf belgisi sezilsa */
  urgentWarning: string | null;
  /** Aniqlab bo'lmadi — "klinika aytsin" bilan davom etiladi */
  fallbackToClinic: boolean;
  disclaimer: string;
}

const ResponseSchema = z.object({
  reply: z.string().min(1).max(600),
  needs_more_info: z.boolean(),
  urgent_warning: z.string().max(300).nullable().optional(),
  suggestions: z
    .array(
      z.object({
        operation_slug: z.string(),
        confidence: z.number().min(0).max(1),
        reason: z.string().max(400),
      }),
    )
    .max(3)
    .default([]),
});

function outputSchema(operations: Operation[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'needs_more_info', 'suggestions'],
    properties: {
      reply: {
        type: 'string',
        description:
          'Bemorga ko‘rinadigan javob. Aniqlashtirish kerak bo‘lsa — BITTA aniq savol. Aniqlangan bo‘lsa — qisqa xulosa.',
      },
      needs_more_info: {
        type: 'boolean',
        description: 'true bo‘lsa reply ichida savol bo‘lishi shart',
      },
      urgent_warning: {
        type: ['string', 'null'],
        description:
          'Shoshilinch tibbiy yordam kerakligi sezilsa (kuchli og‘riq, qon ketish, nafas qisilishi) — qisqa ogohlantirish, aks holda null',
      },
      suggestions: {
        type: 'array',
        maxItems: 3,
        description: 'Aniqlangan operatsiyalar. needs_more_info true bo‘lsa bo‘sh bo‘lishi mumkin.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['operation_slug', 'confidence', 'reason'],
          properties: {
            operation_slug: { type: 'string', enum: operations.map((o) => o.slug) },
            confidence: { type: 'number' },
            reason: { type: 'string' },
          },
        },
      },
    },
  } as const;
}

function systemPrompt(lang: Lang, operations: Operation[], turnsLeft: number): string {
  const catalog = operations
    .map((o) => `- ${o.slug}: ${o.nameUz} (${o.aliasUz}) | kalit: ${o.keywords.join(', ')}`)
    .join('\n');

  return `Sen "KlinikaTop" platformasining yordamchisisan. Bemor shikoyatini oddiy tilda yozadi; sen suhbat orqali qaysi operatsiya yo'nalishi kerakligini aniqlaysan.

Qat'iy chegaralar:
- Sen TASHXIS QO'YMAYSAN va davolash tayinlamaysan. Faqat operatsiya yo'nalishini taxmin qilasan.
- "Sizda ... kasalligi bor" deb yozma. "Bu tavsif ... yo'nalishiga mos kelishi mumkin" tarzida yoz.
- Faqat quyidagi katalogdagi slug'ni tanla. Katalogda yo'q narsani o'ylab topma.

Suhbat qoidalari:
- Aniqlash uchun ma'lumot yetmasa — needs_more_info=true qil va reply ichida FAQAT BITTA aniq, sodda savol ber.
- Savol tibbiy atamasiz bo'lsin. Masalan: "Og'riq qayerda — o'ng tomondami yoki chapda?"
- Ma'lumot yetarli bo'lsa — needs_more_info=false, suggestions to'ldiriladi, reply qisqa xulosa bo'ladi.
- Sizda yana ${turnsLeft} ta savol imkoni bor. Imkon tugasa — needs_more_info=false qil va bor ma'lumot asosida xulosa ber; hech narsa aniqlanmasa suggestions bo'sh qoladi.
- Shoshilinch xavf belgilari (kuchli qorin og'rig'i, ko'krak og'rig'i, qon ketish, nafas qisilishi, hushdan ketish) sezilsa — urgent_warning to'ldir va darhol shifokorga murojaat qilishni ayt.

Til: ${lang === 'ru' ? 'rus tilida yoz' : "o'zbek tilida yoz"}. Qisqa va sodda — bemor tibbiy atamalarni bilmaydi.

Katalog:
${catalog}`;
}

/** Heuristika asosidagi zaxira suhbat — API kaliti bo'lmaganda ham ishlaydi. */
function heuristicChat(turns: ChatTurn[], lang: Lang, operations: Operation[]): AiChatResult {
  const patientText = turns
    .filter((t) => t.role === 'user')
    .map((t) => t.content)
    .join(' ');

  const suggestions = heuristicSuggest(patientText);
  const askedCount = turns.filter((t) => t.role === 'assistant').length;

  // Birinchi urinishda hech narsa topilmasa — bitta aniqlashtiruvchi savol
  if (suggestions.length === 0 && askedCount === 0) {
    return {
      reply:
        lang === 'ru'
          ? 'Расскажите чуть подробнее: что именно беспокоит, где болит и что сказал врач?'
          : 'Biroz batafsilroq yozing: aynan nima bezovta qiladi, qayeri og‘riydi va shifokor nima dedi?',
      needsMoreInfo: true,
      suggestions: [],
      urgentWarning: null,
      fallbackToClinic: false,
      disclaimer: DISCLAIMER[lang],
    };
  }

  if (suggestions.length === 0) {
    return {
      reply:
        lang === 'ru'
          ? 'По описанию направление определить не удалось. Отправим заявку так — клиника определит сама по вашему описанию.'
          : 'Tavsif bo‘yicha yo‘nalishni aniqlab bo‘lmadi. So‘rovni shundayligicha yuboramiz — klinika sizning tavsifingizga qarab o‘zi aniqlaydi.',
      needsMoreInfo: false,
      suggestions: [],
      urgentWarning: null,
      fallbackToClinic: true,
      disclaimer: DISCLAIMER[lang],
    };
  }

  const byId = new Map(operations.map((o) => [o.id, o]));
  return {
    reply:
      lang === 'ru'
        ? 'Судя по описанию, это может быть следующее направление. Подтвердите, если верно.'
        : 'Tavsifingizga ko‘ra bu quyidagi yo‘nalishga mos kelishi mumkin. To‘g‘ri bo‘lsa tasdiqlang.',
    needsMoreInfo: false,
    suggestions: suggestions.map((s) => ({
      operationId: s.operationId,
      operationName: byId.get(s.operationId)?.[lang === 'ru' ? 'nameRu' : 'nameUz'] ?? s.operationName,
      confidence: s.confidence,
      reason: s.reason,
    })),
    urgentWarning: null,
    fallbackToClinic: false,
    disclaimer: DISCLAIMER[lang],
  };
}

/**
 * Suhbatning keyingi qadamini hisoblaydi.
 * `turns` — shu paytgacha bo'lgan butun suhbat (oxirgisi bemorники).
 */
export async function continueChat(turns: ChatTurn[], lang: Lang = 'uz'): Promise<AiChatResult> {
  const operations = listOperations().filter((o) => o.slug !== UNKNOWN_OPERATION_SLUG);
  const asked = turns.filter((t) => t.role === 'assistant').length;
  const turnsLeft = Math.max(0, MAX_TURNS - asked);

  if (!client || turns.length === 0) {
    return heuristicChat(turns, lang, operations);
  }

  try {
    const stream = client.messages.stream({
      model: config.ai.model,
      max_tokens: 2048,
      system: systemPrompt(lang, operations, turnsLeft),
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: outputSchema(operations) },
      },
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
    } as Anthropic.MessageStreamParams);

    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') return heuristicChat(turns, lang, operations);

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const parsed = ResponseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return heuristicChat(turns, lang, operations);

    const bySlug = new Map(operations.map((o) => [o.slug, o]));
    const suggestions: AiChatSuggestion[] = [];
    for (const s of parsed.data.suggestions) {
      const op = bySlug.get(s.operation_slug);
      if (!op) continue;
      suggestions.push({
        operationId: op.id,
        operationName: lang === 'ru' ? op.nameRu : op.nameUz,
        confidence: Math.max(0, Math.min(1, s.confidence)),
        reason: s.reason,
      });
    }

    // Savol imkoni tugadi yoki AI aniqlay olmadi → klinikaga topshiramiz
    const exhausted = turnsLeft <= 0;
    const needsMoreInfo = parsed.data.needs_more_info && !exhausted;

    return {
      reply: parsed.data.reply,
      needsMoreInfo,
      suggestions,
      urgentWarning: parsed.data.urgent_warning ?? null,
      fallbackToClinic: !needsMoreInfo && suggestions.length === 0,
      disclaimer: DISCLAIMER[lang],
    };
  } catch (err) {
    console.error('[ai-chat] xatolik, heuristikaga o‘tildi:', err);
    return heuristicChat(turns, lang, operations);
  }
}
