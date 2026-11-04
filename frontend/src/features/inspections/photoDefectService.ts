import type { Finding, Photo } from '@ozellar/shared';
import { db } from '../../offline/db';
import { localWrite, localDelete } from '../../offline/outbox';

export interface DefectConfirmRequest {
  photo: Photo;
  finding: Finding;
  sectionName?: string;
  onRemoveObservationAndSetNormal: () => Promise<void>;
  onKeepObservationAndSetNormal: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Check whether a finding has user-entered content or observations beyond the photo's caption.
 */
export function hasFindingDetails(finding: Finding, photo?: Photo): boolean {
  const findingText = (finding.text || '').trim();
  const photoText = (photo?.description || '').trim();

  // If corrective action or preventive action was entered, it definitely has details
  const hasCa = !!finding.correctiveAction && finding.correctiveAction.trim().length > 0;
  const hasPa = !!finding.preventiveAction && finding.preventiveAction.trim().length > 0;
  if (hasCa || hasPa) return true;

  // If finding has text and it is different from the photo's own caption/remark,
  // the surveyor entered dedicated observation text.
  if (findingText.length > 0) {
    if (!photoText || findingText !== photoText) {
      return true;
    }
  }

  return false;
}

/**
 * Handle toggling a photo between Defect and Normal:
 * - When marked as DEFECT:
 *   Ensures an observation (Finding) exists for this photo in its section.
 *   If not, creates a new finding, links photo to it, and sets isDefect: true.
 *
 * - When marked as NORMAL:
 *   If linked to an observation:
 *   - If the observation has no custom text/actions and no other photos, automatically removes it.
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

  // Fetch freshest record from Dexie
  const existing = await db.photos.get(photoId);
  const currentPhoto: Photo = existing ? { ...existing, ...photo } : photo;
  const inspectionId = currentPhoto.inspectionId || photo.inspectionId || '';
  const sectionId = currentPhoto.inspectionSectionId || photo.inspectionSectionId || '';

  if (newDefect) {
    // ── Turn into Defect ──
    let findingId = currentPhoto.findingId;
    let createdFinding = false;

    // If not already attached to a finding, create a new Observation in the section
    if (!findingId && sectionId) {
      const existingFindings = await db.findings
        .where('inspectionSectionId')
        .equals(sectionId)
        .toArray();

      findingId = crypto.randomUUID();
      const newFinding: Finding = {
        id: findingId,
        inspectionId,
        inspectionSectionId: sectionId,
        text: currentPhoto.description ? String(currentPhoto.description).trim() : '',
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
    const updated = { ...currentPhoto, ...patch };
    options?.onCompleted?.(updated, createdFinding);
    return true;
  } else {
    // ── Turn into Normal ──
    const findingId = currentPhoto.findingId;

    if (findingId) {
      const finding = await db.findings.get(findingId);
      if (finding) {
        // Check if other photos are also attached to this finding
        const otherPhotos = await db.photos
          .where('findingId')
          .equals(findingId)
          .filter((p) => p.id !== photoId && !p.deletedAt)
          .toArray();

        const hasDetails = hasFindingDetails(finding, currentPhoto) || otherPhotos.length > 0;

        if (hasDetails && options?.onConfirmRequired) {
          // Find section name for context
          let secName = '';
          if (finding.inspectionSectionId) {
            const sec = await db.inspectionSections.get(finding.inspectionSectionId);
            if (sec) secName = sec.name;
          }

          // Request user confirmation popup: Yes (remove observation) or No (observation will stay)
          options.onConfirmRequired({
            photo: currentPhoto,
            finding,
            sectionName: secName,
            // YES: Remove observation & set photo to normal
            onRemoveObservationAndSetNormal: async () => {
              const patch: Partial<Photo> = {
                isDefect: false,
                findingId: null,
                target: (currentPhoto.responseId ? 'question' : (sectionId ? 'section' : 'inspection')) as any,
                inspectionSectionId: sectionId || currentPhoto.inspectionSectionId || null,
              };
              // Unlink and preserve photo in section FIRST
              await localWrite('photos', photoId, patch);

              // Only delete finding if no other photos are attached
              if (otherPhotos.length === 0) {
                await localDelete('findings', finding.id);
              }
              options?.onCompleted?.({ ...currentPhoto, ...patch }, true);
            },
            // NO: Observation will stay! Only set photo to normal and unlink
            onKeepObservationAndSetNormal: async () => {
              const patch: Partial<Photo> = {
                isDefect: false,
                findingId: null,
                target: (currentPhoto.responseId ? 'question' : (sectionId ? 'section' : 'inspection')) as any,
                inspectionSectionId: sectionId || currentPhoto.inspectionSectionId || null,
              };
              await localWrite('photos', photoId, patch);
              options?.onCompleted?.({ ...currentPhoto, ...patch }, false);
            },
            // CANCEL: Keep as defect, do nothing
            onCancel: () => {
              // Cancelled, do nothing
            },
          });

          return false;
        }

        // Unlink photo FIRST so it remains in section evidence
        const patch: Partial<Photo> = {
          isDefect: false,
          findingId: null,
          target: (currentPhoto.responseId ? 'question' : (sectionId ? 'section' : 'inspection')) as any,
          inspectionSectionId: sectionId || currentPhoto.inspectionSectionId || null,
        };
        await localWrite('photos', photoId, patch);

        // Observation is completely empty (no user details entered) and has no other photos -> delete it automatically
        if (otherPhotos.length === 0) {
          await localDelete('findings', finding.id);
        }

        const updated = { ...currentPhoto, ...patch };
        options?.onCompleted?.(updated, true);
        return true;
      }
    }

    const patch: Partial<Photo> = {
      isDefect: false,
      findingId: null,
      target: (currentPhoto.responseId ? 'question' : (sectionId ? 'section' : 'inspection')) as any,
      inspectionSectionId: sectionId || currentPhoto.inspectionSectionId || null,
    };

    await localWrite('photos', photoId, patch);
    const updated = { ...currentPhoto, ...patch };
    options?.onCompleted?.(updated, !!findingId);
    return true;
  }
}
