/** Core types shared by the web app and the API. Mirrors db/schema.sql (camelCase). */

export type Role = 'admin' | 'director' | 'techManager' | 'vesselManager';

export interface User {
  id: string;
  email: string;
  name: string;
  designation: string;
  role: Role;
  isActive: boolean;
  /** Vessel ids assigned to Tech / Vessel Managers (ignored for Admin / Director). */
  vesselIds: string[];
  passwordHash?: string | null;
}

export type InspectionType = 'port' | 'remote' | 'sailing';

export type InspectionStatus =
  | 'in_progress'
  | 'pending_tm'
  | 'pending_director'
  | 'approved'
  | 'returned';

export type ApprovalStage = 'tm' | 'director' | 'approved' | 'returned';

export interface Vessel {
  id: string;
  name: string;
  imo: string;
  vesselType: string;
  particulars: Partial<Record<VesselParticularKey, string>>;
  photoId?: string | null;
  updatedAt: string;
  deletedAt?: string | null;
}

export const VESSEL_PARTICULAR_KEYS = [
  'flag', 'portOfRegistry', 'callSign', 'officialNo', 'yearBuilt', 'placeOfBuild',
  'classSociety', 'classNotation', 'grossTonnage', 'netTonnage', 'deadweight', 'loa',
  'breadth', 'depth', 'summerDraft', 'mainEngine', 'mainEngineMakerModel',
  'mainEnginePower', 'propulsion', 'owner', 'managerOperator', 'email', 'satellitePhone',
] as const;
export type VesselParticularKey = (typeof VESSEL_PARTICULAR_KEYS)[number];

export const COMMON_VESSEL_TYPES = [
  'Bulk Carrier',
  'Container Ship',
  'Oil Tanker',
  'Chemical Tanker',
  'Gas Carrier',
  'General Cargo',
  'Tug / Offshore',
] as const;
export type CommonVesselType = (typeof COMMON_VESSEL_TYPES)[number];

export interface Inspection {
  id: string;
  vesselId: string | null;
  vesselName: string;
  imo: string;
  vesselType: string;
  inspectionType: InspectionType;
  port: string;
  startDate: string | null;       // YYYY-MM-DD
  completionDate: string | null;  // YYYY-MM-DD
  sailFromDate?: string | null; sailFromPort?: string;
  sailToDate?: string | null;   sailToPort?: string;
  remoteFromDate?: string | null; remoteToDate?: string | null;
  inspector: string;
  company: string;
  summary: string;
  conclusion: string;
  coverPhotoId?: string | null;
  status: InspectionStatus;
  createdBy: string | null;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface InspectionSection {
  id: string;
  inspectionId: string;
  templateSr: number | null;
  zone: string;
  name: string;
  position: number;
  photoOnly: boolean;
  isCustom: boolean;
  vesselTypes?: string[];
}

export interface InspectionQuestion {
  id: string;
  inspectionSectionId: string;
  qid: number;
  ref: string;
  text: string;
  position: number;
}

export interface TemplateSection {
  id: string;
  sr: number;
  zone: string;
  name: string;
  position: number;
  photoOnly: boolean;
  vesselTypes: string[];
  deletedAt?: string | null;
  updatedAt?: string;
  rowVersion?: number;
}

export interface TemplateQuestion {
  id: string;
  sectionId: string;
  qid: number;
  ref: string;
  text: string;
  position: number;
  deletedAt?: string | null;
  updatedAt?: string;
  rowVersion?: number;
}

export interface Response {
  id: string;
  inspectionId: string;
  inspectionQuestionId: string;
  applicable: boolean | null;
  answer: 'yes' | 'no' | null;
  remarks: string;
  correctiveAction: string;
  preventiveAction: string;
  updatedAt: string;
}

export interface Finding {
  id: string;
  inspectionId: string;
  inspectionSectionId: string;
  text: string;
  answer: 'yes' | 'no' | null;
  correctiveAction: string;
  preventiveAction: string;
  position: number;
}

export type PhotoTarget = 'section' | 'question' | 'finding' | 'cover' | 'vessel';

export interface Photo {
  id: string;
  inspectionId: string | null;
  target: PhotoTarget;
  inspectionSectionId?: string | null;
  responseId?: string | null;
  findingId?: string | null;
  vesselId?: string | null;
  blobPath: string;
  isDefect: boolean;
  position: number;
  uploaded: boolean;
}

export interface Approval {
  inspectionId: string;
  stage: ApprovalStage;
  submittedBy: string;         // user id
  submittedAt: string;
  tmUserId: string | null;
  directorUserId: string | null;
  approvedAt?: string | null;
  returnedBy?: string | null;
  returnComment?: string | null;
}

export type ApprovalAction = 'submitted' | 'approved' | 'rejected' | 'reopened';

export interface ApprovalEvent {
  id: string;
  inspectionId: string;
  action: ApprovalAction;
  level: string;
  actorUserId: string;
  actorName: string;
  actorDesignation: string;
  actorRole: Role;
  targetUserId: string | null;
  comment: string;
  createdAt: string;
}

/** Limits carried over from the current app. */
export const LIMITS = {
  photosPerQuestionOrSection: 15,
  photosPerPhotoSection: 100,
  passwordMinLength: 6,
} as const;

export type NotificationType =
  | 'inspection_created'
  | 'section_completed'
  | 'inspection_submitted'
  | 'inspection_approved'
  | 'inspection_returned';

export interface AppNotification {
  id: string;
  userId: string;
  inspectionId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAt: string;
}
