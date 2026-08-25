/**
 * CLI: berilgan telegram id uchun imzolangan initData chiqaradi.
 * HTTP testi shu orqali haqiqiy autentifikatsiya yo'lidan o'tadi.
 *
 *   npx tsx server/src/test/sign.ts 900001
 */
import { config } from '../lib/config';
import { signInitData } from './initData';

const id = Number(process.argv[2]);
if (!id) {
  console.error('Foydalanish: sign.ts <telegramId>');
  process.exit(1);
}

if (!config.telegram.botToken) {
  console.error('TELEGRAM_BOT_TOKEN yo‘q — imzo yasab bo‘lmaydi');
  process.exit(1);
}

const NAMES: Record<number, { first_name: string; last_name?: string }> = {
  900001: { first_name: 'Aziz', last_name: 'Karimov' },
  900002: { first_name: 'Nodira', last_name: 'Yusupova' },
  900003: { first_name: 'Dilnoza', last_name: 'Rahimova' },
  900777: { first_name: 'Begona' },
};

process.stdout.write(
  signInitData({ id, language_code: 'uz', ...(NAMES[id] ?? { first_name: `User ${id}` }) }, config.telegram.botToken),
);
