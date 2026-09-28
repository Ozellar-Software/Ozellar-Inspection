import type { Inspection, Role, User } from './types';
import { isEditable } from './approval';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  director: 'Director',
  techManager: 'Tech Manager',
  vesselManager: 'Vessel Manager',
};

/** Does this user see / work on this vessel? Admin & Director see all. */
export function canSeeVessel(user: User, vesselId: string | null | undefined): boolean {
  if (user.role === 'admin' || user.role === 'director') return true;
  if (!vesselId) return false;
  return user.vesselIds.includes(vesselId);
}

export type Action =
  | 'users.manage'
  | 'vessels.manage'
  | 'vessels.view'
  | 'checklist.manage'
  | 'inspection.view'
  | 'inspection.create'
  | 'inspection.edit'
  | 'inspection.delete'
  | 'inspection.addSection'
  | 'inspection.export'
  | 'inspection.importBackup'
  | 'approval.reopen';

/**
 * Single permission check used by BOTH the app (show/hide) and the API (enforce).
 * `inspection` is required for inspection.* actions (except create, which needs vesselId).
 */
export function can(
  user: User,
  action: Action,
  ctx: { inspection?: Pick<Inspection, 'vesselId' | 'status'>; vesselId?: string | null } = {},
): boolean {
  if (!user.isActive) return false;
  const r = user.role;
  const isAdmin = r === 'admin';
  const isManager = r === 'techManager' || r === 'vesselManager';

  switch (action) {
    case 'users.manage':
    case 'vessels.manage':
    case 'checklist.manage':
    case 'inspection.addSection':
    case 'approval.reopen':
      return isAdmin;

    case 'vessels.view':
      return isAdmin || r === 'director';

    case 'inspection.importBackup':
      return isAdmin || isManager;

    case 'inspection.create':
      return isAdmin || (isManager && canSeeVessel(user, ctx.vesselId));

    case 'inspection.view':
    case 'inspection.export':
      return !!ctx.inspection && canSeeVessel(user, ctx.inspection.vesselId);

    case 'inspection.edit':
    case 'inspection.delete': {
      const insp = ctx.inspection;
      if (!insp) return false;
      if (r === 'director') return false;                 // Directors are always view-only
      if (!isEditable(insp.status)) return false;         // locked while pending / after approval
      return isAdmin || (isManager && canSeeVessel(user, insp.vesselId));
    }
  }
}

/** Designation pick-list presets (the app adds any designation already in use). */
export const DESIGNATION_PRESETS = [
  'Master', 'Chief Engineer', 'Chief Officer', 'Second Engineer', 'Vessel Manager',
  'Technical Superintendent', 'Marine Superintendent', 'Fleet Manager', 'Technical Manager',
  'Technical Director', 'Director', 'QHSE Manager', 'Crewing Manager', 'Purchase Manager', 'Admin',
] as const;

/** "Tara — Technical Superintendent (tara@ozellar.com)" */
export function personLabel(p: { name?: string; designation?: string; email?: string }): string {
  let who = p.name || '';
  if (p.designation) who = who ? `${who} — ${p.designation}` : p.designation;
  return who ? `${who} (${p.email ?? ''})` : (p.email ?? '');
}
