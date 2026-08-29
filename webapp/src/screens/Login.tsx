/**
 * Kirish ekrani.
 *
 * Nima uchun kerak edi: ilova faqat ikki yo'l bilan tanirdi —
 * Telegram `initData` yoki `?dev=` URL parametri. Telegramdan tashqarida
 * ochilgan har qanday brauzer "initData yaroqsiz" degan boshi berk ko'chaga
 * tushardi va kirish yo'li umuman taklif qilinmasdi.
 *
 * Ishlab chiqarishda haqiqiy yo'l bitta: ilova Telegram bot orqali ochiladi
 * va `initData` imzosi serverda tekshiriladi. Shuning uchun bu ekran birinchi
 * navbatda shu yo'lni ko'rsatadi.
 *
 * Imzosiz kirish (rol tanlash) butunlay olib tashlandi: u ishlab chiqishni
 * osonlashtirardi, lekin platformani ochib qo'yish xavfini ham saqlab
 * turardi. Endi kirishning yagona yo'li — Telegram.
 */
import { m } from 'framer-motion';
import { useApp } from '@/store/app';
import { popVariants } from '@/lib/motion';
import { Button, Card, Notice } from '@/ui';

export function Login() {
  const { t } = useApp();

  const botUrl = import.meta.env.VITE_BOT_URL ?? '';

  return (
    <div className="login">
      <m.div className="login__box" variants={popVariants} initial="initial" animate="animate">
        <div className="login__mark">KlinikaTop</div>
        <h1 className="login__title">{t('login.title')}</h1>
        <p className="login__sub">{t('login.sub')}</p>

        {/* Ishlab chiqarishdagi yagona yo'l */}
        {botUrl ? (
          <Button block onClick={() => window.location.assign(botUrl)}>
            {t('login.openTelegram')}
          </Button>
        ) : (
          <Notice tone="info">{t('login.noBot')}</Notice>
        )}

      </m.div>

      <Card className="login__note">
        <p className="tiny">{t('login.privacy')}</p>
      </Card>
    </div>
  );
}
