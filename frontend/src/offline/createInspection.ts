import type {
  Inspection, InspectionQuestion, InspectionSection, InspectionType, Mutation, ReportCategory, Vessel,
  TemplateSection, TemplateQuestion,
} from '@ozellar/shared';
import { api } from '../api/client';
import { db } from './db';
import { nextOutboxTimestamp } from './outbox';
import { scheduleSync } from './sync';
import { getCachedUser } from '../auth/session';

type Synced<T> = T & { rowVersion?: number; deletedAt?: string | null };

export interface NewInspectionInput {
  vesselId: string; vesselName: string; imo: string; vesselType: string;
  inspectionType: InspectionType; reportCategory?: ReportCategory; port: string; startDate: string | null;
  inspector: string; company: string;
}

/** Pulls the latest master checklist template (Universal + Vessel Type sections & questions) when online. */
async function hydrateTemplatesIfOnline(): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const [serverSecs, serverQs] = await Promise.all([
      api<TemplateSection[]>('/templates/sections/list'),
      api<TemplateQuestion[]>('/templates/questions/list'),
    ]);
    if (Array.isArray(serverSecs)) {
      const activeSecIds = new Set(serverSecs.map((s) => s.id));
      const localSecs = await db.templateSections.toArray();
      const staleSecIds = localSecs.filter((s) => !activeSecIds.has(s.id)).map((s) => s.id);
      if (staleSecIds.length) await db.templateSections.bulkDelete(staleSecIds);
      if (serverSecs.length) {
        await db.templateSections.bulkPut(serverSecs as unknown as Record<string, unknown> & { id: string }[]);
      }
    }
    if (Array.isArray(serverQs)) {
      const activeQIds = new Set(serverQs.map((q) => q.id));
      const localQs = await db.templateQuestions.toArray();
      const staleQIds = localQs.filter((q) => !activeQIds.has(q.id)).map((q) => q.id);
      if (staleQIds.length) await db.templateQuestions.bulkDelete(staleQIds);
      if (serverQs.length) {
        await db.templateQuestions.bulkPut(serverQs as unknown as Record<string, unknown> & { id: string }[]);
      }
    }
  } catch {
    // offline fallback to local IndexedDB templates
  }
}

interface BuiltInspection {
  mutations: (Mutation & { attempts: number })[];
  inspectionRow: Synced<Inspection>;
  sectionRows: Synced<InspectionSection>[];
  questionRows: Synced<InspectionQuestion>[];
}

/**
 * Builds the mutations + local rows for a frozen copy of the current checklist template (sections + questions),
 * queued in dependency order (inspection, then each section immediately followed by its own questions — the
 * server rejects a question whose section it hasn't seen yet). Pre Purchase / Take Over reports only ever get
 * photo-only sections — never the full checklist.
 */
async function buildInspection(inspectionId: string, input: NewInspectionInput, stamp: () => string): Promise<BuiltInspection> {
  const templateSections = ((await db.templateSections.toArray()) as unknown as TemplateSection[])
    .filter((s) => !s.deletedAt)
    .sort((a, b) => a.position - b.position);
  const templateQuestions = ((await db.templateQuestions.toArray()) as unknown as TemplateQuestion[])
    .filter((q) => !q.deletedAt);

  const mutations: (Mutation & { attempts: number })[] = [];
  const sectionRows: Synced<InspectionSection>[] = [];
  const questionRows: Synced<InspectionQuestion>[] = [];

  // status isn't in the server's writable-columns list for inspections (it decides that itself, always
  // 'in_progress' for a brand-new one) — only send the real fields, but keep it on the local row for the UI.
  // createdBy is likewise server-assigned (insert path sets it from the authenticated user), but we also set it
  // locally right away so Home's "creator can always see their own pending Pre Purchase / Take Over report"
  // check doesn't have to wait for a sync round-trip to backfill it.
  mutations.push({ id: crypto.randomUUID(), entity: 'inspections', entityId: inspectionId, op: 'upsert', data: { ...input }, baseVersion: null, createdAt: stamp(), attempts: 0 });
  const inspectionRow: Synced<Inspection> = {
    id: inspectionId, ...input, reportCategory: input.reportCategory ?? 'inspection', status: 'in_progress', updatedAt: new Date().toISOString(),
    completionDate: null, summary: '', conclusion: '', createdBy: getCachedUser()?.id ?? null,
  };

  const isPhotoOnlyReport = !!input.reportCategory && input.reportCategory !== 'inspection';

  // Only create sections assigned to this vessel's type.
  // Universal sections (empty vesselTypes) act as the Default blueprint in Checklist Master.
  let rawApplicable = templateSections.filter((ts) => {
    const types = (Array.isArray(ts.vesselTypes) ? ts.vesselTypes : []).map((t) => String(t).trim()).filter(Boolean);
    if (input.vesselType?.trim()) {
      const target = input.vesselType.trim().toLowerCase();
      return types.some((t) => t.toLowerCase() === target);
    }
    return types.length === 0;
  });

  // If no sections are specifically assigned to this vessel type, fall back to Universal (Default) sections
  // so the inspection is never created with zero sections! Pre Purchase / Take Over reports are the
  // exception: a vessel type with no photo sections of its own gets none at all, rather than silently
  // reusing another type's Universal photo sections (which would look confusingly identical).
  if (rawApplicable.length === 0 && !isPhotoOnlyReport) {
    rawApplicable = templateSections.filter((ts) => {
      const types = (Array.isArray(ts.vesselTypes) ? ts.vesselTypes : []).map((t) => String(t).trim()).filter(Boolean);
      return types.length === 0;
    });
  }

  // Pre Purchase / Take Over reports only ever get photo-only sections.
  if (isPhotoOnlyReport) {
    rawApplicable = rawApplicable.filter((ts) => ts.photoOnly);
  }

  // Deduplicate by (name, photoOnly) and always group normal sections first, photo sections last
  const seenSectionKeys = new Set<string>();
  const applicableSections = rawApplicable
    .filter((ts) => {
      const key = `${ts.name.trim().toLowerCase()}::${Boolean(ts.photoOnly)}`;
      if (seenSectionKeys.has(key)) return false;
      seenSectionKeys.add(key);
      return true;
    })
    .sort((a, b) => Number(Boolean(a.photoOnly)) - Number(Boolean(b.photoOnly)) || a.position - b.position);

  for (let idx = 0; idx < applicableSections.length; idx++) {
    const ts = applicableSections[idx];
    const sectionId = crypto.randomUUID();
    const sectionData = {
      inspectionId,
      templateSr: ts.sr,
      zone: ts.zone,
      name: ts.name,
      position: idx,
      photoOnly: ts.photoOnly ?? false,
      isCustom: false,
      vesselTypes: Array.isArray(ts.vesselTypes) ? ts.vesselTypes : [],
    };
    sectionRows.push({ id: sectionId, ...sectionData });
    mutations.push({ id: crypto.randomUUID(), entity: 'inspectionSections', entityId: sectionId, op: 'upsert', data: sectionData, baseVersion: null, createdAt: stamp(), attempts: 0 });

    const qs = templateQuestions.filter((q) => q.sectionId === ts.id).sort((a, b) => a.position - b.position);
    for (const tq of qs) {
      const questionId = crypto.randomUUID();
      const qData = { inspectionSectionId: sectionId, qid: tq.qid, ref: tq.ref, text: tq.text, position: tq.position };
      questionRows.push({ id: questionId, ...qData });
      mutations.push({ id: crypto.randomUUID(), entity: 'inspectionQuestions', entityId: questionId, op: 'upsert', data: qData, baseVersion: null, createdAt: stamp(), attempts: 0 });
    }
  }

  return { mutations, inspectionRow, sectionRows, questionRows };
}

