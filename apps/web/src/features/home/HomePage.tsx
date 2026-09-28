import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Text, Title3, ToggleButton } from '@fluentui/react-components';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABELS, STATUS_LABELS, type User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { onSyncStatus, syncNow, type SyncStatus } from '../../offline/sync';
import { useLightMode } from './useLightMode';

/**
 * Home: sync bar, approval notices, Normal/Light switch, New inspection, search, inspection list.
 * Reads inspections from the local DB (works offline); notices come from the API when online.
 */
export function HomePage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [light, setLight] = useLightMode();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  useEffect(() => { const off = onSyncStatus(setSync); return () => { off(); }; }, []);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const inbox = useQuery({
    queryKey: ['inbox'], enabled: navigator.onLine,
    queryFn: () => api<{ waiting: Array<{ id: string; vesselName: string }>; returned: Array<{ id: string; vesselName: string; returnComment: string }> }>('/approvals/inbox'),
  });

  const inspections = useLiveQuery(() => db.inspections.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const list = useMemo(
    () => inspections.filter((i) => !i.deletedAt && i.vesselName.toLowerCase().includes(q.trim().toLowerCase())),
    [inspections, q]);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16, display: 'grid', gap: 12 }}>
      <Title3>Ozellar · All Right Inspection</Title3>

      <Card>
        <Text>
          {sync?.state === 'syncing' ? 'Syncing…' : sync?.state === 'offline' ? `Offline — ${sync.pending} change(s) waiting`
            : sync?.state === 'error' ? `Sync problem: ${sync.message}` : sync?.lastSyncAt ? 'Synced just now' : 'Not synced yet'}
        </Text>
        <Button size="small" onClick={() => void syncNow()}>Sync now</Button>
      </Card>

      {me.data && me.data.role !== 'admin' && (
        <Text size={200}>Signed in as {ROLE_LABELS[me.data.role]} · {me.data.name}{me.data.designation ? ` — ${me.data.designation}` : ''}</Text>
      )}

      {!!inbox.data?.waiting.length && (
        <Card>
          <Text weight="semibold"><Badge>{inbox.data.waiting.length}</Badge> Waiting for your approval</Text>
          {inbox.data.waiting.map((w) => (
            <Button key={w.id} appearance="subtle" onClick={() => nav(`/inspections/${w.id}/report`)}>{w.vesselName}</Button>
          ))}
        </Card>
      )}
      {!!inbox.data?.returned.length && (
        <Card>
          <Text weight="semibold"><Badge color="danger">{inbox.data.returned.length}</Badge> Rejected — returned to you for correction</Text>
          {inbox.data.returned.map((w) => (
            <Button key={w.id} appearance="subtle" onClick={() => nav(`/inspections/${w.id}/report`)}>{w.vesselName}: {w.returnComment}</Button>
          ))}
        </Card>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <ToggleButton checked={!light} onClick={() => setLight(false)} style={{ flex: 1 }}>Normal mode</ToggleButton>
        <ToggleButton checked={light} onClick={() => setLight(true)} style={{ flex: 1 }}>Light mode</ToggleButton>
      </div>

      {me.data?.role !== 'director' && (
        <Button appearance="primary" onClick={() => nav('/inspections/new')}>+ New inspection</Button>
      )}

      <Input placeholder="Search vessel" value={q} onChange={(_, d) => setQ(d.value)} />

      {list.length === 0 ? <Text>No inspections yet.</Text> : list.map((i) => (
        <Card key={i.id} onClick={() => nav(`/inspections/${i.id}`)} style={{ cursor: 'pointer' }}>
          <Text weight="semibold">{i.vesselName}</Text>
          <Text size={200}>{[i.imo && `IMO ${i.imo}`, i.vesselType, i.startDate].filter(Boolean).join(', ')}</Text>
          <Badge appearance="tint" color={i.status === 'approved' ? 'success' : i.status === 'returned' ? 'danger' : 'warning'}>
            {STATUS_LABELS[i.status]}
          </Badge>
        </Card>
      ))}
    </div>
  );
}
