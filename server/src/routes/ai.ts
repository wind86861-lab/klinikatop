import { Router } from 'express';
import { z } from 'zod';
import { DISCLAIMER, heuristicSuggest, suggestOperations } from '../services/ai';
import { MAX_TURNS, continueChat } from '../services/aiChat';
import type { AiResult, Lang } from '../../../shared/types';

export const aiRouter = Router();

const bodySchema = z.object({ text: z.string().min(1).max(2000) });

/** Bemor kutib qolmasin: AI shu muddatdan oshsa lokal heuristikaga tushamiz. */
const AI_TIMEOUT_MS = 25_000;

/**
 * Simptom → operatsiya (SSE).
 * Hodisalar: `start` → `progress`* → `result` yoki `error`.
 * UI shu oqim asosida shimmer ko'rsatadi, keyin natijani "pop" bilan chiqaradi.
 */
aiRouter.post('/suggest', async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Matn kiritilmagan', code: 'bad_request' });
  }
  const lang = (req.user?.lang ?? 'uz') as Lang;

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  /**
   * Uzilishni RESPONSE bo'yicha kuzatamiz.
   * `req`'ning 'close' hodisasi Node 18'da tana o'qib bo'lingach ham ishga tushadi —
   * ya'ni ulanish tirik bo'lsa ham, va shu sabab keyingi yozuvlar to'xtab qolardi.
   */
  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  const send = (event: string, data: unknown) => {
    if (closed || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('start', { disclaimer: DISCLAIMER[lang] });

  try {
    const suggestion = suggestOperations(parsed.data.text, lang, {
      onProgress: (chars) => send('progress', { chars }),
    });

    // Kechikish qo'riqchisi — AI javob bermasa ham ekran muzlab qolmaydi
    const timeout = new Promise<AiResult>((resolve) =>
      setTimeout(() => {
        const fallback = heuristicSuggest(parsed.data.text);
        resolve({
          suggestions: fallback,
          disclaimer: DISCLAIMER[lang],
          fallbackToCatalog: fallback.length === 0,
        });
      }, AI_TIMEOUT_MS).unref?.(),
    );

    send('result', await Promise.race([suggestion, timeout]));
  } catch (err) {
    console.error('[ai] so‘rov xatosi', err);
    send('error', { message: 'Hozircha aniqlab bo‘lmadi, katalogdan tanlang' });
  } finally {
    if (!closed && !res.writableEnded) res.end();
  }
});


const chatSchema = z.object({
  turns: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(MAX_TURNS * 2 + 2),
});

/**
 * AI suhbati — bemor yozadi, AI aniqlashtiruvchi savol beradi.
 * Butun suhbat har safar yuboriladi (server holat saqlamaydi).
 */
aiRouter.post('/chat', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Suhbat bo‘sh', code: 'bad_request' });
  }

  const lang = (req.user?.lang ?? 'uz') as Lang;

  try {
    const result = await Promise.race([
      continueChat(parsed.data.turns, lang),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS).unref?.()),
    ]);

    if (!result) {
      // Kechikish qo'riqchisi: suhbat muzlab qolmasin
      return res.json({
        reply:
          lang === 'ru'
            ? 'Не удалось определить. Отправим заявку с вашим описанием — клиника определит сама.'
            : 'Aniqlab bo‘lmadi. So‘rovni tavsifingiz bilan yuboramiz — klinika o‘zi aniqlaydi.',
        needsMoreInfo: false,
        suggestions: [],
        urgentWarning: null,
        fallbackToClinic: true,
        disclaimer: DISCLAIMER[lang],
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[ai] suhbat xatosi', err);
    res.status(500).json({ error: 'Hozircha javob bera olmadim', code: 'ai_error' });
  }
});
