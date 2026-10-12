import JSZip from 'jszip';
import type { Photo } from '@ozellar/shared';
import { getPhotoUrls, photoSrc } from '../../offline/photoQueue';
import { db } from '../../offline/db';

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'General';
}

/** Triggers a browser download of a Blob file. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Downloads a single photo directly to the device. */
export async function downloadSinglePhoto(
  photo: { id: string; blobPath?: string; isDefect?: boolean; sectionName?: string },
  url?: string,
  prefix = 'photo'
): Promise<void> {
  const effectiveUrl = url || (await photoSrc(photo.id));
  if (!effectiveUrl) {
    throw new Error('Could not load photo URL. Please check network connection.');
  }

  const res = await fetch(effectiveUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch photo file (${res.status})`);
  }
  const blob = await res.blob();
  const safePrefix = sanitizeFilename(prefix);
  const tag = photo.isDefect ? 'defect' : 'normal';
  let ext = 'jpg';
  if (blob.type === 'image/png') ext = 'png';
  else if (blob.type === 'image/webp') ext = 'webp';
  const filename = `${tag}_${safePrefix}_${photo.id.slice(0, 8)}.${ext}`;

  downloadBlob(blob, filename);
}

export interface ZipDownloadOptions {
  zipFilename: string;
  filter?: 'all' | 'defect' | 'normal';
  defaultSectionName?: string;
  onProgress?: (current: number, total: number, message: string) => void;
}

export type PhotoItem = {
  id: string;
  blobPath?: string;
  isDefect?: boolean;
  position?: number;
  target?: string;
  inspectionSectionId?: string | null;
  responseId?: string | null;
  findingId?: string | null;
  sectionName?: string;
  itemLabel?: string;
};

/** Resolves section names and question/finding labels for photos to organize the ZIP. */
async function resolvePhotosContext(
  photos: PhotoItem[],
  defaultSectionName?: string
): Promise<Map<string, { sectionName: string; itemLabel: string }>> {
  const result = new Map<string, { sectionName: string; itemLabel: string }>();

  // Pre-fetch caches for speed
  const sectionCache = new Map<string, string>();
  const questionCache = new Map<string, { ref: string; sectionId: string }>();

  try {
    const allSections = await db.inspectionSections.toArray();
    for (const s of allSections) {
      sectionCache.set(s.id, s.name);
    }
  } catch (e) {
    console.warn('Failed to pre-cache sections', e);
  }

  try {
    const allQuestions = await db.inspectionQuestions.toArray();
    for (const q of allQuestions) {
      questionCache.set(q.id, { ref: q.ref || `Q${q.qid}`, sectionId: q.inspectionSectionId });
    }
  } catch (e) {
    console.warn('Failed to pre-cache questions', e);
  }

  for (const p of photos) {
    if (p.sectionName) {
      result.set(p.id, {
        sectionName: p.sectionName,
        itemLabel: p.itemLabel || (p.target ? p.target : 'photo'),
      });
      continue;
    }

    let sectionName = defaultSectionName || '';
    let itemLabel = p.target || 'photo';

    if (p.target === 'cover') {
      sectionName = 'Cover';
      itemLabel = 'Cover_Photo';
    } else if (p.target === 'vessel') {
      sectionName = 'Vessel';
      itemLabel = 'Vessel_Profile';
    } else if (p.inspectionSectionId && sectionCache.has(p.inspectionSectionId)) {
      sectionName = sectionCache.get(p.inspectionSectionId)!;
      itemLabel = 'Section_Photo';
    } else if (p.responseId) {
      try {
        const resp = await db.responses.get(p.responseId);
        if (resp) {
          const q = questionCache.get(resp.inspectionQuestionId) || (await db.inspectionQuestions.get(resp.inspectionQuestionId));
          if (q) {
            itemLabel = 'ref' in q && q.ref ? q.ref : 'Question';
            const secId = 'sectionId' in q ? q.sectionId : q.inspectionSectionId;
            if (secId && sectionCache.has(secId)) {
              sectionName = sectionCache.get(secId)!;
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to resolve response for photo ${p.id}`, err);
      }
    } else if (p.findingId) {
      try {
        const finding = await db.findings.get(p.findingId);
        if (finding) {
          itemLabel = `Finding_${(finding.position ?? 0) + 1}`;
          if (finding.inspectionSectionId && sectionCache.has(finding.inspectionSectionId)) {
            sectionName = sectionCache.get(finding.inspectionSectionId)!;
          }
        }
      } catch (err) {
        console.warn(`Failed to resolve finding for photo ${p.id}`, err);
      }
    }

    if (!sectionName) {
      sectionName = defaultSectionName || 'General';
    }

    result.set(p.id, { sectionName, itemLabel });
  }

  return result;
}

