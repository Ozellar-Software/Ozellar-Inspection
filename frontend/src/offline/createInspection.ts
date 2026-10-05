import type { Inspection, InspectionQuestion, InspectionSection, InspectionType, Mutation } from '@ozellar/shared';
import { api } from '../api/client';
import { db } from './db';

type Synced<T> = T & { rowVersion?: number; deletedAt?: string | null };

interface TemplateSectionRow { id: string; sr: number; zone: string; name: string; position: number; photoOnly: boolean }
interface TemplateQuestionRow { id: string; sectionId: string; qid: number; ref: string; text: string; position: number }

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
  const baseTime = Date.now();
  let seq = 0;
  const stamp = () => new Date(baseTime + seq++).toISOString(); // strictly increasing so outbox order == dependency order

  let templateSections = ((await db.templateSections.toArray()) as unknown as TemplateSectionRow[])
    .filter((s) => !(s as unknown as { deletedAt?: string | null }).deletedAt)
    .sort((a, b) => a.position - b.position);
  let templateQuestions = ((await db.templateQuestions.toArray()) as unknown as (TemplateQuestionRow & { deletedAt?: string | null })[])
    .filter((q) => !q.deletedAt);

  // Guarantee master checklist is loaded before creating inspection
  if (templateSections.length === 0 && navigator.onLine) {
    try {
      const [serverSecs, serverQs] = await Promise.all([
        api<TemplateSectionRow[]>('/templates/sections/list'),
        api<TemplateQuestionRow[]>('/templates/questions/list'),
      ]);
      if (serverSecs.length) {
        await db.templateSections.bulkPut(serverSecs as unknown as Record<string, unknown> & { id: string }[]);
        templateSections = serverSecs.sort((a, b) => a.position - b.position);
      }
      if (serverQs.length) {
        await db.templateQuestions.bulkPut(serverQs as unknown as Record<string, unknown> & { id: string }[]);
        templateQuestions = serverQs;
      }
    } catch {
      // offline fallback
    }
  }

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

  for (const ts of templateSections) {
    const sectionId = crypto.randomUUID();
    const sectionData = { inspectionId, templateSr: ts.sr, zone: ts.zone, name: ts.name, position: ts.position, photoOnly: ts.photoOnly ?? false, isCustom: false };
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

  return inspectionId;
}
