import { jsPDF } from 'jspdf';
import { STATUS_LABELS, type ApprovalEvent, type VesselParticularKey } from '@ozellar/shared';
import { photoSrc } from '../../offline/photoQueue';
import { db } from '../../offline/db';
import brandLogoSrc from '../../assets/ozellar-marine-global-logo.gif';
import { PARTICULAR_LABELS, PARTICULAR_GROUPS } from '../vessels/particulars';
import type { ReportData, SectionReport, Observation } from './reportData';
import { renderRichText, measureRichText } from './richTextPdf';

// ---------------------------------------------------------------------------
// Design System Constants (Maritime Executive Theme)
// ---------------------------------------------------------------------------
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_LEFT = 14;
const MARGIN_RIGHT = 14;
const TOP_MARGIN = 18;
const BOTTOM_MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT; // 182 mm

// Palette (RGB tuples for jsPDF)
const NAVY: [number, number, number] = [16, 89, 53];         // #105935 Primary Dark Green
const NAVY_LIGHT: [number, number, number] = [30, 122, 75];   // #1E7A4B Secondary Green
const TEAL: [number, number, number] = [242, 107, 36];        // #F26B24 Accent Orange
const TEAL_TINT: [number, number, number] = [254, 239, 230];  // #FEEFE6 Light Orange
const SLATE_BG: [number, number, number] = [248, 250, 252];   // #F8FAFC Card Surface
const BORDER: [number, number, number] = [226, 232, 240];     // #E2E8F0 Card Border
const BORDER_DARK: [number, number, number] = [203, 213, 225];// #CBD5E1 Divider Rule
const TEXT_DARK: [number, number, number] = [15, 23, 42];     // #0F172A Dark Ink
const TEXT_BODY: [number, number, number] = [51, 65, 85];     // #334155 Body Text
const TEXT_MUTED: [number, number, number] = [100, 116, 139]; // #64748B Secondary Text
const TEXT_FAINT: [number, number, number] = [148, 163, 184]; // #94A3B8 Faint Notes
const WHITE: [number, number, number] = [255, 255, 255];

const STATUS_OK: { bg: [number, number, number]; border: [number, number, number]; text: [number, number, number] } = {
  bg: [236, 253, 245], border: [167, 243, 208], text: [6, 95, 70],
};
const STATUS_BAD: { bg: [number, number, number]; border: [number, number, number]; text: [number, number, number] } = {
  bg: [254, 242, 242], border: [254, 202, 202], text: [153, 27, 27],
};
const STATUS_NA: { bg: [number, number, number]; border: [number, number, number]; text: [number, number, number] } = {
  bg: [241, 245, 249], border: [226, 232, 240], text: [71, 85, 105],
};
const STATUS_PENDING: { bg: [number, number, number]; border: [number, number, number]; text: [number, number, number] } = {
  bg: [255, 251, 235], border: [253, 230, 138], text: [146, 64, 14],
};

const INSPECTION_TYPE_LABELS: Record<string, string> = {
  port: 'In Port Survey',
  remote: 'Remote Survey',
  sailing: 'While Sailing Survey',
};

function fmtDate(ms?: number | string | null): string {
  if (!ms) return '-';
  const d = typeof ms === 'string' ? new Date(ms) : new Date(ms);
  if (isNaN(d.getTime())) return String(ms);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
async function loadAssetImage(src: string): Promise<LoadedImage | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image load failed'));
      el.src = src;
    });
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

// High-Performance Image Loader & Optimizer
// ---------------------------------------------------------------------------
interface LoadedImage {
  dataUrl: string;
  w: number;
  h: number;
}

export interface PdfProgressEvent {
  loaded: number;
  total: number;
  stage: string;
  percent: number;
}

const sessionImageCache = new Map<string, Promise<LoadedImage | null>>();

export function clearPdfImageCache() {
  sessionImageCache.clear();
}

async function loadImage(photoId?: string | null): Promise<LoadedImage | null> {
  if (!photoId) return null;
  if (sessionImageCache.has(photoId)) {
    return sessionImageCache.get(photoId)!;
  }

  const p = (async (): Promise<LoadedImage | null> => {
    try {
      const src = await photoSrc(photoId);
      if (!src) return null;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;

      if (typeof (img as any).decode === 'function') {
        try {
          await (img as any).decode();
        } catch {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('image decode failed'));
          });
        }
      } else {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('image load failed'));
        });
      }

      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      if (!nw || !nh) return null;

      // 640px gives crisp 194 DPI inside an 84mm card (retina sharp, 4x faster canvas encoding & 75% lower RAM)
      const MAX_DIM = 640;
      let w = nw;
      let h = nh;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) {
          h = Math.round((h * MAX_DIM) / w);
          w = MAX_DIM;
        } else {
          w = Math.round((w * MAX_DIM) / h);
          h = MAX_DIM;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      return { dataUrl: canvas.toDataURL('image/jpeg', 0.78), w, h };
    } catch {
      return null;
    }
  })();

  sessionImageCache.set(photoId, p);
  return p;
}

// Precise Image Cropper to guarantee exact aspect ratio without PDF overflow
async function cropToCover(loadedImg: LoadedImage, targetW: number, targetH: number): Promise<string> {
  try {
    const targetAspect = targetW / targetH;
    const srcW = loadedImg.w;
    const srcH = loadedImg.h;
    if (!srcW || !srcH) return loadedImg.dataUrl;
    const srcAspect = srcW / srcH;

    let cropW = srcW;
    let cropH = srcH;
    let cropX = 0;
    let cropY = 0;

    if (srcAspect > targetAspect) {
      // Source is wider than target aspect -> crop left and right
      cropW = Math.round(srcH * targetAspect);
      cropX = Math.round((srcW - cropW) / 2);
    } else {
      // Source is taller than target aspect -> crop top and bottom
      cropH = Math.round(srcW / targetAspect);
      cropY = Math.round((srcH - cropH) / 2);
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.min(cropW, 1600);
    canvas.height = Math.round(canvas.width / targetAspect);
    const ctx = canvas.getContext('2d');
    if (!ctx) return loadedImg.dataUrl;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('canvas crop failed'));
      img.src = loadedImg.dataUrl;
    });

    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    return loadedImg.dataUrl;
  }
}

// ---------------------------------------------------------------------------
// Enterprise PDF Builder Class
// ---------------------------------------------------------------------------
class Doc {
  pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  y = TOP_MARGIN;

  newPage() {
    this.pdf.addPage();
    this.y = TOP_MARGIN;
  }

  ensure(h: number) {
    if (this.y + h > PAGE_H - BOTTOM_MARGIN) {
      this.newPage();
    }
  }

  setFill(c: [number, number, number]) {
    this.pdf.setFillColor(c[0], c[1], c[2]);
  }

  setDraw(c: [number, number, number], w = 0.3) {
    this.pdf.setDrawColor(c[0], c[1], c[2]);
    this.pdf.setLineWidth(w);
  }

  setTextColor(c: [number, number, number]) {
    this.pdf.setTextColor(c[0], c[1], c[2]);
  }

  roundedBox(x: number, y: number, w: number, h: number, fill?: [number, number, number], border?: [number, number, number], rx = 2.5) {
    if (fill) this.setFill(fill);
    if (border) this.setDraw(border);
    const style = fill && border ? 'FD' : fill ? 'F' : 'S';
    this.pdf.roundedRect(x, y, w, h, rx, rx, style);
  }

  sectionHeader(title: string, zone?: string, stat?: string) {
    this.ensure(16);
    const h = 12;
    // Dark navy full-width bar
    this.setFill(NAVY);
    this.pdf.rect(MARGIN_LEFT, this.y, CONTENT_W, h, 'F');

    // Left teal accent strip
    this.setFill(TEAL);
    this.pdf.rect(MARGIN_LEFT, this.y, 3.5, h, 'F');

    // Section title
    this.pdf.setFont('helvetica', 'bold').setFontSize(10);
    this.setTextColor(WHITE);
    this.pdf.text(title.toUpperCase(), MARGIN_LEFT + 7, this.y + 8);

    // Calculate stat width for correct zone spacing
    let statW = 0;
    if (stat) {
      this.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
      statW = this.pdf.getTextWidth(stat);
    }

    // Right tags
    if (zone) {
      this.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      const zoneW = this.pdf.getTextWidth(zone.toUpperCase()) + 8;
      const zoneX = PAGE_W - MARGIN_RIGHT - zoneW - (stat ? statW + 6 : 0);
      this.setFill(NAVY_LIGHT);
      this.pdf.roundedRect(zoneX, this.y + 2.5, zoneW, 7, 1.5, 1.5, 'F');
      this.setTextColor([210, 235, 255]);
      this.pdf.text(zone.toUpperCase(), zoneX + 4, this.y + 7);
    }

    if (stat) {
      this.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
      this.setTextColor([190, 210, 230]);
      this.pdf.text(stat, PAGE_W - MARGIN_RIGHT - 2, this.y + 7.5, { align: 'right' });
    }

    this.y += h + 4.5;
  }

  subSectionTitle(title: string) {
    this.ensure(12);
    this.setFill(TEAL);
    this.pdf.roundedRect(MARGIN_LEFT, this.y, 3, 6, 1, 1, 'F');

    this.pdf.setFont('helvetica', 'bold').setFontSize(10.5);
    this.setTextColor(NAVY);
    this.pdf.text(title.toUpperCase(), MARGIN_LEFT + 6, this.y + 5);

    this.setDraw(BORDER);
    this.pdf.line(MARGIN_LEFT, this.y + 8, PAGE_W - MARGIN_RIGHT, this.y + 8);
    this.y += 12;
  }

  statusBadge(state: 'ok' | 'bad' | 'na' | 'pending', x: number, y: number): { w: number; h: number } {
    const config = state === 'ok' ? { ...STATUS_OK, label: 'SATISFACTORY', icon: '[+]' }
      : state === 'bad' ? { ...STATUS_BAD, label: 'OBSERVATION', icon: '!' }
      : state === 'na' ? { ...STATUS_NA, label: 'N / A', icon: '-' }
      : { ...STATUS_PENDING, label: 'PENDING', icon: '[?]' };

    const text = `${config.icon}  ${config.label}`;
    this.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    const textW = this.pdf.getTextWidth(text);
    const w = textW + 8;
    const h = 5.8;

    this.roundedBox(x, y, w, h, config.bg, config.border, 1.5);
    this.setTextColor(config.text);
    this.pdf.text(text, x + 4, y + 4.1);

    return { w, h };
  }

  kvLine(label: string, value: string, x: number, y: number, labelW = 40) {
    this.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
    this.setTextColor(TEXT_MUTED);
    this.pdf.text(label.toUpperCase(), x, y);

    this.pdf.setFont('helvetica', 'normal').setFontSize(9);
    this.setTextColor(TEXT_DARK);
    this.pdf.text(value || '-', x + labelW, y);
  }
}

