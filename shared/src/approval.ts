import type { Approval, ApprovalAction, Inspection, InspectionStatus, Role, User } from './types';

/**
 * Approval state machine — the ONE place these rules live.
 *
 *  in_progress/returned --submit(VM→VU)-------------------> pending_vu
 *  in_progress/returned --submit(VU|Admin→TM)--------------> pending_tm
 *  in_progress/returned --submit(TM|Admin→Director)--------> pending_director
 *  pending_vu       --approve(assigned VU|Admin, pick TM)--------> pending_tm
 *  pending_vu       --reject(assigned VU|Admin, comment)---------> returned
 *  pending_tm       --approve(assigned TM|Admin, pick Director)--> pending_director
 *  pending_tm       --reject(assigned TM|Admin, comment)---------> returned
 *  pending_director --approve(assigned Director|Admin)-----------> approved
 *  pending_director --reject(assigned Director|Admin, comment)---> returned
 *  approved         --reopen(Admin)-------------------------------> returned
 */

export function isEditable(status: InspectionStatus): boolean {
  return status === 'in_progress' || status === 'returned';
}

export type Command =
  | { type: 'submit'; approverId: string; comment?: string; photoOnly?: boolean }
  | { type: 'approve'; nextApproverId?: string; comment?: string }
  | { type: 'reject'; comment: string }
  | { type: 'reopen' };

export interface TransitionContext {
  actor: User;
  inspection: Pick<Inspection, 'id' | 'vesselId' | 'status' | 'summary' | 'conclusion'>;
  approval: Approval | null;
  /** The user the actor picked (submit → VU/TM/Director, VU approve → TM, TM approve → Director). */
  target?: User | null;
  now?: string;
}

export interface TransitionResult {
  status: InspectionStatus;
  approval: Approval;
  event: { action: ApprovalAction; level: string; targetUserId: string | null; comment: string };
  /** Who should be notified (user ids). */
  notify: string[];
}

export class ApprovalError extends Error {
  constructor(public code: 'FORBIDDEN' | 'INVALID_STATE' | 'VALIDATION', message: string) {
    super(message);
  }
}

function hasVessel(u: User, vesselId: string | null): boolean {
  return !!vesselId && u.vesselIds.includes(vesselId);
}

/** Who a given submitter's role is allowed to hand an inspection to next. */
function nextRoleFor(role: Role): Role | null {
  if (role === 'vesselManager') return 'vesselUser';
  if (role === 'vesselUser') return 'techManager';
  if (role === 'techManager') return 'director';
  return null; // admin picks freely based on the target's own role
}

