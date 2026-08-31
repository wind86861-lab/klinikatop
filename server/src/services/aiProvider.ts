/**
 * AI provayderi — model chaqiruvi bir joyda.
 *
 * Ikki provayder qo'llab-quvvatlanadi va ikkalasi ham bir xil narsani
 * qaytaradi: JSON sxemaga mos matn. Chaqiruvchi kod (`ai.ts`, `aiChat.ts`)
 * qaysi model ishlayotganini bilmaydi va bilmasligi ham kerak — modelni
 * almashtirish uchun ularga tegish shart emas.
 *
 * Nima uchun ikkitasi: model bozori tez o'zgaradi va narx farqi katta.
 * Bugun Gemini arzonroq, ertaga boshqasi. Muhimi — almashtirish bitta
 * muhit o'zgaruvchisi bilan bo'lsin, kodni qayta yozish bilan emas.
 *
 * Har ikkisida ham javob QAT'IY sxema bilan cheklanadi. Bu shunchaki
 * qulaylik emas: model erkin matn qaytarsa, uni ajratib olish uchun
 * yozilgan kod ertami-kechmi buziladi va bemorga tasodifiy natija
 * ko'rsatiladi.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../lib/config';
import { keysToTry, markKeyResult, maskKey, type AiKeyProvider } from './aiKeys';

export interface CompleteInput {
  system: string;
  /** Suhbat — bitta so'rov ham shu shaklda beriladi */
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** JSON Schema — javob shundan chetga chiqmaydi */
  schema: unknown;
  /** Model yozayotganini bildirish (UI jonli ko'rinishi uchun) */
  onProgress?: (charsSoFar: number) => void;
}

export interface CompleteResult {
  /** Sxemaga mos JSON matni. Rad etilgan bo'lsa null. */
  text: string | null;
  /** Model xavfsizlik sababli javob bermadi */
  refused: boolean;
}

export interface AiProvider {
  readonly name: string;
  complete(input: CompleteInput): Promise<CompleteResult>;
}

/* ─────────────────────────  Anthropic  ───────────────────────── */

function anthropicProvider(apiKey: string, model: string): AiProvider {
  const client = new Anthropic({ apiKey });

  return {
    name: `anthropic/${model}`,
    async complete({ system, messages, schema, onProgress }) {
      const stream = client.messages.stream({
        model,
        max_tokens: 2048,
        system,
        // Tasniflash vazifasi — past effort tez va yetarli
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        messages,
      } as Anthropic.MessageStreamParams);

      if (onProgress) {
        let chars = 0;
        stream.on('text', (delta: string) => {
          chars += delta.length;
          onProgress(chars);
        });
      }

      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') return { text: null, refused: true };

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      return { text, refused: false };
    },
  };
}

/* ─────────────────────────  Gemini  ───────────────────────── */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Google'ning JSON Schema lahjasi standartdan uch joyda farq qiladi.
 * Sxemani shu shaklga o'giramiz, shunda chaqiruvchi kod bitta sxema
 * yozib ikkala provayderga bera oladi.
 *
 *   1. Turlar KATTA harfda: `string` emas, `STRING`.
 *   2. `additionalProperties` tushunilmaydi va butun so'rov rad etiladi.
 *   3. Ixtiyoriy maydon `type: ['string','null']` shaklida emas,
 *      `type: 'STRING', nullable: true` shaklida yoziladi.
 *
 * Uchinchisi eng jimgina buziladigani: Google 400 qaytaradi, biz esa
 * heuristikaga tushamiz va AI umuman ishlamayotgani sezilmay qoladi.
 */
function toGeminiSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out: any = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' || key === '$schema') continue;

    if (key === 'type') {
      if (typeof value === 'string') {
        out.type = value.toUpperCase();
      } else if (Array.isArray(value)) {
        // ['string','null'] → STRING + nullable
        const real = value.find((t) => t !== 'null');
        out.type = String(real ?? 'string').toUpperCase();
        if (value.includes('null')) out.nullable = true;
      }
      continue;
    }

    out[key] = toGeminiSchema(value);
  }

  return out;
}

