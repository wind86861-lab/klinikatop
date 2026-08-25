/**
 * Rol berish — moderator/admin faqat platforma tomonidan qo'lda tayinlanadi (1.2).
 *
 *   npm run grant --workspace=server -- 900003 moderator
 *   npm run grant --workspace=server -- 900003 admin
 */
import { db, migrate, parseJson, toJson } from './index';
import { ROLES, type Role } from '../../../shared/types';

const [rawId, rawRole] = process.argv.slice(2);
const telegramId = Number(rawId);
const role = rawRole as Role;

if (!telegramId || !ROLES.includes(role)) {
  console.error(`Ishlatish: npm run grant --workspace=server -- <telegramId> <${ROLES.join('|')}>`);
  process.exit(1);
}

migrate();

const user = db.prepare(`SELECT id, roles, first_name FROM users WHERE telegram_id = ?`).get(telegramId) as
  | { id: number; roles: string; first_name: string }
  | undefined;

if (!user) {
  console.error(`Foydalanuvchi topilmadi (telegram_id=${telegramId}). Avval ilovaga bir marta kirsin.`);
  process.exit(1);
}

const roles = parseJson<Role[]>(user.roles, ['patient']);
if (roles.includes(role)) {
  console.log(`${user.first_name} allaqachon "${role}" roliga ega.`);
  process.exit(0);
}

roles.push(role);
db.prepare(`UPDATE users SET roles = ? WHERE id = ?`).run(toJson(roles), user.id);
db.prepare(
  `INSERT INTO moderation_log (entity, entity_id, action, note) VALUES ('user', ?, 'roles', ?)`,
).run(user.id, `CLI: +${role}`);

console.log(`${user.first_name} → rollar: ${roles.join(', ')}`);
