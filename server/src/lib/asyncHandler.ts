/**
 * Async marshrut uchun o'ram.
 *
 * Express 4 `async` funksiyadan qaytgan rad etilgan promise'ni ko'rmaydi:
 * xato middleware'ga yetib bormaydi, so'rov esa javobsiz osilib qoladi va
 * mijoz vaqt tugashini kutadi. Bu o'ram rad etishni `next()` ga uzatadi,
 * shunda u boshqa har qanday xato kabi ishlanadi.
 *
 * Express 5 da bu o'z-o'zidan ishlaydi; o'shanda bu fayl kerak bo'lmaydi.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
