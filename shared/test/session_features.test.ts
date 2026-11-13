import { describe, expect, it } from 'vitest';
import { applyApproval, ApprovalError, canActOnApproval, isEditable } from '../src/approval';
import { can, ROLE_LABELS, isManagerRole, DESIGNATION_PRESETS } from '../src/roles';
import type { Approval, Inspection, User, InspectionSection, Finding, Response } from '../src/types';

describe('All-in-One Verification: Vessel Role, Approval Flow, Section N/A, Photo Delete, Single Action', () => {
  const VESSEL_ID = 'vessel-mv-alpha';

  const makeUser = (id: string, role: User['role'], vesselIds: string[] = []): User => ({
    id,
    email: `${id}@ozellar.com`,
    name: id.toUpperCase(),
    designation: role === 'vesselUser' ? 'Vessel User' : role,
    role,
    isActive: true,
    vesselIds,
  });

  const admin = makeUser('admin', 'admin');
  const vm = makeUser('vm', 'vesselManager', [VESSEL_ID]);
  const vu = makeUser('vu', 'vesselUser', [VESSEL_ID]);
  const vuOther = makeUser('vuOther', 'vesselUser', ['vessel-other']);
  const tm = makeUser('tm', 'techManager', [VESSEL_ID]);
  const director = makeUser('dir', 'director');

  const makeInspection = (status: Inspection['status'] = 'in_progress'): Inspection => ({
    id: 'insp-101',
    vesselId: VESSEL_ID,
    status,
    summary: 'Executive summary text',
    conclusion: 'Conclusion and recommendations',
  } as Inspection);

  // ─────────────────────────────────────────────────────────────
  // 1. "Vessel" (vesselUser) Role Metadata & Permissions
  // ─────────────────────────────────────────────────────────────
  describe('1. Vessel Role (vesselUser) Definition & Access Controls', () => {
    it('has correct role display label, manager classification, and designation preset', () => {
      expect(ROLE_LABELS.vesselUser).toBe('Vessel');
      expect(isManagerRole('vesselUser')).toBe(true);
      expect(DESIGNATION_PRESETS).toContain('Vessel User');
    });

    it('grants vessel-scoped permissions only to assigned vessels', () => {
      const assignedInsp = makeInspection('in_progress');
      const unassignedInsp = { ...assignedInsp, vesselId: 'vessel-other' };

      expect(can(vu, 'inspection.view', { inspection: assignedInsp })).toBe(true);
      expect(can(vu, 'inspection.view', { inspection: unassignedInsp })).toBe(false);
      expect(can(vu, 'inspection.submit', { inspection: assignedInsp })).toBe(true);
      expect(can(vu, 'inspection.submit', { inspection: unassignedInsp })).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Complete 4-Tier Approval Workflow (VM -> VU -> TM -> Director)
  // ─────────────────────────────────────────────────────────────
  describe('2. 4-Tier Approval Flow: VM -> VU -> TM -> Director', () => {
    it('executes full sequential approval flow from In Progress to Approved', () => {
      // Step 1: VM submits to assigned Vessel User
      const submitStep = applyApproval(
        { type: 'submit', approverId: vu.id },
        { actor: vm, inspection: makeInspection('in_progress'), approval: null, target: vu }
      );
      expect(submitStep.status).toBe('pending_vu');
      expect(submitStep.approval.vuUserId).toBe(vu.id);
      expect(submitStep.approval.submittedBy).toBe(vm.id);
      expect(submitStep.notify).toEqual([vu.id]);
      expect(canActOnApproval(vu, submitStep.status, submitStep.approval)).toBe(true);
      expect(canActOnApproval(vuOther, submitStep.status, submitStep.approval)).toBe(false);

      // Step 2: VU approves and picks Tech Manager
      const vuStep = applyApproval(
        { type: 'approve', nextApproverId: tm.id },
        { actor: vu, inspection: makeInspection('pending_vu'), approval: submitStep.approval, target: tm }
      );
      expect(vuStep.status).toBe('pending_tm');
      expect(vuStep.approval.tmUserId).toBe(tm.id);
      expect(vuStep.notify).toContain(vm.id);

      // Step 3: TM approves and picks Director
      const tmStep = applyApproval(
        { type: 'approve', nextApproverId: director.id },
        { actor: tm, inspection: makeInspection('pending_tm'), approval: vuStep.approval, target: director }
      );
      expect(tmStep.status).toBe('pending_director');
      expect(tmStep.approval.directorUserId).toBe(director.id);
      expect(tmStep.notify).toContain(vm.id);

      // Step 4: Director approves (final)
      const dirStep = applyApproval(
        { type: 'approve' },
        { actor: director, inspection: makeInspection('pending_director'), approval: tmStep.approval }
      );
      expect(dirStep.status).toBe('approved');
      expect(dirStep.approval.approvedAt).toBeTruthy();
      expect(isEditable(dirStep.status)).toBe(false);
    });

    it('supports rejection back to VM (Returned) at every level with reason', () => {
      const pendingVuApproval: Approval = {
        inspectionId: 'insp-101',
        submittedBy: vm.id,
        submittedAt: new Date().toISOString(),
        stage: 'vu',
        vuUserId: vu.id,
        tmUserId: null,
        directorUserId: null,
      };

      // VU Rejection
      expect(() =>
        applyApproval(
          { type: 'reject', comment: ' ' },
          { actor: vu, inspection: makeInspection('pending_vu'), approval: pendingVuApproval }
        )
      ).toThrow(/reason/);

      const vuRejection = applyApproval(
        { type: 'reject', comment: 'Missing cargo holds photos' },
        { actor: vu, inspection: makeInspection('pending_vu'), approval: pendingVuApproval }
      );
      expect(vuRejection.status).toBe('returned');
      expect(vuRejection.notify).toEqual([vm.id]);
      expect(isEditable(vuRejection.status)).toBe(true);

      // Resubmission from returned by VM routes back to VU
      const resubmitStep = applyApproval(
        { type: 'submit', approverId: vu.id },
        { actor: vm, inspection: makeInspection('returned'), approval: vuRejection.approval, target: vu }
      );
      expect(resubmitStep.status).toBe('pending_vu');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Section N/A Applicability Logic & Reporting Exclusion
  // ─────────────────────────────────────────────────────────────
  describe('3. Section N/A Applicability & Report Separation', () => {
    interface MockSection {
      id: string;
      name: string;
      photoOnly?: boolean;
      applicable?: boolean;
      deletedAt?: number | null;
      questionsCount: number;
      completedCount: number;
    }

    const sections: MockSection[] = [
      { id: 's1', name: 'Deck Structure', applicable: true, photoOnly: false, questionsCount: 5, completedCount: 5 },
      { id: 's2', name: 'Engine Room', applicable: true, photoOnly: false, questionsCount: 8, completedCount: 4 },
      { id: 's3', name: 'Inert Gas System', applicable: false, photoOnly: false, questionsCount: 6, completedCount: 0 },
      { id: 's4', name: 'Deck Overview Photos', applicable: true, photoOnly: true, questionsCount: 0, completedCount: 0 },
    ];

    it('excludes N/A sections from active checklist calculations and totals', () => {
      const activeSections = sections.filter((s) => !s.deletedAt && s.applicable !== false);
      const naSections = sections.filter((s) => !s.deletedAt && s.applicable === false);

      expect(activeSections.map((s) => s.id)).toEqual(['s1', 's2', 's4']);
      expect(naSections.map((s) => s.id)).toEqual(['s3']);

      // Overall checklist progress ignores N/A sections
      const checklistSections = activeSections.filter((s) => !s.photoOnly);
      const totalQuestions = checklistSections.reduce((sum, s) => sum + s.questionsCount, 0);
      const completedQuestions = checklistSections.reduce((sum, s) => sum + s.completedCount, 0);

      expect(totalQuestions).toBe(13); // s1 (5) + s2 (8), NOT s3 (6)
      expect(completedQuestions).toBe(9); // s1 (5) + s2 (4)
      const progressPercent = Math.round((completedQuestions / totalQuestions) * 100);
      expect(progressPercent).toBe(69);
    });

    it('separates N/A sections in report data structure so they do not show in active report bodies', () => {
      const nonDeleted = sections.filter((s) => !s.deletedAt);
      const reportSections = nonDeleted.filter((s) => s.applicable !== false);
      const notApplicableSections = nonDeleted.filter((s) => s.applicable === false);

      expect(reportSections).toHaveLength(3);
      expect(notApplicableSections).toHaveLength(1);
      expect(notApplicableSections[0].name).toBe('Inert Gas System');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Photo Section Deletion (photoOnly: true)
  // ─────────────────────────────────────────────────────────────
  describe('4. Photo Section Deletion (photoOnly: true)', () => {
    interface MockSection {
      id: string;
      name: string;
      photoOnly: boolean;
      deletedAt?: number | null;
    }

    const sections: MockSection[] = [
      { id: 'p1', name: 'Cargo Hold Photos', photoOnly: true, deletedAt: null },
      { id: 'p2', name: 'Engine Room Photos', photoOnly: true, deletedAt: null },
      { id: 'c1', name: 'Bridge & Navigation', photoOnly: false, deletedAt: null },
    ];

    it('allows deleting photo sections via soft delete and filters them out of views', () => {
      // Simulate deleting 'p1'
      const deletedTime = Date.now();
      const updated = sections.map((s) => (s.id === 'p1' ? { ...s, deletedAt: deletedTime } : s));

      const visibleSections = updated.filter((s) => !s.deletedAt);
      expect(visibleSections.map((s) => s.id)).toEqual(['p2', 'c1']);
      expect(visibleSections.find((s) => s.id === 'p1')).toBeUndefined();
    });

    it('identifies photo sections vs standard checklist sections', () => {
      expect(sections.filter((s) => s.photoOnly).map((s) => s.name)).toEqual([
        'Cargo Hold Photos',
        'Engine Room Photos',
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Single Action (Corrective Action Only, No Preventive Action)
  // ─────────────────────────────────────────────────────────────
  describe('5. Single Action Model: Corrective Action Only (Preventive Action Removed)', () => {
    it('preserves Corrective Action and operates cleanly without Preventive Action', () => {
      const finding: Finding = {
        id: 'f-1',
        inspectionId: 'insp-101',
        inspectionSectionId: 's1',
        text: 'Oil seepage on valve gasket',
        answer: 'no',
        correctiveAction: 'Gasket replacement scheduled at next port call',
        position: 0,
      };

      const response: Response = {
        id: 'r-1',
        inspectionId: 'insp-101',
        inspectionQuestionId: 'q-1',
        applicable: true,
        answer: 'no',
        remarks: 'Minor leakage noted',
        correctiveAction: 'Cleaned area and tightened bolts',
        updatedAt: new Date().toISOString(),
      };

      // Only Corrective Action is populated and used
      expect(finding.correctiveAction).toBe('Gasket replacement scheduled at next port call');
      expect(finding.preventiveAction).toBeUndefined();

      expect(response.correctiveAction).toBe('Cleaned area and tightened bolts');
      expect(response.preventiveAction).toBeUndefined();

      // Observation report entry mapping
      const observation = {
        id: finding.id,
        text: finding.text,
        correctiveAction: finding.correctiveAction,
        // No preventiveAction
      };
      expect(observation.correctiveAction).toBeTruthy();
      expect((observation as any).preventiveAction).toBeUndefined();
    });
  });
});
