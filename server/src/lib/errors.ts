/** Klientga tushunarli kod bilan qaytariladigan xatolik. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Avtorizatsiya talab qilinadi') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Ruxsat yo‘q') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Topilmadi') => new AppError(404, 'not_found', msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
