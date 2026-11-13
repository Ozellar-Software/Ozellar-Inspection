import { describe, expect, it } from 'vitest';
import { applyApproval, ApprovalError, canActOnApproval, isEditable } from '../src/approval';
import { can } from '../src/roles';
import { inspectionDueInfo } from '../src/due';
import type { Approval, Inspection, User } from '../src/types';

const V = 'vessel-alpha';
const mk = (id: string, role: User['role'], vesselIds: string[] = []): User =>
  ({ id, email: `${id}@x.com`, name: id, designation: '', role, isActive: true, vesselIds });
const admin = mk('admin', 'admin');
const dir = mk('dir', 'director');
const dir2 = mk('dir2', 'director');
const tm = mk('tm', 'techManager', [V]);
const tmOther = mk('tm2', 'techManager', ['vessel-beta']);
const vu = mk('vu', 'vesselUser', [V]);
const vuOther = mk('vu2', 'vesselUser', ['vessel-beta']);
const vm = mk('vm', 'vesselManager', [V]);

const insp = (status: Inspection['status'], extra: Partial<Inspection> = {}) =>
  ({ id: 'i1', vesselId: V, status, summary: 'ok', conclusion: 'ok', ...extra });

describe('submit', () => {
  it('VM submits to a VU who has the vessel', () => {
    const r = applyApproval({ type: 'submit', approverId: 'vu' }, { actor: vm, inspection: insp('in_progress'), approval: null, target: vu });
    expect(r.status).toBe('pending_vu');
    expect(r.approval.vuUserId).toBe('vu');
    expect(r.notify).toEqual(['vu']);
  });
  it('VM cannot submit to a VU without the vessel', () => {
    expect(() => applyApproval({ type: 'submit', approverId: 'vu2' }, { actor: vm, inspection: insp('in_progress'), approval: null, target: vuOther }))
      .toThrow(ApprovalError);
  });
  it('VU submits straight to a Tech Manager', () => {
    const r = applyApproval({ type: 'submit', approverId: 'tm' }, { actor: vu, inspection: insp('in_progress'), approval: null, target: tm });
    expect(r.status).toBe('pending_tm');
  });
  it('TM submits straight to a Director', () => {
    const r = applyApproval({ type: 'submit', approverId: 'dir' }, { actor: tm, inspection: insp('in_progress'), approval: null, target: dir });
    expect(r.status).toBe('pending_director');
  });
  it('requires summary and conclusion', () => {
    expect(() => applyApproval({ type: 'submit', approverId: 'vu' }, { actor: vm, inspection: insp('in_progress', { summary: ' ' }), approval: null, target: vu }))
      .toThrow(/Summary/);
  });
  it('Director cannot submit; locked inspection cannot be resubmitted', () => {
    expect(() => applyApproval({ type: 'submit', approverId: 'dir' }, { actor: dir, inspection: insp('in_progress'), approval: null, target: dir2 })).toThrow();
    expect(() => applyApproval({ type: 'submit', approverId: 'vu' }, { actor: vm, inspection: insp('pending_vu'), approval: null, target: vu })).toThrow();
  });
});

describe('full three-level flow + rejection', () => {
  const sub = applyApproval({ type: 'submit', approverId: 'vu' }, { actor: vm, inspection: insp('in_progress'), approval: null, target: vu });
  it('only the assigned VU (or Admin) approves level 1, picking a Tech Manager', () => {
    expect(() => applyApproval({ type: 'approve', nextApproverId: 'tm' }, { actor: vuOther, inspection: insp(sub.status), approval: sub.approval, target: tm })).toThrow();
    const l1 = applyApproval({ type: 'approve', nextApproverId: 'tm' }, { actor: vu, inspection: insp(sub.status), approval: sub.approval, target: tm });
    expect(l1.status).toBe('pending_tm');
    expect(l1.notify).toContain('vm');

    expect(() => applyApproval({ type: 'approve', nextApproverId: 'dir' }, { actor: tmOther, inspection: insp(l1.status), approval: l1.approval, target: dir })).toThrow();
    const l2 = applyApproval({ type: 'approve', nextApproverId: 'dir' }, { actor: tm, inspection: insp(l1.status), approval: l1.approval, target: dir });
    expect(l2.status).toBe('pending_director');
    expect(l2.notify).toContain('vm');

    expect(() => applyApproval({ type: 'approve' }, { actor: dir2, inspection: insp(l2.status), approval: l2.approval })).toThrow();
    const fin = applyApproval({ type: 'approve' }, { actor: dir, inspection: insp(l2.status), approval: l2.approval });
    expect(fin.status).toBe('approved');
    expect(fin.approval.approvedAt).toBeTruthy();
    const reopened = applyApproval({ type: 'reopen' }, { actor: admin, inspection: insp(fin.status), approval: fin.approval });
    expect(reopened.status).toBe('in_progress');
    expect(() => applyApproval({ type: 'reopen' }, { actor: dir, inspection: insp(fin.status), approval: fin.approval })).toThrow();
  });
  it('VU rejection goes back to the Vessel Manager and needs a reason', () => {
    expect(() => applyApproval({ type: 'reject', comment: ' ' }, { actor: vu, inspection: insp(sub.status), approval: sub.approval })).toThrow(/reason/);
    const rej = applyApproval({ type: 'reject', comment: 'Photos missing' }, { actor: vu, inspection: insp(sub.status), approval: sub.approval });
    expect(rej.status).toBe('returned');
    expect(rej.notify).toEqual(['vm']);
    expect(isEditable(rej.status)).toBe(true);
  });
  it('Admin can act at any level', () => {
    const l1 = applyApproval({ type: 'approve', nextApproverId: 'tm' }, { actor: admin, inspection: insp(sub.status), approval: sub.approval, target: tm });
    const l2 = applyApproval({ type: 'approve', nextApproverId: 'dir' }, { actor: admin, inspection: insp(l1.status), approval: l1.approval, target: dir });
    expect(applyApproval({ type: 'approve' }, { actor: admin, inspection: insp(l2.status), approval: l2.approval }).status).toBe('approved');
  });
  it('inbox rule', () => {
    expect(canActOnApproval(vu, 'pending_vu', sub.approval as Approval)).toBe(true);
    expect(canActOnApproval(vuOther, 'pending_vu', sub.approval as Approval)).toBe(false);
    expect(canActOnApproval(vm, 'pending_vu', sub.approval as Approval)).toBe(false);
  });
});

