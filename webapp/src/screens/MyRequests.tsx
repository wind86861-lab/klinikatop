/** "So'rovlarim" bo'limi — faol va yakunlangan so'rovlar. */
import { useEffect, useState } from 'react';
import { useNavigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { money, timeLeft } from '@/lib/format';
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
  IconTrash,
  Notice,
  Screen,
  Segment,
  Sheet,
  SkeletonList,
} from '@/ui';
import { requestTitle } from '@shared/types';
import type { RequestWithMeta } from '@shared/types';

type Tab = 'active' | 'done';

export function MyRequests() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();

  /*
   * O'chirish ro'yxatning O'ZIDA turadi.
   *
   * So'rovlar soniga cheklov olib tashlangach ro'yxat uzayadi va uni
   * shu yerdan tartibga solish tabiiy. Har birini ochib, ichidan
   * o'chirish tugmasini qidirish ortiqcha ish bo'lardi.
   */
  const [confirming, setConfirming] = useState<RequestWithMeta | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const remove = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      await api.deleteRequest(confirming.id);
      haptic.success();
      toast(t('request.deleted'), 'success');
      // Serverga qayta bormaymiz: qator darhol yo'qolsin
      setItems((prev) => prev?.filter((r) => r.id !== confirming.id) ?? null);
      setConfirming(null);
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setDeleting(false);
    }
  };

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
                <div className="list-row">
                  {/*
                    Nom BUTUN kenglikni oladi, holat esa pastki qatorga
                    tushadi. O'chirish tugmasi qo'shilgach nom juda erta
                    kesila boshlagan edi: "Laparoskopik xoletsi…" — bemor
                    qaysi so'rov ekanini ajrata olmasdi.
                  */}
                  <button className="list-item list-item--stacked" onClick={() => navigate(`/request/${request.id}`)}>
                    <div className="list-item__title truncate">{requestTitle(request, lang)}</div>
                    <div className="list-item__meta">
                      <span className="list-item__sub truncate">
                        {money(request.budgetUzs, lang)}
                        {live && !left.expired && ` · ${left.text}`}
                      </span>
                      {request.offersCount > 0 ? (
                        <Badge tone="cheapest">{t('wait.offers', { n: request.offersCount })}</Badge>
                      ) : (
                        <Badge tone="neutral">{t(`status.${request.status}` as any)}</Badge>
                      )}
                    </div>
                  </button>

                  {/*
                    Bitim tuzilgan so'rovda tugma umuman chiqmaydi:
                    uni o'chirib bo'lmaydi va serverdan xato olishdan
                    ko'ra, imkonsiz amalni ko'rsatmaslik to'g'riroq.
                  */}
                  {request.status !== 'CHOSEN' && request.status !== 'COMPLETED' && (
                    <button
                      type="button"
                      className="list-row__del"
                      aria-label={t('request.delete')}
                      onClick={() => setConfirming(request)}
                    >
                      <IconTrash size={17} />
                    </button>
                  )}
                </div>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}

      {/* Qaytarib bo'lmaydigan amal — tasdiqlashsiz bo'lmaydi */}
      <Sheet open={confirming !== null} onClose={() => setConfirming(null)} title={t('request.delete')}>
        {confirming && (
          <div className="stack">
            <strong>{requestTitle(confirming, lang)}</strong>
            <Notice tone="danger">{t('request.deleteWarn')}</Notice>
            {confirming.offersCount > 0 && (
              <p className="tiny">{t('request.deleteOffers', { n: confirming.offersCount })}</p>
            )}
            <Button block variant="danger" loading={deleting} onClick={remove}>
              {t('request.deleteConfirm')}
            </Button>
            <Button block variant="ghost" onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