export function applyApproval(cmd: Command, ctx: TransitionContext): TransitionResult {
  const { actor, inspection: insp, approval, target } = ctx;
  const now = ctx.now ?? new Date().toISOString();
  const isAdmin = actor.role === 'admin';
  if (!actor.isActive) throw new ApprovalError('FORBIDDEN', 'Account is inactive');

  switch (cmd.type) {
    case 'submit': {
      if (!isEditable(insp.status)) throw new ApprovalError('INVALID_STATE', 'Inspection is not editable');
      if (actor.role === 'director') throw new ApprovalError('FORBIDDEN', 'Directors cannot submit');
      if (!isAdmin && !hasVessel(actor, insp.vesselId)) throw new ApprovalError('FORBIDDEN', 'Not your vessel');
      if (!insp.summary.trim() || !insp.conclusion.trim())
        throw new ApprovalError('VALIDATION', 'Add a Summary and Conclusion before submitting');
      if (!target || target.id !== cmd.approverId) throw new ApprovalError('VALIDATION', 'Choose who to send it to');

      const expectedRole = isAdmin ? target.role : nextRoleFor(actor.role);
      if (!expectedRole || !['vesselUser', 'techManager', 'director'].includes(expectedRole))
        throw new ApprovalError('FORBIDDEN', 'This role cannot submit');
      if (target.role !== expectedRole)
        throw new ApprovalError(
          'VALIDATION',
          expectedRole === 'vesselUser' ? 'Choose a Vessel User who has this vessel'
          : expectedRole === 'techManager' ? 'Choose a Tech Manager who has this vessel'
          : 'Choose a Director',
        );
      if ((expectedRole === 'vesselUser' || expectedRole === 'techManager') && !hasVessel(target, insp.vesselId))
        throw new ApprovalError('VALIDATION', expectedRole === 'vesselUser' ? 'Choose a Vessel User who has this vessel' : 'Choose a Tech Manager who has this vessel');

      const status: InspectionStatus = expectedRole === 'vesselUser' ? 'pending_vu' : expectedRole === 'techManager' ? 'pending_tm' : 'pending_director';
      const stage = expectedRole === 'vesselUser' ? 'vu' : expectedRole === 'techManager' ? 'tm' : 'director';
      const level = expectedRole === 'vesselUser' ? 'To Vessel User' : expectedRole === 'techManager' ? 'To Tech Manager' : 'To Director';
      return {
        status,
        approval: {
          inspectionId: insp.id,
          stage,
          submittedBy: actor.id,
          submittedAt: now,
          vuUserId: expectedRole === 'vesselUser' ? target.id : null,
          tmUserId: expectedRole === 'techManager' ? target.id : null,
          directorUserId: expectedRole === 'director' ? target.id : null,
          approvedAt: null,
          returnedBy: null,
          returnComment: null,
        },
        event: { action: 'submitted', level, targetUserId: target.id, comment: cmd.comment ?? '' },
        notify: [target.id],
      };
    }

    case 'approve': {
      if (!approval) throw new ApprovalError('INVALID_STATE', 'Not submitted');
      if (insp.status === 'pending_vu' && approval.stage === 'vu') {
        if (!(isAdmin || (actor.role === 'vesselUser' && approval.vuUserId === actor.id)))
          throw new ApprovalError('FORBIDDEN', 'Only the assigned Vessel User can approve');
        if (!target || target.id !== cmd.nextApproverId || target.role !== 'techManager')
          throw new ApprovalError('VALIDATION', 'Choose the Tech Manager to review next');
        return {
          status: 'pending_tm',
          approval: { ...approval, stage: 'tm', tmUserId: target.id },
          event: { action: 'approved', level: 'Level 1 — Vessel User', targetUserId: target.id, comment: cmd.comment ?? '' },
          notify: [target.id, approval.submittedBy],
        };
      }
      if (insp.status === 'pending_tm' && approval.stage === 'tm') {
        if (!(isAdmin || (actor.role === 'techManager' && approval.tmUserId === actor.id)))
          throw new ApprovalError('FORBIDDEN', 'Only the assigned Tech Manager can approve');
        if (!target || target.id !== cmd.nextApproverId || target.role !== 'director')
          throw new ApprovalError('VALIDATION', 'Choose the Director for final approval');
        return {
          status: 'pending_director',
          approval: { ...approval, stage: 'director', directorUserId: target.id },
          event: { action: 'approved', level: 'Level 2 — Tech Manager', targetUserId: target.id, comment: cmd.comment ?? '' },
          notify: [target.id, approval.submittedBy],
        };
      }
      if (insp.status === 'pending_director' && approval.stage === 'director') {
        if (!(isAdmin || (actor.role === 'director' && approval.directorUserId === actor.id)))
          throw new ApprovalError('FORBIDDEN', 'Only the assigned Director can give final approval');
        return {
          status: 'approved',
          approval: { ...approval, stage: 'approved', approvedAt: now },
          event: { action: 'approved', level: 'Final — Director', targetUserId: null, comment: cmd.comment ?? '' },
          notify: [approval.submittedBy, ...(approval.vuUserId ? [approval.vuUserId] : []), ...(approval.tmUserId ? [approval.tmUserId] : [])],
        };
      }
      throw new ApprovalError('INVALID_STATE', 'Nothing to approve');
    }

    case 'reject': {
      if (!approval) throw new ApprovalError('INVALID_STATE', 'Not submitted');
      if (!cmd.comment?.trim()) throw new ApprovalError('VALIDATION', 'A reason is required');
      let level: string;
      if (insp.status === 'pending_vu') {
        if (!(isAdmin || (actor.role === 'vesselUser' && approval.vuUserId === actor.id)))
          throw new ApprovalError('FORBIDDEN', 'Only the assigned Vessel User can reject');
        level = 'Level 1 — Vessel User';
      } else if (insp.status === 'pending_tm') {
        if (!(isAdmin || (actor.role === 'techManager' && approval.tmUserId === actor.id)))
          throw new ApprovalError('FORBIDDEN', 'Only the assigned Tech Manager can reject');
        level = 'Level 2 — Tech Manager';
      } else if (insp.status === 'pending_director') {
        if (!(isAdmin || (actor.role === 'director' && approval.directorUserId === actor.id)))
          throw new ApprovalError('FORBIDDEN', 'Only the assigned Director can reject');
        level = 'Final — Director';
      } else {
        throw new ApprovalError('INVALID_STATE', 'Nothing to reject');
      }
      return {
        status: 'returned',
        approval: { ...approval, stage: 'returned', returnedBy: actor.id, returnComment: cmd.comment.trim() },
        event: { action: 'rejected', level, targetUserId: approval.submittedBy, comment: cmd.comment.trim() },
        notify: [approval.submittedBy],
      };
    }

    case 'reopen': {
      if (!isAdmin) throw new ApprovalError('FORBIDDEN', 'Only an Admin can reopen');
      if (insp.status !== 'approved' || !approval) throw new ApprovalError('INVALID_STATE', 'Only approved inspections can be reopened');
      return {
        status: 'in_progress',
        approval: { ...approval, stage: 'returned', returnedBy: actor.id, returnComment: 'Reopened by Admin' },
        event: { action: 'reopened', level: 'Reopened by Admin', targetUserId: approval.submittedBy, comment: '' },
        notify: [approval.submittedBy],
      };
    }
  }
}

/** Can this user act on the approval right now (for the "Waiting for your approval" notice)? */
export function canActOnApproval(user: User, status: InspectionStatus, approval: Approval | null): boolean {
  if (!approval) return false;
  if (status === 'pending_vu') return user.role === 'admin' || (user.role === 'vesselUser' && approval.vuUserId === user.id);
  if (status === 'pending_tm') return user.role === 'admin' || (user.role === 'techManager' && approval.tmUserId === user.id);
  if (status === 'pending_director') return user.role === 'admin' || (user.role === 'director' && approval.directorUserId === user.id);
  return false;
}

export const STATUS_LABELS: Record<InspectionStatus, string> = {
  in_progress: 'In progress',
  pending_vu: 'Waiting: Vessel User',
  pending_tm: 'Waiting: Tech Manager',
  pending_director: 'Waiting: Director',
  approved: 'Approved',
  returned: 'Rejected',
};