describe('permissions', () => {
  it('Directors are view-only', () => {
    expect(can(dir, 'inspection.view', { inspection: insp('in_progress') })).toBe(true);
    expect(can(dir, 'inspection.edit', { inspection: insp('in_progress') })).toBe(false);
    expect(can(dir, 'inspection.delete', { inspection: insp('in_progress') })).toBe(false);
    expect(can(dir, 'inspection.submit', { inspection: insp('in_progress') })).toBe(false);
  });
  it('submission permission: only assigned managers and admin can submit while editable', () => {
    expect(can(vm, 'inspection.submit', { inspection: insp('in_progress') })).toBe(true);
    expect(can(vm, 'inspection.submit', { inspection: insp('returned') })).toBe(true);
    expect(can(tm, 'inspection.submit', { inspection: insp('in_progress') })).toBe(true);
    expect(can(admin, 'inspection.submit', { inspection: insp('in_progress') })).toBe(true);
    // Unassigned manager cannot submit
    expect(can(tmOther, 'inspection.submit', { inspection: insp('in_progress') })).toBe(false);
    // Cannot submit when locked (pending or approved)
    expect(can(vm, 'inspection.submit', { inspection: insp('pending_tm') })).toBe(false);
    expect(can(vm, 'inspection.submit', { inspection: insp('approved') })).toBe(false);
  });
  it('nobody edits while pending or after approval', () => {
    for (const s of ['pending_tm', 'pending_director', 'approved'] as const) {
      expect(can(admin, 'inspection.edit', { inspection: insp(s) })).toBe(false);
      expect(can(vm, 'inspection.delete', { inspection: insp(s) })).toBe(false);
    }
    expect(can(vm, 'inspection.edit', { inspection: insp('returned') })).toBe(true);
  });
  it('only Admin can delete inspections, including completed ones', () => {
    expect(can(admin, 'inspection.delete', { inspection: insp('in_progress') })).toBe(true);
    expect(can(admin, 'inspection.delete', { inspection: insp('approved') })).toBe(true);
    expect(can(admin, 'inspection.delete')).toBe(true);
    expect(can(vm, 'inspection.delete', { inspection: insp('in_progress') })).toBe(false);
    expect(can(tm, 'inspection.delete', { inspection: insp('in_progress') })).toBe(false);
    expect(can(dir, 'inspection.delete', { inspection: insp('in_progress') })).toBe(false);
  });
  it('managers limited to their vessels; only Admin manages', () => {
    expect(can(tmOther, 'inspection.view', { inspection: insp('in_progress') })).toBe(false);
    expect(can(vm, 'inspection.create', { vesselId: V })).toBe(true);
    expect(can(vm, 'inspection.create', { vesselId: 'other' })).toBe(false);
    expect(can(tm, 'checklist.manage')).toBe(false);
    expect(can(admin, 'inspection.addSection')).toBe(true);
    expect(can(admin, 'inspection.addSection', { inspection: insp('in_progress') })).toBe(true);
    expect(can(vm, 'inspection.addSection', { inspection: insp('in_progress') })).toBe(true);
    expect(can(tm, 'inspection.addSection', { inspection: insp('in_progress') })).toBe(true);
    expect(can(tmOther, 'inspection.addSection', { inspection: insp('in_progress') })).toBe(false);
    expect(can(dir, 'inspection.addSection', { inspection: insp('in_progress') })).toBe(false);
    expect(can(vm, 'inspection.addSection', { inspection: insp('approved') })).toBe(false);
    expect(can(dir, 'vessels.view')).toBe(true);
    expect(can(dir, 'inspection.importBackup')).toBe(false);
  });
});

describe('fleet due status', () => {
  const now = new Date('2026-09-28T00:00:00');
  it('matches the current app thresholds', () => {
    expect(inspectionDueInfo(null, now).label).toBe('No inspection on record');
    expect(inspectionDueInfo({ completionDate: '2026-08-01' }, now).color).toBe('green');
    expect(inspectionDueInfo({ completionDate: '2026-04-10' }, now).color).toBe('yellow');
    expect(inspectionDueInfo({ startDate: '2026-01-01' }, now).color).toBe('red');
  });
});