function geminiProvider(apiKey: string, model: string): AiProvider {
  return {
    name: `gemini/${model}`,
    async complete({ system, messages, schema, onProgress }) {
      /*
       * Oqim (SSE) ishlatiladi: uzun javobda HTTP kutish vaqti tugab
       * qolmasin va foydalanuvchi kutayotganini ko'rsin. Javob baribir
       * to'liq yig'ilib, keyin tekshiriladi.
       */
      const res = await fetch(`${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Kalit sarlavhada — manzil satrida emas: URL jurnalga tushadi
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            // Google `assistant` emas, `model` deydi
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(schema),
          },
        }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let blocked = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE: qatorlar `data: ` bilan boshlanadi, bo'sh qator — ajratgich
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;

          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let chunk: any;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue; // yarim kelgan bo'lak — keyingi o'qishda to'liq bo'ladi
          }

          const candidate = chunk.candidates?.[0];
          // Xavfsizlik filtri to'xtatgan — heuristikaga tushamiz
          if (candidate?.finishReason === 'SAFETY' || chunk.promptFeedback?.blockReason) {
            blocked = true;
          }

          for (const part of candidate?.content?.parts ?? []) {
            if (typeof part.text === 'string') {
              text += part.text;
              onProgress?.(text.length);
            }
          }
        }
      }

      if (blocked) return { text: null, refused: true };
      return { text, refused: false };
    },
  };
}

/* ─────────────────────────  Tanlash  ───────────────────────── */

/**
 * Provayder muhit sozlamasidan tanlanadi.
 *
 * Ikkala kalit ham bo'lsa `AI_PROVIDER` hal qiladi; u ham bo'lmasa
 * qaysi kalit bor — o'shanisi ishlatiladi. Hech biri bo'lmasa `null`
 * qaytadi va butun tizim lokal heuristikaga tushadi: AI ishlamayotgani
 * uchun bemor so'rov qoldira olmay qolmasligi kerak.
 */
function pick(): AiProvider | null {
  const { provider, apiKey, geminiKey, model } = config.ai;

  const wantGemini = provider === 'gemini' || (provider === 'auto' && !apiKey && geminiKey);
  if (wantGemini && geminiKey) return geminiProvider(geminiKey, model);

  if (apiKey) return anthropicProvider(apiKey, model);
  if (geminiKey) return geminiProvider(geminiKey, model);
  return null;
}

/**
 * Bir nechta kalitni ketma-ket sinaydigan provayder.
 *
 * Prodda ko'rilgan holat: Gemini 503 "high demand" qaytardi va butun
 * AI heuristikaga tushdi. Bitta provayderning vaqtinchalik yuklamasi
 * mahsulotning asosiy qismini o'chirmasligi kerak.
 *
 * Tartib: admin qo'ygan kalitlar, keyin muhit sozlamasidagi.
 * Birinchi MUVAFFAQIYATLI javob qaytariladi; hammasi yiqilsa xato
 * tashlanadi va chaqiruvchi heuristikaga tushadi (avvalgidek).
 *
 * Rad javobi (`refused`) xato EMAS: model ataylab javob bermagan,
 * boshqa kalit ham xuddi shunday qiladi.
 */
function failoverProvider(which: AiKeyProvider, model: string): AiProvider | null {
  const build = which === 'gemini' ? geminiProvider : anthropicProvider;

  return {
    name: `${which}/${model}`,
    async complete(req) {
      const keys = keysToTry(which);
      if (keys.length === 0) throw new Error('AI kaliti yo‘q');

      let lastError: unknown = null;
      for (const key of keys) {
        try {
          const result = await build(key, model).complete(req);
          markKeyResult(key, null);
          return result;
        } catch (err) {
          lastError = err;
          const message = err instanceof Error ? err.message : String(err);
          markKeyResult(key, message);
          console.warn(`[ai] kalit ishlamadi (${maskKey(key)}), keyingisiga o‘tildi: ${message}`);
        }
      }
      throw lastError ?? new Error('Barcha AI kalitlari ishlamadi');
    },
  };
}

let cached: AiProvider | null | undefined;

export function aiProvider(): AiProvider | null {
  if (cached !== undefined) return cached;

  /*
   * Qaysi provayder — avvalgidek sozlamadan. Kalitlar esa endi
   * ro'yxatdan olinadi, shuning uchun natija keshlansa ham yangi
   * kalit qo'shilganda `resetAiProvider()` chaqiriladi.
   */
  const base = pick();
  if (!base) {
    // Bazada kalit bo'lishi mumkin — muhitda bo'lmasa ham
    const which: AiKeyProvider = config.ai.provider === 'anthropic' ? 'anthropic' : 'gemini';
    cached = keysToTry(which).length > 0 ? failoverProvider(which, config.ai.model) : null;
    return cached;
  }

  cached = failoverProvider(base.name.startsWith('anthropic') ? 'anthropic' : 'gemini', config.ai.model);
  return cached;
}

export const aiEnabled = () => aiProvider() !== null;

/** Testlar uchun — sozlama o'zgargach qayta tanlansin. */
export function resetAiProvider() {
  cached = undefined;
}