/** Creates a new inspection for an existing vessel, entirely offline. Returns the new inspection id. */
export async function createInspection(input: NewInspectionInput): Promise<string> {
  const inspectionId = crypto.randomUUID();
  const stamp = () => nextOutboxTimestamp(); // strictly increasing so outbox order == dependency order

  await hydrateTemplatesIfOnline();
  const { mutations, inspectionRow, sectionRows, questionRows } = await buildInspection(inspectionId, input, stamp);

  await db.transaction('rw', db.inspections, db.inspectionSections, db.inspectionQuestions, db.outbox, async () => {
    await db.inspections.put(inspectionRow);
    await db.inspectionSections.bulkPut(sectionRows);
    await db.inspectionQuestions.bulkPut(questionRows);
    await db.outbox.bulkAdd(mutations);
  });

  scheduleSync();
  return inspectionId;
}

export interface NewVesselDraft { name: string; imo: string; vesselType: string }

/**
 * Creates a brand-new "unregistered" vessel (Pre Purchase / Take Over inline registration) together with its
 * inspection, in one local transaction/outbox batch. The vessel stays hidden from everyone but its creator and
 * Admin (via Manage Vessel → Unregistered) until an Admin approves it.
 */
export async function createInspectionWithNewVessel(
  input: Omit<NewInspectionInput, 'vesselId'> & { newVessel: NewVesselDraft },
): Promise<string> {
  const { newVessel, ...rest } = input;
  const vesselId = crypto.randomUUID();
  const inspectionId = crypto.randomUUID();
  const stamp = () => nextOutboxTimestamp();
  const me = getCachedUser();

  await hydrateTemplatesIfOnline();

  const vesselRow: Synced<Vessel> = {
    id: vesselId, name: newVessel.name, imo: newVessel.imo, vesselType: newVessel.vesselType,
    particulars: {}, registrationStatus: 'unregistered', createdBy: me?.id ?? null,
    updatedAt: new Date().toISOString(),
  };
  const vesselMutation: Mutation & { attempts: number } = {
    id: crypto.randomUUID(), entity: 'vessels', entityId: vesselId, op: 'upsert',
    data: { name: vesselRow.name, imo: vesselRow.imo, vesselType: vesselRow.vesselType, particulars: {}, registrationStatus: 'unregistered' },
    baseVersion: null, createdAt: stamp(), attempts: 0,
  };

  const { mutations, inspectionRow, sectionRows, questionRows } = await buildInspection(
    inspectionId, { ...rest, vesselId }, stamp,
  );

  await db.transaction('rw', db.vessels, db.inspections, db.inspectionSections, db.inspectionQuestions, db.outbox, async () => {
    await db.vessels.put(vesselRow);
    await db.inspections.put(inspectionRow);
    await db.inspectionSections.bulkPut(sectionRows);
    await db.inspectionQuestions.bulkPut(questionRows);
    await db.outbox.add(vesselMutation);
    await db.outbox.bulkAdd(mutations);
  });

  scheduleSync();
  return inspectionId;
}

