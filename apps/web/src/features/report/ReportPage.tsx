import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isEditable, ROLE_LABELS, STATUS_LABELS, type ApprovalEvent, type InspectionStatus, type User } from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import { syncNow } from '../../offline/sync';
import { BackIcon } from '../../icons';
import { loadReportData, type ReportData } from './reportData';
import { generateInspectionPdf } from './pdf';

interface Approver { id: string; email: string; name: string; designation: string; role: string }
interface HistoryResponse { approval: { stage: string; tmUserId: string | null; directorUserId: string | null } | null; history: ApprovalEvent[] }

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ReportPage() {
  const nav = useNavigate();
  const { id: inspectionId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const inspection = useLiveQuery(() => (inspectionId ? db.inspections.get(inspectionId) : undefined), [inspectionId]);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const history = useQuery({
    queryKey: ['approvalHistory', inspectionId], enabled: !!inspectionId,
    queryFn: () => api<HistoryResponse>(`/inspections/${inspectionId}/approval`),
  });

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

  async function onExportPdf() {
    if (!report) return;
    setExporting(true); setError(null);
    try {
      const blob = await generateInspectionPdf(report);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(report.inspection.vesselName || 'inspection').replace(/[^a-z0-9]+/gi, '-')}-report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not generate the PDF — try again.');
    } finally {
      setExporting(false);
    }
  }

  const approvalLevel = inspection?.status === 'pending_tm' ? 'director'
    : me.data?.role === 'vesselManager' ? 'tm' : 'director';
  const approvers = useQuery({
    queryKey: ['approvers', approvalLevel, inspectionId],
    enabled: !!inspectionId && !!inspection && (inspection.status === 'in_progress' || inspection.status === 'returned' || inspection.status === 'pending_tm'),
    queryFn: () => api<Approver[]>(`/approvers?level=${approvalLevel}&inspectionId=${inspectionId}`),
  });

  if (!inspection || !me.data) return null;
  const editable = isEditable(inspection.status);
  const canSubmit = editable && me.data.role !== 'director';
  const approval = history.data?.approval;
  const canApproveHere = inspection.status === 'pending_tm'
    ? (me.data.role === 'admin' || (me.data.role === 'techManager' && approval?.tmUserId === me.data.id))
    : inspection.status === 'pending_director'
    ? (me.data.role === 'admin' || (me.data.role === 'director' && approval?.directorUserId === me.data.id))
    : false;
  const canReopen = inspection.status === 'approved' && me.data.role === 'admin';

  async function saveSummaryConclusion() {
    await localWrite('inspections', inspectionId!, { summary, conclusion });
  }

  async function act(path: string, body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await api<{ status: InspectionStatus }>(`/inspections/${inspectionId}/${path}`, { method: 'POST', body });
      // approve/reject/submit/reopen change the inspection's status directly on the server — the local
      // offline copy has no way to know that until the next sync pull, so patch it in immediately.
      await db.inspections.update(inspectionId!, { status: res.status });
      await qc.invalidateQueries({ queryKey: ['approvalHistory', inspectionId] });
      await qc.invalidateQueries({ queryKey: ['inbox'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (!approverId) { setError('Choose who to send it to'); return; }
    await saveSummaryConclusion();
    await syncNow(); // submit is a direct API call, not an offline mutation — the server needs summary/conclusion first
    await act('submit', { approverId, comment });
  }
  async function onApprove() {
    if (inspection!.status === 'pending_tm') {
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

  return (
    <>
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => nav(`/inspections/${inspectionId}`)}><BackIcon /></button>
        <div className="title-wrap">
          <h1>{inspection.vesselName}</h1>
          <div className="sub">{STATUS_LABELS[inspection.status]}</div>
        </div>
      </div>

      <div className="page-wrap" style={{ paddingTop: 16 }}>
        {error && <div className="section-pad"><div className="auth-error">{error}</div></div>}

        {report && (
          <div className="section-pad">
            <div className="stat-grid">
              <div className="stat-tile"><div className="n">{report.stats.totalQuestions}</div><div className="l">Total</div></div>
              <div className="stat-tile ok"><div className="n">{report.stats.satisfactory}</div><div className="l">Satisfactory</div></div>
              <div className="stat-tile bad"><div className="n">{report.stats.observations}</div><div className="l">Observations</div></div>
              <div className="stat-tile na"><div className="n">{report.stats.na}</div><div className="l">N/A</div></div>
              <div className="stat-tile pending"><div className="n">{report.stats.pending}</div><div className="l">Pending</div></div>
              <div className="stat-tile"><div className="n">{report.stats.photoCount}</div><div className="l">Photos</div></div>
              <div className="stat-tile"><div className="n">{report.stats.extraFindings}</div><div className="l">Extra findings</div></div>
            </div>
            <button className="btn btn-outline btn-block" disabled={exporting} onClick={() => void onExportPdf()}>
              {exporting ? 'Generating PDF…' : 'Export PDF'}
            </button>
          </div>
        )}

        <div className="section-pad" style={{ marginBottom: 16 }}>
          <div className="seg-label">Summary</div>
          <textarea placeholder="Overall summary of this inspection..." disabled={!editable}
            value={summary} onChange={(e) => setSummary(e.target.value)} onBlur={saveSummaryConclusion} style={{ width: '100%', minHeight: 70 }} />
          <div className="seg-label">Conclusion</div>
          <textarea placeholder="Conclusion / recommendation..." disabled={!editable}
            value={conclusion} onChange={(e) => setConclusion(e.target.value)} onBlur={saveSummaryConclusion} style={{ width: '100%', minHeight: 70 }} />
        </div>

        {canSubmit && (
          <div className="qcard extras-card">
            <div className="seg-label">Send for approval to</div>
            <select className="auth-input" value={approverId} onChange={(e) => setApproverId(e.target.value)}>
              <option value="">Select…</option>
              {approvers.data?.map((a) => <option key={a.id} value={a.id}>{a.name || a.email}{a.designation ? ` — ${a.designation}` : ''}</option>)}
            </select>
            <div className="seg-label">Note (optional)</div>
            <textarea placeholder="Anything the approver should know..." value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} />
            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={() => void onSubmit()}>
              {busy ? 'Sending…' : 'Submit for approval'}
            </button>
          </div>
        )}

        {canApproveHere && (
          <div className="qcard extras-card">
            <div className="seg-label">{inspection.status === 'pending_tm' ? 'Approve — pick the Director for final approval' : 'Final approval'}</div>
            {inspection.status === 'pending_tm' && (
              <select className="auth-input" value={approverId} onChange={(e) => setApproverId(e.target.value)}>
                <option value="">Select a Director…</option>
                {approvers.data?.map((a) => <option key={a.id} value={a.id}>{a.name || a.email}{a.designation ? ` — ${a.designation}` : ''}</option>)}
              </select>
            )}
            <textarea placeholder="Note (optional)" value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={() => void onApprove()}>
              {busy ? 'Please wait…' : inspection.status === 'pending_tm' ? 'Approve → send to Director' : 'Give final approval'}
            </button>
            <div className="seg-label" style={{ color: 'var(--bad)' }}>Or reject with a reason</div>
            <textarea placeholder="Why is this being returned?" value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} style={{ width: '100%' }} />
            <button className="btn btn-outline btn-block" style={{ marginTop: 8, color: 'var(--bad)', borderColor: 'var(--bad)' }} disabled={busy} onClick={() => void onReject()}>
              Reject / return for correction
            </button>
          </div>
        )}

        {canReopen && (
          <div className="section-pad" style={{ marginBottom: 16 }}>
            <button className="btn btn-outline btn-block" disabled={busy} onClick={() => void onReopen()}>Reopen (Admin)</button>
          </div>
        )}

        {inspection.status === 'returned' && approval && (
          <div className="section-pad" style={{ marginBottom: 16 }}>
            <div className="auth-error">Returned for correction — see the reason in the history below.</div>
          </div>
        )}

        <div className="report-section-title">Observations ({report?.observations.length ?? 0})</div>
        {!report?.observations.length ? (
          <p className="extras-hint">No observations recorded.</p>
        ) : report.observations.map((o, i) => (
          <div key={i} className="observation-row" onClick={() => nav(`/inspections/${inspectionId}/sections/${o.sectionId}`)}>
            <div className="oref">{o.sectionName} — {o.ref}</div>
            <div className="otext">{o.text || '(no description)'}</div>
          </div>
        ))}

        <div className="report-section-title">Approval history</div>
        {!history.data?.history.length ? (
          <p className="extras-hint">Not submitted yet.</p>
        ) : history.data.history.map((ev) => (
          <div key={ev.id} className="section-pad" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
              {ev.action === 'submitted' ? 'Submitted' : ev.action === 'approved' ? 'Approved' : ev.action === 'rejected' ? 'Rejected' : 'Reopened'} — {ev.level}
            </div>
            <div className="vmeta">{ev.actorName || ROLE_LABELS[ev.actorRole]}{ev.actorDesignation ? ` — ${ev.actorDesignation}` : ''} · {fmtDateTime(ev.createdAt)}</div>
            {ev.comment && <div className="vmeta" style={{ marginTop: 2 }}>&ldquo;{ev.comment}&rdquo;</div>}
          </div>
        ))}
      </div>
    </>
  );
}