/** Batch downloads photos as a .zip archive, organized into 2 folders: normal and defect, with filenames starting with defect or normal. */
export async function downloadPhotosAsZip(
  photos: PhotoItem[],
  options: ZipDownloadOptions
): Promise<{ success: boolean; count: number }> {
  const targetPhotos = options.filter === 'defect'
    ? photos.filter((p) => !!p.isDefect)
    : options.filter === 'normal'
    ? photos.filter((p) => !p.isDefect)
    : photos;

  if (targetPhotos.length === 0) {
    throw new Error(
      options.filter === 'defect'
        ? 'No defect photos found to download.'
        : options.filter === 'normal'
        ? 'No normal photos found to download.'
        : 'No photos available to download.'
    );
  }

  const total = targetPhotos.length;
  options.onProgress?.(0, total, 'Resolving section details and photo URLs...');

  const [contextMap, urlMap] = await Promise.all([
    resolvePhotosContext(targetPhotos, options.defaultSectionName),
    getPhotoUrls(targetPhotos.map((p) => p.id)),
  ]);

  const zip = new JSZip();
  let completed = 0;
  let successCount = 0;

  // Explicitly create normal and defect folders in zip archive
  zip.folder('normal');
  zip.folder('defect');

  // Pre-calculate sequential numbering within normal and defect folders
  const normalPhotos = targetPhotos.filter((p) => !p.isDefect);
  const defectPhotos = targetPhotos.filter((p) => !!p.isDefect);
  const photoIndexMap = new Map<string, { folder: 'normal' | 'defect'; indexStr: string }>();

  normalPhotos.forEach((p, idx) => {
    photoIndexMap.set(p.id, {
      folder: 'normal',
      indexStr: String(idx + 1).padStart(3, '0'),
    });
  });

  defectPhotos.forEach((p, idx) => {
    photoIndexMap.set(p.id, {
      folder: 'defect',
      indexStr: String(idx + 1).padStart(3, '0'),
    });
  });

  // Process downloads in concurrent batches of 4
  const BATCH_SIZE = 4;
  for (let i = 0; i < targetPhotos.length; i += BATCH_SIZE) {
    const batch = targetPhotos.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (photo) => {
        const info = photoIndexMap.get(photo.id) || {
          folder: (photo.isDefect ? 'defect' : 'normal') as 'normal' | 'defect',
          indexStr: '001',
        };
        const folder = info.folder;
        const prefix = info.folder; // 'normal' or 'defect'
        const indexStr = info.indexStr;

        const meta = contextMap.get(photo.id) || {
          sectionName: options.defaultSectionName || 'General',
          itemLabel: 'photo',
        };

        const safeSection = sanitizeFilename(meta.sectionName);
        const safeLabel = sanitizeFilename(meta.itemLabel || 'photo');
        const labelPart = safeSection && safeSection !== 'General' && safeSection !== safeLabel
          ? `${safeSection}_${safeLabel}`
          : safeLabel;

        try {
          const u = urlMap[photo.id] || (await photoSrc(photo.id));
          if (u) {
            const resp = await fetch(u);
            if (resp.ok) {
              const blob = await resp.blob();
              let ext = 'jpg';
              if (blob.type === 'image/png') ext = 'png';
              else if (blob.type === 'image/webp') ext = 'webp';

              // Name starts with defect or normal and placed in corresponding folder:
              // e.g. normal/normal_001_Section_Photo_abc12345.jpg or defect/defect_001_Section_Photo_abc12345.jpg
              const fileName = `${folder}/${prefix}_${indexStr}_${labelPart}_${photo.id.slice(0, 8)}.${ext}`;
              zip.file(fileName, blob);
              successCount++;
            }
          }
        } catch (err) {
          console.warn(`Failed to include photo ${photo.id} in zip`, err);
        } finally {
          completed++;
          options.onProgress?.(
            completed,
            total,
            `Downloading photo ${completed} of ${total} (${folder})...`
          );
        }
      })
    );
  }

  if (successCount === 0) {
    throw new Error('Unable to retrieve any photo files. Please ensure you are online.');
  }

  options.onProgress?.(total, total, 'Compiling ZIP archive with normal and defect folders...');
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const safeZipName = `${sanitizeFilename(options.zipFilename)}.zip`;
  downloadBlob(zipBlob, safeZipName);

  return { success: true, count: successCount };
}
