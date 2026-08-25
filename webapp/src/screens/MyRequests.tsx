/** "So'rovlarim" bo'limi — faol va yakunlangan so'rovlar. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { money, timeLeft } from '@/lib/format';
import { opName } from '@/i18n';
import { TabBar } from '@/components/TabBar';
import {
  AnimatedItem,
  AnimatedList,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconInbox,
  IconPlus,
  Screen,
  Segment,
  SkeletonList,
} from '@/ui';
import type { RequestWithMeta } from '@shared/types';

type Tab = 'active' | 'done';

export function MyRequests() {
  const { t, lang } = useApp();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('active');
  const [items, setItems] = useState<RequestWithMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setItems(await api.requests());
    } catch (err: any) {
      setError(err?.message ?? t('common.error'));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = (items ?? []).filter((r) => r.status === 'NEW' || r.status === 'COLLECTING');
  const done = (items ?? []).filter((r) => r.status !== 'NEW' && r.status !== 'COLLECTING');
  const shown = tab === 'active' ? active : done;

  return (
    <Screen
      title={t('requests.title')}
      tabBar={<TabBar role="patient" />}
      actions={
        <Button size="sm" variant="ghost" icon={<IconPlus size={16} />} onClick={() => navigate('/new')}>
          {t('common.next')}
        </Button>
      }
    >
      <Segment
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: `${t('requests.active')}${active.length ? ` · ${active.length}` : ''}` },
          { value: 'done', label: `${t('requests.done')}${done.length ? ` · ${done.length}` : ''}` },
        ]}
      />

      {error ? (
        <ErrorState message={error} retryLabel={t('common.retry')} onRetry={load} />
      ) : items === null ? (
        <SkeletonList count={3} lines={2} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<IconInbox size={32} />}
          title={t('requests.empty')}
          text={tab === 'active' ? t('requests.emptyText') : undefined}
          action={
            tab === 'active' ? (
              <Button size="sm" onClick={() => navigate('/new')}>
                {t('home.new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <AnimatedList>
          {shown.map((request) => {
            const left = timeLeft(request.expiresAt, lang);
            const live = request.status === 'NEW' || request.status === 'COLLECTING';
            return (
              <AnimatedItem key={request.id}>
                <button className="list-item" onClick={() => navigate(`/request/${request.id}`)}>
                  <div className="list-item__body">
                    <div className="list-item__title truncate">{opName(request.operation, lang)}</div>
                    <div className="list-item__sub truncate">
                      {money(request.budgetUzs, lang)}
                      {live && !left.expired && ` · ${left.text}`}
                    </div>
                  </div>
                  {request.offersCount > 0 ? (
                    <Badge tone="cheapest">{t('wait.offers', { n: request.offersCount })}</Badge>
                  ) : (
                    <Badge tone="neutral">{t(`status.${request.status}` as any)}</Badge>
                  )}
                </button>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}
    </Screen>
  );
}