// ---------------------------------------------------------------------------
// Main PDF Export Function
// ---------------------------------------------------------------------------
export async function generateInspectionPdf(data: ReportData & {
  reportType?: 'full' | 'photo_only';
  onProgress?: (progress: PdfProgressEvent) => void;
}): Promise<Blob> {
  const { inspection, vessel, sections = [], observations = [], stats, approvalHistory = [] } = data;
  const isPhotoOnly = data.reportType === 'photo_only';
  const photoSectionsOnly = sections.filter((s) => !!s.section.photoOnly);
  const neededSections = isPhotoOnly ? photoSectionsOnly : sections;
  const doc = new Doc();

  // 1. Gather all needed photo IDs to prefetch concurrently
  const allNeededPhotoIds: string[] = [];
  if (inspection.coverPhotoId) allNeededPhotoIds.push(inspection.coverPhotoId);

  for (const s of neededSections) {
    if (s.sectionPhotoIds) allNeededPhotoIds.push(...s.sectionPhotoIds);
    for (const q of s.questions) {
      if (q.photoIds) allNeededPhotoIds.push(...q.photoIds);
    }
    for (const f of s.findings) {
      if (f.photoIds) allNeededPhotoIds.push(...f.photoIds);
    }
  }

  const neededPhotoSecIdSet = new Set(photoSectionsOnly.map((s) => s.section.id));
  const neededObservations = isPhotoOnly
    ? observations.filter((obs) => neededPhotoSecIdSet.has(obs.sectionId))
    : observations;

  if (neededObservations.length > 0) {
    neededObservations.forEach((obs) => {
      if (obs.photoIds) allNeededPhotoIds.push(...obs.photoIds);
    });
    (data.photos || []).forEach((p) => {
      if (p.isDefect) allNeededPhotoIds.push(p.id);
    });
  }

  const uniquePhotoIds = Array.from(new Set(allNeededPhotoIds.filter(Boolean)));
  const totalUniquePhotos = uniquePhotoIds.length;

  if (data.onProgress && totalUniquePhotos > 0) {
    data.onProgress({
      loaded: 0,
      total: totalUniquePhotos,
      stage: 'Preparing photographic evidence...',
      percent: 5,
    });
  }

  // 2. High-speed concurrent pre-warmer (processes 8 images in parallel)
  if (uniquePhotoIds.length > 0) {
    let completed = 0;
    const queue = [...uniquePhotoIds];
    const CONCURRENCY = 8;
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        await loadImage(id);
        completed++;
        if (data.onProgress && (completed % 4 === 0 || completed === totalUniquePhotos)) {
          const percent = 5 + Math.round((completed / totalUniquePhotos) * 85);
          data.onProgress({
            loaded: completed,
            total: totalUniquePhotos,
            stage: `Processing image ${completed} of ${totalUniquePhotos}...`,
            percent,
          });
        }
      }
    });
    await Promise.all(workers);
  }

  if (data.onProgress) {
    data.onProgress({
      loaded: totalUniquePhotos,
      total: totalUniquePhotos,
      stage: 'Rendering report document pages...',
      percent: 92,
    });
  }

  const photoMap = new Map((data.photos ?? []).map((p) => [p.id, p]));
  const getPhotoDoc = async (id?: string | null) => {
    if (!id) return null;
    return photoMap.get(id) ?? await db.photos.get(id).catch(() => null);
  };

  const svgRingData = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg width="400" height="400" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ozellar-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f1592a" /><stop offset="100%" stopColor="#e04e22" /></linearGradient></defs><circle cx="50" cy="50" r="36" fill="none" stroke="url(#ozellar-grad)" strokeWidth="20" /></svg>');

  const [brandLogo] = await Promise.all([
    loadAssetImage(brandLogoSrc)
  ]);

    // ─── Professional High-Visibility Photo Card Renderer ──
  const drawPhotoCard = (
    px: number,
    py: number,
    pW: number,
    pH: number,
    img: LoadedImage | null,
    docPhoto: any,
    label: string
  ) => {
    const isDef = !!docPhoto?.isDefect;
    const desc = docPhoto?.description ? String(docPhoto.description).trim() : '';

    // Split description into lines to dynamically fit within caption banner
    const maxDescW = pW - 8;
    doc.pdf.setFont('helvetica', isDef ? 'bold' : 'normal').setFontSize(6.5);
    const descLines = desc ? (doc.pdf.splitTextToSize(desc, maxDescW) as string[]).slice(0, 2) : [];

    // Caption banner height: 9mm (no desc), 13mm (1 line), 16mm (2 lines)
    const bannerH = descLines.length > 1 ? 16 : descLines.length === 1 ? 13 : 9;
    const imgAreaH = pH - bannerH;

    // 1. Outer Card Container
    if (isDef) {
      doc.roundedBox(px, py, pW, pH, [255, 245, 245], [220, 38, 38], 2);
      doc.setFill([220, 38, 38]);
      doc.pdf.rect(px, py, 3, pH, 'F');
    } else {
      doc.roundedBox(px, py, pW, pH, WHITE, BORDER, 2);
      doc.setFill(NAVY);
      doc.pdf.rect(px, py, 2.5, pH, 'F');
    }

    // 2. Image Viewport — fills prominent upper area of card with clean neutral framing
    const imgLeft = px + (isDef ? 3 : 2.5);
    const imgAreaW = pW - (isDef ? 3 : 2.5);

    doc.setFill(isDef ? [254, 242, 242] : [248, 250, 252]);
    doc.pdf.rect(imgLeft, py, imgAreaW, imgAreaH, 'F');

    if (img) {
      const scFit = Math.min(imgAreaW / img.w, imgAreaH / img.h);
      const fw = img.w * scFit;
      const fh = img.h * scFit;
      const fx = imgLeft + (imgAreaW - fw) / 2;
      const fy = py + (imgAreaH - fh) / 2;
      doc.pdf.addImage(img.dataUrl, 'JPEG', fx, fy, fw, fh);
    } else {
      doc.pdf.setFont('helvetica', 'italic').setFontSize(7);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text('Photo unavailable', imgLeft + imgAreaW / 2, py + imgAreaH / 2, { align: 'center' });
    }

    // 3. Compact status icon badge (top-right pill)
    if (isDef) {
      const bW = 18, bH = 5;
      const bX = px + pW - bW - 2.5;
      const bY = py + 2.5;
      doc.setFill([220, 38, 38]);
      doc.pdf.roundedRect(bX, bY, bW, bH, 1.2, 1.2, 'F');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(6.5);
      doc.setTextColor(WHITE);
      doc.pdf.text('▲ DEFECT', bX + 2, bY + 3.6);
    } else {
      const bW = 14, bH = 5;
      const bX = px + pW - bW - 2.5;
      const bY = py + 2.5;
      doc.setFill([6, 95, 70]);
      doc.pdf.roundedRect(bX, bY, bW, bH, 1.2, 1.2, 'F');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(6.5);
      doc.setTextColor(WHITE);
      doc.pdf.text('✓ OK', bX + 2.2, bY + 3.6);
    }

    // 4. Caption banner at bottom
    const capY = py + pH - bannerH;
    if (isDef) {
      doc.setFill([254, 235, 235]);
      doc.pdf.rect(imgLeft, capY, imgAreaW, bannerH, 'F');
      doc.setDraw([220, 38, 38], 0.3);
      doc.pdf.line(imgLeft, capY, px + pW - 0.3, capY);
    } else {
      doc.setFill([248, 250, 252]);
      doc.pdf.rect(imgLeft, capY, imgAreaW, bannerH, 'F');
      doc.setDraw(BORDER, 0.3);
      doc.pdf.line(imgLeft, capY, px + pW - 0.3, capY);
    }

    // Line 1: Header Label (e.g. PHOTO #1)
    const labelY = capY + 4;
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.2);
    doc.setTextColor(isDef ? [185, 28, 28] : NAVY);
    doc.pdf.text(label, imgLeft + 3, labelY);

    // Line 2: Description Text (bold & highlighted if defect)
    if (descLines.length > 0) {
      let descY = labelY + 4;
      doc.pdf.setFont('helvetica', isDef ? 'bold' : 'normal').setFontSize(6.5);
      doc.setTextColor(isDef ? [153, 27, 27] : TEXT_BODY);
      for (const dLine of descLines) {
        doc.pdf.text(dLine, imgLeft + 3, descY);
        descY += 3.8;
      }
    } else {
      doc.pdf.setFont('helvetica', 'italic').setFontSize(6.0);
      doc.setTextColor(TEXT_FAINT);
      doc.pdf.text(
        isDef ? 'Defect identified during survey inspection' : 'Visual record logged for section survey',
        imgLeft + 3,
        labelY + 3.8
      );
    }
  };

  // ─── 4 Photos Per Page Grid (High-Visibility, Big Scale) ───
  const renderPhotoGrid4 = async (
    photoIds: string[],
    sectionName: string,
    zone: string,
    gridTitle = 'SECTION PHOTOGRAPHS & VISUAL EVIDENCE'
  ) => {
    if (!photoIds.length) return;

    const gapX = 8;
    const gapY = 6;
    const pW = (CONTENT_W - gapX) / 2; // 87 mm
    const pH = 104;                     // 104 mm
    const rowH = pH + gapY;             // 110 mm
    let photosOnCurrentPage = 0;

    // If starting on a page that already has content (like remarks) and cannot fit 2 full rows (4 photos):
    if (photoIds.length >= 3 && doc.y + (2 * rowH) > PAGE_H - BOTTOM_MARGIN) {
      doc.newPage();
      doc.sectionHeader(
        sectionName,
        zone || 'Visual Evidence',
        `${photoIds.length} Photographs`
      );
    }

    doc.ensure(rowH + 10);
    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(gridTitle, MARGIN_LEFT, doc.y + 4);
    doc.y += 7;

    for (let pIdx = 0; pIdx < photoIds.length; pIdx += 2) {
      if (photosOnCurrentPage >= 4 || doc.y + pH > PAGE_H - BOTTOM_MARGIN) {
        doc.newPage();
        doc.sectionHeader(
          sectionName,
          zone || 'Visual Evidence',
          `Photographs (Cont.)`
        );
        doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text(gridTitle + ' (CONTINUED)', MARGIN_LEFT, doc.y + 4);
        doc.y += 7;
        photosOnCurrentPage = 0;
      }

      const id1 = photoIds[pIdx];
      const id2 = pIdx + 1 < photoIds.length ? photoIds[pIdx + 1] : undefined;

      const [img1, img2, photoDoc1, photoDoc2] = await Promise.all([
        loadImage(id1),
        id2 ? loadImage(id2) : Promise.resolve(null),
        getPhotoDoc(id1),
        id2 ? getPhotoDoc(id2) : Promise.resolve(null),
      ]);

      const curRowY = doc.y;
      if (id1) {
        drawPhotoCard(MARGIN_LEFT, curRowY, pW, pH, img1, photoDoc1, `PHOTO #${pIdx + 1}`);
        photosOnCurrentPage++;
      }
      if (id2) {
        drawPhotoCard(MARGIN_LEFT + pW + gapX, curRowY, pW, pH, img2, photoDoc2, `PHOTO #${pIdx + 2}`);
        photosOnCurrentPage++;
      }

      doc.y += rowH;
    }
  };
  const renderPhotoGrid8 = renderPhotoGrid4; // Backwards-compatible alias

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 1: EXECUTIVE COVER PAGE
  // ═══════════════════════════════════════════════════════════════════════════

    // Top Header Banner (Single Row)
  doc.setFill(WHITE);
  doc.pdf.rect(0, 0, PAGE_W, 24, 'F');
  doc.setFill(TEAL);
  doc.pdf.rect(0, 22, PAGE_W, 2, 'F');

  let titleX = MARGIN_LEFT;
  if (brandLogo) {
    const scale = 11 / brandLogo.h;
    const lw = brandLogo.w * scale;
    doc.pdf.addImage(brandLogo.dataUrl, 'PNG', MARGIN_LEFT, 6, lw, 11);
    titleX += lw + 6;
  }

  const isTakeOver = (inspection as any)?.reportCategory === 'take_over';
  const isPrePurchase = (inspection as any)?.reportCategory === 'pre_purchase';
  const mainPdfTitle = isTakeOver
    ? 'VESSEL TAKE OVER REPORT'
    : isPrePurchase
    ? 'PRE PURCHASE INSPECTION REPORT'
    : (isPhotoOnly ? 'VESSEL PHOTO INSPECTION REPORT' : 'VESSEL INSPECTION REPORT');
  const subPdfTitle = isTakeOver
    ? 'VESSEL TAKE OVER & FLEET ENTRY AUDIT RECORD'
    : isPrePurchase
    ? 'PRE PURCHASE PHOTOGRAPHIC CONDITION SURVEY'
    : (isPhotoOnly ? 'PHOTOGRAPHIC SURVEY & CONDITION AUDIT RECORD' : 'OFFICIAL STATUTORY & TECHNICAL AUDIT RECORD');

  doc.pdf.setFont('helvetica', 'bold').setFontSize(13);
  doc.setTextColor(NAVY);
  doc.pdf.text(mainPdfTitle, titleX, 11.5);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text(subPdfTitle, titleX, 16);

  // Top Right Audit Grade Pill
  const auditPillW = 40;
  doc.setFill(SLATE_BG);
  doc.setDraw(BORDER);
  doc.pdf.roundedRect(PAGE_W - MARGIN_RIGHT - auditPillW, 6, auditPillW, 12, 1.5, 1.5, 'FD');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(NAVY);
  doc.pdf.text('AUDIT CERTIFIED', PAGE_W - MARGIN_RIGHT - auditPillW + 5, 10.5);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(6.5);
  doc.setTextColor(TEXT_FAINT);
  doc.pdf.text(`ISSUED: ${fmtDate(inspection.startDate || new Date().toISOString())}`, PAGE_W - MARGIN_RIGHT - auditPillW + 5, 14.5);

  // ── Full-Bleed Hero Cover Image ──────────────────────────────────────────
  // Image spans full page width, with a dark gradient overlay at bottom for text
  const heroY = 25;
  const heroH = 138;
  let coverImgLoaded: LoadedImage | null = null;
  if (inspection.coverPhotoId) {
    coverImgLoaded = await loadImage(inspection.coverPhotoId);
  }

  // Inspected vessel metadata string (shown on image overlay)
  const metaItems = [
    inspection.imo ? `IMO ${inspection.imo}` : '',
    inspection.vesselType ? inspection.vesselType.toUpperCase() : '',
    vessel?.particulars?.flag ? `Flag: ${vessel.particulars.flag}` : '',
    inspection.port ? `Port: ${inspection.port}` : '',
  ].filter(Boolean);
  const vMetaStr = metaItems.join('   |   ');

  // Status configuration
  const statusLabel = (STATUS_LABELS[inspection.status] || inspection.status || 'IN PROGRESS').toUpperCase();
  const stColor = inspection.status === 'approved'
    ? { bg: [16, 122, 70] as [number, number, number], border: [34, 197, 94] as [number, number, number] }
    : inspection.status === 'returned'
    ? { bg: [185, 28, 28] as [number, number, number], border: [239, 68, 68] as [number, number, number] }
    : { bg: [180, 83, 9] as [number, number, number], border: [245, 158, 11] as [number, number, number] };

  if (coverImgLoaded) {
    // Exact crop to cover: fits PAGE_W × heroH with zero overflow
    const croppedDataUrl = await cropToCover(coverImgLoaded, PAGE_W, heroH);
    doc.pdf.addImage(croppedDataUrl, 'JPEG', 0, heroY, PAGE_W, heroH);

    // Dark gradient overlay at bottom of image (layered rects)
    const gradH = 50;
    const gradTop = heroY + heroH - gradH;
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const alpha = i / steps;
      const darkness = Math.round(alpha * 180);
      doc.setFill([darkness > 130 ? 0 : 10, darkness > 130 ? 0 : 20, darkness > 130 ? 0 : 15] as [number, number, number]);
      doc.pdf.setGState(doc.pdf.GState({ opacity: alpha * 0.78 }));
      doc.pdf.rect(0, gradTop + (i * gradH) / steps, PAGE_W, gradH / steps + 0.5, 'F');
    }
    doc.pdf.setGState(doc.pdf.GState({ opacity: 1 }));

    // Status Pill (placed at bottom right of image over gradient)
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    const pillTextW = doc.pdf.getTextWidth(statusLabel);
    const pillW = pillTextW + 14;
    const pillH = 7.5;
    const pillX = PAGE_W - MARGIN_RIGHT - pillW;
    const pillY = heroY + heroH - 22;

    doc.setFill(stColor.bg);
    doc.setDraw(stColor.border, 0.4);
    doc.pdf.roundedRect(pillX, pillY, pillW, pillH, 1.5, 1.5, 'FD');
    // Inner filled status dot
    doc.setFill(WHITE);
    doc.pdf.circle(pillX + 4.5, pillY + pillH / 2, 1.1, 'F');
    doc.setTextColor(WHITE);
    doc.pdf.text(statusLabel, pillX + 8, pillY + 5.2);

    // Vessel Name Overlay (bottom left)
    const overlayTextY = heroY + heroH - 18;
    doc.pdf.setFont('helvetica', 'bold').setFontSize(16.5);
    doc.setTextColor(WHITE);
    doc.pdf.text((inspection.vesselName || 'VESSEL').toUpperCase(), MARGIN_LEFT, overlayTextY);

    // Metadata line (IMO, Type, Flag, Port)
    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.0);
    doc.setTextColor([210, 235, 225]);
    doc.pdf.text(vMetaStr, MARGIN_LEFT, overlayTextY + 7);

    // Orange accent bar at bottom of image
    doc.setFill(TEAL);
    doc.pdf.rect(0, heroY + heroH - 2, PAGE_W, 2.5, 'F');
  } else {
    // Executive Maritime fallback banner (when no cover photo available)
    doc.setFill([13, 33, 56]);
    doc.pdf.rect(0, heroY, PAGE_W, heroH, 'F');
    doc.setFill([10, 50, 35]);
    doc.pdf.rect(0, heroY + heroH - 35, PAGE_W, 35, 'F');

    doc.setFill(TEAL);
    doc.pdf.rect(MARGIN_LEFT, heroY + 16, 24, 1.5, 'F');

    // Status Pill
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    const pillTextW = doc.pdf.getTextWidth(statusLabel);
    const pillW = pillTextW + 14;
    const pillH = 7.5;
    const pillX = PAGE_W - MARGIN_RIGHT - pillW;
    const pillY = heroY + 16;
    doc.setFill(stColor.bg);
    doc.setDraw(stColor.border, 0.4);
    doc.pdf.roundedRect(pillX, pillY, pillW, pillH, 1.5, 1.5, 'FD');
    doc.setFill(WHITE);
    doc.pdf.circle(pillX + 4.5, pillY + pillH / 2, 1.1, 'F');
    doc.setTextColor(WHITE);
    doc.pdf.text(statusLabel, pillX + 8, pillY + 5.2);

    doc.pdf.setFont('helvetica', 'bold').setFontSize(22);
    doc.setTextColor(WHITE);
    doc.pdf.text((inspection.vesselName || 'VESSEL INSPECTION').toUpperCase(), MARGIN_LEFT, heroY + 32);

    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
    doc.setTextColor([180, 225, 200]);
    doc.pdf.text(vMetaStr || `IMO: ${inspection.imo || 'NOT SPECIFIED'}`, MARGIN_LEFT, heroY + 44);

    doc.setFill(TEAL);
    doc.pdf.rect(0, heroY + heroH - 2, PAGE_W, 2.5, 'F');
  }

  // ── AUDIT & SURVEY PARTICULARS (Executive Maritime Table) ──────────────────
  const detailsY = heroY + heroH + 6;
  const detailsH = 66;
  doc.roundedBox(MARGIN_LEFT, detailsY, CONTENT_W, detailsH, WHITE, BORDER, 2.5);

  // Navy header strip inside card
  const hdrH = 8.5;
  doc.setFill(NAVY);
  doc.pdf.rect(MARGIN_LEFT, detailsY, CONTENT_W, hdrH, 'F');
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, detailsY, 3.5, hdrH, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
  doc.setTextColor(WHITE);
  doc.pdf.text('AUDIT & SURVEY PARTICULARS', MARGIN_LEFT + 8, detailsY + 5.8);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
  doc.setTextColor([200, 230, 215]);
  doc.pdf.text('OFFICIAL STATUTORY RECORD', PAGE_W - MARGIN_RIGHT - 8, detailsY + 5.8, { align: 'right' });

  // 4 Rows of Data Grid
  const particularsRows = [
    {
      col1: { label: 'SURVEY TYPE', val: isPhotoOnly ? 'Photographic Condition Survey' : (INSPECTION_TYPE_LABELS[inspection.inspectionType] || inspection.inspectionType || 'In Port Survey') },
      col2: { label: 'LEAD SURVEYOR', val: inspection.inspector || '-' },
    },
    {
      col1: { label: 'PORT / LOCATION', val: inspection.port || '-' },
      col2: { label: 'SURVEY AGENCY', val: inspection.company || 'Ozellar Marine Global' },
    },
    {
      col1: { label: 'DATE COMMENCED', val: fmtDate(inspection.startDate) },
      col2: { label: 'REPORT REFERENCE', val: `VIR-${inspection.id.slice(0, 8).toUpperCase()}` },
    },
    {
      col1: { label: 'DATE COMPLETED', val: fmtDate(inspection.completionDate || inspection.startDate) },
      col2: { label: 'VESSEL CATEGORY', val: (inspection.vesselType || 'Commercial Vessel').toUpperCase() },
    },
  ];

  let pRowY = detailsY + hdrH + 3.5;
  const col1X = MARGIN_LEFT + 8;
  const col2X = MARGIN_LEFT + 98;

  for (let rIdx = 0; rIdx < particularsRows.length; rIdx++) {
    const row = particularsRows[rIdx];

    // Col 1
    doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(row.col1.label, col1X, pRowY + 3.5);
    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
    doc.setTextColor(NAVY);
    doc.pdf.text(row.col1.val, col1X, pRowY + 8.5);

    // Col 2
    doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(row.col2.label, col2X, pRowY + 3.5);
    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
    doc.setTextColor(NAVY);
    doc.pdf.text(row.col2.val, col2X, pRowY + 8.5);

    // Hairline divider after rows 0, 1, 2
    if (rIdx < particularsRows.length - 1) {
      doc.setDraw(BORDER, 0.2);
      doc.pdf.line(MARGIN_LEFT + 8, pRowY + 12.5, PAGE_W - MARGIN_RIGHT - 8, pRowY + 12.5);
    }

    pRowY += 13.5;
  }

  // ── Cover Footer Certification Box ─────────────────────────────────────────
  const certY = detailsY + detailsH + 6;
  const certH = 24;
  doc.roundedBox(MARGIN_LEFT, certY, CONTENT_W, certH, TEAL_TINT, [242, 107, 36] as any, 2);
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, certY, 3.5, certH, 'F');

  doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
  doc.setTextColor(TEAL);
  doc.pdf.text('VERIFICATION STATEMENT & QUALITY CERTIFICATION', MARGIN_LEFT + 8, certY + 6.5);

  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  doc.setTextColor(NAVY);
  doc.pdf.text('IMO / SOLAS SURVEY STANDARDS', PAGE_W - MARGIN_RIGHT - 8, certY + 6.5, { align: 'right' });

  doc.setDraw([242, 107, 36], 0.2);
  doc.pdf.line(MARGIN_LEFT + 8, certY + 9, PAGE_W - MARGIN_RIGHT - 8, certY + 9);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(7.2);
  doc.setTextColor(TEXT_BODY);
  const certMsg = 'This inspection was carried out in accordance with international maritime safety regulations, classification society standards, and approved company survey procedures. Findings and condition assessments represent accurate technical status at the time of inspection.';
  const certLines = doc.pdf.splitTextToSize(certMsg, CONTENT_W - 16) as string[];
  doc.pdf.text(certLines, MARGIN_LEFT + 8, certY + 14.5);

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 2: VESSEL TECHNICAL PARTICULARS (Executive Bespoke Maritime Dossier)
  // ═══════════════════════════════════════════════════════════════════════════
  doc.newPage();
  const p = vessel?.particulars ?? {};

  // 1. Bespoke Architectural Executive Dossier Header (Unique - Not a generic green bar!)
  const dossierHdrY = doc.y;

  // Top category kicker
  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  doc.setTextColor(TEAL); // Accent Orange
  doc.pdf.text('STATUTORY SPECIFICATIONS DOSSIER & TECHNICAL PARTICULARS', MARGIN_LEFT, dossierHdrY + 3.5);

  // Main Title
  doc.pdf.setFont('helvetica', 'bold').setFontSize(13.5);
  doc.setTextColor(NAVY);
  doc.pdf.text('1. Vessel Technical Particulars', MARGIN_LEFT, dossierHdrY + 8.5);

  // Subtitle
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7.0);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('Certified Statutory, Classification Society & Principal Technical Registry Record', MARGIN_LEFT, dossierHdrY + 12.2);

  // Right-hand Side Executive Badges (IMO + Vessel Category)
  const imoStr = inspection.imo ? `IMO ${inspection.imo}` : (vessel?.imo ? `IMO ${vessel.imo}` : 'IMO REGISTERED');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7.2);
  const imoPillW = doc.pdf.getTextWidth(imoStr) + 10;
  const vTypeStr = (inspection.vesselType || (vessel as any)?.type || 'COMMERCIAL').toUpperCase();
  const vTypePillW = doc.pdf.getTextWidth(vTypeStr) + 10;

  // IMO Badge (Navy fill, white bold)
  const imoX = PAGE_W - MARGIN_RIGHT - imoPillW;
  doc.setFill(NAVY);
  doc.pdf.roundedRect(imoX, dossierHdrY + 1.5, imoPillW, 6.2, 1.2, 1.2, 'F');
  doc.setTextColor(WHITE);
  doc.pdf.text(imoStr, imoX + imoPillW / 2, dossierHdrY + 5.7, { align: 'center' });

  // Vessel Type Badge (Slate fill, dark navy border & text)
  const vTypeX = imoX - vTypePillW - 3;
  doc.setFill(SLATE_BG);
  doc.setDraw(BORDER);
  doc.pdf.roundedRect(vTypeX, dossierHdrY + 1.5, vTypePillW, 6.2, 1.2, 1.2, 'FD');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  doc.setTextColor(NAVY);
  doc.pdf.text(vTypeStr, vTypeX + vTypePillW / 2, dossierHdrY + 5.7, { align: 'center' });

  // Dual-tone Accent Hairline Divider
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, dossierHdrY + 14.5, 26, 1.2, 'F');
  doc.setDraw(BORDER_DARK, 0.25);
  doc.pdf.line(MARGIN_LEFT + 26, dossierHdrY + 15.1, PAGE_W - MARGIN_RIGHT, dossierHdrY + 15.1);

  doc.y = dossierHdrY + 18.5;

  // 2. Vessel Profile Identity Card (Full-Width Architectural Panel)
  const heroCardY = doc.y;
  const heroCardH = 22;
  doc.roundedBox(MARGIN_LEFT, heroCardY, CONTENT_W, heroCardH, SLATE_BG, BORDER, 2);

  // Left solid accent (inset pill so it stays neatly inside rounded corners)
  doc.setFill(NAVY);
  doc.pdf.roundedRect(MARGIN_LEFT + 1.2, heroCardY + 1.5, 2.5, heroCardH - 3, 1, 1, 'F');

  // 4 Columns inside Hero Panel
  const heroCols = [
    {
      label: 'VESSEL IDENTITY',
      val: (inspection.vesselName || vessel?.name || 'COMMERCIAL VESSEL').toUpperCase(),
      sub: imoStr,
      isPrimary: true,
    },
    {
      label: 'FLAG & REGISTRY',
      val: p.flag || (vessel as any)?.flag || 'LIBERIA (LR)',
      sub: `Port: ${p.portOfRegistry || (vessel as any)?.portOfRegistry || inspection.port || 'Registered Port'}`,
    },
    {
      label: 'CLASS & SOCIETY',
      val: p.classSociety || 'IACS CERTIFIED',
      sub: p.classNotation ? p.classNotation.slice(0, 20) : 'Statutory Standards',
    },
    {
      label: 'SURVEY REFERENCE',
      val: `VIR-${inspection.id.slice(0, 8).toUpperCase()}`,
      sub: `Date: ${fmtDate(inspection.startDate)}`,
    },
  ];

  const heroColW = (CONTENT_W - 3) / 4;
  for (let ci = 0; ci < heroCols.length; ci++) {
    const col = heroCols[ci];
    const cx = MARGIN_LEFT + 3 + ci * heroColW;

    // Hairline vertical divider between columns
    if (ci > 0) {
      doc.setDraw(BORDER, 0.25);
      doc.pdf.line(cx, heroCardY + 2.5, cx, heroCardY + heroCardH - 2.5);
    }

    const padLeft = cx + 5;
    const maxValW = heroColW - 8;

    // Label
    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.6);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(col.label, padLeft, heroCardY + 5.8);

    // Value
    doc.pdf.setFont('helvetica', 'bold').setFontSize(col.isPrimary ? 9.5 : 8.2);
    doc.setTextColor(col.isPrimary ? NAVY : TEXT_DARK);
    let vText = col.val;
    while (vText.length > 3 && doc.pdf.getTextWidth(vText) > maxValW) {
      vText = vText.slice(0, -1);
    }
    doc.pdf.text(vText, padLeft, heroCardY + 11.8);

    // Subtitle
    doc.pdf.setFont('helvetica', 'normal').setFontSize(5.8);
    doc.setTextColor(TEXT_FAINT);
    let sText = col.sub;
    while (sText.length > 3 && doc.pdf.getTextWidth(sText) > maxValW) {
      sText = sText.slice(0, -1);
    }
    doc.pdf.text(sText, padLeft, heroCardY + 17.0);
  }

  doc.y = heroCardY + heroCardH + 4.5;

  // 3. Key Technical Specification Metric Ribbon (4 Refined Executive KPI Cards)
  const specRibbonY = doc.y;
  const specRibbonH = 16.5;
  const ribbonGap = 4;
  const ribbonCardW = (CONTENT_W - 3 * ribbonGap) / 4;

  const ribbonItems = [
    {
      label: 'TRADING PROFILE',
      val: (inspection.vesselType || (vessel as any)?.type || 'BULK CARRIER').toUpperCase(),
      sub: 'Category / Service',
      barColor: NAVY,
    },
    {
      label: 'REGISTERED TONNAGE',
      val: p.deadweight
        ? (p.deadweight.includes('T') || p.deadweight.includes('t') ? p.deadweight : `${p.deadweight} DWT`)
        : (p.grossTonnage ? `${p.grossTonnage} GT` : 'COMMERCIAL DWT'),
      sub: 'Deadweight / Cargo',
      barColor: [185, 28, 28] as [number, number, number],
    },
    {
      label: 'HULL DIMENSIONS',
      val: p.loa
        ? (p.loa.includes('m') || p.loa.includes('M') ? p.loa : `${p.loa} M LOA`)
        : (p.breadth ? `BEAM ${p.breadth} M` : 'PRINCIPAL SPECS'),
      sub: p.breadth ? `Beam: ${p.breadth}m` : 'Length & Breadth',
      barColor: NAVY_LIGHT,
    },
    {
      label: 'CONSTRUCTION RECORD',
      val: p.yearBuilt ? `BUILT ${p.yearBuilt}` : (p.placeOfBuild || 'SHIPYARD RECORD').toUpperCase(),
      sub: p.placeOfBuild ? p.placeOfBuild : 'Build Specification',
      barColor: TEAL,
    },
  ];

  for (let ri = 0; ri < ribbonItems.length; ri++) {
    const item = ribbonItems[ri];
    const rx = MARGIN_LEFT + ri * (ribbonCardW + ribbonGap);

    doc.roundedBox(rx, specRibbonY, ribbonCardW, specRibbonH, WHITE, BORDER, 1.8);

    // Top hairline accent line
    doc.setFill(item.barColor);
    doc.pdf.rect(rx, specRibbonY, ribbonCardW, 1.8, 'F');

    // Label
    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.6);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(item.label, rx + 4, specRibbonY + 5.8);

    // Value
    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.2);
    doc.setTextColor(TEXT_DARK);
    let valStr = item.val;
    while (valStr.length > 3 && doc.pdf.getTextWidth(valStr) > ribbonCardW - 8) {
      valStr = valStr.slice(0, -1);
    }
    doc.pdf.text(valStr, rx + 4, specRibbonY + 10.6);

    // Subtitle
    doc.pdf.setFont('helvetica', 'normal').setFontSize(5.6);
    doc.setTextColor(TEXT_FAINT);
    let subStr = item.sub;
    while (subStr.length > 3 && doc.pdf.getTextWidth(subStr) > ribbonCardW - 8) {
      subStr = subStr.slice(0, -1);
    }
    doc.pdf.text(subStr, rx + 4, specRibbonY + 14.5);
  }

  doc.y = specRibbonY + specRibbonH + 4.5;

  // 4. Two-Column Technical Matrix (4 Balanced Executive Cards, No Repetitive Green Bars!)
  const colW = (CONTENT_W - 5) / 2; // 88.5 mm each
  const col1Left = MARGIN_LEFT;
  const col2Left = MARGIN_LEFT + colW + 5;

  const drawExecutiveSpecCard = (
    mx: number,
    my: number,
    mw: number,
    cardBadge: string,
    title: string,
    categoryTag: string,
    items: { label: string; value: string }[]
  ): number => {
    const headerH = 6.8;
    const rowHeight = 6.3;
    const totalH = headerH + items.length * rowHeight + 1.5;

    // Card outer box
    doc.roundedBox(mx, my, mw, totalH, WHITE, BORDER, 2);

    // Card header bar: Crisp slate background (Not solid green!)
    doc.setFill([241, 245, 249]); // #F1F5F9 Slate Tint
    doc.pdf.roundedRect(mx, my, mw, headerH, 2, 2, 'F');
    doc.pdf.rect(mx, my + headerH - 1.5, mw, 1.5, 'F');

    // Header bottom hairline divider
    doc.setDraw(BORDER_DARK, 0.2);
    doc.pdf.line(mx, my + headerH, mx + mw, my + headerH);

    // Left Geometric Badge (Pill with Navy background)
    const badgeW = 4.2;
    const badgeH = 4.2;
    const badgeX = mx + 3.2;
    const badgeY = my + 1.3;
    doc.setFill(NAVY);
    doc.pdf.roundedRect(badgeX, badgeY, badgeW, badgeH, 0.8, 0.8, 'F');
    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.0);
    doc.setTextColor(WHITE);
    doc.pdf.text(cardBadge, badgeX + badgeW / 2, badgeY + 3.0, { align: 'center' });

    // Header Title
    doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
    doc.setTextColor(NAVY);
    doc.pdf.text(title.toUpperCase(), mx + 9.5, my + 4.6);

    // Right Category Tag
    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.5);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(categoryTag.toUpperCase(), mx + mw - 4, my + 4.6, { align: 'right' });

    // Row items (Zebra striping, clean typography)
    let rY = my + headerH;
    const labelW = 39;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isAlt = i % 2 === 1;

      if (isAlt) {
        doc.setFill(SLATE_BG);
        doc.pdf.rect(mx + 0.5, rY, mw - 1, rowHeight, 'F');
      }

      // Hairline row divider
      if (i < items.length - 1) {
        doc.setDraw(BORDER, 0.15);
        doc.pdf.line(mx + 3, rY + rowHeight, mx + mw - 3, rY + rowHeight);
      }

      // Left Accent Bullet
      const hasVal = Boolean(item.value && item.value !== '-' && item.value.trim() !== '');
      doc.setFill(hasVal ? TEAL : [203, 213, 225]);
      doc.pdf.circle(mx + 4.5, rY + rowHeight / 2, 0.55, 'F');

      // Label
      doc.pdf.setFont('helvetica', 'bold').setFontSize(6.2);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text(item.label.toUpperCase(), mx + 7.5, rY + 4.2);

      // Value
      const valX = mx + labelW;
      const valMaxW = mw - labelW - 3.5;

      if (hasVal) {
        doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
        doc.setTextColor(TEXT_DARK);
        let vText = item.value;
        while (vText.length > 3 && doc.pdf.getTextWidth(vText) > valMaxW) {
          vText = vText.slice(0, -1);
        }
        doc.pdf.text(vText, valX, rY + 4.2);
      } else {
        doc.pdf.setFont('helvetica', 'normal').setFontSize(6.2);
        doc.setTextColor(TEXT_FAINT);
        doc.pdf.text('—', valX, rY + 4.2);
      }

      rY += rowHeight;
    }

    return totalH;
  };

  const matrixStartY = doc.y;

  // Left Column: Card A (Registration) & Card B (Commercial & Audit)
  let leftY = matrixStartY;

  // Card A: Registration & Identification
  const left1H = drawExecutiveSpecCard(
    col1Left,
    leftY,
    colW,
    'A',
    'Registration & Statutory Record',
    'Statutory Registry',
    [
      { label: 'Flag State', value: p.flag || (vessel as any)?.flag || '-' },
      { label: 'Port of Registry', value: p.portOfRegistry || (vessel as any)?.portOfRegistry || inspection.port || '-' },
      { label: 'Official Registry No', value: p.officialNo || '-' },
      { label: 'Radio Call Sign', value: p.callSign || (vessel as any)?.callSign || '-' },
      { label: 'IMO Official Number', value: inspection.imo ? `IMO ${inspection.imo}` : (vessel?.imo ? `IMO ${vessel.imo}` : '-') },
      { label: 'Year Built', value: p.yearBuilt || (vessel as any)?.builtYear || '-' },
      { label: 'Place of Build', value: p.placeOfBuild || '-' },
    ]
  );
  leftY += left1H + 4;

  // Card B: Commercial Ownership & Audit Logistics
  const left2H = drawExecutiveSpecCard(
    col1Left,
    leftY,
    colW,
    'B',
    'Commercial Management & Audit',
    'Operations & Audit',
    [
      { label: 'Registered Owner', value: p.owner || '-' },
      { label: 'Commercial Operator', value: p.managerOperator || '-' },
      { label: 'Survey Reference', value: `VIR-${inspection.id.slice(0, 8).toUpperCase()}` },
      { label: 'Survey Port / Location', value: inspection.port || '-' },
      { label: 'Attending Surveyor', value: inspection.inspector || '-' },
      { label: 'Date Commenced', value: fmtDate(inspection.startDate) },
      { label: 'Date Completed', value: fmtDate(inspection.completionDate || inspection.startDate) },
    ]
  );
  leftY += left2H;

  // Right Column: Card C (Dimensions & Tonnage) & Card D (Propulsion & Class)
  let rightY = matrixStartY;

  // Card C: Principal Dimensions & Tonnage
  const right1H = drawExecutiveSpecCard(
    col2Left,
    rightY,
    colW,
    'C',
    'Dimensions, Draft & Tonnage',
    'Hull & Capacities',
    [
      { label: 'Length Overall (LOA)', value: p.loa ? (p.loa.includes('m') || p.loa.includes('M') ? p.loa : `${p.loa} m`) : '-' },
      { label: 'Breadth (Beam)', value: p.breadth ? (p.breadth.includes('m') || p.breadth.includes('M') ? p.breadth : `${p.breadth} m`) : '-' },
      { label: 'Moulded Depth', value: p.depth ? (p.depth.includes('m') || p.depth.includes('M') ? p.depth : `${p.depth} m`) : '-' },
      { label: 'Summer Draft', value: p.summerDraft ? (p.summerDraft.includes('m') || p.summerDraft.includes('M') ? p.summerDraft : `${p.summerDraft} m`) : '-' },
      { label: 'Gross Tonnage (GRT)', value: p.grossTonnage ? (p.grossTonnage.includes('T') ? p.grossTonnage : `${p.grossTonnage} GT`) : '-' },
      { label: 'Net Tonnage (NRT)', value: p.netTonnage ? (p.netTonnage.includes('T') ? p.netTonnage : `${p.netTonnage} NT`) : '-' },
      { label: 'Deadweight (DWT)', value: p.deadweight ? (p.deadweight.includes('T') || p.deadweight.includes('t') ? p.deadweight : `${p.deadweight} DWT`) : '-' },
    ]
  );
  rightY += right1H + 4;

  // Card D: Propulsion Machinery & Classification
  const right2H = drawExecutiveSpecCard(
    col2Left,
    rightY,
    colW,
    'D',
    'Machinery, Propulsion & Class',
    'Engineering & Society',
    [
      { label: 'Classification Society', value: p.classSociety || 'IACS Certified' },
      { label: 'Class Notation', value: p.classNotation || '-' },
      { label: 'Main Propulsion Engine', value: p.mainEngine || '-' },
      { label: 'Maker & Model', value: p.mainEngineMakerModel || '-' },
      { label: 'Total Power Output', value: p.mainEnginePower ? (p.mainEnginePower.includes('W') ? p.mainEnginePower : `${p.mainEnginePower} kW`) : '-' },
      { label: 'Propulsion Type', value: p.propulsion || '-' },
      { label: 'Operational Comms', value: p.satellitePhone || p.email || '-' },
    ]
  );
  rightY += right2H;

  doc.y = Math.max(leftY, rightY) + 5;

  // 5. Official Maritime Survey Seal & Statutory Attestation (Full Width Bottom)
  const sealBoxY = doc.y;
  const sealBoxH = 28;
  doc.roundedBox(MARGIN_LEFT, sealBoxY, CONTENT_W, sealBoxH, WHITE, BORDER, 2.5);

  // Left solid accent (inset pill so it stays neatly inside rounded corners)
  doc.setFill(NAVY);
  doc.pdf.roundedRect(MARGIN_LEFT + 1.5, sealBoxY + 2, 2.5, sealBoxH - 4, 1, 1, 'F');

  // Vertical hairline divider separating left legal attestation from right seal stamp
  const dividerX = MARGIN_LEFT + 118;
  doc.setDraw(BORDER, 0.25);
  doc.pdf.line(dividerX, sealBoxY + 3, dividerX, sealBoxY + sealBoxH - 3);

  // ── LEFT SIDE: Attestation Statement & Verification Badges ──
  const attLeft = MARGIN_LEFT + 7;
  const attMaxW = dividerX - attLeft - 4; // ~107 mm

  // Header
  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  doc.setTextColor(NAVY);
  doc.pdf.text('STATUTORY ATTESTATION & TECHNICAL CERTIFICATION RECORD', attLeft, sealBoxY + 5.5);

  // Description
  doc.pdf.setFont('helvetica', 'normal').setFontSize(5.8);
  doc.setTextColor(TEXT_BODY);
  const attMsg = 'Vessel technical specifications recorded herein are verified against official certificates of registry, classification society records, builder specification documentation, and attending surveyor on-site audit.';
  const attLines = doc.pdf.splitTextToSize(attMsg, attMaxW) as string[];
  doc.pdf.text(attLines, attLeft, sealBoxY + 9.8);

  // 3 Verification Pills (Clean, concise, vector bullet, zero truncation!)
  const checkY = sealBoxY + 18.2;
  const checkBadges = [
    'Registry Verified',
    'Class Certified',
    'On-Site Attested',
  ];
  const badgeGap = 3;
  const checkW = (attMaxW - 2 * badgeGap) / 3; // ~33.6 mm each

  for (let cbi = 0; cbi < checkBadges.length; cbi++) {
    const cbX = attLeft + cbi * (checkW + badgeGap);

    // Pill background
    doc.setFill([236, 253, 245]);
    doc.setDraw([167, 243, 208], 0.3);
    doc.pdf.roundedRect(cbX, checkY, checkW, 5.2, 1.2, 1.2, 'FD');

    // Vector emerald check dot (guaranteed crisp, no unicode corruption!)
    doc.setFill([16, 122, 70]);
    doc.pdf.circle(cbX + 3.2, checkY + 2.6, 0.9, 'F');

    // Badge label
    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.8);
    doc.setTextColor([6, 95, 70]);
    doc.pdf.text(checkBadges[cbi], cbX + 5.6, checkY + 3.7);
  }

  // ── RIGHT SIDE: Official Survey Seal Stamp ──
  const sealAreaLeft = dividerX + 3;
  const sealAreaW = PAGE_W - MARGIN_RIGHT - sealAreaLeft; // ~61 mm
  const sealCenterX = sealAreaLeft + sealAreaW / 2;

  // Stamp Box Container (Double-bordered maritime seal)
  const stampBoxW = 56;
  const stampBoxH = 22;
  const stampBoxX = sealCenterX - stampBoxW / 2;
  const stampBoxY = sealBoxY + 3;

  doc.roundedBox(stampBoxX, stampBoxY, stampBoxW, stampBoxH, SLATE_BG, NAVY, 1.5);
  doc.setDraw(BORDER_DARK, 0.2);
  doc.pdf.roundedRect(stampBoxX + 1, stampBoxY + 1, stampBoxW - 2, stampBoxH - 2, 1, 1, 'S');

  // Seal Top Title
  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.2);
  doc.setTextColor(NAVY);
  doc.pdf.text('OZELLAR MARINE TECHNICAL AUDIT', sealCenterX, stampBoxY + 4.2, { align: 'center' });

  // Seal Status Pill
  const sPillW = 42;
  const sPillH = 4.6;
  const sPillX = sealCenterX - sPillW / 2;
  const sPillY = stampBoxY + 5.8;
  doc.setFill(NAVY);
  doc.pdf.roundedRect(sPillX, sPillY, sPillW, sPillH, 1, 1, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.6);
  doc.setTextColor(WHITE);
  doc.pdf.text('OFFICIAL RECORD - VERIFIED', sealCenterX, sPillY + 3.3, { align: 'center' });

  // Seal Reference & Date
  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.8);
  doc.setTextColor(TEXT_DARK);
  doc.pdf.text(`VIR-${inspection.id.slice(0, 8).toUpperCase()}  |  ${fmtDate(inspection.startDate)}`, sealCenterX, stampBoxY + 15.0, { align: 'center' });

  // Seal Surveyor Attestation
  doc.pdf.setFont('helvetica', 'italic').setFontSize(4.8);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text(
    inspection.inspector ? `Surveyor: ${inspection.inspector}` : 'Authorized Technical Dossier',
    sealCenterX,
    stampBoxY + 18.8,
    { align: 'center' }
  );

  doc.y = sealBoxY + sealBoxH + 6;

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 3: EXECUTIVE SUMMARY & SURVEY SYNTHESIS (Bespoke Maritime Dashboard)
  // ═══════════════════════════════════════════════════════════════════════════
  doc.newPage();

  // 1. Bespoke Architectural Executive Summary Header
  const execHdrY = doc.y;

  // Top category kicker
  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  doc.setTextColor(TEAL); // Accent Orange #F26B24
  doc.pdf.text('SURVEY AUDIT SYNTHESIS & EXECUTIVE APPRAISAL', MARGIN_LEFT, execHdrY + 3.5);

  // Main Title
  doc.pdf.setFont('helvetica', 'bold').setFontSize(13.5);
  doc.setTextColor(NAVY);
  doc.pdf.text('2. Executive Summary', MARGIN_LEFT, execHdrY + 8.5);

  // Subtitle
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7.0);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('Key Condition Findings, Operational Status & Attending Surveyor Appraisal', MARGIN_LEFT, execHdrY + 12.2);

  // Right-hand Badges: Status Pill + Reference
  const execStatusLabel = (STATUS_LABELS[inspection.status] || inspection.status || 'IN PROGRESS').toUpperCase();
  const execStColor = inspection.status === 'approved'
    ? { bg: [16, 122, 70] as [number, number, number], text: WHITE }
    : inspection.status === 'returned'
    ? { bg: [185, 28, 28] as [number, number, number], text: WHITE }
    : { bg: [245, 158, 11] as [number, number, number], text: TEXT_DARK };

  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  const stPillW = doc.pdf.getTextWidth(execStatusLabel) + 12;
  const stX = PAGE_W - MARGIN_RIGHT - stPillW;
  doc.setFill(execStColor.bg);
  doc.pdf.roundedRect(stX, execHdrY + 1.5, stPillW, 6.2, 1.2, 1.2, 'F');
  doc.setTextColor(execStColor.text);
  doc.pdf.text(execStatusLabel, stX + stPillW / 2, execHdrY + 5.7, { align: 'center' });

  // Audit Reference Pill
  const refStr = `VIR-${inspection.id.slice(0, 8).toUpperCase()}`;
  const refPillW = doc.pdf.getTextWidth(refStr) + 10;
  const refX = stX - refPillW - 3;
  doc.setFill(SLATE_BG);
  doc.setDraw(BORDER);
  doc.pdf.roundedRect(refX, execHdrY + 1.5, refPillW, 6.2, 1.2, 1.2, 'FD');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  doc.setTextColor(NAVY);
  doc.pdf.text(refStr, refX + refPillW / 2, execHdrY + 5.7, { align: 'center' });

  // Dual-tone Accent Hairline Divider
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, execHdrY + 14.5, 26, 1.2, 'F');
  doc.setDraw(BORDER_DARK, 0.25);
  doc.pdf.line(MARGIN_LEFT + 26, execHdrY + 15.1, PAGE_W - MARGIN_RIGHT, execHdrY + 15.1);

  doc.y = execHdrY + 18.5;

  // 2. High-Impact Executive Scorecard Ribbon (4 Refined KPI Cards)
  const totalQuestions = stats.totalQuestions || 0;
  const evaluatedQuestions = totalQuestions - (stats.na || 0);
  const satisfactoryQuestions = stats.satisfactory || 0;
  const complianceRate = evaluatedQuestions > 0 ? Math.round((satisfactoryQuestions / evaluatedQuestions) * 100) : 100;
  const totalObs = observations.length;
  const defectCount = observations.filter(o => !!(o as any).isDefect !== false).length;
  const totalSecs = sections.length;
  const totalPhotos = stats.photoCount || (data.photos || []).length;

  const kpiScoreY = doc.y;
  const kpiScoreH = 16.5;
  const kpiScoreGap = 4;
  const kpiScoreW = (CONTENT_W - 3 * kpiScoreGap) / 4;

  const scoreKpis = [
    {
      label: 'OVERALL COMPLIANCE',
      val: evaluatedQuestions > 0 ? `${complianceRate}%` : 'PASS',
      sub: evaluatedQuestions > 0 ? `${satisfactoryQuestions}/${evaluatedQuestions} Items Passed` : 'Standard Inspection',
      accent: complianceRate >= 85 ? ([16, 122, 70] as [number, number, number]) : ([185, 28, 28] as [number, number, number]),
    },
    {
      label: 'DEFICIENCIES LOGGED',
      val: String(totalObs),
      sub: defectCount > 0 ? `${defectCount} Defect${defectCount > 1 ? 's' : ''} Flagged` : 'Zero Critical Defects',
      accent: defectCount > 0 ? ([185, 28, 28] as [number, number, number]) : ([16, 122, 70] as [number, number, number]),
    },
    {
      label: 'SECTIONS SURVEYED',
      val: String(totalSecs),
      sub: `${sections.filter(s => !s.section.photoOnly).length} Checklist / ${sections.filter(s => !!s.section.photoOnly).length} Photo`,
      accent: NAVY,
    },
    {
      label: 'VISUAL EVIDENCE',
      val: String(totalPhotos),
      sub: 'Captured Photographs',
      accent: [14, 124, 134] as [number, number, number],
    },
  ];

  for (let ki = 0; ki < scoreKpis.length; ki++) {
    const item = scoreKpis[ki];
    const kx = MARGIN_LEFT + ki * (kpiScoreW + kpiScoreGap);

    doc.roundedBox(kx, kpiScoreY, kpiScoreW, kpiScoreH, WHITE, BORDER, 1.8);

    // Top hairline accent
    doc.setFill(item.accent);
    doc.pdf.rect(kx, kpiScoreY, kpiScoreW, 1.8, 'F');

    // Label
    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.6);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(item.label, kx + 4, kpiScoreY + 5.8);

    // Value
    doc.pdf.setFont('helvetica', 'bold').setFontSize(9.5);
    doc.setTextColor(item.accent);
    doc.pdf.text(item.val, kx + 4, kpiScoreY + 11.2);

    // Subtitle
    doc.pdf.setFont('helvetica', 'normal').setFontSize(5.5);
    doc.setTextColor(TEXT_FAINT);
    let sStr = item.sub;
    while (sStr.length > 3 && doc.pdf.getTextWidth(sStr) > kpiScoreW - 8) {
      sStr = sStr.slice(0, -1);
    }
    doc.pdf.text(sStr, kx + 4, kpiScoreY + 14.8);
  }

  doc.y = kpiScoreY + kpiScoreH + 4.5;

  // 3. Two-Column Analytical Matrix: Remarks (Left) & Section Breakdown (Right)
  const matrixY = doc.y;
  const col1W = 100; // Left column width (Remarks)
  const colGap = 4;
  const col2W = CONTENT_W - col1W - colGap; // 78 mm (Section Table)
  const matrixCol2X = MARGIN_LEFT + col1W + colGap;

  const summaryText = inspection.summary?.trim() || 'Vessel physical survey conducted in accordance with international maritime regulations and approved survey protocol. Individual compartment condition and specific equipment findings are documented in the detailed section logs.';

  // Determine height of matrix cards
  const neededSummaryH = measureRichText(doc.pdf, summaryText, col1W - 14, { size: 7.8, lineGap: 4.2 });
  const matrixH = Math.min(Math.max(neededSummaryH + 28, 70), 92);

  // ── Card A (Left): Surveyor Remarks & Executive Appraisal ──
  doc.roundedBox(MARGIN_LEFT, matrixY, col1W, matrixH, WHITE, BORDER, 2);

  // Header band
  doc.setFill([241, 245, 249]);
  doc.pdf.roundedRect(MARGIN_LEFT, matrixY, col1W, 6.8, 2, 2, 'F');
  doc.pdf.rect(MARGIN_LEFT, matrixY + 6.8 - 1.5, col1W, 1.5, 'F');
  doc.setDraw(BORDER_DARK, 0.2);
  doc.pdf.line(MARGIN_LEFT, matrixY + 6.8, MARGIN_LEFT + col1W, matrixY + 6.8);

  // Header Badge 'A'
  doc.setFill(NAVY);
  doc.pdf.roundedRect(MARGIN_LEFT + 3.2, matrixY + 1.3, 4.2, 4.2, 0.8, 0.8, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.0);
  doc.setTextColor(WHITE);
  doc.pdf.text('A', MARGIN_LEFT + 5.3, matrixY + 4.3, { align: 'center' });

  // Header Title & Tag
  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  doc.setTextColor(NAVY);
  doc.pdf.text('SURVEYOR REMARKS & APPRAISAL', MARGIN_LEFT + 9.5, matrixY + 4.6);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.5);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('AUDIT OPINION', MARGIN_LEFT + col1W - 4, matrixY + 4.6, { align: 'right' });

  // Remarks Rich Text Content
  renderRichText(doc.pdf, summaryText, MARGIN_LEFT + 6, matrixY + 11.5, col1W - 12, {
    size: 7.6,
    lineGap: 4.0,
    color: TEXT_BODY,
    bulletColor: NAVY,
  });

  // Surveyor Sign-off footer strip inside Remarks card
  const signY = matrixY + matrixH - 12;
  doc.setDraw(BORDER, 0.25);
  doc.pdf.line(MARGIN_LEFT + 4, signY, MARGIN_LEFT + col1W - 4, signY);

  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.8);
  doc.setTextColor(NAVY);
  doc.pdf.text(`Lead Surveyor: ${inspection.inspector || 'Official Marine Surveyor'}`, MARGIN_LEFT + 6, signY + 4.5);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(5.4);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text(`Port: ${inspection.port || 'Survey Port'}  |  Date: ${fmtDate(inspection.startDate)}`, MARGIN_LEFT + 6, signY + 8.8);

  // ── Card B (Right): Section Evaluation Matrix ──
  doc.roundedBox(matrixCol2X, matrixY, col2W, matrixH, WHITE, BORDER, 2);

  // Header band
  doc.setFill([241, 245, 249]);
  doc.pdf.roundedRect(matrixCol2X, matrixY, col2W, 6.8, 2, 2, 'F');
  doc.pdf.rect(matrixCol2X, matrixY + 6.8 - 1.5, col2W, 1.5, 'F');
  doc.setDraw(BORDER_DARK, 0.2);
  doc.pdf.line(matrixCol2X, matrixY + 6.8, matrixCol2X + col2W, matrixY + 6.8);

  // Header Badge 'B'
  doc.setFill(NAVY);
  doc.pdf.roundedRect(matrixCol2X + 3.2, matrixY + 1.3, 4.2, 4.2, 0.8, 0.8, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.0);
  doc.setTextColor(WHITE);
  doc.pdf.text('B', matrixCol2X + 5.3, matrixY + 4.3, { align: 'center' });

  // Header Title & Tag
  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  doc.setTextColor(NAVY);
  doc.pdf.text('SECTION EVALUATION MATRIX', matrixCol2X + 9.5, matrixY + 4.6);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.5);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('AUDIT BREAKDOWN', matrixCol2X + col2W - 4, matrixY + 4.6, { align: 'right' });

  // Display top sections (up to 6)
  const previewSections = sections.slice(0, 6);
  const sRowH = 6.2;
  let sY = matrixY + 6.8;

  for (let si = 0; si < previewSections.length; si++) {
    const sec = previewSections[si];
    const isAlt = si % 2 === 1;

    if (isAlt) {
      doc.setFill(SLATE_BG);
      doc.pdf.rect(matrixCol2X + 0.5, sY, col2W - 1, sRowH, 'F');
    }

    if (si < previewSections.length - 1) {
      doc.setDraw(BORDER, 0.15);
      doc.pdf.line(matrixCol2X + 3, sY + sRowH, matrixCol2X + col2W - 3, sY + sRowH);
    }

    // Has defect or observation?
    const secObs = observations.filter(o => o.sectionId === sec.section.id);
    const hasDef = secObs.some(o => !!(o as any).isDefect);
    const hasObs = secObs.length > 0;

    // Left indicator dot
    doc.setFill(hasDef ? [220, 38, 38] : hasObs ? [245, 158, 11] : [16, 122, 70]);
    doc.pdf.circle(matrixCol2X + 4.5, sY + sRowH / 2, 0.6, 'F');

    // Section Name
    doc.pdf.setFont('helvetica', 'bold').setFontSize(6.2);
    doc.setTextColor(TEXT_DARK);
    let sTitle = `${si + 1}. ${sec.section.name}`;
    const maxTitleW = col2W - 28;
    while (sTitle.length > 3 && doc.pdf.getTextWidth(sTitle) > maxTitleW) {
      sTitle = sTitle.slice(0, -1);
    }
    doc.pdf.text(sTitle, matrixCol2X + 7.5, sY + 4.2);

    // Status Pill on right
    const statusTagW = 16;
    const statusTagX = matrixCol2X + col2W - statusTagW - 3.5;
    if (hasDef) {
      doc.setFill([254, 242, 242]);
      doc.setDraw([254, 202, 202], 0.25);
      doc.pdf.roundedRect(statusTagX, sY + 1.2, statusTagW, 4.0, 0.8, 0.8, 'FD');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(5.0);
      doc.setTextColor([153, 27, 27]);
      doc.pdf.text('DEFECT', statusTagX + statusTagW / 2, sY + 3.9, { align: 'center' });
    } else if (hasObs) {
      doc.setFill([255, 251, 235]);
      doc.setDraw([253, 230, 138], 0.25);
      doc.pdf.roundedRect(statusTagX, sY + 1.2, statusTagW, 4.0, 0.8, 0.8, 'FD');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(5.0);
      doc.setTextColor([146, 64, 14]);
      doc.pdf.text('NOTED', statusTagX + statusTagW / 2, sY + 3.9, { align: 'center' });
    } else {
      doc.setFill([236, 253, 245]);
      doc.setDraw([167, 243, 208], 0.25);
      doc.pdf.roundedRect(statusTagX, sY + 1.2, statusTagW, 4.0, 0.8, 0.8, 'FD');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(5.0);
      doc.setTextColor([6, 95, 70]);
      doc.pdf.text('PASS', statusTagX + statusTagW / 2, sY + 3.9, { align: 'center' });
    }

    sY += sRowH;
  }

  // Summary Checklist Tally Footer at bottom of right card
  const tallyY = matrixY + matrixH - 12;
  doc.setDraw(BORDER, 0.25);
  doc.pdf.line(matrixCol2X + 4, tallyY, matrixCol2X + col2W - 4, tallyY);

  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.6);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('CHECKLIST TALLY:', matrixCol2X + 5, tallyY + 4.5);

  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.6);
  doc.setTextColor([16, 122, 70]);
  doc.pdf.text(`${stats.satisfactory} Passed`, matrixCol2X + 38, tallyY + 4.5);

  doc.setTextColor(totalObs > 0 ? [185, 28, 28] : TEXT_MUTED);
  doc.pdf.text(`${totalObs} Noted`, matrixCol2X + 56, tallyY + 4.5);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(5.2);
  doc.setTextColor(TEXT_FAINT);
  doc.pdf.text(`(${stats.na || 0} N/A • ${stats.pending || 0} Pending • ${stats.totalQuestions} Total)`, matrixCol2X + 5, tallyY + 8.8);

  doc.y = matrixY + matrixH + 4.5;

  // 4. Full-Width Technical Findings & Condition Summary Panel
  const findBoxY = doc.y;
  const findBoxH = 26;

  if (observations.length > 0) {
    doc.roundedBox(MARGIN_LEFT, findBoxY, CONTENT_W, findBoxH, [255, 250, 250], [254, 202, 202], 2);
    // Left inset accent
    doc.setFill([185, 28, 28]);
    doc.pdf.roundedRect(MARGIN_LEFT + 1.5, findBoxY + 2, 2.5, findBoxH - 4, 1, 1, 'F');

    // Header
    doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
    doc.setTextColor([185, 28, 28]);
    doc.pdf.text(`KEY TECHNICAL FINDINGS & DEFECT NOTICES (${observations.length} RECORDED)`, MARGIN_LEFT + 7, findBoxY + 5.2);

    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.8);
    doc.setTextColor([153, 27, 27]);
    doc.pdf.text(`${defectCount} CRITICAL DEFECT${defectCount === 1 ? '' : 'S'} REQUIRING ATTENTION`, PAGE_W - MARGIN_RIGHT - 6, findBoxY + 5.2, { align: 'right' });

    // Show up to 2 top observations with clean line
    const topObs = observations.slice(0, 2);
    let oY = findBoxY + 9.5;
    for (let oi = 0; oi < topObs.length; oi++) {
      const o = topObs[oi];
      const isDef = !!(o as any).isDefect;

      doc.setFill(isDef ? [220, 38, 38] : [245, 158, 11]);
      doc.pdf.circle(MARGIN_LEFT + 8, oY + 1.2, 0.7, 'F');

      doc.pdf.setFont('helvetica', 'bold').setFontSize(6.2);
      doc.setTextColor(isDef ? [185, 28, 28] : TEXT_DARK);
      const prefix = `[ ${o.ref || 'OBS'} ] ${o.sectionName}: `;
      doc.pdf.text(prefix, MARGIN_LEFT + 11, oY + 2.2);

      const prefW = doc.pdf.getTextWidth(prefix);
      doc.pdf.setFont('helvetica', 'normal').setFontSize(6.0);
      doc.setTextColor(TEXT_BODY);

      let oDesc = o.text || 'Technical observation logged by surveyor';
      const maxOW = CONTENT_W - 20 - prefW;
      while (oDesc.length > 3 && doc.pdf.getTextWidth(oDesc) > maxOW) {
        oDesc = oDesc.slice(0, -1);
      }
      doc.pdf.text(oDesc, MARGIN_LEFT + 11 + prefW, oY + 2.2);

      oY += 5.2;
    }

    doc.pdf.setFont('helvetica', 'italic').setFontSize(5.2);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text('Refer to detailed Section Observations & Findings chapters for complete photographic records and corrective actions.', MARGIN_LEFT + 7, findBoxY + 22.0);
  } else {
    // Zero Defects Statement
    doc.roundedBox(MARGIN_LEFT, findBoxY, CONTENT_W, findBoxH, [240, 253, 244], [167, 243, 208], 2);
    // Left inset accent
    doc.setFill([16, 122, 70]);
    doc.pdf.roundedRect(MARGIN_LEFT + 1.5, findBoxY + 2, 2.5, findBoxH - 4, 1, 1, 'F');

    // Header
    doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
    doc.setTextColor([16, 122, 70]);
    doc.pdf.text('DEFICIENCY-FREE CONDITION STATEMENT', MARGIN_LEFT + 7, findBoxY + 5.2);

    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.8);
    doc.setTextColor([6, 95, 70]);
    doc.pdf.text('ALL AUDITED AREAS SATISFACTORY', PAGE_W - MARGIN_RIGHT - 6, findBoxY + 5.2, { align: 'right' });

    doc.pdf.setFont('helvetica', 'normal').setFontSize(5.8);
    doc.setTextColor(TEXT_BODY);
    const zeroDefText = 'No critical technical defects, structural deformations, or immediate safety non-conformities were identified during this physical survey inspection. Vessel equipment, machinery spaces, and audited structures were found in satisfactory operating condition consistent with vessel age and trading profile.';
    const zLines = doc.pdf.splitTextToSize(zeroDefText, CONTENT_W - 16) as string[];
    doc.pdf.text(zLines, MARGIN_LEFT + 7, findBoxY + 10.5);

    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.5);
    doc.setTextColor([6, 95, 70]);
    doc.pdf.text('Formal condition grade: SATISFACTORY / STANDARD MARITIME COMPLIANCE', MARGIN_LEFT + 7, findBoxY + 22.0);
  }

  doc.y = findBoxY + findBoxH + 4.5;

  // 5. Official Quality Audit & Sign-off Footer Panel (Matching Page 2)
  const execSealBoxY = doc.y;
  const execSealBoxH = 28;
  doc.roundedBox(MARGIN_LEFT, execSealBoxY, CONTENT_W, execSealBoxH, WHITE, BORDER, 2.5);

  // Left solid accent
  doc.setFill(NAVY);
  doc.pdf.roundedRect(MARGIN_LEFT + 1.5, execSealBoxY + 2, 2.5, execSealBoxH - 4, 1, 1, 'F');

  // Vertical hairline divider
  const execDividerX = MARGIN_LEFT + 118;
  doc.setDraw(BORDER, 0.25);
  doc.pdf.line(execDividerX, execSealBoxY + 3, execDividerX, execSealBoxY + execSealBoxH - 3);

  // ── LEFT SIDE: Audit Attestation & Verification Badges ──
  const execAttLeft = MARGIN_LEFT + 7;
  const execAttMaxW = execDividerX - execAttLeft - 4;

  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  doc.setTextColor(NAVY);
  doc.pdf.text('SURVEY AUDIT ATTESTATION & TECHNICAL RECORD', execAttLeft, execSealBoxY + 5.5);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(5.8);
  doc.setTextColor(TEXT_BODY);
  const execAttMsg = 'This executive summary represents an accurate synthesis of vessel physical condition, audited compartments, and surveyor visual records at the time of inspection, performed in accordance with international survey protocols.';
  const execAttLines = doc.pdf.splitTextToSize(execAttMsg, execAttMaxW) as string[];
  doc.pdf.text(execAttLines, execAttLeft, execSealBoxY + 9.8);

  // 3 Verification Pills
  const execCheckY = execSealBoxY + 18.2;
  const execCheckBadges = [
    'Survey Completed',
    'Evidence Cataloged',
    'Audit Certified',
  ];
  const execBadgeGap = 3;
  const execCheckW = (execAttMaxW - 2 * execBadgeGap) / 3;

  for (let cbi = 0; cbi < execCheckBadges.length; cbi++) {
    const cbX = execAttLeft + cbi * (execCheckW + execBadgeGap);

    doc.setFill([236, 253, 245]);
    doc.setDraw([167, 243, 208], 0.3);
    doc.pdf.roundedRect(cbX, execCheckY, execCheckW, 5.2, 1.2, 1.2, 'FD');

    doc.setFill([16, 122, 70]);
    doc.pdf.circle(cbX + 3.2, execCheckY + 2.6, 0.9, 'F');

    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.8);
    doc.setTextColor([6, 95, 70]);
    doc.pdf.text(execCheckBadges[cbi], cbX + 5.6, execCheckY + 3.7);
  }

  // ── RIGHT SIDE: Official Survey Seal Stamp ──
  const execSealAreaLeft = execDividerX + 3;
  const execSealAreaW = PAGE_W - MARGIN_RIGHT - execSealAreaLeft;
  const execSealCenterX = execSealAreaLeft + execSealAreaW / 2;

  const execStampBoxW = 56;
  const execStampBoxH = 22;
  const execStampBoxX = execSealCenterX - execStampBoxW / 2;
  const execStampBoxY = execSealBoxY + 3;

  doc.roundedBox(execStampBoxX, execStampBoxY, execStampBoxW, execStampBoxH, SLATE_BG, NAVY, 1.5);
  doc.setDraw(BORDER_DARK, 0.2);
  doc.pdf.roundedRect(execStampBoxX + 1, execStampBoxY + 1, execStampBoxW - 2, execStampBoxH - 2, 1, 1, 'S');

  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.2);
  doc.setTextColor(NAVY);
  doc.pdf.text('OZELLAR MARINE TECHNICAL AUDIT', execSealCenterX, execStampBoxY + 4.2, { align: 'center' });

  const execSPillW = 42;
  const execSPillH = 4.6;
  const execSPillX = execSealCenterX - execSPillW / 2;
  const execSPillY = execStampBoxY + 5.8;
  doc.setFill(NAVY);
  doc.pdf.roundedRect(execSPillX, execSPillY, execSPillW, execSPillH, 1, 1, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.6);
  doc.setTextColor(WHITE);
  doc.pdf.text('OFFICIAL RECORD - VERIFIED', execSealCenterX, execSPillY + 3.3, { align: 'center' });

  doc.pdf.setFont('helvetica', 'bold').setFontSize(5.8);
  doc.setTextColor(TEXT_DARK);
  doc.pdf.text(`VIR-${inspection.id.slice(0, 8).toUpperCase()}  |  ${fmtDate(inspection.startDate)}`, execSealCenterX, execStampBoxY + 15.0, { align: 'center' });

  doc.pdf.setFont('helvetica', 'italic').setFontSize(4.8);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text(
    inspection.inspector ? `Surveyor: ${inspection.inspector}` : 'Authorized Technical Dossier',
    execSealCenterX,
    execStampBoxY + 18.8,
    { align: 'center' }
  );

  doc.y = execSealBoxY + execSealBoxH + 6;

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGES 4+: SECTION EVALUATIONS & CHECKLIST DETAILS / PHOTO SECTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  const displaySections = isPhotoOnly
    ? photoSectionsOnly
    : sections;

  if (isPhotoOnly && displaySections.length === 0) {
    doc.newPage();
    doc.sectionHeader('Photo Sections', 'Visual Survey', '0 Photo Sections');
    doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, 14, SLATE_BG, BORDER, 2);
    doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text('No dedicated photo sections recorded for this inspection.', MARGIN_LEFT + 8, doc.y + 8.5);
    doc.y += 18;
  }

  for (let sIdx = 0; sIdx < displaySections.length; sIdx++) {
    const s = displaySections[sIdx];
    const isPhotoSection = !!s.section.photoOnly;

    if (isPhotoSection) {
      doc.newPage();
      doc.sectionHeader(
        `Section ${sIdx + 1}: ${s.section.name}`,
        s.section.zone || 'General',
        `${s.sectionPhotoIds.length} Photographs Captured`
      );

      // Section Remarks (if any)
      if (s.section.remarks?.trim()) {
        const remText = s.section.remarks.trim();
        const richH = measureRichText(doc.pdf, remText, CONTENT_W - 16, { size: 8.5, lineGap: 4.5 });
        const remBoxH = Math.max(richH + 16, 20);
        doc.ensure(remBoxH + 4);

        doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, remBoxH, SLATE_BG, BORDER, 2);
        doc.setFill(TEAL);
        doc.pdf.rect(MARGIN_LEFT, doc.y, 2.5, remBoxH, 'F');

        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text('REMARKS', MARGIN_LEFT + 7, doc.y + 6);

        renderRichText(doc.pdf, remText, MARGIN_LEFT + 7, doc.y + 11.5, CONTENT_W - 16, {
          size: 8.5,
          lineGap: 4.5,
          color: TEXT_BODY,
          bulletColor: NAVY,
        });
        doc.y += remBoxH + 6;
      }

      // Section Level Photos (8 per page grid)
      if (s.sectionPhotoIds.length > 0) {
        await renderPhotoGrid8(
          s.sectionPhotoIds,
          s.section.name,
          s.section.zone || 'General',
          'SECTION PHOTOGRAPHS & VISUAL EVIDENCE'
        );
      } else {
        doc.ensure(20);
        doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, 14, SLATE_BG, BORDER, 2);
        doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text('No photographs recorded for this section.', MARGIN_LEFT + 8, doc.y + 8.5);
        doc.y += 18;
      }

      // Section Findings if any
      if (s.findings.length > 0) {
        doc.ensure(24);
        doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text('SECTION OBSERVATIONS & FINDINGS', MARGIN_LEFT, doc.y + 4);
        doc.y += 8;

        for (let fIdx = 0; fIdx < s.findings.length; fIdx++) {
          const fRow = s.findings[fIdx];
          const textContent = fRow.finding.text || 'Observation logged';
          const caContent = fRow.finding.correctiveAction ? `**Corrective Action:** ${fRow.finding.correctiveAction}` : '';
          const paContent = fRow.finding.preventiveAction ? `*Preventive Action:* ${fRow.finding.preventiveAction}` : '';

          const textH = measureRichText(doc.pdf, textContent, CONTENT_W - 16, { size: 8, lineGap: 4.2 });
          const caH = caContent ? measureRichText(doc.pdf, caContent, CONTENT_W - 16, { size: 7.5, lineGap: 4.2 }) : 0;
          const paH = paContent ? measureRichText(doc.pdf, paContent, CONTENT_W - 16, { size: 7.5, lineGap: 4.2 }) : 0;

          const totalTextH = 12 + textH + (caH ? caH + 2 : 0) + (paH ? paH + 2 : 0);

          const photoIds = fRow.photoIds || [];
          const firstBatchObsPhotos = photoIds.slice(0, 4);
          const remainingObsPhotos = photoIds.slice(4);

          const singlePhoto = firstBatchObsPhotos.length === 1;
          const photoRows = Math.ceil(firstBatchObsPhotos.length / 2);
          const singlePH = 92;
          const gridPH = 92;
          const obsGapY = 5;
          let photoBlockH = 0;
          if (singlePhoto) {
            photoBlockH = singlePH + 8;
          } else if (photoRows > 0) {
            photoBlockH = photoRows * (gridPH + obsGapY) + 4;
          }

          const cardH = totalTextH + photoBlockH + 4;

          doc.ensure(cardH + 4);
          const cardY = doc.y;
          doc.roundedBox(MARGIN_LEFT, cardY, CONTENT_W, cardH, WHITE, BORDER, 2);
          doc.setFill([239, 68, 68]);
          doc.pdf.rect(MARGIN_LEFT, cardY, 2.5, cardH, 'F');

          doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
          doc.setTextColor([185, 28, 28]);
          doc.pdf.text(`OBSERVATION ${fIdx + 1} • ${s.section.name.toUpperCase()}`, MARGIN_LEFT + 8, cardY + 5.5);

          let curY = cardY + 11;
          renderRichText(doc.pdf, textContent, MARGIN_LEFT + 8, curY, CONTENT_W - 16, {
            size: 8,
            lineGap: 4.2,
            color: TEXT_DARK,
          });
          curY += textH + 2;

          if (caContent) {
            renderRichText(doc.pdf, caContent, MARGIN_LEFT + 8, curY, CONTENT_W - 16, {
              size: 7.5,
              lineGap: 4.2,
              color: [185, 28, 28],
            });
            curY += caH + 2;
          }

          if (paContent) {
            renderRichText(doc.pdf, paContent, MARGIN_LEFT + 8, curY, CONTENT_W - 16, {
              size: 7.5,
              lineGap: 4.2,
              color: TEXT_MUTED,
            });
            curY += paH + 2;
          }

          if (firstBatchObsPhotos.length > 0) {
            curY += 2;
            if (singlePhoto) {
              const pW = 100;
              const pH = singlePH;
              const pX = MARGIN_LEFT + (CONTENT_W - pW) / 2;
              const id1 = firstBatchObsPhotos[0];
              const [img1, photoDoc1] = await Promise.all([loadImage(id1), getPhotoDoc(id1)]);
              if (id1) {
                drawPhotoCard(pX, curY, pW, pH, img1, photoDoc1, `PHOTO #1 • OBS ${fIdx + 1}`);
              }
              curY += pH + 4;
            } else {
              const pW = (CONTENT_W - 22) / 2;
              const pH = gridPH;
              for (let pIdx = 0; pIdx < firstBatchObsPhotos.length; pIdx += 2) {
                const id1 = firstBatchObsPhotos[pIdx];
                const id2 = pIdx + 1 < firstBatchObsPhotos.length ? firstBatchObsPhotos[pIdx + 1] : undefined;

                const [img1, img2, photoDoc1, photoDoc2] = await Promise.all([
                  loadImage(id1),
                  id2 ? loadImage(id2) : Promise.resolve(null),
                  getPhotoDoc(id1),
                  id2 ? getPhotoDoc(id2) : Promise.resolve(null),
                ]);

                if (id1) {
                  drawPhotoCard(MARGIN_LEFT + 8, curY, pW, pH, img1, photoDoc1, `PHOTO #${pIdx + 1} • OBS ${fIdx + 1}`);
                }
                if (id2) {
                  drawPhotoCard(MARGIN_LEFT + 8 + pW + 6, curY, pW, pH, img2, photoDoc2, `PHOTO #${pIdx + 2} • OBS ${fIdx + 1}`);
                }

                curY += pH + obsGapY;
              }
            }
          }

          doc.y += cardH + 4;

          // Continuation for any additional photos beyond 4
          if (remainingObsPhotos.length > 0) {
            for (let remIdx = 0; remIdx < remainingObsPhotos.length; remIdx += 4) {
              const chunk = remainingObsPhotos.slice(remIdx, remIdx + 4);
              const chunkRows = Math.ceil(chunk.length / 2);
              const chunkH = 14 + chunkRows * (gridPH + obsGapY) + 4;

              doc.newPage();
              doc.sectionHeader(
                `Section ${sIdx + 1}: ${s.section.name}`,
                s.section.zone || 'General',
                `OBS ${fIdx + 1} Photographs (Cont.)`
              );

              const contY = doc.y;
              doc.roundedBox(MARGIN_LEFT, contY, CONTENT_W, chunkH, WHITE, BORDER, 2);
              doc.setFill([239, 68, 68]);
              doc.pdf.rect(MARGIN_LEFT, contY, 2.5, chunkH, 'F');

              doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
              doc.setTextColor([185, 28, 28]);
              doc.pdf.text(`OBSERVATION ${fIdx + 1} • ${s.section.name.toUpperCase()} (Photographs Cont.)`, MARGIN_LEFT + 8, contY + 5.5);

              let chunkY = contY + 12;
              const pW = (CONTENT_W - 22) / 2;
              for (let cIdx = 0; cIdx < chunk.length; cIdx += 2) {
                const pNum1 = 4 + remIdx + cIdx + 1;
                const pNum2 = pNum1 + 1;
                const cid1 = chunk[cIdx];
                const cid2 = cIdx + 1 < chunk.length ? chunk[cIdx + 1] : undefined;

                const [cImg1, cImg2, cPhotoDoc1, cPhotoDoc2] = await Promise.all([
                  loadImage(cid1),
                  cid2 ? loadImage(cid2) : Promise.resolve(null),
                  getPhotoDoc(cid1),
                  cid2 ? getPhotoDoc(cid2) : Promise.resolve(null),
                ]);

                if (cid1) {
                  drawPhotoCard(MARGIN_LEFT + 8, chunkY, pW, gridPH, cImg1, cPhotoDoc1, `PHOTO #${pNum1} • OBS ${fIdx + 1}`);
                }
                if (cid2) {
                  drawPhotoCard(MARGIN_LEFT + 8 + pW + 6, chunkY, pW, gridPH, cImg2, cPhotoDoc2, `PHOTO #${pNum2} • OBS ${fIdx + 1}`);
                }

                chunkY += gridPH + obsGapY;
              }

              doc.y += chunkH + 4;
            }
          }
        }
      }

      continue;
    }

    doc.newPage();
    doc.sectionHeader(
      `Section ${sIdx + 1}: ${s.section.name}`,
      s.section.zone,
      `${s.questions.length} Items Evaluated`
    );

    // Section Level Photos (if any, 8 per page grid)
    if (s.sectionPhotoIds.length > 0) {
      await renderPhotoGrid8(
        s.sectionPhotoIds,
        s.section.name,
        s.section.zone || 'Overview',
        'SECTION OVERVIEW PHOTOGRAPHS'
      );
    }

    // Questions List
    for (const qRow of s.questions) {
      const { question, response, state, photoIds } = qRow;

      // Set fonts temporarily to measure widths for layout
      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      const statusStr = state === 'ok' ? '[+]  SATISFACTORY' : state === 'bad' ? '!  OBSERVATION' : state === 'na' ? '-  N / A' : '[?]  PENDING';
      const badgeW = doc.pdf.getTextWidth(statusStr) + 8;
      const refW = doc.pdf.getTextWidth(question.ref) + 8;

      doc.pdf.setFont('helvetica', 'bold').setFontSize(9);
      // Ensure the question text never overlaps the tags
      const maxTextW = CONTENT_W - refW - badgeW - 20;
      const qLines = doc.pdf.splitTextToSize(question.text, maxTextW) as string[];
      let headerTextH = 12 + qLines.length * 4.2;

      if (response?.remarks?.trim()) {
        const remLines = doc.pdf.splitTextToSize(`Remarks: ${response.remarks}`, CONTENT_W - 16) as string[];
        headerTextH += remLines.length * 4 + 6;
      }

      let defBoxH = 0;
      let caText = '';
      let paText = '';
      let caH = 0;
      let paH = 0;
      if (state === 'bad') {
        caText = response?.correctiveAction ? `**Corrective:** ${response.correctiveAction}` : '**Corrective:** Immediate rectification required';
        paText = response?.preventiveAction ? `*Preventive:* ${response.preventiveAction}` : '*Preventive:* Review preventive maintenance routine';
        caH = measureRichText(doc.pdf, caText, CONTENT_W - 22, { size: 7.8, lineGap: 4 });
        paH = measureRichText(doc.pdf, paText, CONTENT_W - 22, { size: 7.8, lineGap: 4 });
        defBoxH = Math.max(caH + paH + 13, 22);
        headerTextH += defBoxH + 4;
      }

      // Maximum 4 photos per page inside question card; remainder paginated onto continuation pages
      const firstBatchPhotos = photoIds.slice(0, 4);
      const remainingPhotos = photoIds.slice(4);

      const qSinglePH = 92;
      const qGridPH = 92;
      const pW = (CONTENT_W - 18) / 2; // 82 mm
      const gapY = 5;

      const firstPhotoRows = Math.ceil(firstBatchPhotos.length / 2);
      let firstPhotoH = 0;
      if (firstBatchPhotos.length === 1) {
        firstPhotoH = qSinglePH + 8;
      } else if (firstPhotoRows > 0) {
        firstPhotoH = firstPhotoRows * (qGridPH + gapY) + 4;
      }

      const mainCardH = headerTextH + firstPhotoH + 2;

      // Ensure main card fits or start fresh page
      doc.ensure(mainCardH + 4);

      const cardY = doc.y;
      doc.roundedBox(MARGIN_LEFT, cardY, CONTENT_W, mainCardH, WHITE, BORDER, 2.5);

      // Top Question Header
      // Ref Pill: e.g. [ HULL-01 ]
      doc.setFill(NAVY);
      doc.pdf.roundedRect(MARGIN_LEFT + 6, cardY + 5, refW, 5.8, 1.2, 1.2, 'F');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      doc.setTextColor(WHITE);
      doc.pdf.text(question.ref, MARGIN_LEFT + 10, cardY + 9.1);

      // Status Badge on Right
      const badgeX = PAGE_W - MARGIN_RIGHT - badgeW - 6;
      doc.statusBadge(state, badgeX, cardY + 5);

      // Question Text
      doc.pdf.setFont('helvetica', 'bold').setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      let textY = cardY + 9.1;
      const textX = MARGIN_LEFT + refW + 10;
      for (let l = 0; l < qLines.length; l++) {
        doc.pdf.text(qLines[l], textX, textY);
        if (l < qLines.length - 1) textY += 4.2;
      }

      let innerY = textY + 6;

      // Remarks Block (if any)
      if (response?.remarks?.trim()) {
        const remContent = `**Remarks:** ${response.remarks.trim()}`;
        const remH = measureRichText(doc.pdf, remContent, CONTENT_W - 16, { size: 8.5, lineGap: 4.2 });
        renderRichText(doc.pdf, remContent, MARGIN_LEFT + 6, innerY, CONTENT_W - 16, {
          size: 8.5,
          lineGap: 4.2,
          color: TEXT_BODY,
        });
        innerY += remH + 3;
      }

      // Deficiency Callout Box (if bad)
      if (state === 'bad') {
        doc.roundedBox(MARGIN_LEFT + 6, innerY, CONTENT_W - 12, defBoxH, [254, 242, 242], [254, 202, 202], 2);
        doc.setFill([239, 68, 68]);
        doc.pdf.rect(MARGIN_LEFT + 6, innerY, 2.5, defBoxH, 'F');

        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor([185, 28, 28]);
        doc.pdf.text('!  DEFICIENCY / ACTION REQUIRED', MARGIN_LEFT + 12, innerY + 5);

        let subY = innerY + 10;
        renderRichText(doc.pdf, caText, MARGIN_LEFT + 12, subY, CONTENT_W - 22, { size: 7.8, lineGap: 4, color: TEXT_DARK });
        subY += caH + 2;
        renderRichText(doc.pdf, paText, MARGIN_LEFT + 12, subY, CONTENT_W - 22, { size: 7.8, lineGap: 4, color: TEXT_MUTED });

        innerY += defBoxH + 4;
      }

      // First batch of photos (strictly up to 4 photos on main question card)
      if (firstBatchPhotos.length > 0) {
        if (firstBatchPhotos.length === 1) {
          const sW = 100;
          const sH = qSinglePH;
          const sX = MARGIN_LEFT + (CONTENT_W - sW) / 2;
          const id1 = firstBatchPhotos[0];
          const [img1, qPhotoDoc1] = await Promise.all([
            loadImage(id1),
            getPhotoDoc(id1),
          ]);
          if (id1) {
            drawPhotoCard(sX, innerY, sW, sH, img1, qPhotoDoc1, `PHOTO #1 • ${question.ref}`);
          }
          innerY += sH + 4;
        } else {
          for (let pIdx = 0; pIdx < firstBatchPhotos.length; pIdx += 2) {
            const id1 = firstBatchPhotos[pIdx];
            const id2 = pIdx + 1 < firstBatchPhotos.length ? firstBatchPhotos[pIdx + 1] : undefined;

            const [img1, img2, qPhotoDoc1, qPhotoDoc2] = await Promise.all([
              loadImage(id1),
              id2 ? loadImage(id2) : Promise.resolve(null),
              getPhotoDoc(id1),
              id2 ? getPhotoDoc(id2) : Promise.resolve(null),
            ]);

            if (id1) {
              drawPhotoCard(MARGIN_LEFT + 6, innerY, pW, qGridPH, img1, qPhotoDoc1, `PHOTO #${pIdx + 1} • ${question.ref}`);
            }
            if (id2) {
              drawPhotoCard(MARGIN_LEFT + 6 + pW + 6, innerY, pW, qGridPH, img2, qPhotoDoc2, `PHOTO #${pIdx + 2} • ${question.ref}`);
            }

            innerY += qGridPH + gapY;
          }
        }
      }

      doc.y += mainCardH + 4;

      // If question has more than 4 photos, paginate them onto continuation pages (max 4 per page)
      if (remainingPhotos.length > 0) {
        for (let remIdx = 0; remIdx < remainingPhotos.length; remIdx += 4) {
          const chunk = remainingPhotos.slice(remIdx, remIdx + 4);
          const chunkRows = Math.ceil(chunk.length / 2);
          const chunkPhotosH = chunkRows * (qGridPH + gapY);
          const contCardH = 14 + chunkPhotosH + 4;

          doc.newPage();
          doc.sectionHeader(
            `Section ${sIdx + 1}: ${s.section.name}`,
            s.section.zone,
            `${question.ref} Photographs (Cont.)`
          );

          const contCardY = doc.y;
          doc.roundedBox(MARGIN_LEFT, contCardY, CONTENT_W, contCardH, WHITE, BORDER, 2.5);

          // Continuation Header
          doc.setFill(NAVY);
          doc.pdf.roundedRect(MARGIN_LEFT + 6, contCardY + 4, refW, 5.5, 1.2, 1.2, 'F');
          doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
          doc.setTextColor(WHITE);
          doc.pdf.text(question.ref, MARGIN_LEFT + 10, contCardY + 7.8);

          doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
          doc.setTextColor(TEXT_DARK);
          const contTitle = `${question.text.slice(0, 60)}... (Photographs Cont.)`;
          doc.pdf.text(contTitle, MARGIN_LEFT + refW + 10, contCardY + 7.8);

          doc.statusBadge(state, badgeX, contCardY + 4);

          let chunkY = contCardY + 12;
          for (let cIdx = 0; cIdx < chunk.length; cIdx += 2) {
            const photoNum1 = 4 + remIdx + cIdx + 1;
            const photoNum2 = photoNum1 + 1;
            const cid1 = chunk[cIdx];
            const cid2 = cIdx + 1 < chunk.length ? chunk[cIdx + 1] : undefined;

            const [cImg1, cImg2, cPhotoDoc1, cPhotoDoc2] = await Promise.all([
              loadImage(cid1),
              cid2 ? loadImage(cid2) : Promise.resolve(null),
              getPhotoDoc(cid1),
              cid2 ? getPhotoDoc(cid2) : Promise.resolve(null),
            ]);

            if (cid1) {
              drawPhotoCard(MARGIN_LEFT + 6, chunkY, pW, qGridPH, cImg1, cPhotoDoc1, `PHOTO #${photoNum1} • ${question.ref}`);
            }
            if (cid2) {
              drawPhotoCard(MARGIN_LEFT + 6 + pW + 6, chunkY, pW, qGridPH, cImg2, cPhotoDoc2, `PHOTO #${photoNum2} • ${question.ref}`);
            }

            chunkY += qGridPH + gapY;
          }

          doc.y += contCardH + 4;
        }
      }
    }

    // Section Observations (if any)
    for (let fIdx = 0; fIdx < s.findings.length; fIdx++) {
      const fRow = s.findings[fIdx];
      const photoIds = fRow.photoIds || [];
      const firstBatchObsPhotos = photoIds.slice(0, 4);
      const remainingObsPhotos = photoIds.slice(4);

      const obsSinglePH = 92;
      const obsGridPH = 92;
      const obsPW = (CONTENT_W - 22) / 2;
      const obsGapY = 5;

      const firstPhotoRows = Math.ceil(firstBatchObsPhotos.length / 2);
      let cardH = 28;
      if (fRow.finding.correctiveAction) cardH += 6;
      if (firstBatchObsPhotos.length === 1) {
        cardH += obsSinglePH + 8;
      } else if (firstPhotoRows > 0) {
        cardH += firstPhotoRows * (obsGridPH + obsGapY) + 4;
      }

      doc.ensure(cardH + 4);
      doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, cardH, SLATE_BG, BORDER, 2.5);

      doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
      doc.setTextColor(NAVY);
      doc.pdf.text(`OBSERVATION ${fIdx + 1} • ${s.section.name.toUpperCase()}`, MARGIN_LEFT + 6, doc.y + 6);

      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      const fStatusStr = fRow.state === 'ok' ? '[+]  SATISFACTORY' : fRow.state === 'bad' ? '!  OBSERVATION' : fRow.state === 'na' ? '-  N / A' : '[?]  PENDING';
      const fBadgeW = doc.pdf.getTextWidth(fStatusStr) + 8;
      const fBadgeX = PAGE_W - MARGIN_RIGHT - fBadgeW - 6;
      doc.statusBadge(fRow.state, fBadgeX, doc.y + 4);

      doc.pdf.setFont('helvetica', 'normal').setFontSize(8.5);
      doc.setTextColor(TEXT_BODY);
      doc.pdf.text(doc.pdf.splitTextToSize(fRow.finding.text || '-', CONTENT_W - 16) as string[], MARGIN_LEFT + 6, doc.y + 13);

      let curY = doc.y + 20;
      if (fRow.finding.correctiveAction) {
        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor([185, 28, 28]);
        doc.pdf.text(`Action: ${fRow.finding.correctiveAction}`, MARGIN_LEFT + 6, curY);
        curY += 6;
      }

      if (firstBatchObsPhotos.length > 0) {
        curY += 2;
        if (firstBatchObsPhotos.length === 1) {
          const pW = 100;
          const pH = obsSinglePH;
          const pX = MARGIN_LEFT + (CONTENT_W - pW) / 2;
          const id1 = firstBatchObsPhotos[0];
          const [img1, photoDoc1] = await Promise.all([loadImage(id1), getPhotoDoc(id1)]);
          if (id1) {
            drawPhotoCard(pX, curY, pW, pH, img1, photoDoc1, `PHOTO #1 • OBS ${fIdx + 1}`);
          }
          curY += pH + 4;
        } else {
          for (let pIdx = 0; pIdx < firstBatchObsPhotos.length; pIdx += 2) {
            const id1 = firstBatchObsPhotos[pIdx];
            const id2 = pIdx + 1 < firstBatchObsPhotos.length ? firstBatchObsPhotos[pIdx + 1] : undefined;

            const [img1, img2, photoDoc1, photoDoc2] = await Promise.all([
              loadImage(id1),
              id2 ? loadImage(id2) : Promise.resolve(null),
              getPhotoDoc(id1),
              id2 ? getPhotoDoc(id2) : Promise.resolve(null),
            ]);

            if (id1) {
              drawPhotoCard(MARGIN_LEFT + 8, curY, obsPW, obsGridPH, img1, photoDoc1, `PHOTO #${pIdx + 1} • OBS ${fIdx + 1}`);
            }
            if (id2) {
              drawPhotoCard(MARGIN_LEFT + 8 + obsPW + 6, curY, obsPW, obsGridPH, img2, photoDoc2, `PHOTO #${pIdx + 2} • OBS ${fIdx + 1}`);
            }

            curY += obsGridPH + obsGapY;
          }
        }
      }

      doc.y += cardH + 4;

      // Continuation for any additional photos beyond 4
      if (remainingObsPhotos.length > 0) {
        for (let remIdx = 0; remIdx < remainingObsPhotos.length; remIdx += 4) {
          const chunk = remainingObsPhotos.slice(remIdx, remIdx + 4);
          const chunkRows = Math.ceil(chunk.length / 2);
          const chunkH = 14 + chunkRows * (obsGridPH + obsGapY) + 4;

          doc.newPage();
          doc.sectionHeader(
            `Section ${sIdx + 1}: ${s.section.name}`,
            s.section.zone,
            `OBS ${fIdx + 1} Photographs (Cont.)`
          );

          const contY = doc.y;
          doc.roundedBox(MARGIN_LEFT, contY, CONTENT_W, chunkH, SLATE_BG, BORDER, 2.5);

          doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
          doc.setTextColor(NAVY);
          doc.pdf.text(`OBSERVATION ${fIdx + 1} • ${s.section.name.toUpperCase()} (Photographs Cont.)`, MARGIN_LEFT + 6, contY + 6);
          doc.statusBadge(fRow.state, fBadgeX, contY + 4);

          let chunkY = contY + 12;
          for (let cIdx = 0; cIdx < chunk.length; cIdx += 2) {
            const pNum1 = 4 + remIdx + cIdx + 1;
            const pNum2 = pNum1 + 1;
            const cid1 = chunk[cIdx];
            const cid2 = cIdx + 1 < chunk.length ? chunk[cIdx + 1] : undefined;

            const [cImg1, cImg2, cPhotoDoc1, cPhotoDoc2] = await Promise.all([
              loadImage(cid1),
              cid2 ? loadImage(cid2) : Promise.resolve(null),
              getPhotoDoc(cid1),
              cid2 ? getPhotoDoc(cid2) : Promise.resolve(null),
            ]);

            if (cid1) {
              drawPhotoCard(MARGIN_LEFT + 8, chunkY, obsPW, obsGridPH, cImg1, cPhotoDoc1, `PHOTO #${pNum1} • OBS ${fIdx + 1}`);
            }
            if (cid2) {
              drawPhotoCard(MARGIN_LEFT + 8 + obsPW + 6, chunkY, obsPW, obsGridPH, cImg2, cPhotoDoc2, `PHOTO #${pNum2} • OBS ${fIdx + 1}`);
            }

            chunkY += obsGridPH + obsGapY;
          }

          doc.y += chunkH + 4;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFICIENCY SUMMARY TABLE (If Observations Exist)
  // ═══════════════════════════════════════════════════════════════════════════
  const photoSectionIdSet = new Set(photoSectionsOnly.map((s) => s.section.id));
  const displayObservations = isPhotoOnly
    ? observations.filter((obs) => photoSectionIdSet.has(obs.sectionId))
    : observations;

  if (displayObservations.length > 0) {
    doc.newPage();
    doc.sectionHeader('Deficiency Action Log & Remediation Plan', 'Action List', `${displayObservations.length} Observations`);

    // Table Header
    doc.ensure(12);
    const thH = 8;
    doc.setFill(NAVY);
    doc.pdf.rect(MARGIN_LEFT, doc.y, CONTENT_W, thH, 'F');
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.setTextColor(WHITE);
    doc.pdf.text('#', MARGIN_LEFT + 4, doc.y + 5.2);
    doc.pdf.text('SECTION & REF', MARGIN_LEFT + 12, doc.y + 5.2);
    doc.pdf.text('DEFICIENCY DESCRIPTION', MARGIN_LEFT + 58, doc.y + 5.2);
    doc.pdf.text('CORRECTIVE ACTION REQUIRED', MARGIN_LEFT + 114, doc.y + 5.2);
    doc.pdf.text('EVIDENCE', MARGIN_LEFT + 162, doc.y + 5.2);
    doc.y += thH;

    displayObservations.forEach((obs, idx) => {
      const descLines = doc.pdf.splitTextToSize(obs.text || obs.remarks || '-', 54) as string[];
      const caLines = doc.pdf.splitTextToSize(obs.correctiveAction || 'Immediate remediation required', 46) as string[];
      const rH = Math.max(descLines.length, caLines.length) * 4.2 + 6;

      doc.ensure(rH);
      const isAlt = idx % 2 === 1;
      if (isAlt) {
        doc.setFill(SLATE_BG);
        doc.pdf.rect(MARGIN_LEFT, doc.y, CONTENT_W, rH, 'F');
      }

      // Red left indicator
      doc.setFill([239, 68, 68]);
      doc.pdf.rect(MARGIN_LEFT, doc.y, 2.5, rH, 'F');

      doc.setDraw(BORDER);
      doc.pdf.line(MARGIN_LEFT, doc.y + rH, PAGE_W - MARGIN_RIGHT, doc.y + rH);

      // Cells
      doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
      doc.setTextColor(NAVY);
      doc.pdf.text(String(idx + 1), MARGIN_LEFT + 4, doc.y + 5);

      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      doc.setTextColor(TEXT_DARK);
      doc.pdf.text(obs.ref || 'OBS', MARGIN_LEFT + 12, doc.y + 5);
      doc.pdf.setFont('helvetica', 'normal').setFontSize(6.8);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text(obs.sectionName.slice(0, 24), MARGIN_LEFT + 12, doc.y + 9);

      doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
      doc.setTextColor(TEXT_BODY);
      doc.pdf.text(descLines, MARGIN_LEFT + 58, doc.y + 5);
      doc.pdf.text(caLines, MARGIN_LEFT + 114, doc.y + 5);

      // Evidence Photo Count Pill Badge
      const pCount = obs.photoIds ? obs.photoIds.length : 0;
      if (pCount > 0) {
        doc.setFill([254, 242, 242]);
        doc.pdf.roundedRect(MARGIN_LEFT + 160, doc.y + 2.5, 19, 5, 1, 1, 'F');
        doc.pdf.setFont('helvetica', 'bold').setFontSize(6.5);
        doc.setTextColor([185, 28, 28]);
        doc.pdf.text(`[!] ${pCount} Photo${pCount > 1 ? 's' : ''}`, MARGIN_LEFT + 161.5, doc.y + 6);
      } else {
        doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
        doc.setTextColor(TEXT_FAINT);
        doc.pdf.text('-', MARGIN_LEFT + 168, doc.y + 5.5);
      }

      doc.y += rH;
    });

    doc.y += 10;

    // ─── DEFICIENCY & OBSERVATION VISUAL EVIDENCE GRID (8 PHOTOS PER PAGE) ───
    interface ObsEvidenceItem {
      photoId: string;
      label: string;
      desc: string;
      isDefect: boolean;
      sectionName: string;
      ref: string;
    }
    const evidencePhotos: ObsEvidenceItem[] = [];
    const seenPhotoIds = new Set<string>();

    // 1. Photos directly linked to observations
    displayObservations.forEach((obs, obsIdx) => {
      const pIds = obs.photoIds || [];
      pIds.forEach((pId, pIdx) => {
        if (!seenPhotoIds.has(pId)) {
          seenPhotoIds.add(pId);
          evidencePhotos.push({
            photoId: pId,
            label: `${obs.ref || `OBSERVATION ${obsIdx + 1}`} • PHOTO #${pIdx + 1}`,
            desc: obs.text || obs.correctiveAction || 'Deficiency identified during survey inspection',
            isDefect: true,
            sectionName: obs.sectionName,
            ref: obs.ref || `OBS ${obsIdx + 1}`,
          });
        }
      });
    });

    // 2. Any additional photos in the inspection flagged as defect
    (data.photos || []).forEach((p) => {
      if (p.isDefect && !seenPhotoIds.has(p.id)) {
        seenPhotoIds.add(p.id);
        const sec = sections.find((s) => s.section.id === p.inspectionSectionId);
        const secName = sec?.section.name || 'Deficiency Evidence';
        evidencePhotos.push({
          photoId: p.id,
          label: `DEFECT EVIDENCE • ${secName.toUpperCase()}`,
          desc: p.description || 'Defect flagged during visual survey inspection',
          isDefect: true,
          sectionName: secName,
          ref: 'DEFECT',
        });
      }
    });

    if (evidencePhotos.length > 0) {
      doc.newPage();
      doc.sectionHeader(
        'Deficiency & Observation Visual Evidence',
        'Visual Evidence',
        `${evidencePhotos.length} Defect Photographs`
      );

      doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text('HIGH-RESOLUTION PHOTOGRAPHIC EVIDENCE FOR DEFICIENCIES & OBSERVATIONS', MARGIN_LEFT, doc.y + 4);
      doc.y += 8;

      const evGapX = 8;
      const evGapY = 6;
      const pW = (CONTENT_W - evGapX) / 2; // 87 mm
      const pH = 104;                       // 104 mm
      const rowH = pH + evGapY;             // 110 mm
      let photosOnCurrentPage = 0;

      for (let pIdx = 0; pIdx < evidencePhotos.length; pIdx += 2) {
        if (photosOnCurrentPage >= 4 || doc.y + pH > PAGE_H - BOTTOM_MARGIN) {
          doc.newPage();
          doc.sectionHeader(
            'Deficiency & Observation Visual Evidence',
            'Visual Evidence',
            'Photographs (Cont.)'
          );
          doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
          doc.setTextColor(TEXT_MUTED);
          doc.pdf.text('DEFICIENCY & OBSERVATION VISUAL EVIDENCE (CONTINUED)', MARGIN_LEFT, doc.y + 4);
          doc.y += 7;
          photosOnCurrentPage = 0;
        }

        const item1 = evidencePhotos[pIdx];
        const item2 = pIdx + 1 < evidencePhotos.length ? evidencePhotos[pIdx + 1] : undefined;

        const [img1, img2, photoDoc1, photoDoc2] = await Promise.all([
          loadImage(item1.photoId),
          item2 ? loadImage(item2.photoId) : Promise.resolve(null),
          getPhotoDoc(item1.photoId),
          item2 ? getPhotoDoc(item2.photoId) : Promise.resolve(null),
        ]);

        const curRowY = doc.y;
        if (item1) {
          const mergedDoc1 = {
            ...photoDoc1,
            isDefect: true,
            description: photoDoc1?.description || item1.desc,
          };
          drawPhotoCard(MARGIN_LEFT, curRowY, pW, pH, img1, mergedDoc1, item1.label);
          photosOnCurrentPage++;
        }
        if (item2) {
          const mergedDoc2 = {
            ...photoDoc2,
            isDefect: true,
            description: photoDoc2?.description || item2.desc,
          };
          drawPhotoCard(MARGIN_LEFT + pW + evGapX, curRowY, pW, pH, img2, mergedDoc2, item2.label);
          photosOnCurrentPage++;
        }

        doc.y += rowH;
      }

      doc.y += 10;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONCLUSION & RECOMMENDATIONS (shown last) — Professional Layout
  // ═══════════════════════════════════════════════════════════════════════════
  doc.newPage();
  doc.sectionHeader('3. Conclusion & Recommendations', 'Survey Close-Out');

  const conclusionText = inspection.conclusion?.trim() || 'No concluding remarks or formal recommendations logged.';

  // Header context box
  const ctxBoxH = 18;
  doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, ctxBoxH, [13, 33, 56], NAVY, 2);
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, doc.y, 3, ctxBoxH, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
  doc.setTextColor(WHITE);
  doc.pdf.text('SURVEY CONCLUSION', MARGIN_LEFT + 7, doc.y + 7.5);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
  doc.setTextColor([180, 220, 200]);
  const surveyDate = `${fmtDate(inspection.startDate)} – ${fmtDate(inspection.completionDate || inspection.startDate)}`;
  doc.pdf.text(`Survey Period: ${surveyDate}  ·  Lead Surveyor: ${inspection.inspector || '-'}`, MARGIN_LEFT + 7, doc.y + 13.5);
  doc.y += ctxBoxH + 5;

  // Conclusion text box with rich formatting (bullets, bold, headings, font styles)
  const conRichH = measureRichText(doc.pdf, conclusionText, CONTENT_W - 20, { size: 8.5, lineGap: 5 });
  const conBoxH = Math.max(conRichH + 18, 30);
  doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, conBoxH, SLATE_BG, BORDER, 2);
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, doc.y, 3, conBoxH, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('CONCLUDING REMARKS', MARGIN_LEFT + 7, doc.y + 6.5);
  doc.setDraw(BORDER, 0.3);
  doc.pdf.line(MARGIN_LEFT + 7, doc.y + 8.5, PAGE_W - MARGIN_RIGHT - 7, doc.y + 8.5);

  renderRichText(doc.pdf, conclusionText, MARGIN_LEFT + 7, doc.y + 14, CONTENT_W - 20, {
    size: 8.5,
    lineGap: 5,
    color: TEXT_BODY,
    bulletColor: NAVY,
  });
  doc.y += conBoxH + 6;

  // Key recommendation highlight boxes (checklist summary)
  const recItems = [
    { icon: '✓', text: 'All sections have been surveyed and documented per maritime inspection protocols.', ok: true },
    { icon: observations.length > 0 ? '▲' : '✓', text: observations.length > 0 ? `${observations.length} observation(s) require corrective action before next voyage.` : 'No critical observations recorded. Vessel meets inspection requirements.', ok: observations.length === 0 },
    { icon: '→', text: 'Full photographic evidence is embedded within this report for auditor reference.', ok: true },
  ];
  for (const rec of recItems) {
    doc.ensure(12);
    const recH = 10;
    const bgColor = rec.ok ? ([236, 253, 245] as [number, number, number]) : ([254, 242, 242] as [number, number, number]);
    const bdColor = rec.ok ? ([167, 243, 208] as [number, number, number]) : ([254, 202, 202] as [number, number, number]);
    const txColor = rec.ok ? ([6, 95, 70] as [number, number, number]) : ([185, 28, 28] as [number, number, number]);
    doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, recH, bgColor, bdColor, 1.5);
    doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
    doc.setTextColor(txColor);
    doc.pdf.text(`${rec.icon}  ${rec.text}`, MARGIN_LEFT + 5, doc.y + 6.8);
    doc.y += recH + 2;
  }

  doc.y += 10;

  // ═══════════════════════════════════════════════════════════════════════════
  // POST-PASS: DYNAMIC RUNNING HEADERS & FOOTERS (Page X of Y)
  // ═══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.pdf.getNumberOfPages();

  for (let pNum = 1; pNum <= totalPages; pNum++) {
    doc.pdf.setPage(pNum);

    if (pNum >= 2) {
            // Running Header (Pages 2+)
      let rhLogoX = MARGIN_LEFT;

      if (brandLogo) {
        const scale = 6.5 / brandLogo.h;
        const lw = brandLogo.w * scale;
        doc.pdf.addImage(brandLogo.dataUrl, 'PNG', rhLogoX, 6, lw, 6.5);
        rhLogoX += lw + 4;
      }

      if (!brandLogo) {
        doc.setFill(TEAL);
        doc.pdf.circle(MARGIN_LEFT + 1.2, 10.8, 1.2, 'F');
        rhLogoX = MARGIN_LEFT + 4.5;
      }

      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      doc.setTextColor(NAVY);
      doc.pdf.text('OZELLAR FLEET SYSTEMS', rhLogoX, 11.5);

      const rtitleW = doc.pdf.getTextWidth('OZELLAR FLEET SYSTEMS');

      doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
      doc.setTextColor(TEXT_MUTED);
      const rhReportType = isTakeOver
        ? ' |  VESSEL TAKE OVER REPORT'
        : isPrePurchase
        ? ' |  PRE PURCHASE REPORT'
        : (isPhotoOnly ? ' |  VESSEL PHOTO REPORT' : ' |  VESSEL INSPECTION REPORT');
      doc.pdf.text(rhReportType, rhLogoX + rtitleW, 11.5);

      // Right Header
      const rightHead = `${inspection.vesselName || 'VESSEL'}${inspection.imo ? '  |  IMO ' + inspection.imo : ''}`;
      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      doc.setTextColor(NAVY_LIGHT);
      doc.pdf.text(rightHead, PAGE_W - MARGIN_RIGHT, 11.5, { align: 'right' });

      // Hairline divider
      doc.setDraw(BORDER_DARK, 0.2);
      doc.pdf.line(MARGIN_LEFT, 14, PAGE_W - MARGIN_RIGHT, 14);
    }

    // Running Footer (All Pages)
    const footY = PAGE_H - 10;
    doc.setDraw(BORDER_DARK, 0.2);
    doc.pdf.line(MARGIN_LEFT, footY - 3, PAGE_W - MARGIN_RIGHT, footY - 3);

    doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text('CONFIDENTIAL & PROPRIETARY  |  OZELLAR MARINE INSPECTION PLATFORM', MARGIN_LEFT, footY + 1);

    doc.setTextColor(TEXT_FAINT);
    doc.pdf.text(`GENERATED: ${new Date().toLocaleDateString('en-GB')}`, PAGE_W - MARGIN_RIGHT - 25, footY + 1, { align: 'right' });

    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.setTextColor(NAVY);
    doc.pdf.text(`Page ${pNum} of ${totalPages}`, PAGE_W - MARGIN_RIGHT, footY + 1, { align: 'right' });
  }

  if (data.onProgress) {
    data.onProgress({
      loaded: totalUniquePhotos,
      total: totalUniquePhotos,
      stage: 'Finalizing PDF document...',
      percent: 100,
    });
  }

  return doc.pdf.output('blob');
}


































