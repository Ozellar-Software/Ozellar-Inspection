import type { Finding, Photo } from '@ozellar/shared';
import { db } from '../../offline/db';
import { localWrite, localDelete } from '../../offline/outbox';

export interface DefectConfirmRequest {
  photo: Photo;
  finding: Finding;
  sectionName?: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Check whether a finding has user-entered content or observations.
 */
export function hasFindingDetails(finding: Finding): boolean {
  const hasText = !!finding.text && finding.text.trim().length > 0;
  const hasCa = !!finding.correctiveAction && finding.correctiveAction.trim().length > 0;
  const hasPa = !!finding.preventiveAction && finding.preventiveAction.trim().length > 0;
  return hasText || hasCa || hasPa;
}

/**
 * Handle toggling a photo between Defect and Normal:
 * - When marked as DEFECT:
 *   Ensures an observation (Finding) exists for this photo in its section.
 *   If not, creates a new finding, links photo to it, and sets isDefect: true.
 *
 * - When marked as NORMAL:
 *   If linked to an observation:
 *   - If the observation has no text/actions and no other photos, automatically removes it.
 *   - If the observation has user-entered details, requests confirmation via callback.
 */
export async function togglePhotoDefectWithObservation(
  photo: Photo,
  newDefect: boolean,
  options?: {
    onConfirmRequired?: (req: DefectConfirmRequest) => void;
    onCompleted?: (updatedPhoto: Photo, observationCreatedOrRemoved: boolean) => void;
  }
): Promise<boolean> {
  const photoId = photo.id;

  if (newDefect) {
    // ── Turn into Defect ──
    let findingId = photo.findingId;
    let createdFinding = false;

    // If not already attached to a finding, create a new Observation
    if (!findingId && photo.inspectionSectionId) {
      const existingFindings = await db.findings
        .where('inspectionSectionId')
        .equals(photo.inspectionSectionId)
        .toArray();

      findingId = crypto.randomUUID();
      const newFinding: Finding = {
        id: findingId,
        inspectionId: photo.inspectionId || '',
        inspectionSectionId: photo.inspectionSectionId || '',
        text: photo.description ? String(photo.description).trim() : '',
        answer: 'no', // Observation / Defect
        correctiveAction: '',
        preventiveAction: '',
        position: existingFindings.length,
      };

      await localWrite('findings', findingId, newFinding as unknown as Record<string, unknown>);
      createdFinding = true;
    }

    const patch: Partial<Photo> = {
      isDefect: true,
      ...(findingId ? { findingId, target: 'finding' as const } : {}),
    };

    await localWrite('photos', photoId, patch);
    const updated = { ...photo, ...patch };
    options?.onCompleted?.(updated, createdFinding);
    return true;
  } else {
    // ── Turn into Normal ──
    const findingId = photo.findingId;

    if (findingId) {
      const finding = await db.findings.get(findingId);
      if (finding) {
        // Check if other photos are also attached to this finding
        const otherPhotos = await db.photos
          .where('findingId')
          .equals(findingId)
          .filter((p) => p.id !== photoId && !p.deletedAt)
          .toArray();

        const hasDetails = hasFindingDetails(finding) || otherPhotos.length > 0;

        if (hasDetails && options?.onConfirmRequired) {
          // Find section name for context
          let secName = '';
          if (finding.inspectionSectionId) {
            const sec = await db.inspectionSections.get(finding.inspectionSectionId);
            if (sec) secName = sec.name;
          }

          // Request user confirmation popup
          options.onConfirmRequired({
            photo,
            finding,
            sectionName: secName,
            onConfirm: async () => {
              // Only delete finding if no other photos are attached
              if (otherPhotos.length === 0) {
                await localDelete('findings', finding.id);
              }
              const patch: Partial<Photo> = {
                isDefect: false,
                findingId: null,
                target: (photo.inspectionSectionId ? 'section' : 'inspection') as any,
              };
              await localWrite('photos', photoId, patch);
              options?.onCompleted?.({ ...photo, ...patch }, true);
            },
            onCancel: () => {
              // Cancelled, do nothing
            },
          });

          return false;
        }

        // Observation is completely empty and has no other photos -> delete it automatically
        if (otherPhotos.length === 0) {
          await localDelete('findings', finding.id);
        }
      }
    }

    const patch: Partial<Photo> = {
      isDefect: false,
      findingId: null,
      target: (photo.inspectionSectionId ? 'section' : 'inspection') as any,
    };

    await localWrite('photos', photoId, patch);
    const updated = { ...photo, ...patch };
    options?.onCompleted?.(updated, !!findingId);
    return true;
  }
}
