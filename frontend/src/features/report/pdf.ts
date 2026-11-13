import { jsPDF } from 'jspdf';
import { STATUS_LABELS, type ApprovalEvent, type VesselParticularKey } from '@ozellar/shared';
import { photoSrc } from '../../offline/photoQueue';
import { db } from '../../offline/db';
import brandLogoSrc from '../../assets/ozellar-marine-global-logo.gif';
import { PARTICULAR_LABELS, PARTICULAR_GROUPS } from '../vessels/particulars';
import type { ReportData, SectionReport, Observation } from './reportData';
import { renderRichText, measureRichText } from './richTextPdf';
import { stripHtmlToPlainText, formatObservationText } from '../inspections/photoDefectService';

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

// Cover-crop with rounded corners and a dark gradient at the bottom (for the title), returned as a JPEG.
// The corners are filled white, which matches the page background.
async function cropToCoverRounded(loadedImg: LoadedImage, targetW: number, targetH: number, radiusMm: number): Promise<string> {
  try {
    const srcW = loadedImg.w;
    const srcH = loadedImg.h;
    if (!srcW || !srcH) return loadedImg.dataUrl;
    const targetAspect = targetW / targetH;

    let cropW = srcW;
    let cropH = srcH;
    let cropX = 0;
    let cropY = 0;
    if (srcW / srcH > targetAspect) {
      cropW = Math.round(srcH * targetAspect);
      cropX = Math.round((srcW - cropW) / 2);
    } else {
      cropH = Math.round(srcW / targetAspect);
      cropY = Math.round((srcH - cropH) / 2);
    }

    const canvasW = 1400;
    const canvasH = Math.round(canvasW / targetAspect);
    const r = radiusMm * (canvasW / targetW);
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return loadedImg.dataUrl;

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('canvas crop failed'));
      img.src = loadedImg.dataUrl;
    });

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(canvasW - r, 0);
    ctx.quadraticCurveTo(canvasW, 0, canvasW, r);
    ctx.lineTo(canvasW, canvasH - r);
    ctx.quadraticCurveTo(canvasW, canvasH, canvasW - r, canvasH);
    ctx.lineTo(r, canvasH);
    ctx.quadraticCurveTo(0, canvasH, 0, canvasH - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvasW, canvasH);

    const shadeTop = canvasH * 0.6;
    const grad = ctx.createLinearGradient(0, shadeTop, 0, canvasH);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, shadeTop, canvasW, canvasH - shadeTop);

    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return loadedImg.dataUrl;
  }
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

  sectionHeader(title: string, _zone?: string, _stat?: string) {
    this.ensure(16);
    const h = 12;
    // Dark navy full-width bar with smooth corners
    this.setFill(NAVY);
    this.pdf.roundedRect(MARGIN_LEFT, this.y, CONTENT_W, h, 1.5, 1.5, 'F');

    // Section title
    this.pdf.setFont('helvetica', 'bold').setFontSize(10);
    this.setTextColor(WHITE);
    this.pdf.text(title.toUpperCase(), MARGIN_LEFT + 6, this.y + 8);

    // (no zone badge or photo-count text on the right: the bar carries the title only)

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
  reportType?: 'full' | 'photo_only' | 'observation';
  onProgress?: (progress: PdfProgressEvent) => void;
}): Promise<Blob> {
  const { inspection, vessel, sections = [], observations = [], stats, approvalHistory = [] } = data;
  const isPhotoOnly = data.reportType === 'photo_only';
  const isObservationOnly = data.reportType === 'observation';
  const photoSectionsOnly = sections.filter((s) => !!s.section.photoOnly);
  const neededSections = isObservationOnly ? [] : isPhotoOnly ? photoSectionsOnly : sections;
  const doc = new Doc();

  // 1. Gather all needed photo IDs to prefetch concurrently
  const allNeededPhotoIds: string[] = [];
  if (inspection.coverPhotoId && !isObservationOnly) allNeededPhotoIds.push(inspection.coverPhotoId);

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

    // ─── Professional Photo Card Renderer ───
  const drawPhotoCard = (
    px: number,
    py: number,
    pW: number,
    pH: number,
    img: LoadedImage | null,
    docPhoto: any,
    label: string,
    neutralBorder = false
  ) => {
    const isDef = !!docPhoto?.isDefect;
    const desc = docPhoto?.description ? String(docPhoto.description).trim() : '';

    // Split description into lines to dynamically fit within caption banner
    const maxDescW = pW - 8;
    doc.pdf.setFont('helvetica', isDef ? 'bold' : 'normal').setFontSize(6.5);
    const descLines = desc ? (doc.pdf.splitTextToSize(desc, maxDescW) as string[]).slice(0, 2) : [];

    // Caption banner height: 8mm (label only), 13mm (1 line), 16mm (2 lines)
    const bannerH = descLines.length > 1 ? 16 : descLines.length === 1 ? 13 : 8;

    // 1. Outer Card Container — Lite red border for defect, standard border for normal
    const cardBorder = isDef && !neutralBorder ? ([248, 113, 113] as [number, number, number]) : BORDER;
    doc.roundedBox(px, py, pW, pH, WHITE, cardBorder, 2);

    // 2. Image Viewport — Prominently centered, clean neutral framing
    const pad = 1.2;
    const imgAreaW = pW - (2 * pad);
    const imgAreaH = pH - bannerH - pad;
    const imgLeft = px + pad;
    const imgTop = py + pad;

    doc.setFill([248, 250, 252]);
    doc.pdf.roundedRect(imgLeft, imgTop, imgAreaW, imgAreaH, 1.2, 1.2, 'F');

    if (img) {
      const scFit = Math.min((imgAreaW - 0.8) / img.w, (imgAreaH - 0.8) / img.h);
      const fw = img.w * scFit;
      const fh = img.h * scFit;
      const fx = imgLeft + (imgAreaW - fw) / 2;
      const fy = imgTop + (imgAreaH - fh) / 2;
      doc.pdf.addImage(img.dataUrl, 'JPEG', fx, fy, fw, fh);
    } else {
      doc.pdf.setFont('helvetica', 'italic').setFontSize(7);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text('Photo unavailable', imgLeft + imgAreaW / 2, imgTop + imgAreaH / 2, { align: 'center' });
    }

    // 3. Status Badge: ONLY one alert symbol in top-right for defect image (no "DEFECT" text)
    if (isDef) {
      const bW = 6.2, bH = 5.2;
      const bX = imgLeft + imgAreaW - bW - 2;
      const bY = imgTop + 2;
      doc.setFill([220, 38, 38]);
      doc.pdf.roundedRect(bX, bY, bW, bH, 1.2, 1.2, 'F');

      // Vector Alert Triangle inside the badge
      const triCenterX = bX + bW / 2;
      const triTopY = bY + 1.1;
      const triBotY = bY + 4.1;
      doc.setFill(WHITE);
      doc.pdf.triangle(triCenterX, triTopY, triCenterX - 1.6, triBotY, triCenterX + 1.6, triBotY, 'F');

      // Exclamation point inside triangle
      doc.pdf.setFont('helvetica', 'bold').setFontSize(4.0);
      doc.setTextColor([220, 38, 38]);
      doc.pdf.text('!', triCenterX, triBotY - 0.4, { align: 'center' });
    }

    // 4. Caption banner at bottom — Standard clean styling for all images
    const capY = py + pH - bannerH;
    doc.setDraw(BORDER, 0.25);
    doc.pdf.line(px, capY, px + pW, capY);

    // Clean white background fill inside caption
    doc.setFill(WHITE);
    doc.pdf.rect(px + 0.5, capY + 0.2, pW - 1, bannerH - 0.6, 'F');

    // Line 1: Header Label (e.g. PHOTO #1)
    const labelY = capY + 4;
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.2);
    doc.setTextColor(NAVY);
    let displayLabel = label;
    while (displayLabel.length > 3 && doc.pdf.getTextWidth(displayLabel) > pW - 8) {
      displayLabel = displayLabel.slice(0, -1);
    }
    doc.pdf.text(displayLabel, px + 3.5, labelY);

    // Line 2: Description Text
    if (descLines.length > 0) {
      let descY = labelY + 3.8;
      doc.pdf.setFont('helvetica', 'normal').setFontSize(6.5);
      doc.setTextColor(TEXT_BODY);
      for (const dLine of descLines) {
        doc.pdf.text(dLine, px + 3.5, descY);
        descY += 3.6;
      }
    }
    // No remark -> no placeholder line: the caption is just the photo label.
  };

  // ─── Justified photo rows (shared by the section photo grid and observation cards) ───
  // Two photos per row, same height, widths proportional to each photo's shape: a landscape photo gets a wide frame
  // and a portrait photo a narrow one, so frames hug their photos instead of showing grey bands. Photo order is kept.
  const ROW_PAD = 1.2;
  const ROW_FRAME = 2 * ROW_PAD + 0.8;  // card width minus the photo's own width
  const ROW_MAX_IMG_H = 98;

  const aspectOf = (img: LoadedImage | null) => (img ? Math.min(1.9, Math.max(0.55, img.w / img.h)) : 1);

  const bannerFor = (docPhoto: any, cardW: number): number => {
    const desc = docPhoto?.description ? String(docPhoto.description).trim() : '';
    if (!desc) return 8;
    doc.pdf.setFont('helvetica', docPhoto?.isDefect ? 'bold' : 'normal').setFontSize(6.5);
    return (doc.pdf.splitTextToSize(desc, cardW - 8) as string[]).length > 1 ? 16 : 13;
  };

  const buildPhotoRow = async (
    idA: string,
    idB: string | undefined,
    availW: number,
    x0: number,
    gapX: number,
    centerSingle: boolean,
    maxImgH = ROW_MAX_IMG_H,
    forceEqualColumns = false
  ) => {
    const [img1, img2, photoDoc1, photoDoc2] = await Promise.all([
      loadImage(idA),
      idB ? loadImage(idB) : Promise.resolve(null),
      getPhotoDoc(idA),
      idB ? getPhotoDoc(idB) : Promise.resolve(null),
    ]);
    const a1 = aspectOf(img1);
    const a2 = aspectOf(img2);

    let imgH: number;
    let w1: number;
    let w2 = 0;
    let x1 = x0;
    if (idB) {
      if (forceEqualColumns) {
        // Symmetrical 50/50 columns for sections with mixed orientations
        const colW = (availW - gapX) / 2;
        w1 = colW;
        w2 = colW;
        x1 = x0;
        imgH = Math.min(maxImgH, Math.max(56, (colW - ROW_FRAME) / 1.33));
      } else {
        // Same height for both; widths follow each photo's shape and together fill the row (or are centred if capped).
        imgH = Math.min(maxImgH, (availW - gapX - 2 * ROW_FRAME) / (a1 + a2));
        w1 = imgH * a1 + ROW_FRAME;
        w2 = imgH * a2 + ROW_FRAME;
        x1 = x0 + (availW - (w1 + gapX + w2)) / 2;
      }
    } else {
      if (forceEqualColumns) {
        const colW = (availW - gapX) / 2;
        w1 = colW;
        imgH = Math.min(maxImgH, Math.max(56, (colW - ROW_FRAME) / 1.33));
        x1 = centerSingle ? x0 + (availW - colW) / 2 : x0;
      } else {
        // A lone photo: frame hugs the photo (at most half the row wide), so there are no grey bands either.
        const maxW = (availW - gapX) / 2;
        imgH = Math.min(maxImgH, (maxW - ROW_FRAME) / a1);
        w1 = imgH * a1 + ROW_FRAME;
        if (centerSingle) x1 = x0 + (availW - w1) / 2;
      }
    }
    const banner = Math.max(bannerFor(photoDoc1, w1), idB ? bannerFor(photoDoc2, w2) : 0);
    return { idB, img1, img2, photoDoc1, photoDoc2, w1, w2, x1, gapX, pH: imgH + 0.8 + banner + ROW_PAD };
  };

  // ─── Adaptive Photo Grid ───
  // Rows are packed by real remaining space instead of a fixed 4-per-page.
  const renderPhotoGrid4 = async (
    photoIds: string[],
    sectionName: string,
    zone: string,
    gridTitle = 'SECTION PHOTOGRAPHS & VISUAL EVIDENCE'
  ) => {
    if (!photoIds.length) return;

    const gapX = 8;
    const gapY = 6;
    const pageLimit = PAGE_H - BOTTOM_MARGIN;

    // Check if this section contains mixed orientations (both landscape and portrait)
    const sectionImgs = await Promise.all(photoIds.map((id) => loadImage(id)));
    const sectionAspects = sectionImgs.map(aspectOf);
    const hasLandscape = sectionAspects.some((a) => a >= 1.05);
    const hasPortrait = sectionAspects.some((a) => a < 0.95);
    const isMixedSection = hasLandscape && hasPortrait;

    const rowAt = (pIdx: number) =>
      buildPhotoRow(photoIds[pIdx], photoIds[pIdx + 1], CONTENT_W, MARGIN_LEFT, gapX, false, ROW_MAX_IMG_H, isMixedSection);

    const continuedHeader = () => {
      doc.newPage();
      doc.sectionHeader(sectionName, zone || 'Visual Evidence', 'Photographs (Cont.)');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text(gridTitle, MARGIN_LEFT, doc.y + 4);
      doc.y += 7;
    };

    let row = await rowAt(0);

    // Grid title travels with the first row: if they don't fit together, both move to the next page.
    if (doc.y + 7 + row.pH > pageLimit) {
      doc.newPage();
      doc.sectionHeader(sectionName, zone || 'Visual Evidence', `${photoIds.length} Photographs`);
    }
    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(gridTitle, MARGIN_LEFT, doc.y + 4);
    doc.y += 7;

    for (let pIdx = 0; pIdx < photoIds.length; pIdx += 2) {
      if (pIdx > 0) row = await rowAt(pIdx);
      if (doc.y + row.pH > pageLimit) continuedHeader();

      const curRowY = doc.y;
      drawPhotoCard(row.x1, curRowY, row.w1, row.pH, row.img1, row.photoDoc1, `PHOTO #${pIdx + 1}`);
      if (row.idB) {
        drawPhotoCard(row.x1 + row.w1 + gapX, curRowY, row.w2, row.pH, row.img2, row.photoDoc2, `PHOTO #${pIdx + 2}`);
      }
      doc.y += row.pH + gapY;
    }
  };
  const renderPhotoGrid8 = renderPhotoGrid4; // Backwards-compatible alias

  // ─── Observation card ───
  // One soft-red card: tag, text, corrective action, then the observation's photos in justified rows.
  // Height is measured from the real content. The card splits across pages only between photo rows, and the
  // "OBSERVATIONS & FINDINGS" heading always stays with the first card.
  // An observation's text only counts when the user typed it. Auto-generated text (empty, the section name,
  // the photo's caption, or the "Defect observation logged…" placeholder) is treated as no text.
  const isDefaultObservationText = (text: string | undefined | null, sectionName: string, photoDescs: string[]): boolean => {
    const t = stripHtmlToPlainText(text || '').toLowerCase();
    if (!t) return true;
    const sec = stripHtmlToPlainText(sectionName || '');
    if (sec && t === sec.toLowerCase()) return true;
    if (t === 'defect observation logged from visual evidence' || t === 'observation logged') return true;
    return photoDescs.some((d) => {
      const desc = stripHtmlToPlainText(d || '');
      return !!desc && (t === desc.toLowerCase() || t === stripHtmlToPlainText(formatObservationText(sec, desc)).toLowerCase());
    });
  };

  type SectionRow = (typeof sections)[number];
  const renderObservationCard = async (
    fRow: SectionRow['findings'][number],
    fIdx: number,
    s: SectionRow,
    sIdx: number,
    showStatus: boolean,
    showHeading = true
  ) => {
    const ordinary = (inspection as any)?.reportCategory !== 'take_over' && (inspection as any)?.reportCategory !== 'pre_purchase';
    const RED = [185, 28, 28] as [number, number, number];
    const innerX = MARGIN_LEFT + 6;
    const innerW = CONTENT_W - 12;
    const ROW_GAP = 4;
    const BOTTOM_PAD = 3;
    const CONT_HEADER_H = 12;
    const OBS_MAX_IMG_H = 76; // smaller than section photos so two observation cards fit on one page
    const pageLimit = PAGE_H - BOTTOM_MARGIN;

    const photoIds = (fRow.photoIds || []).filter(Boolean);
    const obsImgs = await Promise.all(photoIds.map((id) => loadImage(id)));
    const obsAspects = obsImgs.map(aspectOf);
    const hasObsLandscape = obsAspects.some((a) => a >= 1.05);
    const hasObsPortrait = obsAspects.some((a) => a < 0.95);
    const isMixedObs = hasObsLandscape && hasObsPortrait;

    const rows: Awaited<ReturnType<typeof buildPhotoRow>>[] = [];
    for (let i = 0; i < photoIds.length; i += 2) {
      rows.push(await buildPhotoRow(photoIds[i], photoIds[i + 1], innerW, innerX, 6, true, OBS_MAX_IMG_H, isMixedObs));
    }

    // Only what the user actually entered is printed: no placeholder text when nothing was typed.
    const photoDescs = photoIds.map((pid) => String(photoMap.get(pid)?.description ?? ''));
    const textContent = isDefaultObservationText(fRow.finding.text, s.section.name, photoDescs) ? '' : (fRow.finding.text || '');
    const caContent = (ordinary && stripHtmlToPlainText(fRow.finding.correctiveAction || '')) ? `**Corrective Action:** ${fRow.finding.correctiveAction}` : '';

    const blocks: { content: string; size: number; lineGap: number; color: [number, number, number]; h: number }[] = [];
    if (textContent) blocks.push({ content: textContent, size: 8.5, lineGap: 4.2, color: TEXT_DARK, h: measureRichText(doc.pdf, textContent, innerW, { size: 8.5, lineGap: 4.2 }) });
    if (caContent) blocks.push({ content: caContent, size: 7.8, lineGap: 4.0, color: RED, h: measureRichText(doc.pdf, caContent, innerW, { size: 7.8, lineGap: 4.0 }) });
    const bodyH = blocks.reduce((sum, b, i) => sum + b.h + (i > 0 ? 2 : 0), 0);

    // Tag row; when there is text, a divider and a clear gap below it before the text starts.
    const BODY_TOP = 17;
    const textBlockH = blocks.length ? BODY_TOP + bodyH + (rows.length ? 2 : 0) : 12;

    const statusStr = fRow.state === 'ok' ? '[+]  SATISFACTORY' : fRow.state === 'bad' ? '!  OBSERVATION' : fRow.state === 'na' ? '-  N / A' : '[?]  PENDING';
    const drawTag = (y: number, text: string) => {
      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      const tagW = doc.pdf.getTextWidth(text) + 8;
      // Same green theme as the other section headings (not alarm red)
      doc.setFill(STATUS_OK.bg);
      doc.setDraw(STATUS_OK.border, 0.3);
      doc.pdf.roundedRect(innerX, y + 4, tagW, 5.5, 1, 1, 'FD');
      doc.setTextColor(NAVY);
      doc.pdf.text(text, innerX + 4, y + 7.8);
      if (showStatus) {
        const badgeW = doc.pdf.getTextWidth(statusStr) + 8;
        doc.statusBadge(fRow.state, PAGE_W - MARGIN_RIGHT - badgeW - 6, y + 4);
      }
    };

    const tag = `OBSERVATION ${fIdx + 1} • ${s.section.name.toUpperCase()}`;
    let rowIdx = 0;
    let first = true;
    do {
      const headerH = first ? textBlockH : CONT_HEADER_H;
      const firstRowH = rows[rowIdx] ? rows[rowIdx].pH + ROW_GAP : 0;

      if (first) {
        doc.ensure(headerH + firstRowH + BOTTOM_PAD + (fIdx === 0 && showHeading ? 8 : 0));
        if (fIdx === 0 && showHeading) {
          doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
          doc.setTextColor(TEXT_MUTED);
          doc.pdf.text('SECTION OBSERVATIONS & FINDINGS', MARGIN_LEFT, doc.y + 4);
          doc.y += 8;
        }
      } else {
        doc.newPage();
        doc.sectionHeader(`Section ${sIdx + 1}: ${s.section.name}`, s.section.zone || 'General', `OBS ${fIdx + 1} Photographs (Cont.)`);
      }

      // How many photo rows fit on this page
      let h = headerH;
      let count = 0;
      while (rowIdx + count < rows.length) {
        const rh = rows[rowIdx + count].pH + ROW_GAP;
        if (count > 0 && doc.y + h + rh + BOTTOM_PAD > pageLimit) break;
        h += rh;
        count++;
      }
      const cardH = h + BOTTOM_PAD;

      const cardY = doc.y;
      doc.roundedBox(MARGIN_LEFT, cardY, CONTENT_W, cardH, WHITE, BORDER, 2.5);

      let curY: number;
      if (first) {
        drawTag(cardY, tag);

        if (blocks.length) {
          doc.setDraw(BORDER, 0.25);
          doc.pdf.line(innerX, cardY + 12, PAGE_W - MARGIN_RIGHT - 6, cardY + 12);

          curY = cardY + BODY_TOP;
          blocks.forEach((b, i) => {
            if (i > 0) curY += 2;
            renderRichText(doc.pdf, b.content, innerX, curY, innerW, { size: b.size, lineGap: b.lineGap, color: b.color });
            curY += b.h;
          });
          if (rows.length) curY += 2;
        } else {
          curY = cardY + 12;
        }
      } else {
        drawTag(cardY, `${tag} (Photographs Cont.)`);
        curY = cardY + CONT_HEADER_H;
      }

      for (let r = 0; r < count; r++) {
        const row = rows[rowIdx + r];
        const n1 = (rowIdx + r) * 2 + 1;
        drawPhotoCard(row.x1, curY, row.w1, row.pH, row.img1, row.photoDoc1, `PHOTO #${n1} • OBS ${fIdx + 1}`, true);
        if (row.idB) {
          drawPhotoCard(row.x1 + row.w1 + row.gapX, curY, row.w2, row.pH, row.img2, row.photoDoc2, `PHOTO #${n1 + 1} • OBS ${fIdx + 1}`, true);
        }
        curY += row.pH + ROW_GAP;
      }

      doc.y += cardH + 5;
      rowIdx += count;
      first = false;
    } while (rowIdx < rows.length);
  };

  // ─── Report-kind flags and titles (used by the cover, the running header and the observation report) ───
  const isTakeOver = (inspection as any)?.reportCategory === 'take_over';
  const isPrePurchase = (inspection as any)?.reportCategory === 'pre_purchase';
  const isOrdinaryInspection = !isTakeOver && !isPrePurchase;
  const mainPdfTitle = isObservationOnly
    ? 'VESSEL OBSERVATION REPORT'
    : isTakeOver
    ? 'VESSEL TAKE OVER REPORT'
    : isPrePurchase
    ? 'PRE PURCHASE INSPECTION REPORT'
    : (isPhotoOnly ? 'VESSEL PHOTO INSPECTION REPORT' : 'VESSEL INSPECTION REPORT');
  const subPdfTitle = isObservationOnly
    ? 'OBSERVATIONS, REMARKS & PHOTOGRAPHIC EVIDENCE'
    : isTakeOver
    ? 'VESSEL TAKE OVER & FLEET ENTRY AUDIT RECORD'
    : isPrePurchase
    ? 'PRE PURCHASE PHOTOGRAPHIC CONDITION SURVEY'
    : (isPhotoOnly ? 'PHOTOGRAPHIC SURVEY & CONDITION AUDIT RECORD' : 'OFFICIAL STATUTORY & TECHNICAL AUDIT RECORD');

  // ─── Observation list table (Appendix of the full report; the opening list of the Observation Report) ───
  const renderAppendix = (startNewPage: boolean, title: string) => {
    const plain = (v?: string | null) => stripHtmlToPlainText(v ?? '');
    const appendixItems = neededObservations.map((o) => {
      let desc: string;
      if (o.kind === 'finding') {
        const descs = (o.photoIds || []).map((pid) => plain(photoMap.get(pid)?.description));
        desc = isDefaultObservationText(o.text, o.sectionName, descs) ? '' : plain(o.text);
        if (!desc) desc = descs.find(Boolean) ?? '';
      } else {
        const remarks = plain(o.remarks);
        desc = [plain(o.text), remarks ? `Remarks: ${remarks}` : ''].filter(Boolean).join(' — ');
      }
      return { section: o.sectionName, ref: o.ref, desc };
    });

    if (startNewPage) doc.newPage();
    doc.sectionHeader(title, 'List of Observations', `${appendixItems.length} Observation${appendixItems.length === 1 ? '' : 's'}`);

    const colNo = 10;
    const colSection = 48;
    const colRef = 28;
    const colDesc = CONTENT_W - colNo - colSection - colRef;

    const drawTableHead = () => {
      doc.setFill(NAVY);
      doc.pdf.roundedRect(MARGIN_LEFT, doc.y, CONTENT_W, 8, 1.2, 1.2, 'F');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      doc.setTextColor(WHITE);
      doc.pdf.text('NO.', MARGIN_LEFT + 3, doc.y + 5.3);
      doc.pdf.text('SECTION', MARGIN_LEFT + colNo + 2, doc.y + 5.3);
      doc.pdf.text('REFERENCE', MARGIN_LEFT + colNo + colSection + 2, doc.y + 5.3);
      doc.pdf.text('OBSERVATION / REMARKS', MARGIN_LEFT + colNo + colSection + colRef + 2, doc.y + 5.3);
      doc.y += 9;
    };

    if (!appendixItems.length) {
      doc.pdf.setFont('helvetica', 'italic').setFontSize(8.5);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text('No observations recorded.', MARGIN_LEFT, doc.y + 5);
      doc.y += 10;
      return;
    }

    drawTableHead();
    appendixItems.forEach((it, i) => {
      doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
      const secLines = doc.pdf.splitTextToSize(it.section || '-', colSection - 4) as string[];
      const refLines = doc.pdf.splitTextToSize(it.ref || '-', colRef - 4) as string[];
      const descLines = doc.pdf.splitTextToSize(it.desc || '-', colDesc - 4) as string[];
      const lineCount = Math.max(secLines.length, refLines.length, descLines.length);
      const rowH = lineCount * 4 + 4;

      if (doc.y + rowH > PAGE_H - BOTTOM_MARGIN) {
        doc.newPage();
        drawTableHead();
      }

      if (i % 2 === 0) {
        doc.setFill(SLATE_BG);
        doc.pdf.rect(MARGIN_LEFT, doc.y, CONTENT_W, rowH, 'F');
      }
      const ty = doc.y + 5;
      doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
      doc.setTextColor(NAVY);
      doc.pdf.text(String(i + 1), MARGIN_LEFT + 3, ty);
      doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
      doc.setTextColor(TEXT_DARK);
      doc.pdf.text(secLines, MARGIN_LEFT + colNo + 2, ty);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text(refLines, MARGIN_LEFT + colNo + colSection + 2, ty);
      doc.setTextColor(it.desc ? TEXT_BODY : TEXT_FAINT);
      doc.pdf.text(descLines, MARGIN_LEFT + colNo + colSection + colRef + 2, ty);

      doc.setDraw(BORDER, 0.2);
      doc.pdf.line(MARGIN_LEFT, doc.y + rowH, MARGIN_LEFT + CONTENT_W, doc.y + rowH);
      doc.y += rowH;
    });
  };

  // ─── Observation Report: title block, the observation list, then every observation with its remarks and photos ───
  const renderObservationOnlyReport = async () => {
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
    doc.pdf.setFont('helvetica', 'bold').setFontSize(13);
    doc.setTextColor(NAVY);
    doc.pdf.text(mainPdfTitle, titleX, 11.5);
    doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(subPdfTitle, titleX, 16);

    // Vessel / survey strip
    const stripY = 31;
    const stripH = 13;
    doc.setFill(SLATE_BG);
    doc.setDraw(BORDER_DARK, 0.25);
    doc.pdf.roundedRect(MARGIN_LEFT, stripY, CONTENT_W, stripH, 1.5, 1.5, 'FD');
    const stripCols = [
      { label: 'VESSEL', val: `${inspection.vesselName || '-'}${inspection.imo ? `  (IMO ${inspection.imo})` : ''}`, w: 0.34 },
      { label: 'SURVEY PORT / LOCATION', val: inspection.port || '-', w: 0.2 },
      { label: 'AUDITOR / SURVEYOR / SUPERINTENDENT', val: inspection.inspector || '-', w: 0.26 },
      { label: 'INSPECTION DATES', val: `${fmtDate(inspection.startDate)} - ${fmtDate(inspection.completionDate || inspection.startDate)}`, w: 0.2 },
    ];
    let cx = MARGIN_LEFT;
    stripCols.forEach((c, i) => {
      const cw = CONTENT_W * c.w;
      if (i > 0) {
        doc.setDraw(BORDER, 0.2);
        doc.pdf.line(cx, stripY + 2, cx, stripY + stripH - 2);
      }
      doc.pdf.setFont('helvetica', 'bold').setFontSize(5.2);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text(c.label, cx + 4, stripY + 4.6);
      doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
      doc.setTextColor(TEXT_DARK);
      let v = c.val;
      while (v.length > 3 && doc.pdf.getTextWidth(v) > cw - 6) v = v.slice(0, -1);
      doc.pdf.text(v, cx + 4, stripY + 9.4);
      cx += cw;
    });
    doc.y = stripY + stripH + 8;

    renderAppendix(false, 'Observation Summary');

    // Every observation, grouped by section, with its remarks and photos
    const plain = (v?: string | null) => stripHtmlToPlainText(v ?? '');
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const s = sections[sIdx];
      const obs = neededObservations.filter((o) => o.sectionId === s.section.id);
      if (!obs.length) continue;

      doc.ensure(75);
      doc.sectionHeader(`Section ${sIdx + 1}: ${s.section.name}`, s.section.zone || 'General', `${obs.length} Observation${obs.length === 1 ? '' : 's'}`);

      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        const remarks = plain(o.remarks);
        const fRow = {
          finding: {
            text: o.kind === 'question'
              ? [`**${o.ref}** ${plain(o.text)}`, remarks ? `Remarks: ${remarks}` : ''].filter(Boolean).join('\n')
              : o.text,
            correctiveAction: o.correctiveAction,
          },
          state: 'bad',
          photoIds: o.photoIds || [],
        } as any;
        await renderObservationCard(fRow, i, s, sIdx, false, false);
      }
    }
  };

  if (isObservationOnly) {
    await renderObservationOnlyReport();
  } else {

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


  doc.pdf.setFont('helvetica', 'bold').setFontSize(13);
  doc.setTextColor(NAVY);
  doc.pdf.text(mainPdfTitle, titleX, 11.5);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text(subPdfTitle, titleX, 16);

  // ── Framed Hero Cover Image (rounded corners, inside the page margins) ─────────
  const heroX = MARGIN_LEFT;
  const heroW = CONTENT_W;
  const heroY = 31;
  const heroH = 128;
  const heroRadius = 4;
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

  if (coverImgLoaded) {
    // Cropped to the frame, with rounded corners and the bottom shading for the title baked into the image
    const heroDataUrl = await cropToCoverRounded(coverImgLoaded, heroW, heroH, heroRadius);
    doc.pdf.addImage(heroDataUrl, 'JPEG', heroX, heroY, heroW, heroH);

    // Vessel Name Overlay (bottom left)
    const overlayTextY = heroY + heroH - 16;
    doc.pdf.setFont('helvetica', 'bold').setFontSize(16.5);
    doc.setTextColor(WHITE);
    doc.pdf.text((inspection.vesselName || 'VESSEL').toUpperCase(), heroX + 8, overlayTextY);

    // Metadata line (IMO, Type, Flag, Port)
    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.0);
    doc.setTextColor([210, 235, 225]);
    doc.pdf.text(vMetaStr, heroX + 8, overlayTextY + 7);
  } else {
    // Executive Maritime fallback banner (when no cover photo available)
    doc.roundedBox(heroX, heroY, heroW, heroH, [13, 33, 56], undefined, heroRadius);

    doc.setFill(TEAL);
    doc.pdf.rect(heroX + 8, heroY + 16, 24, 1.5, 'F');

    doc.pdf.setFont('helvetica', 'bold').setFontSize(22);
    doc.setTextColor(WHITE);
    doc.pdf.text((inspection.vesselName || 'VESSEL INSPECTION').toUpperCase(), heroX + 8, heroY + 32);

    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
    doc.setTextColor([180, 225, 200]);
    doc.pdf.text(vMetaStr || `IMO: ${inspection.imo || 'NOT SPECIFIED'}`, heroX + 8, heroY + 44);
  }

  // ── AUDIT & SURVEY PARTICULARS (Executive Maritime Table) ──────────────────
  const detailsY = heroY + heroH + 8;
  const detailsH = 52.5;
  doc.roundedBox(MARGIN_LEFT, detailsY, CONTENT_W, detailsH, WHITE, BORDER, 2.5);

  // Navy header strip inside card
  const hdrH = 8.5;
  doc.setFill(NAVY);
  doc.pdf.rect(MARGIN_LEFT, detailsY, CONTENT_W, hdrH, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
  doc.setTextColor(WHITE);
  doc.pdf.text('AUDIT & SURVEY PARTICULARS', MARGIN_LEFT + 6, detailsY + 5.8);


  // 4 Rows of Data Grid
  const particularsRows = [
    {
      col1: { label: 'SURVEY TYPE', val: isPhotoOnly ? 'Photographic Condition Survey' : (INSPECTION_TYPE_LABELS[inspection.inspectionType] || inspection.inspectionType || 'In Port Survey') },
      col2: { label: 'AUDITOR / SURVEYOR / SUPERINTENDENT', val: inspection.inspector || '-' },
    },
    {
      col1: { label: 'PORT / LOCATION', val: inspection.port || '-' },
      col2: { label: 'REPORT REFERENCE', val: `VIR-${inspection.id.slice(0, 8).toUpperCase()}` },
    },
    {
      col1: { label: 'DATE COMMENCED', val: fmtDate(inspection.startDate) },
      col2: { label: 'DATE COMPLETED', val: fmtDate(inspection.completionDate || inspection.startDate) },
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

  const heroColW = CONTENT_W / 4;
  for (let ci = 0; ci < heroCols.length; ci++) {
    const col = heroCols[ci];
    const cx = MARGIN_LEFT + ci * heroColW;

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

  // Audit Reference Pill
  const refStr = `VIR-${inspection.id.slice(0, 8).toUpperCase()}`;
  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
  const refPillW = doc.pdf.getTextWidth(refStr) + 10;
  const refX = PAGE_W - MARGIN_RIGHT - refPillW;
  doc.setFill(SLATE_BG);
  doc.setDraw(BORDER);
  doc.pdf.roundedRect(refX, execHdrY + 1.5, refPillW, 6.2, 1.2, 1.2, 'FD');
  doc.setTextColor(NAVY);
  doc.pdf.text(refStr, refX + refPillW / 2, execHdrY + 5.7, { align: 'center' });

  // Dual-tone Accent Hairline Divider
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, execHdrY + 14.5, 26, 1.2, 'F');
  doc.setDraw(BORDER_DARK, 0.25);
  doc.pdf.line(MARGIN_LEFT + 26, execHdrY + 15.1, PAGE_W - MARGIN_RIGHT, execHdrY + 15.1);

  doc.y = execHdrY + 18.5;

  // 2. Executive Survey Dispatch Metadata Ribbon
  const metaY = doc.y;
  const metaH = 11;
  doc.setFill(SLATE_BG);
  doc.setDraw(BORDER_DARK, 0.25);
  doc.pdf.roundedRect(MARGIN_LEFT, metaY, CONTENT_W, metaH, 1.5, 1.5, 'FD');

  const metaCols = [
    { label: 'AUDITOR / SURVEYOR / SUPERINTENDENT', val: inspection.inspector || '-' },
    { label: 'SURVEY PORT / LOCATION', val: inspection.port || '-' },
    { label: 'INSPECTION DATES', val: `${fmtDate(inspection.startDate)} - ${fmtDate(inspection.completionDate || inspection.startDate)}` },
  ];
  const mColW = CONTENT_W / metaCols.length;

  for (let mi = 0; mi < metaCols.length; mi++) {
    const mcX = MARGIN_LEFT + mi * mColW;
    if (mi > 0) {
      doc.setDraw(BORDER, 0.2);
      doc.pdf.line(mcX, metaY + 2, mcX, metaY + metaH - 2);
    }
    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.2);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(metaCols[mi].label, mcX + 4, metaY + 4.2);

    doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
    doc.setTextColor(TEXT_DARK);
    let mVal = metaCols[mi].val;
    while (mVal.length > 3 && doc.pdf.getTextWidth(mVal) > mColW - 6) {
      mVal = mVal.slice(0, -1);
    }
    doc.pdf.text(mVal, mcX + 4, metaY + 8.4);
  }

  doc.y = metaY + metaH + 6;

  // 3. Section Title Bar: Attending Surveyor Remarks & Appraisal
  doc.pdf.setFont('helvetica', 'bold').setFontSize(8.0);
  doc.setTextColor(NAVY);
  doc.pdf.text('ATTENDING SUPERINTENDENT APPRAISAL & OPERATIONAL SYNTHESIS', MARGIN_LEFT, doc.y + 3);

  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.5);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('OFFICIAL RECORD', PAGE_W - MARGIN_RIGHT, doc.y + 3, { align: 'right' });

  doc.setDraw(BORDER_DARK, 0.25);
  doc.pdf.line(MARGIN_LEFT, doc.y + 5.5, PAGE_W - MARGIN_RIGHT, doc.y + 5.5);
  doc.y += 9.5;

  // 4. Flowing Paginated Rich Text Content (Accommodates Any Length Across Pages!)
  const summaryText = inspection.summary?.trim() || 'Vessel physical survey conducted in accordance with international maritime regulations and approved company survey procedures. Individual compartment condition, structural integrity, and specific equipment findings are documented in the detailed section logs.';

  const onExecPageBreak = () => {
    doc.newPage();
    doc.pdf.setFont('helvetica', 'bold').setFontSize(10.5);
    doc.setTextColor(NAVY);
    doc.pdf.text('2. Executive Summary (Continued)', MARGIN_LEFT, 20);

    doc.pdf.setFont('helvetica', 'bold').setFontSize(6.5);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(`VIR-${inspection.id.slice(0, 8).toUpperCase()}  |  SURVEYOR REMARKS (CONT.)`, PAGE_W - MARGIN_RIGHT, 20, { align: 'right' });

    doc.setDraw(BORDER_DARK, 0.25);
    doc.pdf.line(MARGIN_LEFT, 23, PAGE_W - MARGIN_RIGHT, 23);

    doc.y = 28;
    return 28;
  };

  const pageMaxY = PAGE_H - BOTTOM_MARGIN - 22; // Leave safe space above footer

  const finalY = renderRichText(doc.pdf, summaryText, MARGIN_LEFT, doc.y, CONTENT_W, {
    size: 8.4,
    lineGap: 4.8,
    color: TEXT_BODY,
    bulletColor: NAVY,
    maxY: pageMaxY,
    onPageBreak: onExecPageBreak,
  });

  doc.y = finalY + 8;

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

        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor(NAVY);
        doc.pdf.text('SECTION REMARKS', MARGIN_LEFT + 6, doc.y + 6);

        renderRichText(doc.pdf, remText, MARGIN_LEFT + 6, doc.y + 11.5, CONTENT_W - 12, {
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
        for (let fIdx = 0; fIdx < s.findings.length; fIdx++) {
          await renderObservationCard(s.findings[fIdx], fIdx, s, sIdx, false);
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

    // ═════════════════════════════════════════════════════════════════════════
    // 1. SECTION QUESTIONS & DETAILS
    // ═════════════════════════════════════════════════════════════════════════
    for (const qRow of s.questions) {
      const { question, response, state, photoIds } = qRow;

      // Top Header Dimensions
      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      const statusStr = state === 'ok' ? '[+]  SATISFACTORY' : state === 'bad' ? '!  OBSERVATION' : state === 'na' ? '-  N / A' : '[?]  PENDING';
      const badgeW = doc.pdf.getTextWidth(statusStr) + 8;
      const refW = doc.pdf.getTextWidth(question.ref) + 8;

      // Question Title: Full width across the card, identical to modern web UI!
      doc.pdf.setFont('helvetica', 'bold').setFontSize(9);
      const qLines = doc.pdf.splitTextToSize(question.text, CONTENT_W - 14) as string[];
      const qTitleH = qLines.length * 4.4;
      const qHeaderH = 13 + qTitleH + 3.5;

      // Remarks Block (if any)
      let remBoxH = 0;
      let remRichH = 0;
      const remText = response?.remarks?.trim() || '';
      if (remText) {
        remRichH = measureRichText(doc.pdf, remText, CONTENT_W - 24, { size: 8.2, lineGap: 4.2 });
        remBoxH = Math.max(remRichH + 11, 17);
      }

      // Deficiency Callout Box (if bad and ordinary vessel inspection)
      let defBoxH = 0;
      let caText = '';
      let caH = 0;
      if (state === 'bad' && isOrdinaryInspection) {
        caText = response?.correctiveAction ? `**Corrective:** ${response.correctiveAction}` : '**Corrective:** Immediate rectification required';
        caH = measureRichText(doc.pdf, caText, CONTENT_W - 22, { size: 7.8, lineGap: 4 });
        defBoxH = Math.max(caH + 13, 18);
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

      const mainCardH = qHeaderH + (remBoxH ? remBoxH + 4 : 0) + (defBoxH ? defBoxH + 4 : 0) + firstPhotoH + 4;

      // Ensure main card fits or start fresh page
      doc.ensure(mainCardH + 4);

      const cardY = doc.y;
      doc.roundedBox(MARGIN_LEFT, cardY, CONTENT_W, mainCardH, WHITE, BORDER, 2.5);

      // Row 1: Left [ Ref Pill ], Right [ Status Badge ]
      doc.setFill(NAVY);
      doc.pdf.roundedRect(MARGIN_LEFT + 6, cardY + 4.5, refW, 5.5, 1.2, 1.2, 'F');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      doc.setTextColor(WHITE);
      doc.pdf.text(question.ref, MARGIN_LEFT + 10, cardY + 8.3);

      const badgeX = PAGE_W - MARGIN_RIGHT - badgeW - 6;
      doc.statusBadge(state, badgeX, cardY + 4.5);

      // Row 2: Full-width Question Title
      doc.pdf.setFont('helvetica', 'bold').setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      let titleY = cardY + 14.2;
      for (let l = 0; l < qLines.length; l++) {
        doc.pdf.text(qLines[l], MARGIN_LEFT + 6, titleY);
        if (l < qLines.length - 1) titleY += 4.4;
      }

      // Hairline divider separating header from card content
      const divY = titleY + 3.2;
      doc.setDraw(BORDER, 0.25);
      doc.pdf.line(MARGIN_LEFT + 6, divY, PAGE_W - MARGIN_RIGHT - 6, divY);

      let innerY = divY + 4;

      // Remarks Block (if any)
      if (remBoxH > 0) {
        doc.roundedBox(MARGIN_LEFT + 6, innerY, CONTENT_W - 12, remBoxH, SLATE_BG, BORDER, 1.8);
        doc.pdf.setFont('helvetica', 'bold').setFontSize(6.8);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text('REMARKS', MARGIN_LEFT + 10, innerY + 5);

        renderRichText(doc.pdf, remText, MARGIN_LEFT + 10, innerY + 9.5, CONTENT_W - 20, {
          size: 8.2,
          lineGap: 4.2,
          color: TEXT_BODY,
        });

        innerY += remBoxH + 4;
      }

      // Deficiency Callout Box (if bad and ordinary vessel inspection)
      if (defBoxH > 0) {
        doc.roundedBox(MARGIN_LEFT + 6, innerY, CONTENT_W - 12, defBoxH, [254, 242, 242], [254, 202, 202], 2);

        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor([185, 28, 28]);
        doc.pdf.text('!  DEFICIENCY / ACTION REQUIRED', MARGIN_LEFT + 10, innerY + 5.5);

        const subY = innerY + 10.5;
        renderRichText(doc.pdf, caText, MARGIN_LEFT + 10, subY, CONTENT_W - 20, { size: 7.8, lineGap: 4, color: TEXT_DARK });

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
          const contHeaderH = 18;
          const contCardH = contHeaderH + chunkPhotosH + 4;

          doc.newPage();
          doc.sectionHeader(
            `Section ${sIdx + 1}: ${s.section.name}`,
            s.section.zone,
            `${question.ref} Photographs (Cont.)`
          );

          const contCardY = doc.y;
          doc.roundedBox(MARGIN_LEFT, contCardY, CONTENT_W, contCardH, WHITE, BORDER, 2.5);

          // Continuation Header: Row 1
          doc.setFill(NAVY);
          doc.pdf.roundedRect(MARGIN_LEFT + 6, contCardY + 4.5, refW, 5.5, 1.2, 1.2, 'F');
          doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
          doc.setTextColor(WHITE);
          doc.pdf.text(question.ref, MARGIN_LEFT + 10, contCardY + 8.3);

          doc.statusBadge(state, badgeX, contCardY + 4.5);

          // Continuation Header: Row 2
          doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
          doc.setTextColor(TEXT_DARK);
          const contTitle = `${question.text}  (Photographs Cont.)`;
          const contLines = doc.pdf.splitTextToSize(contTitle, CONTENT_W - 14) as string[];
          doc.pdf.text(contLines[0], MARGIN_LEFT + 6, contCardY + 14);

          // Hairline divider
          doc.setDraw(BORDER, 0.25);
          doc.pdf.line(MARGIN_LEFT + 6, contCardY + 16.5, PAGE_W - MARGIN_RIGHT - 6, contCardY + 16.5);

          let chunkY = contCardY + contHeaderH + 2;
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

    // ═════════════════════════════════════════════════════════════════════════
    // 2. SECTION OVERVIEW PHOTOGRAPHS
    // ═════════════════════════════════════════════════════════════════════════
    if (s.sectionPhotoIds.length > 0) {
      if (doc.y + 115 > PAGE_H - BOTTOM_MARGIN) {
        doc.newPage();
        doc.sectionHeader(
          `Section ${sIdx + 1}: ${s.section.name}`,
          s.section.zone || 'Overview',
          `${s.sectionPhotoIds.length} Section Overview Photographs`
        );
      }

      await renderPhotoGrid8(
        s.sectionPhotoIds,
        `Section ${sIdx + 1}: ${s.section.name}`,
        s.section.zone || 'Overview',
        'SECTION OVERVIEW PHOTOGRAPHS'
      );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3. SECTION OBSERVATIONS & FINDINGS (with observation images)
    // ═════════════════════════════════════════════════════════════════════════
    if (s.findings.length > 0) {
      for (let fIdx = 0; fIdx < s.findings.length; fIdx++) {
        await renderObservationCard(s.findings[fIdx], fIdx, s, sIdx, true);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONCLUSION & RECOMMENDATIONS (shown last) — Professional Layout
  // ═══════════════════════════════════════════════════════════════════════════
  doc.newPage();
  doc.sectionHeader('Conclusion & Recommendations', 'Survey Close-Out');

  const conclusionText = inspection.conclusion?.trim() || 'No concluding remarks or formal recommendations logged.';

  // Header context box
  const ctxBoxH = 18;
  doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, ctxBoxH, [13, 33, 56], NAVY, 2);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
  doc.setTextColor(WHITE);
  doc.pdf.text('SURVEY CONCLUSION', MARGIN_LEFT + 6, doc.y + 7.5);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
  doc.setTextColor([180, 220, 200]);
  const surveyDate = `${fmtDate(inspection.startDate)} – ${fmtDate(inspection.completionDate || inspection.startDate)}`;
  doc.pdf.text(`Survey Period: ${surveyDate}  ·  Auditor / Surveyor / Superintendent: ${inspection.inspector || '-'}`, MARGIN_LEFT + 6, doc.y + 13.5);
  doc.y += ctxBoxH + 5;

  // Conclusion text box with rich formatting (bullets, bold, headings, font styles)
  const conRichH = measureRichText(doc.pdf, conclusionText, CONTENT_W - 16, { size: 8.5, lineGap: 5 });
  const conBoxH = Math.max(conRichH + 18, 30);
  doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, conBoxH, SLATE_BG, BORDER, 2);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(NAVY);
  doc.pdf.text('CONCLUDING REMARKS', MARGIN_LEFT + 6, doc.y + 6.5);
  doc.setDraw(BORDER, 0.3);
  doc.pdf.line(MARGIN_LEFT + 6, doc.y + 8.5, PAGE_W - MARGIN_RIGHT - 6, doc.y + 8.5);

  renderRichText(doc.pdf, conclusionText, MARGIN_LEFT + 6, doc.y + 14, CONTENT_W - 16, {
    size: 8.5,
    lineGap: 5,
    color: TEXT_BODY,
    bulletColor: NAVY,
  });
  doc.y += conBoxH + 10;

  renderAppendix(true, 'Appendix');
  } // end of full / photo report

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
        : isObservationOnly
        ? ' |  VESSEL OBSERVATION REPORT'
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


































