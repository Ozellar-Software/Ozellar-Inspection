import type { ApprovalEvent, Finding, Inspection, InspectionQuestion, InspectionSection, Photo, Response, Vessel } from '@ozellar/shared';
import { db } from '../../offline/db';

export type QuestionState = 'ok' | 'bad' | 'na' | 'pending';

export function questionState(r?: Response): QuestionState {
  if (!r) return 'pending';
  if (r.applicable === false) return 'na';
  if (r.applicable === true && r.answer === 'yes') return 'ok';
  if (r.applicable === true && r.answer === 'no') return 'bad';
  return 'pending';
}
export function findingState(f: Finding): QuestionState {
  if (f.answer === 'yes') return 'ok';
  return 'bad';
}

export interface SectionReport {
  section: InspectionSection;
  questions: { question: InspectionQuestion; response?: Response; state: QuestionState; photoIds: string[] }[];
  findings: { finding: Finding; state: QuestionState; photoIds: string[] }[];
  sectionPhotoIds: string[];
}

export interface ReportStats {
  totalQuestions: number;
  satisfactory: number;
  observations: number;
  na: number;
  pending: number;
  photoCount: number;
  extraFindings: number;
  photoSectionCount?: number;
  defectPhotoCount?: number;
  photoSectionPhotosCount?: number;
  photoSectionDefectCount?: number;
  photoSectionExtraFindings?: number;
}

export interface Observation {
  id?: string;
  kind: 'question' | 'finding';
  sectionId: string;
  sectionName: string;
  ref: string;
  text: string;
  remarks: string;
  correctiveAction: string;
  preventiveAction: string;
  photoIds: string[];
}

export interface ReportData {
  inspection: Inspection;
  vessel?: Vessel;
  sections: SectionReport[];
  stats: ReportStats;
  observations: Observation[];
  approvalHistory?: ApprovalEvent[];
  photos: Photo[];
}

export async function loadReportData(inspectionId: string): Promise<ReportData | null> {
  const inspection = await db.inspections.get(inspectionId);
  if (!inspection) return null;
  const vessel = inspection.vesselId ? await db.vessels.get(inspection.vesselId) : undefined;
  const allSections = (await db.inspectionSections.where('inspectionId').equals(inspectionId).sortBy('position'))
    .filter((s) => !(s as any).deletedAt)
    .sort((a, b) => Number(Boolean(a.photoOnly)) - Number(Boolean(b.photoOnly)) || a.position - b.position);
  const questions = await db.inspectionQuestions.toArray();
  const responses = await db.responses.where('inspectionId').equals(inspectionId).toArray();
  const findings = (await db.findings.where('inspectionId').equals(inspectionId).toArray()).filter((f) => !f.deletedAt);
  const photos = (await db.photos.where('inspectionId').equals(inspectionId).toArray()).filter((p) => !p.deletedAt);

  const responseByQuestion = new Map(responses.map((r) => [r.inspectionQuestionId, r]));
  const photosByResponse = new Map<string, string[]>();
  const photosByFinding = new Map<string, string[]>();
  const photosBySection = new Map<string, string[]>();
  for (const p of photos) {
    if (p.findingId) {
      (photosByFinding.get(p.findingId) ?? photosByFinding.set(p.findingId, []).get(p.findingId)!).push(p.id);
    }
    if (p.responseId) {
      (photosByResponse.get(p.responseId) ?? photosByResponse.set(p.responseId, []).get(p.responseId)!).push(p.id);
    }
    // Defect / observation photos appear ONLY in observations, removed from section overview photos
    if (p.inspectionSectionId && !p.responseId && !p.findingId && !p.isDefect) {
      (photosBySection.get(p.inspectionSectionId) ?? photosBySection.set(p.inspectionSectionId, []).get(p.inspectionSectionId)!).push(p.id);
    }
  }

  const defectPhotoCount = photos.filter((p) => p.isDefect).length;
  const photoSectionIdSet = new Set(allSections.filter((s) => s.photoOnly).map((s) => s.id));
  const photoSectionCount = photoSectionIdSet.size;
  const photoSectionPhotos = photos.filter((p) => p.inspectionSectionId && photoSectionIdSet.has(p.inspectionSectionId));
  const photoSectionPhotosCount = photoSectionPhotos.length;
  const photoSectionDefectCount = photoSectionPhotos.filter((p) => p.isDefect).length;
  const photoSectionExtraFindings = findings.filter((f) => photoSectionIdSet.has(f.inspectionSectionId)).length;

  const stats: ReportStats = {
    totalQuestions: 0,
    satisfactory: 0,
    observations: 0,
    na: 0,
    pending: 0,
    photoCount: photos.length,
    extraFindings: findings.length,
    photoSectionCount,
    defectPhotoCount,
    photoSectionPhotosCount,
    photoSectionDefectCount,
    photoSectionExtraFindings,
  };
  const observations: Observation[] = [];
  const sections: SectionReport[] = [];

  for (const section of allSections) {
    const sectionQuestions = questions.filter((q) => q.inspectionSectionId === section.id).sort((a, b) => a.position - b.position);
    const sectionFindings = findings.filter((f) => f.inspectionSectionId === section.id).sort((a, b) => a.position - b.position);

    const qRows = sectionQuestions.map((question) => {
      const response = responseByQuestion.get(question.id);
      const state = questionState(response);
      if (!section.photoOnly) {
        stats.totalQuestions++;
        if (state === 'ok') stats.satisfactory++;
        else if (state === 'bad') stats.observations++;
        else if (state === 'na') stats.na++;
        else stats.pending++;
        const qPhotoIds = photosByResponse.get(response?.id ?? '') ?? [];
        if (state === 'bad') {
          observations.push({
            id: response?.id,
            kind: 'question', sectionId: section.id, sectionName: section.name, ref: question.ref, text: question.text,
            remarks: response?.remarks ?? '', correctiveAction: response?.correctiveAction ?? '', preventiveAction: response?.preventiveAction ?? '',
            photoIds: qPhotoIds,
          });
        }
      }
      return { question, response, state, photoIds: photosByResponse.get(response?.id ?? '') ?? [] };
    });

    const fRows = sectionFindings.map((finding, fIdx) => {
      const state = findingState(finding);
      const fPhotoIds = photosByFinding.get(finding.id) ?? [];
      if (state === 'bad') {
        observations.push({
          id: finding.id,
          kind: 'finding', sectionId: section.id, sectionName: section.name, ref: `Observation ${fIdx + 1}`, text: finding.text,
          remarks: '', correctiveAction: finding.correctiveAction, preventiveAction: finding.preventiveAction,
          photoIds: fPhotoIds,
        });
      }
      return { finding, state, photoIds: fPhotoIds };
    });

    sections.push({ section, questions: qRows, findings: fRows, sectionPhotoIds: photosBySection.get(section.id) ?? [] });
  }

  stats.observations = observations.length;
  stats.extraFindings = findings.filter((f) => f.answer !== 'yes').length;
  stats.photoSectionExtraFindings = observations.filter((o) => photoSectionIdSet.has(o.sectionId)).length;

  return { inspection, vessel, sections, stats, observations, photos };
}
