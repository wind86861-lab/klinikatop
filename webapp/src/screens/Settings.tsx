/** Sozlamalar — til, ko'rinish, maxfiylik. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { haptic } from '@/lib/telegram';
import { Card, Chip, Notice, Screen, Segment } from '@/ui';
import type { Lang } from '@shared/types';

type Theme = 'auto' | 'light' | 'dark';

/** Tema tanlovi hujjat ildiziga yoziladi — CSS tokenlari shunga qarab almashadi. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  localStorage.setItem('klinikatop.theme', theme);
}

export function Settings() {
  const { t, lang, setLang } = useApp();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(
    (localStorage.getItem('klinikatop.theme') as Theme | null) ?? 'auto',
  );

  return (
    <Screen title={t('settings.title')} onBack={() => navigate(-1)}>
      <Card className="stack">
        <h2 className="section-title">{t('settings.language')}</h2>
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          {(['uz', 'ru'] as Lang[]).map((l) => (
            <Chip key={l} active={lang === l} onClick={() => setLang(l)}>
              {l === 'uz' ? "O'zbekcha" : 'Русский'}
            </Chip>
          ))}
        </div>
      </Card>

      <Card className="stack">
        <h2 className="section-title">{t('settings.theme')}</h2>
        <Segment
          value={theme}
          onChange={(v) => {
            haptic.select();
            setTheme(v);
            applyTheme(v);
          }}
          options={[
            { value: 'auto', label: t('settings.theme.auto') },
            { value: 'light', label: t('settings.theme.light') },
            { value: 'dark', label: t('settings.theme.dark') },
          ]}
        />
      </Card>

      <Card className="stack">
        <h2 className="section-title">{t('settings.privacy')}</h2>
        <Notice tone="info">{t('settings.privacyText')}</Notice>
      </Card>

    </Screen>
  );
}

/** Ilova ochilishida saqlangan temani tiklaydi. */
export function restoreTheme() {
  const saved = localStorage.getItem('klinikatop.theme') as Theme | null;
  if (saved && saved !== 'auto') document.documentElement.setAttribute('data-theme', saved);
}
