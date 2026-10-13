import type {
  Inspection, InspectionQuestion, InspectionSection, InspectionType, Mutation,
  TemplateSection, TemplateQuestion,
} from '@ozellar/shared';
import { api } from '../api/client';
import { db } from './db';
import { nextOutboxTimestamp } from './outbox';
import { scheduleSync } from './sync';

type Synced<T> = T & { rowVersion?: number; deletedAt?: string | null };

export interface NewInspectionInput {
  vesselId: string; vesselName: string; imo: string; vesselType: string;
  inspectionType: InspectionType; port: string; startDate: string | null;
  inspector: string; company: string;
}

/**
 * Creates a new inspection with a frozen copy of the current checklist template (sections + questions),
 * entirely offline: one local transaction, queued as mutations in dependency order (inspection, then each
 * section immediately followed by its own questions — the server rejects a question whose section it hasn't
 * seen yet). Returns the new inspection id.
 */
export async function createInspection(input: NewInspectionInput): Promise<string> {
  const inspectionId = crypto.randomUUID();
  const stamp = () => nextOutboxTimestamp(); // strictly increasing so outbox order == dependency order

  // When online, always hydrate the latest master checklist (Universal + Vessel Type sections & questions)
  if (navigator.onLine) {
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
      // offline fallback to local IndexedDB templates below
    }
  }

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
  mutations.push({ id: crypto.randomUUID(), entity: 'inspections', entityId: inspectionId, op: 'upsert', data: { ...input }, baseVersion: null, createdAt: stamp(), attempts: 0 });
  const inspectionRow: Synced<Inspection> = {
    id: inspectionId, ...input, status: 'in_progress', updatedAt: new Date().toISOString(),
    completionDate: null, summary: '', conclusion: '', createdBy: null,
  };

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
  // so the inspection is never created with zero sections!
  if (rawApplicable.length === 0) {
    rawApplicable = templateSections.filter((ts) => {
      const types = (Array.isArray(ts.vesselTypes) ? ts.vesselTypes : []).map((t) => String(t).trim()).filter(Boolean);
      return types.length === 0;
    });
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

  await db.transaction('rw', db.inspections, db.inspectionSections, db.inspectionQuestions, db.outbox, async () => {
    await db.inspections.put(inspectionRow);
    await db.inspectionSections.bulkPut(sectionRows);
    await db.inspectionQuestions.bulkPut(questionRows);
    await db.outbox.bulkAdd(mutations);
  });

  scheduleSync();
  return inspectionId;
}

