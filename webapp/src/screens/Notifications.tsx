import { useEffect } from 'react';
import { useNavigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { relativeTime } from '@/lib/format';
import { AnimatedItem, AnimatedList, Button, EmptyState, IconBell, Screen } from '@/ui';
import type { TranslationKey } from '@/i18n';
import { safePath } from '@/lib/safePath';

export function Notifications() {
  const { t, lang, notifications, unread, loadNotifications, markAllRead } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  return (
    <Screen
      title={t('notif.title')}
      onBack={() => navigate(-1)}
      actions={
        unread > 0 ? (
          <Button size="sm" variant="ghost" onClick={markAllRead}>
            {t('notif.readAll')}
          </Button>
        ) : undefined
      }
    >
      {notifications.length === 0 ? (
        <EmptyState icon={<IconBell size={32} />} title={t('notif.empty')} />
      ) : (
        <AnimatedList>
          {notifications.map((n) => (
            <AnimatedItem key={n.id}>
              <button
                className="list-item"
                onClick={() => n.link && navigate(safePath(n.link))}
                style={{ opacity: n.readAt ? 0.7 : 1 }}
              >
                <div className="list-item__body">
                  <div className="list-item__title" style={{ fontSize: 'var(--t-sm)' }}>
                    {t(`notif.${n.type}` as TranslationKey, n.params)}
                  </div>
                  <div className="list-item__sub">{relativeTime(n.createdAt, lang)}</div>
                </div>
                {!n.readAt && <span className="list-item__unread" />}
              </button>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}
    </Screen>
  );
}
