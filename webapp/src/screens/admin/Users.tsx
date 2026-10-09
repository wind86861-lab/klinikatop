/**
 * Super-admin: foydalanuvchilar va huquqlar.
 *
 * Bu imkoniyat serverda ANCHADAN BERI bor edi — rol berish, bloklash,
 * ro'yxatni ko'rish — lekin hech qanday ekrani yo'q edi. Ya'ni platforma
 * egasi kimga qanday huquq berilganini faqat bazaga kirib ko'ra olardi,
 * o'zgartirish uchun esa `curl` yozishi kerak edi.
 *
 * Ikkita chegara SERVERDA turadi va bu yerda shunchaki ko'rsatiladi:
 * admin o'zidan admin rolini ola olmaydi va o'zini bloklay olmaydi —
 * ikkalasi ham o'zini panelidan qulflab qo'yish degani.
 */
import { useMemo, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { formatDate } from '@/lib/format';
import { Button, Field, Notice, Sheet, Skeleton, Textarea } from '@/ui';
import { Async, useResource } from '@/screens/clinic/shell';
import { DataTable, Empty, PageHeader, RowMenu, Tag } from './ui';
import { ROLES, type AdminUserRow, type Role } from '@shared/types';
import type { ColumnDef } from '@tanstack/react-table';

const ROLE_LABEL: Record<Role, string> = {
  patient: 'Bemor',
  clinic_admin: 'Klinika admini',
  clinic_operator: 'Klinika operatori',
  admin: 'Administrator',
  doctor: 'Shifokor',
};

export function AdminUsers() {
  const { t, lang, user: me, toast } = useApp();
  const res = useResource(() => api.adminUsers());
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [blocking, setBlocking] = useState<AdminUserRow | null>(null);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      haptic.success();
      toast(ok, 'success');
      setEditing(null);
      setBlocking(null);
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  const columns = useMemo<ColumnDef<AdminUserRow, any>[]>(
    () => [
      {
        id: 'name',
        header: 'Foydalanuvchi',
        accessorFn: (r) => `${r.firstName} ${r.lastName ?? ''} ${r.phone ?? ''} ${r.username ?? ''}`,
        cell: (c) => {
          const r = c.row.original;
          return (
            <div>
              <div className="atable__name">
                {r.firstName} {r.lastName ?? ''}
                {r.id === me?.id && <span className="atable__sub"> · siz</span>}
              </div>
              <div className="atable__sub">{r.phone ?? (r.username ? `@${r.username}` : '—')}</div>
            </div>
          );
        },
      },
      {
        id: 'roles',
        header: 'Huquqlar',
        size: 260,
        accessorFn: (r) => r.roles.join(','),
        cell: (c) => (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {c.row.original.roles.map((role) => (
              <Tag key={role} tone={role === 'admin' ? 'bad' : role === 'patient' ? 'neutral' : 'good'}>
                {ROLE_LABEL[role]}
              </Tag>
            ))}
          </div>
        ),
      },
      {
        id: 'clinic',
        header: 'Klinika',
        size: 180,
        accessorFn: (r) => r.clinicName ?? '',
        cell: (c) => c.row.original.clinicName ?? <span className="muted">—</span>,
      },
      {
        id: 'status',
        header: 'Holat',
        size: 110,
        accessorFn: (r) => (r.blockedAt ? 'blocked' : 'active'),
        cell: (c) =>
          c.row.original.blockedAt ? <Tag tone="bad">Bloklangan</Tag> : <Tag tone="good">Faol</Tag>,
      },
      {
        id: 'joined',
        header: 'Qo‘shilgan',
        size: 120,
        accessorFn: (r) => r.createdAt,
        cell: (c) => <span className="tiny">{formatDate(c.row.original.createdAt, lang)}</span>,
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        enableSorting: false,
        cell: (c) => {
          const r = c.row.original;
          const self = r.id === me?.id;
          return (
            <div className="arow-actions">
              <RowMenu
                items={[
                  { label: 'Huquqlarni o‘zgartirish', onClick: () => setEditing(r) },
                  /*
                   * O'zini bloklash tugmasi KO'RSATILMAYDI. Server uni
                   * baribir rad etadi, lekin bosib keyin xato olish —
                   * foydalanuvchini aldash bo'lardi.
                   */
                  ...(self
                    ? []
                    : [
                        r.blockedAt
                          ? {
                              label: 'Blokdan chiqarish',
                              onClick: () => act(() => api.setUserBlocked(r.id, false), 'Blokdan chiqarildi'),
                            }
                          : { label: 'Bloklash', onClick: () => setBlocking(r), danger: true },
                      ]),
                ]}
              />
            </div>
          );
        },
      },
    ],
    [lang, me?.id],
  );

  return (
    <div className="stack">
      <PageHeader
        title="Foydalanuvchilar"
        description="Kim qanday huquqqa ega va kim bloklangan. Huquq o‘zgarishi darhol kuchga kiradi."
      />

      <Async resource={res} skeleton={<Skeleton h={320} />}>
        {(list) => (
          <DataTable
            data={list}
            columns={columns}
            searchPlaceholder="Ism, telefon yoki username…"
            empty={<Empty title="Foydalanuvchi topilmadi" />}
          />
        )}
      </Async>

      <RolesSheet
        row={editing}
        isSelf={editing?.id === me?.id}
        onClose={() => setEditing(null)}
        onSave={(roles) => act(() => api.setUserRoles(editing!.id, roles), 'Huquqlar saqlandi')}
      />

      <BlockSheet
        row={blocking}
        onClose={() => setBlocking(null)}
        onBlock={(note) => act(() => api.setUserBlocked(blocking!.id, true, note), 'Bloklandi')}
      />
    </div>
  );
}

/* ─────────────────────────  Huquqlar  ───────────────────────── */

function RolesSheet({
  row,
  isSelf,
  onClose,
  onSave,
}: {
  row: AdminUserRow | null;
  isSelf?: boolean;
  onClose: () => void;
  onSave: (roles: Role[]) => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [seen, setSeen] = useState<number | null>(null);

  // Varaq yangi odam uchun ochilganda tanlov o'sha odamnikiga tiklanadi
  if (row && seen !== row.id) {
    setSeen(row.id);
    setRoles(row.roles);
  }

  const toggle = (r: Role) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const losingOwnAdmin = isSelf && !roles.includes('admin');

  return (
    <Sheet open={row !== null} onClose={onClose} title="Huquqlar">
      {row && (
        <div className="stack">
          <Notice>
            <b>
              {row.firstName} {row.lastName ?? ''}
            </b>
            {row.phone ? ` · ${row.phone}` : ''}
          </Notice>

          <Field label="Rollar">
            <div className="chips">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`chip ${roles.includes(r) ? 'is-active' : ''}`}
                  onClick={() => toggle(r)}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </Field>

          {losingOwnAdmin && (
            <Notice tone="warning">
              O‘zingizdan administrator huquqini ola olmaysiz — bu panelga kirishni butunlay yopib
              qo‘yardi.
            </Notice>
          )}

          <Button block disabled={roles.length === 0 || losingOwnAdmin} onClick={() => onSave(roles)}>
            Saqlash
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/* ─────────────────────────  Bloklash  ───────────────────────── */

function BlockSheet({
  row,
  onClose,
  onBlock,
}: {
  row: AdminUserRow | null;
  onClose: () => void;
  onBlock: (note: string) => void;
}) {
  const [note, setNote] = useState('');

  return (
    <Sheet open={row !== null} onClose={onClose} title="Bloklash">
      {row && (
        <div className="stack">
          <Notice tone="warning">
            <b>
              {row.firstName} {row.lastName ?? ''}
            </b>{' '}
            tizimga kira olmaydi. Sababi jurnalga yoziladi.
          </Notice>
          {/* Sabab majburiy: blok qarori keyin tekshiriladigan qaror */}
          <Field label="Sabab">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} />
          </Field>
          <Button block variant="danger" disabled={note.trim().length < 3} onClick={() => onBlock(note.trim())}>
            Bloklash
          </Button>
        </div>
      )}
    </Sheet>
  );
}
