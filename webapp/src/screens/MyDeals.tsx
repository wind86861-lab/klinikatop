/** "Bitimlar" bo'limi — faol va yakunlangan bitimlar. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { opName } from '@/i18n';
import { TabBar } from '@/components/TabBar';
import {
  AnimatedItem,
  AnimatedList,
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconChat,
  Screen,
  Segment,
  SkeletonList,
} from '@/ui';
import type { DealDetail } from '@shared/types';

type Tab = 'active' | 'done';

export function MyDeals() {
  const { t, lang } = useApp();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('active');
  const [items, setItems] = useState<DealDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setItems(await api.deals());
    } catch (err: any) {
      setError(err?.message ?? t('common.error'));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDone = (d: DealDetail) =>
    d.status === 'CONFIRMED' || d.status === 'CANCELLED' || d.status === 'DISPUTED';
  const active = (items ?? []).filter((d) => !isDone(d));
  const done = (items ?? []).filter(isDone);
  const shown = tab === 'active' ? active : done;

  // Tejalgan summa: kelishilgan narxdan qancha kam to'langan
  const saved = done.reduce((sum, d) => {
    if (d.status !== 'CONFIRMED' || d.confirmedAmountUzs == null) return sum;
    return sum + Math.max(0, d.agreedPriceUzs - d.confirmedAmountUzs);
  }, 0);

  return (
    <Screen title={t('home.deals')} tabBar={<TabBar role="patient" />}>
      <Segment
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: `${t('requests.active')}${active.length ? ` · ${active.length}` : ''}` },
          { value: 'done', label: `${t('requests.done')}${done.length ? ` · ${done.length}` : ''}` },
        ]}
      />

      {tab === 'done' && saved > 0 && (
        <div className="kpi">
          <div className="kpi__label">{t('profile.saved')}</div>
          <div className="kpi__value" style={{ color: 'var(--success)' }}>
            {money(saved, lang)}
          </div>
        </div>
      )}

      {error ? (
        <ErrorState message={error} retryLabel={t('common.retry')} onRetry={load} />
      ) : items === null ? (
        <SkeletonList count={3} lines={2} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<IconChat size={32} />}
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
          {shown.map((deal) => (
            <AnimatedItem key={deal.id}>
              <button className="list-item" onClick={() => navigate(`/deal/${deal.id}`)}>
                <Avatar name={deal.clinic.name} url={deal.clinic.logoUrl} size="sm" />
                <div className="list-item__body">
                  <div className="list-item__title truncate">{deal.clinic.name}</div>
                  <div className="list-item__sub truncate">
                    {opName(deal.request.operation, lang)} ·{' '}
                    {money(deal.confirmedAmountUzs ?? deal.agreedPriceUzs, lang)}
                  </div>
                </div>
                <Badge
                  tone={
                    deal.status === 'CONFIRMED'
                      ? 'cheapest'
                      : deal.status === 'DISPUTED'
                        ? 'warning'
                        : deal.status === 'CANCELLED'
                          ? 'danger'
                          : 'neutral'
                  }
                >
                  {t(
                    (deal.status === 'CANCELLED' || deal.status === 'DISPUTED'
                      ? `deal.status.${deal.status}`
                      : `deal.step.${deal.status}`) as any,
                  )}
                </Badge>
              </button>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}
    </Screen>
  );
}
