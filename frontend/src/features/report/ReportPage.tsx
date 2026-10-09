import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, isEditable, ROLE_LABELS, STATUS_LABELS, type ApprovalEvent, type InspectionStatus, type User } from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import { syncNow } from '../../offline/sync';
import { queueApprovalAction } from '../../offline/approvalQueue';
import { BackIcon, WarningIcon, LockIcon } from '../../icons';
import { loadReportData, type ReportData } from './reportData';
import { generateInspectionPdf } from './pdf';
import './ReportPage.css';

interface Approver { id: string; email: string; name: string; designation: string; role: string }
interface HistoryResponse { approval: { stage: string; tmUserId: string | null; directorUserId: string | null; returnComment?: string } | null; history: ApprovalEvent[] }

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Mock report stats (shown when real report hasn't loaded yet) ──────────

// ─── Inline icon helpers ───────────────────────────────────────────────────
function CheckCircleIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      <circle cx={12} cy={12} r={10} />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
function AlertIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function MinusCircleIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      <circle cx={12} cy={12} r={10} />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}
function ClockIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      <circle cx={12} cy={12} r={10} />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function ListIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
function CameraIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx={12} cy={14} r={3.4} />
    </svg>
  );
}
function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 17, height: 17 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}
function ThumbUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}
function ReturnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-5" />
    </svg>
  );
}

// ─── Stat tile ─────────────────────────────────────────────────────────────
interface StatTileProps {
  value: number;
  label: string;
  icon: React.ReactNode;
  accentBg: string;
  accentText: string;
}
function StatTile({ value, label, icon, accentBg, accentText }: StatTileProps) {
  return (
    <div className="stat-tile-container">
      <div className="stat-tile-header">
        <div className="stat-tile-icon-box" style={{ background: accentBg, color: accentText }}>
          {icon}
        </div>
        <div className="stat-tile-label">
          {label}
        </div>
      </div>
      <div className="stat-tile-value" style={{ color: accentText }}>
        {value}
      </div>
    </div>
  );
}

// ─── History event badge ───────────────────────────────────────────────────
function actionColor(action: string) {
  if (action === 'approved') return { bg: 'var(--ok-tint)', text: 'var(--ok)', border: 'var(--ok)' };
  if (action === 'rejected') return { bg: 'var(--bad-tint)', text: 'var(--bad)', border: 'var(--bad)' };
  if (action === 'submitted') return { bg: '#E6F0FA', text: '#1F5C99', border: '#1F5C99' };
  return { bg: 'var(--na-tint)', text: 'var(--na)', border: 'var(--na)' };
}

import { useCurrentUser } from '../../auth/useCurrentUser';

