/**
 * Birinchi admin hisobini yaratish.
 *
 * Panelga kirish uchun hisob kerak, hisob ochish uchun esa panelga kirish
 * kerak — bu halqani biror joydan uzish lozim. Uzilish nuqtasi shu skript:
 * u serverga SSH bilan kira oladigan odam uchun, ya'ni allaqachon eng
 * yuqori huquqqa ega odam uchun. Internetdan ochiq "birinchi admin"
 * sahifasi qilinmadi — uni birinchi topgan odam egallab olardi.
 *
 *   npm run admin:create -- +998901234567 "Ali Valiyev"
 */
import { createAccount } from '../services/webAuth';
import { config } from '../lib/config';

const [phone, fullName] = process.argv.slice(2);

if (!phone || !fullName) {
  console.error('Foydalanish: npm run admin:create -- <telefon> "<To‘liq ism>"');
  process.exit(1);
}

const { user, setupToken } = createAccount({
  phone,
  fullName,
  level: 'full',
  clinicId: null,
});

const base = config.telegram.webappUrl.replace(/\/$/, '');

console.log(`\n  Hisob ochildi: +${user.phone} (#${user.id})\n`);
console.log('  Parol o‘rnatish havolasi — 7 kun amal qiladi, bir martalik:\n');
console.log(`  ${base}/kabinet/parol?token=${setupToken}\n`);
console.log('  Parolni qo‘ygach 2FA ni yoqing: Panel → Xavfsizlik.\n');