export function ReportPage() {
  const nav = useNavigate();
  const { id: inspectionId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const inspection = useLiveQuery(() => (inspectionId ? db.inspections.get(inspectionId) : undefined), [inspectionId]);
  const me = useCurrentUser();
  const history = useQuery({
    queryKey: ['approvalHistory', inspectionId], enabled: !!inspectionId,
    queryFn: async () => {
      if (navigator.onLine) {
        try {
          const res = await api<HistoryResponse>(`/inspections/${inspectionId}/approval`);
          if (res?.approval) {
            await db.approvals.put({ ...res.approval, id: inspectionId! } as any);
          }
          if (res?.history?.length) {
            await db.approvalEvents.bulkPut(res.history as any);
          }
          return res;
        } catch {
          // offline fallback below
        }
      }
      const localAppr = await db.approvals.get(inspectionId!);
      const localEvents = await db.approvalEvents.where('inspectionId').equals(inspectionId!).sortBy('createdAt');
      return {
        approval: localAppr ?? null,
        history: localEvents ?? [],
      } as HistoryResponse;
    },
  });

  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'photo' ? 'photo' : 'full';
  const [reportMode, setReportMode] = useState<'full' | 'photo'>(initialMode);

  const [summary, setSummary] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [seeded, setSeeded] = useState(false);
  if (inspection && !seeded) { setSummary(inspection.summary); setConclusion(inspection.conclusion); setSeeded(true); }

  const [approverId, setApproverId] = useState('');
  const [comment, setComment] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [report, setReport] = useState<ReportData | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!inspectionId) return;
    void loadReportData(inspectionId).then(setReport);
  }, [inspectionId, inspection?.updatedAt]);

  const isMock = !inspection && inspectionId?.startsWith('mock');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dispInspection: any = isMock ? { status: 'in_progress', id: inspectionId, vesselName: 'MV Pacific Star (Mock)', inspectionType: 'port', imo: '1234567', company: 'Ozellar Demo', inspector: 'Admin', port: 'Singapore' } : inspection;

  const canExport = !!report || isMock;

  const EMPTY_STATS: any = {
    totalQuestions: 0,
    answeredQuestions: 0,
    naQuestions: 0,
    findingCount: 0,
    photoCount: 0,
    bySection: {},
    satisfactory: 0,
    observations: 0,
    na: 0,
    pending: 0,
    extraFindings: 0,
    photoSectionCount: 0,
    defectPhotoCount: 0,
    photoSectionPhotosCount: 0,
    photoSectionDefectCount: 0,
    photoSectionExtraFindings: 0,
  };

  async function onExportPdf(overrideMode?: 'full' | 'photo') {
    if (!canExport) return;
    setExporting(true); setError(null);
    const mode = overrideMode || reportMode;
    try {
      let exportData = report;
      if (!exportData && isMock) {
        exportData = {
          inspection: dispInspection,
          sections: [],
          observations: [],
          stats: EMPTY_STATS
        };
      }
      const blob = await generateInspectionPdf({
        ...exportData!,
        approvalHistory: history.data?.history,
        reportType: mode === 'photo' ? 'photo_only' : 'full',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = (dispInspection.vesselName || 'inspection').replace(/[^a-z0-9]+/gi, '-');
      a.download = mode === 'photo' ? `${slug}-photo-section-report.pdf` : `${slug}-report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      setError('Could not generate the PDF — try again.');
    } finally {
      setExporting(false);
    }
  }

  const approvalLevel = dispInspection?.status === 'pending_tm' ? 'director'
    : me.data?.role === 'vesselManager' ? 'tm' : 'director';
  const approvers = useQuery({
    queryKey: ['approvers', approvalLevel, inspectionId, dispInspection?.vesselId],
    enabled: !!inspectionId && !!dispInspection && (dispInspection?.status === 'in_progress' || dispInspection?.status === 'returned' || dispInspection?.status === 'pending_tm'),
    queryFn: async () => {
      if (isMock) {
        return [{ id: 'mock-1', email: 'demo@ozellar.com', name: 'Demo Approver', designation: 'Technical Manager', role: 'techManager' }] as Approver[];
      }
      if (navigator.onLine) {
        try {
          return await api<Approver[]>(`/approvers?level=${approvalLevel}&inspectionId=${inspectionId}&vesselId=${dispInspection?.vesselId ?? ''}`);
        } catch {
          // offline fallback below
        }
      }
      const allUsers = await db.users.toArray();
      const targetRole = approvalLevel === 'tm' ? 'techManager' : 'director';
      const vesselId = dispInspection?.vesselId?.toLowerCase().trim();
      return allUsers
        .filter((u) => {
          if (u.isActive === false) return false;
          if (targetRole === 'director') return u.role === 'director' || u.role === 'admin';
          if (targetRole === 'techManager') {
            if (u.role === 'admin') return true;
            if (u.role === 'techManager') {
              if (!vesselId) return true;
              return (u.vesselIds ?? []).some((vid) => vid.toLowerCase().trim() === vesselId);
            }
          }
          return false;
        })
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          designation: u.designation,
          role: u.role,
        })) as Approver[];
    },
  });

  if (!dispInspection || !me.data) return null;

  if (inspection && !can(me.data, 'inspection.view', { inspection })) {
    return (
      <div className="page-wrap" style={{ padding: 32, textAlign: 'center' }}>
        <h2 style={{ color: 'var(--bad)', fontSize: 18, marginBottom: 8 }}>Access Restricted</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
          You do not have permission to view inspections for this vessel.
        </p>
        <button className="btn btn-outline" onClick={() => nav('/')}>Back to Home</button>
      </div>
    );
  }

  const editable = isEditable(dispInspection.status as any);
  const canSubmit = can(me.data, 'inspection.submit', { inspection: dispInspection });
  const approval = history.data?.approval;
  const canApproveHere = dispInspection.status as any === 'pending_tm'
    ? (me.data.role === 'admin' || (me.data.role === 'techManager' && approval?.tmUserId === me.data.id))
    : dispInspection.status as any === 'pending_director'
    ? (me.data.role === 'admin' || (me.data.role === 'director' && approval?.directorUserId === me.data.id))
    : false;
  const canReopen = dispInspection.status as any === 'approved' && me.data.role === 'admin';

  async function saveSummaryConclusion() {
    await localWrite('inspections', inspectionId!, { summary, conclusion });
  }

  async function act(path: 'submit' | 'approve' | 'reject' | 'reopen', body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      if (navigator.onLine) {
        try {
          const res = await api<{ status: InspectionStatus }>(`/inspections/${inspectionId}/${path}`, { method: 'POST', body });
          await db.inspections.update(inspectionId!, { status: res.status });
          try {
            const fresh = await api<HistoryResponse>(`/inspections/${inspectionId}/approval`);
            if (fresh?.approval) await db.approvals.put({ ...fresh.approval, id: inspectionId! } as any);
            if (fresh?.history?.length) await db.approvalEvents.bulkPut(fresh.history as any);
          } catch {
            // ignore
          }
          await qc.invalidateQueries({ queryKey: ['approvalHistory', inspectionId] });
          await qc.invalidateQueries({ queryKey: ['notifications'] });
          await qc.invalidateQueries({ queryKey: ['inbox'] });
          return;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const isNetworkError = !navigator.onLine || msg.includes('Failed to fetch') || msg.includes('Network');
          if (!isNetworkError) throw err;
        }
      }

      // Offline Transition Handling: update local IndexedDB and queue for sync
      let nextStatus: InspectionStatus = dispInspection.status;
      if (path === 'submit') {
        nextStatus = me.data?.role === 'vesselManager' ? 'pending_tm' : 'pending_director';
      } else if (path === 'approve') {
        nextStatus = dispInspection.status === 'pending_tm' ? 'pending_director' : 'approved';
      } else if (path === 'reject') {
        nextStatus = 'returned';
      } else if (path === 'reopen') {
        nextStatus = 'returned';
      }

      const now = new Date().toISOString();
      await db.inspections.update(inspectionId!, { status: nextStatus, updatedAt: now });
      await queueApprovalAction(inspectionId!, path, body);

      const stage = nextStatus === 'pending_tm' ? 'tm' : nextStatus === 'pending_director' ? 'director' : nextStatus === 'approved' ? 'approved' : 'returned';
      const existingAppr = await db.approvals.get(inspectionId!);
      await db.approvals.put({
        id: inspectionId!,
        inspectionId: inspectionId!,
        stage,
        submittedBy: existingAppr?.submittedBy || me.data?.id || '',
        submittedAt: existingAppr?.submittedAt || now,
        tmUserId: (body.approverId as string) || (body.nextApproverId as string) || existingAppr?.tmUserId || null,
        directorUserId: (body.approverId as string) || (body.nextApproverId as string) || existingAppr?.directorUserId || null,
        approvedAt: nextStatus === 'approved' ? now : null,
        returnedBy: nextStatus === 'returned' ? me.data?.id || null : null,
        returnComment: nextStatus === 'returned' ? (body.comment as string) || null : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // Save local ApprovalEvent so Audit Trail shows immediately offline!
      const levelLabel = path === 'submit'
        ? (me.data?.role === 'vesselManager' ? 'To Tech Manager' : 'To Director')
        : path === 'approve'
          ? (dispInspection.status === 'pending_tm' ? 'Level 1 — Tech Manager' : 'Final — Director')
          : path === 'reject' ? 'Returned by Reviewer' : 'Reopened by Admin';

      const localEvent: ApprovalEvent = {
        id: crypto.randomUUID(),
        inspectionId: inspectionId!,
        action: path === 'submit' ? 'submitted' : path === 'approve' ? 'approved' : path === 'reject' ? 'rejected' : 'reopened',
        level: levelLabel,
        actorUserId: me.data?.id || '',
        actorName: me.data?.name || me.data?.email || 'User',
        actorDesignation: me.data?.designation || '',
        actorRole: me.data?.role || 'techManager',
        targetUserId: (body.nextApproverId as string) || (body.approverId as string) || null,
        comment: (body.comment as string) || '',
        createdAt: now,
      };
      await db.approvalEvents.put(localEvent as any);

      // Create local notifications for the Director / user
      const notifTitle = path === 'approve'
        ? (nextStatus === 'approved' ? 'Inspection Approved' : 'Technical Review Completed — Director Approval Needed')
        : path === 'submit' ? 'Inspection Submitted for Review' : 'Inspection Returned for Correction';
      const notifMsg = path === 'approve'
        ? (nextStatus === 'approved' ? `${dispInspection.vesselName}: Inspection officially approved by ${me.data?.name || 'Tech Manager'}` : `${dispInspection.vesselName}: Reviewed and endorsed by ${me.data?.name || 'Tech Manager'}. Ready for final Director approval.`)
        : path === 'submit' ? `${dispInspection.vesselName}: Inspection submitted for review` : `${dispInspection.vesselName}: Returned by reviewer`;

      try {
        const allUsers = await db.users.toArray();
        const targetDirs = allUsers.filter(u => u.role === 'director' || u.id === (body.nextApproverId as string));
        for (const dir of targetDirs) {
          await db.notifications.put({
            id: crypto.randomUUID(),
            userId: dir.id,
            inspectionId: inspectionId!,
            type: path === 'approve' ? 'inspection_approved' : path === 'submit' ? 'inspection_submitted' : 'inspection_returned',
            title: notifTitle,
            message: notifMsg,
            link: `/inspections/${inspectionId}/report`,
            read: false,
            createdAt: now,
          });
        }
      } catch {
        // ignore
      }

      await qc.invalidateQueries({ queryKey: ['approvalHistory', inspectionId] });
      await qc.invalidateQueries({ queryKey: ['notifications'] });
      await qc.invalidateQueries({ queryKey: ['inbox'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Something went wrong'));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (reportMode === 'full' && stats.pending > 0) {
      setError(`All checklist questions must be answered (Yes / No / N/A) before submitting for approval (${stats.pending} remaining).`);
      return;
    }
    const photoCountInSecs = stats.photoSectionPhotosCount ?? stats.photoCount;
    if (reportMode === 'photo' && photoCountInSecs === 0) {
      setError('Please add at least one photo in photo sections before submitting a Photo Section Report.');
      return;
    }
    if (!summary.trim() || !conclusion.trim()) {
      setError('Please add both a Summary and Conclusion before submitting.');
      return;
    }
    if (!approverId) {
      setError(me.data!.role === 'vesselManager' ? 'Choose a Technical Manager to review' : 'Choose a Director for sign-off');
      return;
    }
    await saveSummaryConclusion();
    if (navigator.onLine) await syncNow();
    await act('submit', { approverId, comment, photoOnly: reportMode === 'photo' });
  }

  async function onApprove() {
    if (dispInspection.status === 'pending_tm') {
      if (!approverId) { setError('Choose the Director for final approval'); return; }
      await act('approve', { nextApproverId: approverId, comment });
    } else {
      await act('approve', { comment });
    }
  }

  async function onReject() {
    if (!rejectComment.trim()) { setError('A reason is required'); return; }
    await act('reject', { comment: rejectComment });
  }

  async function onReopen() {
    await act('reopen', {});
  }

  // Use real stats if available, mock if report hasn't loaded
  const stats = report?.stats ?? EMPTY_STATS;

  return (
    <>
      {/* ── App bar ── */}
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => nav(`/inspections/${inspectionId}`)}><BackIcon /></button>
        <div className="title-wrap">
          <h1>{dispInspection.vesselName}</h1>
          <div className="sub">{STATUS_LABELS[dispInspection.status as import('@ozellar/shared').InspectionStatus]}</div>
        </div>
        {canExport && (
          <button
            type="button"
            disabled={exporting}
            onClick={() => void onExportPdf()}
            className="report-subnav-export-btn"
            title="Download PDF Inspection Report"
          >
            {exporting ? (
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67"/>
              </svg>
            ) : (
              <PdfIcon />
            )}
            <span className="report-pdf-label-full">{exporting ? 'Generating…' : 'Download PDF'}</span>
            <span className="report-pdf-label-short">{exporting ? 'Generating…' : 'PDF'}</span>
          </button>
        )}
      </div>

      <div className="page-wrap" style={{ paddingTop: 16 }}>

        {/* ── Error banner ── */}
        {error && (
          <div style={{
            margin: '0 16px 12px', padding: '12px 14px', borderRadius: 'var(--radius)',
            background: 'var(--bad-tint)', border: '1px solid var(--bad)',
            color: 'var(--bad)', fontSize: 13.5, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8
          }}>
            <WarningIcon width={16} height={16} style={{ flexShrink: 0 }} /> {error}
          </div>
        )}

        {/* ── Report Type Switcher ── */}
        <div className="report-mode-toggle-card">
          <div className="report-mode-toggle-header">
            <div className="report-mode-toggle-top-row">
              <div className="report-mode-toggle-title">
                <span>Select Report Type</span>
              </div>
              <span className={`report-mode-toggle-badge ${reportMode === 'photo' ? 'photo' : 'full'}`}>
                {reportMode === 'photo' ? 'Photo Sections' : 'Full Checklist'}
              </span>
            </div>
            <div className="report-mode-toggle-desc">
              {reportMode === 'photo'
                ? 'Photo Section Report: Focuses exclusively on photo sections, summary, and conclusion. Standard checklist questions are omitted.'
                : 'Full Checklist Report: Comprehensive report including all sections, questions, photos, and observations.'}
            </div>
          </div>
          <div className="report-mode-pills" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={reportMode === 'full'}
              className={`report-mode-pill ${reportMode === 'full' ? 'active' : ''}`}
              onClick={() => setReportMode('full')}
            >
              <ListIcon color={reportMode === 'full' ? 'var(--accent)' : '#64748b'} />
              <span>Full Checklist Report</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reportMode === 'photo'}
              className={`report-mode-pill ${reportMode === 'photo' ? 'active photo-mode' : ''}`}
              onClick={() => setReportMode('photo')}
            >
              <CameraIcon color={reportMode === 'photo' ? '#ffffff' : '#64748b'} />
              <span>Photo Section Report</span>
            </button>
          </div>
        </div>

        {/* ── Workflow Stepper ── */}
        <div className="stepper-card">
          <div className="stepper-title">Inspection Lifecycle</div>
          <div className="stepper-track">
            {[
              {
                label: dispInspection.status === 'returned' ? 'Returned' : 'In Progress',
                sub: dispInspection.status === 'returned' ? 'Needs Fix' : 'Inspector',
                isDone: dispInspection.status !== 'in_progress' && dispInspection.status !== 'returned',
                isCurrent: dispInspection.status === 'in_progress' || dispInspection.status === 'returned',
                isReturned: dispInspection.status === 'returned',
              },
              {
                label: 'Technical Review',
                sub: 'Tech Manager',
                isDone: dispInspection.status === 'pending_director' || dispInspection.status === 'approved',
                isCurrent: dispInspection.status === 'pending_tm',
                isReturned: false,
              },
              {
                label: 'Director Sign-off',
                sub: 'Director',
                isDone: dispInspection.status === 'approved',
                isCurrent: dispInspection.status === 'pending_director',
                isReturned: false,
              },
              {
                label: 'Approved & Locked',
                sub: 'Final Record',
                isDone: dispInspection.status === 'approved',
                isCurrent: false,
                isReturned: false,
              },
            ].map((st, idx) => (
              <div
                key={idx}
                className={`stepper-node ${st.isDone ? 'done' : st.isReturned ? 'returned' : st.isCurrent ? 'current' : 'pending'}`}
              >
                <div className="stepper-circle">
                  {st.isDone ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : st.isReturned ? (
                    '!'
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <div className="stepper-label">{st.label}</div>
                <div className="stepper-sub">{st.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Locked State Banners ── */}
        {dispInspection.status === 'pending_tm' && (
          <div className="locked-banner info">
            <div className="locked-banner-icon"><LockIcon width={20} height={20} /></div>
            <div className="locked-banner-content">
              <strong>Inspection Under Technical Review</strong>
              <span>Submitted to Technical Manager. Further edits are locked while review is in progress.</span>
            </div>
          </div>
        )}
        {dispInspection.status === 'pending_director' && (
          <div className="locked-banner info">
            <div className="locked-banner-icon"><LockIcon width={20} height={20} /></div>
            <div className="locked-banner-content">
              <strong>Inspection Under Director Sign-off</strong>
              <span>Forwarded to Director for final executive sign-off. Editing is locked.</span>
            </div>
          </div>
        )}
        {dispInspection.status === 'approved' && (
          <div className="locked-banner success">
            <div className="locked-banner-icon"><CheckCircleIcon color="var(--ok)" /></div>
            <div className="locked-banner-content">
              <strong>Official Approved Inspection</strong>
              <span>This inspection has received final Director approval and is permanently locked.</span>
            </div>
          </div>
        )}
        {dispInspection.status === 'returned' && (
          <div className="locked-banner warning">
            <div className="locked-banner-icon"><WarningIcon width={20} height={20} /></div>
            <div className="locked-banner-content">
              <strong>Returned for Correction</strong>
              <span>{approval?.returnComment ? `Reviewer comment: "${approval.returnComment}"` : 'Please address reviewer comments and resubmit.'}</span>
            </div>
          </div>
        )}

        {/* ── Premium stat tiles grid ── */}
        <div className="report-stats-section">
          {reportMode === 'photo' ? (
            <>
              <div className="stats-grid-top">
                <StatTile value={stats.photoSectionPhotosCount ?? 0} label="Total Photos"
                  icon={<CameraIcon color="#1F5C99" />}
                  accentBg="#E6F0FA" accentText="#1F5C99" />
                <StatTile value={stats.photoSectionCount ?? 0} label="Photo Sections"
                  icon={<ListIcon color="var(--accent)" />}
                  accentBg="var(--accent-tint)" accentText="var(--accent)" />
                <StatTile value={Math.max((stats.photoSectionPhotosCount ?? 0) - (stats.photoSectionDefectCount ?? 0), 0)} label="Normal Photos"
                  icon={<CheckCircleIcon color="var(--ok)" />}
                  accentBg="var(--ok-tint)" accentText="var(--ok)" />
                <StatTile value={stats.photoSectionDefectCount ?? 0} label="Defects Flagged"
                  icon={<AlertIcon color={stats.photoSectionDefectCount ? "var(--bad)" : "var(--muted)"} />}
                  accentBg={stats.photoSectionDefectCount ? "var(--bad-tint)" : "var(--na-tint)"}
                  accentText={stats.photoSectionDefectCount ? "var(--bad)" : "var(--muted)"} />
              </div>
              <div className="stats-grid-bottom" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <StatTile value={stats.photoSectionExtraFindings ?? 0} label="Extra Observations"
                  icon={<ListIcon color="var(--accent-dark)" />}
                  accentBg="var(--accent-tint)" accentText="var(--accent-dark)" />
                <StatTile value={STATUS_LABELS[dispInspection.status as import('@ozellar/shared').InspectionStatus] || dispInspection.status} label="Inspection State"
                  icon={<CheckCircleIcon color="var(--ok)" />}
                  accentBg="var(--ok-tint)" accentText="var(--ink)" />
              </div>
            </>
          ) : (
            <>
              <div className="stats-grid-top">
                <StatTile value={stats.totalQuestions} label="Total"
                  icon={<ListIcon color="var(--accent)" />}
                  accentBg="var(--accent-tint)" accentText="var(--accent)" />
                <StatTile value={stats.satisfactory} label="Satisfactory"
                  icon={<CheckCircleIcon color="var(--ok)" />}
                  accentBg="var(--ok-tint)" accentText="var(--ok)" />
                <StatTile value={stats.observations} label="Observations"
                  icon={<AlertIcon color="var(--bad)" />}
                  accentBg="var(--bad-tint)" accentText="var(--bad)" />
                <StatTile value={stats.na} label="N/A"
                  icon={<MinusCircleIcon color="var(--na)" />}
                  accentBg="var(--na-tint)" accentText="var(--na)" />
              </div>
              <div className="stats-grid-bottom">
                <StatTile value={stats.pending} label="Pending"
                  icon={<ClockIcon color="var(--warn)" />}
                  accentBg="var(--warn-tint)" accentText="var(--warn)" />
                <StatTile value={stats.photoCount} label="Photos"
                  icon={<CameraIcon color="#1F5C99" />}
                  accentBg="#E6F0FA" accentText="#1F5C99" />
                <StatTile value={stats.extraFindings} label="Extra Findings"
                  icon={<ListIcon color="var(--accent-dark)" />}
                  accentBg="var(--accent-tint)" accentText="var(--accent-dark)" />
              </div>
            </>
          )}

          {/* ── Export PDF buttons ── */}
          <div className="report-pdf-download-actions">
            <button
              type="button"
              disabled={exporting || !canExport}
              onClick={() => void onExportPdf(reportMode)}
              className={`report-download-official-btn ${reportMode === 'photo' ? 'btn-photo-pdf' : ''}`}
            >
              {exporting ? (
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67"/>
                </svg>
              ) : (
                <PdfIcon />
              )}
              <span>
                {exporting
                  ? (reportMode === 'photo' ? 'Generating Photo Section PDF…' : 'Preparing Official PDF Report…')
                  : (reportMode === 'photo' ? 'Download Photo Section Report (PDF)' : 'Download Official PDF Report')}
              </span>
            </button>

            <button
              type="button"
              disabled={exporting || !canExport}
              onClick={() => void onExportPdf(reportMode === 'photo' ? 'full' : 'photo')}
              className="report-download-alt-btn"
            >
              <PdfIcon />
              <span>{reportMode === 'photo' ? 'Download Full Checklist Report (PDF)' : 'Download Photo Section Report (PDF)'}</span>
            </button>
          </div>
        </div>

        {/* ── Summary & Conclusion textareas ── */}
        <div className="premium-report-card">
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            Summary
          </div>
          <textarea
            placeholder="Overall summary of this inspection..."
            disabled={!editable}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={saveSummaryConclusion}
            style={{ width: '100%', minHeight: 80, marginBottom: 20, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 10, padding: 12, fontSize: 14, outline: 'none', color: '#0f172a', resize: 'vertical' }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#0d9488'; e.currentTarget.style.background = '#ffffff'; }}
            onBlurCapture={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = '#f8fafc'; }}
          />

          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            Conclusion
          </div>
          <textarea
            placeholder="Conclusion / recommendation..."
            disabled={!editable}
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            onBlur={saveSummaryConclusion}
            style={{ width: '100%', minHeight: 80, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 10, padding: 12, fontSize: 14, outline: 'none', color: '#0f172a', resize: 'vertical' }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#0d9488'; e.currentTarget.style.background = '#ffffff'; }}
            onBlurCapture={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = '#f8fafc'; }}
          />
        </div>

        {/* ── Submit for approval card ── */}
        {canSubmit && (
          <div className="premium-report-card">
            <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a', marginBottom: 4, letterSpacing: '-0.3px' }}>
              {reportMode === 'photo'
                ? (me.data.role === 'vesselManager'
                    ? 'Submit Photo Section Report to Technical Manager'
                    : me.data.role === 'techManager'
                    ? 'Submit Photo Section Report to Director'
                    : 'Submit Photo Section Report for Approval')
                : (me.data.role === 'vesselManager'
                    ? 'Submit to Technical Manager'
                    : me.data.role === 'techManager'
                    ? 'Submit to Director for Sign-off'
                    : 'Submit for Approval')}
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              {reportMode === 'photo'
                ? 'Photo Section Submission: Only photo sections, summary, and conclusion will be submitted for technical sign-off. Standard checklist questions are bypassed.'
                : (me.data.role === 'vesselManager'
                    ? 'Select an assigned Technical Manager to review your findings and photos.'
                    : me.data.role === 'techManager'
                    ? 'As Technical Manager, your inspection is submitted directly to the Director for final executive sign-off.'
                    : 'Select an approver to review this inspection.')}
            </div>

            {/* Validation alerts */}
            {(!summary.trim() || !conclusion.trim()) && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 10,
                padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#b45309',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                <WarningIcon width={16} height={16} style={{ flexShrink: 0 }} />
                <span>Summary and Conclusion must be filled before submitting.</span>
              </div>
            )}
            {reportMode === 'photo' && (stats.photoSectionPhotosCount ?? stats.photoCount) === 0 && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 10,
                padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#b45309',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                <WarningIcon width={16} height={16} style={{ flexShrink: 0 }} />
                <span>At least one photo must be captured in photo sections before submitting.</span>
              </div>
            )}
            {reportMode === 'full' && stats.pending > 0 && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 10,
                padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#b45309',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                <WarningIcon width={16} height={16} style={{ flexShrink: 0 }} />
                <span>
                  All checklist questions must be evaluated (Yes / No / N/A) before submitting (<strong>{stats.pending} question{stats.pending !== 1 ? 's' : ''} remaining</strong>).
                </span>
              </div>
            )}

            {approvers.data && approvers.data.length === 0 && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 10,
                padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#b45309',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                <WarningIcon width={16} height={16} style={{ flexShrink: 0 }} />
                <span>
                  {me.data.role === 'vesselManager'
                    ? 'No Technical Manager is assigned to this vessel yet. Ask an Administrator to assign a Technical Manager to this vessel.'
                    : 'No Director found in the system for final approval.'}
                </span>
              </div>
            )}

            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
              {me.data.role === 'vesselManager' ? 'Select Technical Manager' : 'Select Director'}
            </div>
            <select
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              style={{ width: '100%', marginBottom: 16, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 10, padding: '12px 14px', fontSize: 14, outline: 'none', color: '#0f172a' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#0d9488'; e.currentTarget.style.background = '#ffffff'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = '#f8fafc'; }}
            >
              <option value="">
                {approvers.data && approvers.data.length === 0
                  ? (me.data.role === 'vesselManager' ? 'No Technical Manager assigned to this vessel' : 'No Director available')
                  : (me.data.role === 'vesselManager' ? 'Select assigned Technical Manager…' : 'Select Director…')}
              </option>
              {approvers.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email}{a.designation ? ` — ${a.designation}` : ''}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Note to approver (optional)</div>
            <textarea
              placeholder="Anything the approver should know..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={{ width: '100%', minHeight: 60, marginBottom: 16, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 10, padding: 12, fontSize: 14, outline: 'none', color: '#0f172a', resize: 'vertical' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#0d9488'; e.currentTarget.style.background = '#ffffff'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = '#f8fafc'; }}
            />
            {(() => {
              const photoSecCount = stats.photoSectionPhotosCount ?? stats.photoCount;
              const canClickSubmit = !busy && summary.trim() && conclusion.trim() && approverId && (reportMode === 'photo' ? photoSecCount > 0 : stats.pending === 0);
              return (
                <button
                  disabled={!canClickSubmit}
                  onClick={() => void onSubmit()}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    background: !canClickSubmit ? '#94a3b8' : (reportMode === 'photo' ? 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)' : '#0f172a'),
                    color: '#fff', border: 'none',
                    borderRadius: 12, padding: '13px 20px',
                    fontWeight: 700, fontSize: 14.5,
                    cursor: !canClickSubmit ? 'not-allowed' : 'pointer',
                    minHeight: 48, opacity: busy ? 0.7 : 1, letterSpacing: '0.1px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {busy ? 'Sending…'
                    : reportMode === 'photo'
                    ? (photoSecCount === 0 ? 'Capture Photos in Photo Sections First'
                      : me.data.role === 'vesselManager' ? 'Submit Photo Report to Technical Manager'
                      : me.data.role === 'techManager' ? 'Submit Photo Report to Director'
                      : 'Submit Photo Section Report')
                    : (stats.pending > 0 ? `Answer All Questions First (${stats.pending} remaining)`
                      : me.data.role === 'vesselManager' ? 'Submit to Technical Manager'
                      : me.data.role === 'techManager' ? 'Submit to Director'
                      : 'Submit for Approval')}
                </button>
              );
            })()}
          </div>
        )}

        {/* ── Approve / Reject card ── */}
        {canApproveHere && (
          <div className="premium-report-card">
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--ink)', marginBottom: 4 }}>
              {dispInspection.status as any === 'pending_tm' ? 'Technical Review (Level 1)' : 'Executive Sign-off (Director)'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
              {dispInspection.status as any === 'pending_tm'
                ? 'Review the inspection findings, observations, and photos. Forward to a Director for final sign-off, or return to the Vessel Manager for corrections.'
                : 'You have executive approval authority. Granting final approval will officially complete and permanently lock this inspection.'}
            </div>

            {dispInspection.status as any === 'pending_tm' && (
              <>
                <div className="seg-label" style={{ marginTop: 0 }}>Select Director for Final Approval</div>
                <select
                  className="auth-input"
                  value={approverId}
                  onChange={(e) => setApproverId(e.target.value)}
                  style={{ marginBottom: 12 }}
                >
                  <option value="">Select a Director…</option>
                  {approvers.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.email}{a.designation ? ` — ${a.designation}` : ''}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className="seg-label">Review note (optional)</div>
            <textarea
              placeholder="Note (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={{ width: '100%', marginBottom: 14, minHeight: 60 }}
            />

            {/* Approve button */}
            <button
              disabled={busy || (dispInspection.status as any === 'pending_tm' && !approverId)}
              onClick={() => void onApprove()}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: (dispInspection.status as any === 'pending_tm' && !approverId) ? '#94a3b8' : 'var(--ok)',
                color: '#fff', border: 'none',
                borderRadius: 10, padding: '13px 20px',
                fontWeight: 700, fontSize: 14.5,
                cursor: (busy || (dispInspection.status as any === 'pending_tm' && !approverId)) ? 'not-allowed' : 'pointer',
                minHeight: 48, opacity: busy ? 0.7 : 1, marginBottom: 16,
                boxShadow: '0 4px 12px rgba(31,138,87,0.25)',
              }}
            >
              <ThumbUpIcon />
              {busy ? 'Please wait…'
                : dispInspection.status as any === 'pending_tm' ? 'Approve & Forward to Director'
                : 'Give Final Approval'}
            </button>

            {/* Divider */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
            }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 12, color: 'var(--faint)', fontWeight: 600 }}>OR</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            {/* Reject section */}
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--bad)', marginBottom: 6 }}>
              {dispInspection.status as any === 'pending_tm'
                ? 'Reject / Return to Vessel Manager'
                : 'Reject / Return for Correction'}
            </div>
            <textarea
              placeholder="Specify what needs correction (required)..."
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              style={{ width: '100%', marginBottom: 10, minHeight: 60 }}
            />
            <button
              disabled={busy || !rejectComment.trim()}
              onClick={() => void onReject()}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: !rejectComment.trim() ? '#fee2e2' : 'var(--bad-tint)',
                color: 'var(--bad)',
                border: '1.5px solid var(--bad)',
                borderRadius: 10, padding: '12px 20px',
                fontWeight: 700, fontSize: 14.5,
                cursor: (busy || !rejectComment.trim()) ? 'not-allowed' : 'pointer',
                minHeight: 46, opacity: busy ? 0.7 : 1,
              }}
            >
              <ReturnIcon />
              {dispInspection.status as any === 'pending_tm'
                ? 'Reject & Return to Vessel Manager'
                : 'Reject & Return for Correction'}
            </button>
          </div>
        )}

        {/* ── Admin reopen ── */}
        {canReopen && (
          <div style={{ margin: '0 16px 16px' }}>
            <button
              className="btn btn-outline btn-block"
              disabled={busy}
              onClick={() => void onReopen()}
            >
              Reopen Inspection (Admin)
            </button>
          </div>
        )}

        {/* ── Observations list ── */}
        <div className="report-section-header" style={{ margin: '8px 16px 10px' }}>
          Observations ({report?.observations.length ?? 0})
        </div>
        {!report?.observations.length ? (
          <p className="extras-hint report-empty-hint" style={{ margin: '0 16px 16px' }}>No observations recorded.</p>
        ) : report.observations.map((o, i) => (
          <div
            key={i}
            className="observation-row-card"
            onClick={() => nav(`/inspections/${inspectionId}/sections/${o.sectionId}`)}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderLeft: '4px solid var(--bad)',
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(11,33,56,0.05)',
              transition: 'box-shadow 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = '0 3px 12px rgba(11,33,56,0.10)'}
            onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(11,33,56,0.05)'}
          >
            <div style={{
              fontSize: 10.5, fontWeight: 800, color: 'var(--bad)',
              textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 4,
            }}>
              {o.sectionName} — {o.ref}
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>
              {o.text || '(no description)'}
            </div>
          </div>
        ))}

        {/* ── Approval history ── */}
        <div className="report-section-header" style={{
          margin: '16px 16px 10px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <HistoryIcon />
          Approval History & Audit Trail
        </div>
        {!history.data?.history.length ? (
          <p className="extras-hint report-empty-hint" style={{ margin: '0 16px 24px' }}>Not submitted yet.</p>
        ) : history.data.history.map((ev) => {
          const c = actionColor(ev.action);
          return (
            <div
              key={ev.id}
              className="report-history-card"
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '12px 14px',
                boxShadow: '0 1px 4px rgba(11,33,56,0.05)',
                display: 'flex', gap: 12, alignItems: 'flex-start',
              }}
            >
              {/* Timeline dot */}
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: c.text,
                flexShrink: 0, marginTop: 6,
                boxShadow: `0 0 0 3px ${c.bg}`,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
                    background: c.bg, color: c.text, border: `1px solid ${c.border}`,
                    textTransform: 'capitalize',
                  }}>
                    {ev.action}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--faint)' }}>{ev.level}</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                  {ev.actorName || ROLE_LABELS[ev.actorRole as import('@ozellar/shared').Role] || ev.actorRole}
                  {ev.actorDesignation ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> — {ev.actorDesignation}</span> : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>
                  {fmtDateTime(ev.createdAt)}
                </div>
                {ev.comment && (
                  <div style={{
                    marginTop: 8, padding: '8px 10px',
                    background: 'var(--bg)', borderRadius: 6,
                    fontSize: 13, color: 'var(--muted)', fontStyle: 'italic',
                    borderLeft: `3px solid ${c.text}`,
                  }}>
                    "{ev.comment}"
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div style={{ height: 24 }} />
      </div>
    </>
  );
}


