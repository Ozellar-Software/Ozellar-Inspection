import { jsPDF } from 'jspdf';
import { STATUS_LABELS, type ApprovalEvent, type VesselParticularKey } from '@ozellar/shared';
import { photoSrc } from '../../offline/photoQueue';
import { db } from '../../offline/db';
import brandLogoSrc from '../../assets/ozellar-marine-global-logo.gif';
import { PARTICULAR_LABELS, PARTICULAR_GROUPS } from '../vessels/particulars';
import type { ReportData, SectionReport, Observation } from './reportData';

// ---------------------------------------------------------------------------
// Design System Constants (Maritime Executive Theme)
// ---------------------------------------------------------------------------
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_LEFT = 14;
const MARGIN_RIGHT = 14;
const TOP_MARGIN = 20;
const BOTTOM_MARGIN = 18;
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

async function loadImage(photoId?: string | null): Promise<LoadedImage | null> {
  if (!photoId) return null;
  try {
    const src = await photoSrc(photoId);
    if (!src) return null;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image load failed'));
      el.src = src;
    });

    if (!img.naturalWidth || !img.naturalHeight) return null;

    // Rescale to maximum 1200px to ensure fast PDF build and crisp 300DPI clarity
    const MAX_DIM = 1200;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
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
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), w, h };
  } catch {
    return null;
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
    const h = 13;
    // Dark navy full-width bar
    this.setFill(NAVY);
    this.pdf.rect(MARGIN_LEFT, this.y, CONTENT_W, h, 'F');

    // Left teal accent strip
    this.setFill(TEAL);
    this.pdf.rect(MARGIN_LEFT, this.y, 4, h, 'F');

    // Section title
    this.pdf.setFont('helvetica', 'bold').setFontSize(10.5);
    this.setTextColor(WHITE);
    this.pdf.text(title.toUpperCase(), MARGIN_LEFT + 7, this.y + 8.5);

    // Calculate stat width for correct zone spacing
    let statW = 0;
    if (stat) {
      this.pdf.setFont('helvetica', 'normal').setFontSize(8);
      statW = this.pdf.getTextWidth(stat);
    }

    // Right tags
    if (zone) {
      this.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      const zoneW = this.pdf.getTextWidth(zone.toUpperCase()) + 8;
      const zoneX = PAGE_W - MARGIN_RIGHT - zoneW - (stat ? statW + 6 : 0);
      this.setFill(NAVY_LIGHT);
      this.pdf.roundedRect(zoneX, this.y + 3, zoneW, 7, 1.5, 1.5, 'F');
      this.setTextColor([210, 235, 255]);
      this.pdf.text(zone.toUpperCase(), zoneX + 4, this.y + 7.5);
    }

    if (stat) {
      this.pdf.setFont('helvetica', 'normal').setFontSize(8);
      this.setTextColor([190, 210, 230]);
      this.pdf.text(stat, PAGE_W - MARGIN_RIGHT - 2, this.y + 8, { align: 'right' });
    }

    this.y += h + 6;
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
export async function generateInspectionPdf(data: ReportData & { reportType?: 'full' | 'photo_only' }): Promise<Blob> {
  const { inspection, vessel, sections = [], observations = [], stats, approvalHistory = [] } = data;
  const isPhotoOnly = data.reportType === 'photo_only';
  const photoSectionsOnly = sections.filter((s) => !!s.section.photoOnly);
  const doc = new Doc();

  const photoMap = new Map((data.photos ?? []).map((p) => [p.id, p]));
  const getPhotoDoc = async (id?: string | null) => {
    if (!id) return null;
    return photoMap.get(id) ?? await db.photos.get(id).catch(() => null);
  };

  const svgRingData = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg width="400" height="400" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ozellar-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f1592a" /><stop offset="100%" stopColor="#e04e22" /></linearGradient></defs><circle cx="50" cy="50" r="36" fill="none" stroke="url(#ozellar-grad)" strokeWidth="20" /></svg>');

  const [brandLogo] = await Promise.all([
    loadAssetImage(brandLogoSrc)
  ]);

    // ─── Professional Photo Card Renderer ──
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

    // Caption banner height
    const bannerH = desc ? 14 : 10;
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

    // 2. Image — fills full card width (cover-fit, edge-to-edge minus stripe)
    const imgLeft = px + (isDef ? 3 : 2.5);
    const imgAreaW = pW - (isDef ? 3 : 2.5);
    if (img) {
      // Use cover scale: fill the whole area, cropping if needed
      const sc = Math.max(imgAreaW / img.w, imgAreaH / img.h);
      const iw = img.w * sc;
      const ih = img.h * sc;
      // Clip to image area before drawing
      doc.pdf.saveGraphicsState?.();
      try {
        // jsPDF doesn't have clip API, so scale to fit instead (contain)
        const scFit = Math.min(imgAreaW / img.w, imgAreaH / img.h);
        const fw = img.w * scFit;
        const fh = img.h * scFit;
        const fx = imgLeft + (imgAreaW - fw) / 2;
        const fy = py + (imgAreaH - fh) / 2;
        doc.pdf.addImage(img.dataUrl, 'JPEG', fx, fy, fw, fh);
      } finally {
        doc.pdf.restoreGraphicsState?.();
      }
    } else {
      doc.setFill([240, 240, 240]);
      doc.pdf.rect(imgLeft, py, imgAreaW, imgAreaH, 'F');
      doc.pdf.setFont('helvetica', 'italic').setFontSize(7);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text('Photo unavailable', imgLeft + imgAreaW / 2, py + imgAreaH / 2, { align: 'center' });
    }

    // 3. Compact status icon badge (top-right, small pill)
    if (isDef) {
      // Small red pill: ▲ DEFECT
      const bW = 16, bH = 4.2;
      const bX = px + pW - bW - 2;
      const bY = py + 2;
      doc.setFill([220, 38, 38]);
      doc.pdf.roundedRect(bX, bY, bW, bH, 1, 1, 'F');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(5.5);
      doc.setTextColor(WHITE);
      doc.pdf.text('▲ DEFECT', bX + 1.5, bY + 3);
    } else {
      // Small green pill: ✓ OK
      const bW = 12, bH = 4.2;
      const bX = px + pW - bW - 2;
      const bY = py + 2;
      doc.setFill([6, 95, 70]);
      doc.pdf.roundedRect(bX, bY, bW, bH, 1, 1, 'F');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(5.5);
      doc.setTextColor(WHITE);
      doc.pdf.text('✓ OK', bX + 1.5, bY + 3);
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

    // Label line
    const labelY = capY + 3.8;
    doc.pdf.setFont('helvetica', 'bold').setFontSize(6.5);
    if (isDef) {
      doc.setTextColor([185, 28, 28]);
    } else {
      doc.setTextColor(NAVY);
    }
    doc.pdf.text(label, imgLeft + 2.5, labelY);

    // Description / remark line (highlighted for defects)
    if (desc) {
      const descY = capY + 7.6;
      const descMaxW = imgAreaW - 6;
      let dText = desc;
      doc.pdf.setFont('helvetica', isDef ? 'bold' : 'normal').setFontSize(6.0);
      if (doc.pdf.getTextWidth(dText) > descMaxW) {
        while (dText.length > 5 && doc.pdf.getTextWidth(dText + '…') > descMaxW) dText = dText.slice(0, -1);
        dText += '…';
      }
      doc.setTextColor(isDef ? [153, 27, 27] : TEXT_BODY);
      doc.pdf.text(dText, imgLeft + 2.5, descY);
    } else {
      const descY = capY + 7.6;
      doc.pdf.setFont('helvetica', 'italic').setFontSize(5.8);
      doc.setTextColor(TEXT_FAINT);
      doc.pdf.text(
        isDef ? 'Defect identified during survey' : 'Visual record logged',
        imgLeft + 2.5,
        descY
      );
    }
  };

  const renderPhotoGrid8 = async (
    photoIds: string[],
    sectionName: string,
    zone: string,
    gridTitle = 'SECTION PHOTOGRAPHS & VISUAL EVIDENCE'
  ) => {
    if (!photoIds.length) return;

    doc.ensure(30);
    doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(gridTitle, MARGIN_LEFT, doc.y + 4);
    doc.y += 8;

    const pW = (CONTENT_W - 6) / 2;
    const pH = 55.5;
    const rowH = 58;
    let photosOnCurrentPage = 0;

    for (let pIdx = 0; pIdx < photoIds.length; pIdx += 2) {
      if (photosOnCurrentPage >= 8 || doc.y + rowH > PAGE_H - BOTTOM_MARGIN) {
        doc.newPage();
        doc.sectionHeader(
          sectionName,
          zone || 'Visual Evidence',
          `Photographs (Cont.)`
        );
        doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text(gridTitle + ' (CONTINUED)', MARGIN_LEFT, doc.y + 4);
        doc.y += 8;
        photosOnCurrentPage = 0;
      }

      const id1 = photoIds[pIdx];
      const id2 = photoIds[pIdx + 1];

      const [img1, img2, photoDoc1, photoDoc2] = await Promise.all([
        loadImage(id1),
        id2 ? loadImage(id2) : Promise.resolve(null),
        getPhotoDoc(id1),
        getPhotoDoc(id2),
      ]);

      const curRowY = doc.y;
      if (img1) {
        drawPhotoCard(MARGIN_LEFT, curRowY, pW, pH, img1, photoDoc1, `PHOTO #${pIdx + 1}`);
        photosOnCurrentPage++;
      }
      if (img2) {
        drawPhotoCard(MARGIN_LEFT + pW + 6, curRowY, pW, pH, img2, photoDoc2, `PHOTO #${pIdx + 2}`);
        photosOnCurrentPage++;
      }

      doc.y += rowH;
    }
  };

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
  const heroY = 26;
  const heroH = PAGE_H * 0.52; // ~154 mm — dominates the top half of the page
  let coverImgLoaded: LoadedImage | null = null;
  if (inspection.coverPhotoId) {
    coverImgLoaded = await loadImage(inspection.coverPhotoId);
  }

  if (coverImgLoaded) {
    // Full-bleed: cover scale to fill entire width × heroH
    const sc = Math.max(PAGE_W / coverImgLoaded.w, heroH / coverImgLoaded.h);
    const iw = coverImgLoaded.w * sc;
    const ih = coverImgLoaded.h * sc;
    const ix = (PAGE_W - iw) / 2;
    const iy = heroY + (heroH - ih) / 2;
    doc.pdf.addImage(coverImgLoaded.dataUrl, 'JPEG', ix, iy, iw, ih);

    // Dark gradient overlay at bottom of image (simulate gradient with layered rects)
    const gradH = 52;
    const gradTop = heroY + heroH - gradH;
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const alpha = i / steps; // 0 → 1
      const darkness = Math.round(alpha * 180);
      doc.setFill([darkness > 130 ? 0 : 10, darkness > 130 ? 0 : 20, darkness > 130 ? 0 : 15] as [number, number, number]);
      doc.pdf.setGState(doc.pdf.GState({ opacity: alpha * 0.75 }));
      doc.pdf.rect(0, gradTop + (i * gradH) / steps, PAGE_W, gradH / steps + 0.5, 'F');
    }
    doc.pdf.setGState(doc.pdf.GState({ opacity: 1 }));

    // Vessel name & IMO text overlay at bottom of image
    const overlayTextY = heroY + heroH - 18;
    doc.pdf.setFont('helvetica', 'bold').setFontSize(16);
    doc.setTextColor(WHITE);
    doc.pdf.text((inspection.vesselName || 'VESSEL').toUpperCase(), MARGIN_LEFT, overlayTextY);

    doc.pdf.setFont('helvetica', 'normal').setFontSize(8.5);
    doc.setTextColor([200, 230, 215]);
    const metaStr = [
      inspection.imo && `IMO ${inspection.imo}`,
      inspection.vesselType,
      inspection.port && `Port: ${inspection.port}`,
    ].filter(Boolean).join('  ·  ');
    doc.pdf.text(metaStr, MARGIN_LEFT, overlayTextY + 7);

    // Orange accent bar at very bottom of image
    doc.setFill(TEAL);
    doc.pdf.rect(0, heroY + heroH - 2, PAGE_W, 2.5, 'F');
  } else {
    // Executive Maritime fallback banner (no cover photo)
    doc.setFill([13, 33, 56]);
    doc.pdf.rect(0, heroY, PAGE_W, heroH, 'F');
    doc.setFill([10, 50, 35]);
    doc.pdf.rect(0, heroY + heroH - 30, PAGE_W, 30, 'F');

    doc.setFill(TEAL);
    doc.pdf.rect(MARGIN_LEFT, heroY + 18, 24, 1.5, 'F');

    doc.pdf.setFont('helvetica', 'bold').setFontSize(22);
    doc.setTextColor(WHITE);
    doc.pdf.text((inspection.vesselName || 'VESSEL INSPECTION').toUpperCase(), MARGIN_LEFT, heroY + 32);

    doc.pdf.setFont('helvetica', 'normal').setFontSize(9.5);
    doc.setTextColor([180, 225, 200]);
    doc.pdf.text(`IMO: ${inspection.imo || 'NOT SPECIFIED'}   ·   TYPE: ${(inspection.vesselType || 'COMMERCIAL VESSEL').toUpperCase()}`, MARGIN_LEFT, heroY + 42);

    doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
    doc.setTextColor([150, 190, 165]);
    doc.pdf.text(`PORT: ${inspection.port || 'NOT SET'}   ·   SURVEY DATE: ${fmtDate(inspection.startDate)}`, MARGIN_LEFT, heroY + 50);

    doc.setFill(TEAL);
    doc.pdf.rect(0, heroY + heroH - 2, PAGE_W, 2.5, 'F');
  }

  // Vessel Identity & Status Banner — compact card below image
  const vcardY = heroY + heroH + 5;
  const vcardH = 20;
  doc.roundedBox(MARGIN_LEFT, vcardY, CONTENT_W, vcardH, WHITE, BORDER, 2.5);
  // Green left accent
  doc.setFill(NAVY);
  doc.pdf.rect(MARGIN_LEFT, vcardY, 3, vcardH, 'F');

  // Left vessel info
  doc.pdf.setFont('helvetica', 'bold').setFontSize(6.5);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('INSPECTED VESSEL', MARGIN_LEFT + 7, vcardY + 5.5);

  doc.pdf.setFont('helvetica', 'bold').setFontSize(13);
  doc.setTextColor(NAVY);
  doc.pdf.text(inspection.vesselName || 'Unnamed Vessel', MARGIN_LEFT + 7, vcardY + 12.5);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
  doc.setTextColor(TEXT_MUTED);
  const vMeta = [inspection.imo && `IMO ${inspection.imo}`, inspection.vesselType, vessel?.particulars?.flag && `Flag: ${vessel.particulars.flag}`].filter(Boolean).join('  |  ');
  doc.pdf.text(vMeta, MARGIN_LEFT + 7, vcardY + 17.5);

  // Right status pill
  const statusLabel = (STATUS_LABELS[inspection.status] || inspection.status).toUpperCase();
  const stState = inspection.status === 'approved' ? 'ok'
    : inspection.status === 'returned' ? 'bad'
    : inspection.status === 'in_progress' ? 'pending' : 'ok';
  const stColor = stState === 'ok' ? STATUS_OK : stState === 'bad' ? STATUS_BAD : STATUS_PENDING;

  doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
  const stText = `●  ${statusLabel}`;
  const stW = doc.pdf.getTextWidth(stText) + 10;
  const stX = PAGE_W - MARGIN_RIGHT - stW - 6;
  doc.roundedBox(stX, vcardY + 5.5, stW, 8, stColor.bg, stColor.border, 2);
  doc.setTextColor(stColor.text);
  doc.pdf.text(stText, stX + 5, vcardY + 11.3);

  // Inspection Particulars 2-Column Grid
  const detailsY = vcardY + vcardH + 4;
  const detailsH = 48;
  doc.roundedBox(MARGIN_LEFT, detailsY, CONTENT_W, detailsH, SLATE_BG, BORDER, 2.5);

  // Navy header strip inside card
  doc.setFill(NAVY);
  doc.pdf.rect(MARGIN_LEFT, detailsY, CONTENT_W, 7.5, 'F');
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, detailsY, 3, 7.5, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(WHITE);
  doc.pdf.text('AUDIT & SURVEY PARTICULARS', MARGIN_LEFT + 7, detailsY + 5.2);

  // Left Column
  const col1X = MARGIN_LEFT + 7;
  let rowY = detailsY + 15;
  doc.kvLine('Survey Type', isPhotoOnly ? 'Photographic Condition Survey' : (INSPECTION_TYPE_LABELS[inspection.inspectionType] || inspection.inspectionType), col1X, rowY, 34);
  rowY += 7;
  doc.kvLine('Port / Location', inspection.port || '-', col1X, rowY, 34);
  rowY += 7;
  doc.kvLine('Commenced', fmtDate(inspection.startDate), col1X, rowY, 34);
  rowY += 7;
  doc.kvLine('Completed', fmtDate(inspection.completionDate || inspection.startDate), col1X, rowY, 34);

  // Right Column
  const col2X = MARGIN_LEFT + 96;
  rowY = detailsY + 15;
  doc.kvLine('Lead Surveyor', inspection.inspector || '-', col2X, rowY, 34);
  rowY += 7;
  doc.kvLine('Report Ref', `VIR-${inspection.id.slice(0, 8).toUpperCase()}`, col2X, rowY, 34);
  rowY += 7;
  doc.kvLine('Vessel Type', inspection.vesselType || '-', col2X, rowY, 34);

  // Cover Footer Certification Box
  const certY = detailsY + detailsH + 4;
  const certH = 15;
  doc.roundedBox(MARGIN_LEFT, certY, CONTENT_W, certH, TEAL_TINT, TEAL, 2);
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, certY, 3, certH, 'F');

  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(TEAL);
  doc.pdf.text('VERIFICATION STATEMENT & QUALITY CERTIFICATION', MARGIN_LEFT + 6, certY + 5.5);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(6.5);
  doc.setTextColor(TEXT_BODY);
  const certMsg = 'This inspection was carried out in accordance with maritime safety regulations and approved company survey procedures. Findings and condition assessments represent accurate technical status at the time of inspection.';
  const certLines = doc.pdf.splitTextToSize(certMsg, CONTENT_W - 12) as string[];
  doc.pdf.text(certLines, MARGIN_LEFT + 6, certY + 9.5);

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 2: VESSEL TECHNICAL PARTICULARS
  // ═══════════════════════════════════════════════════════════════════════════
  doc.newPage();

  doc.sectionHeader('1. Vessel Technical Particulars', 'Technical Data');
  const p = vessel?.particulars ?? {};
  const hasParticulars = Object.values(p).some(Boolean);

  if (hasParticulars) {
    // Collect all populated particulars
    const rows: [string, string][] = [];
    for (const group of PARTICULAR_GROUPS) {
      for (const k of group.keys) {
        const val = p[k];
        if (val) rows.push([PARTICULAR_LABELS[k] || k, val]);
      }
    }

    // Professional 2-column table with header row and alternating rows
    const rowH = 7;
    const halfW = (CONTENT_W - 2) / 2;
    const numRows = Math.ceil(rows.length / 2);

    // Table column headers
    doc.ensure(rowH + 2);
    doc.setFill(NAVY_LIGHT);
    doc.pdf.rect(MARGIN_LEFT, doc.y, halfW, rowH, 'F');
    doc.pdf.rect(MARGIN_LEFT + halfW + 2, doc.y, halfW, rowH, 'F');
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
    doc.setTextColor(WHITE);
    doc.pdf.text('FIELD', MARGIN_LEFT + 4, doc.y + 4.8);
    doc.pdf.text('VALUE', MARGIN_LEFT + 44, doc.y + 4.8);
    doc.pdf.text('FIELD', MARGIN_LEFT + halfW + 6, doc.y + 4.8);
    doc.pdf.text('VALUE', MARGIN_LEFT + halfW + 46, doc.y + 4.8);
    doc.y += rowH;

    for (let r = 0; r < numRows; r++) {
      doc.ensure(rowH + 2);
      const isAlt = r % 2 === 1;

      // Left Column item
      const item1 = rows[r];
      if (item1) {
        doc.setFill(isAlt ? SLATE_BG : WHITE);
        doc.pdf.rect(MARGIN_LEFT, doc.y, halfW, rowH, 'F');
        doc.setDraw(BORDER, 0.2);
        doc.pdf.line(MARGIN_LEFT, doc.y + rowH, MARGIN_LEFT + halfW, doc.y + rowH);
        // Teal accent dot
        doc.setFill(TEAL);
        doc.pdf.circle(MARGIN_LEFT + 2.5, doc.y + rowH / 2, 0.8, 'F');
        doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text(item1[0], MARGIN_LEFT + 5, doc.y + 4.8);
        doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
        doc.setTextColor(TEXT_DARK);
        // Truncate value if too wide
        let v1 = item1[1];
        const v1MaxW = halfW - 44;
        while (v1.length > 4 && doc.pdf.getTextWidth(v1) > v1MaxW) v1 = v1.slice(0, -1);
        doc.pdf.text(v1, MARGIN_LEFT + 44, doc.y + 4.8);
      }

      // Right Column item
      const item2 = rows[r + numRows];
      if (item2) {
        const rx = MARGIN_LEFT + halfW + 2;
        doc.setFill(isAlt ? SLATE_BG : WHITE);
        doc.pdf.rect(rx, doc.y, halfW, rowH, 'F');
        doc.setDraw(BORDER, 0.2);
        doc.pdf.line(rx, doc.y + rowH, rx + halfW, doc.y + rowH);
        doc.setFill(TEAL);
        doc.pdf.circle(rx + 2.5, doc.y + rowH / 2, 0.8, 'F');
        doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text(item2[0], rx + 5, doc.y + 4.8);
        doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
        doc.setTextColor(TEXT_DARK);
        let v2 = item2[1];
        const v2MaxW = halfW - 44;
        while (v2.length > 4 && doc.pdf.getTextWidth(v2) > v2MaxW) v2 = v2.slice(0, -1);
        doc.pdf.text(v2, rx + 44, doc.y + 4.8);
      }

      doc.y += rowH;
    }
    doc.y += 4;
  } else {
    doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, 14, SLATE_BG, BORDER, 2);
    doc.pdf.setFont('helvetica', 'normal').setFontSize(8.5);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text('No technical particulars registered for this vessel in the database.', MARGIN_LEFT + 8, doc.y + 8.5);
    doc.y += 18;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 3: EXECUTIVE SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  doc.newPage();

  doc.sectionHeader('2. Executive Summary', 'Survey Overview');

  // KPI stat boxes
  const totalDef = observations.filter(o => !!(o as any).isDefect !== false).length;
  const totalSecs = sections.length;
  const totalPhotos = (data.photos || []).length;
  const kpiW = (CONTENT_W - 8) / 3;
  const kpiH = 20;
  const kpiBoxes = [
    { label: 'SECTIONS SURVEYED', value: String(totalSecs), color: NAVY },
    { label: 'OBSERVATIONS LOGGED', value: String(observations.length), color: [185, 28, 28] as [number, number, number] },
    { label: 'PHOTOGRAPHS CAPTURED', value: String(totalPhotos), color: NAVY_LIGHT },
  ];
  for (let ki = 0; ki < kpiBoxes.length; ki++) {
    const kx = MARGIN_LEFT + ki * (kpiW + 4);
    const ky = doc.y;
    doc.roundedBox(kx, ky, kpiW, kpiH, WHITE, BORDER, 2);
    doc.setFill(kpiBoxes[ki].color);
    doc.pdf.rect(kx, ky, kpiW, 4, 'F');
    doc.pdf.setFont('helvetica', 'bold').setFontSize(16);
    doc.setTextColor(kpiBoxes[ki].color);
    doc.pdf.text(kpiBoxes[ki].value, kx + kpiW / 2, ky + 13.5, { align: 'center' });
    doc.pdf.setFont('helvetica', 'bold').setFontSize(5.5);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(kpiBoxes[ki].label, kx + kpiW / 2, ky + 18.5, { align: 'center' });
  }
  doc.y += kpiH + 6;

  const summaryText = inspection.summary?.trim() || 'No executive summary remarks recorded by the surveyor.';
  const summaryLines = doc.pdf.splitTextToSize(summaryText, CONTENT_W - 20) as string[];
  const sumBoxH = Math.max(summaryLines.length * 4.8 + 16, 26);

  doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, sumBoxH, SLATE_BG, BORDER, 2);
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, doc.y, 3, sumBoxH, 'F');
  // Label inside box
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('SURVEYOR REMARKS', MARGIN_LEFT + 7, doc.y + 6);
  doc.setDraw(BORDER, 0.3);
  doc.pdf.line(MARGIN_LEFT + 7, doc.y + 8, PAGE_W - MARGIN_RIGHT - 7, doc.y + 8);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(8.5);
  doc.setTextColor(TEXT_BODY);
  let curSy = doc.y + 13;
  for (const line of summaryLines) {
    doc.pdf.text(line, MARGIN_LEFT + 7, curSy);
    curSy += 4.8;
  }
  doc.y += sumBoxH + 10;

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
        doc.ensure(20);
        const remLines = doc.pdf.splitTextToSize(s.section.remarks, CONTENT_W - 16) as string[];
        const remBoxH = Math.max(remLines.length * 4.4 + 15, 20);

        doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, remBoxH, SLATE_BG, BORDER, 2);
        doc.setFill(TEAL);
        doc.pdf.rect(MARGIN_LEFT, doc.y, 2.5, remBoxH, 'F');

        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text('REMARKS', MARGIN_LEFT + 7, doc.y + 6);

        doc.pdf.setFont('helvetica', 'normal').setFontSize(8.5);
        doc.setTextColor(TEXT_BODY);
        let remY = doc.y + 6 + (remLines.length > 0 ? 5 : 0);
        for (const line of remLines) {
          doc.pdf.text(line, MARGIN_LEFT + 7, remY);
          remY += 4.4;
        }
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
          const textLines = doc.pdf.splitTextToSize(fRow.finding.text || 'Observation logged', CONTENT_W - 16) as string[];
          let caLines: string[] = [];
          if (fRow.finding.correctiveAction) {
            caLines = doc.pdf.splitTextToSize(`Corrective Action: ${fRow.finding.correctiveAction}`, CONTENT_W - 16) as string[];
          }
          let paLines: string[] = [];
          if (fRow.finding.preventiveAction) {
            paLines = doc.pdf.splitTextToSize(`Preventive Action: ${fRow.finding.preventiveAction}`, CONTENT_W - 16) as string[];
          }

          const contentLinesCount = textLines.length + caLines.length + paLines.length;
          let cardH = Math.max(18, contentLinesCount * 4.2 + 10);

          const photoIds = fRow.photoIds || [];
          const photoRows = Math.ceil(photoIds.length / 2);
          if (photoRows > 0) {
            cardH += photoRows * 54 + 4;
          }

          doc.ensure(cardH + 4);
          const cardY = doc.y;
          doc.roundedBox(MARGIN_LEFT, cardY, CONTENT_W, cardH, WHITE, BORDER, 2);
          doc.setFill([239, 68, 68]);
          doc.pdf.rect(MARGIN_LEFT, cardY, 2.5, cardH, 'F');

          doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
          doc.setTextColor([185, 28, 28]);
          doc.pdf.text(`OBSERVATION ${fIdx + 1} • ${s.section.name.toUpperCase()}`, MARGIN_LEFT + 8, cardY + 5.5);

          let curY = cardY + 11;
          doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
          doc.setTextColor(TEXT_DARK);
          doc.pdf.text(textLines, MARGIN_LEFT + 8, curY);
          curY += textLines.length * 4.2;

          if (caLines.length > 0) {
            doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
            doc.setTextColor([185, 28, 28]);
            doc.pdf.text(caLines, MARGIN_LEFT + 8, curY);
            curY += caLines.length * 4.2;
          }

          if (paLines.length > 0) {
            doc.pdf.setFont('helvetica', 'italic').setFontSize(7.5);
            doc.setTextColor(TEXT_MUTED);
            doc.pdf.text(paLines, MARGIN_LEFT + 8, curY);
            curY += paLines.length * 4.2;
          }

          if (photoIds.length > 0) {
            curY += 2;
            if (photoIds.length === 1) {
              const pW = CONTENT_W - 16;
              const pH = 68;
              const id1 = photoIds[0];
              const [img1, photoDoc1] = await Promise.all([loadImage(id1), getPhotoDoc(id1)]);
              if (img1) {
                drawPhotoCard(MARGIN_LEFT + 8, curY, pW, pH, img1, photoDoc1, `PHOTO #1 • OBS ${fIdx + 1}`);
              }
              curY += pH + 4;
            } else {
              const pW = (CONTENT_W - 22) / 2;
              const pH = 55.5;
              for (let pIdx = 0; pIdx < photoIds.length; pIdx += 2) {
                const id1 = photoIds[pIdx];
                const id2 = photoIds[pIdx + 1];

                const [img1, img2, photoDoc1, photoDoc2] = await Promise.all([
                  loadImage(id1),
                  id2 ? loadImage(id2) : Promise.resolve(null),
                  getPhotoDoc(id1),
                  getPhotoDoc(id2),
                ]);

                if (img1) {
                  drawPhotoCard(MARGIN_LEFT + 8, curY, pW, pH, img1, photoDoc1, `PHOTO #${pIdx + 1} • OBS ${fIdx + 1}`);
                }
                if (img2) {
                  drawPhotoCard(MARGIN_LEFT + 8 + pW + 6, curY, pW, pH, img2, photoDoc2, `PHOTO #${pIdx + 2} • OBS ${fIdx + 1}`);
                }

                curY += pH + 4;
              }
            }
          }

          doc.y += cardH + 4;
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
      let cardH = 12 + qLines.length * 4.2;

      if (response?.remarks?.trim()) {
        const remLines = doc.pdf.splitTextToSize(`Remarks: ${response.remarks}`, CONTENT_W - 16) as string[];
        cardH += remLines.length * 4 + 6;
      }

      if (state === 'bad') {
        cardH += 26; // Deficiency callout block
      }

      const photoRows = Math.ceil(photoIds.length / 2);
      if (photoIds.length === 1) {
        cardH += 72;
      } else if (photoRows > 0) {
        cardH += photoRows * 59 + 4;
      }

      // Ensure whole card fits or start fresh page
      doc.ensure(cardH + 4);

      const cardY = doc.y;
      doc.roundedBox(MARGIN_LEFT, cardY, CONTENT_W, cardH, WHITE, BORDER, 2.5);

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
        doc.pdf.setFont('helvetica', 'normal').setFontSize(8.5);
        doc.setTextColor(TEXT_BODY);
        const remLines = doc.pdf.splitTextToSize(`Remarks: ${response.remarks}`, CONTENT_W - 16) as string[];
        for (const rLine of remLines) {
          doc.pdf.text(rLine, MARGIN_LEFT + 6, innerY);
          innerY += 4;
        }
        innerY += 2;
      }

      // Deficiency Callout Box (if bad)
      if (state === 'bad') {
        const defBoxH = 22;
        doc.roundedBox(MARGIN_LEFT + 6, innerY, CONTENT_W - 12, defBoxH, [254, 242, 242], [254, 202, 202], 2);
        doc.setFill([239, 68, 68]);
        doc.pdf.rect(MARGIN_LEFT + 6, innerY, 2.5, defBoxH, 'F');

        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor([185, 28, 28]);
        doc.pdf.text('!  DEFICIENCY / ACTION REQUIRED', MARGIN_LEFT + 12, innerY + 5);

        doc.pdf.setFont('helvetica', 'normal').setFontSize(7.8);
        doc.setTextColor(TEXT_DARK);
        const caText = response?.correctiveAction ? `Corrective: ${response.correctiveAction}` : 'Corrective: Immediate rectification required';
        const paText = response?.preventiveAction ? `Preventive: ${response.preventiveAction}` : 'Preventive: Review preventive maintenance routine';
        doc.pdf.text(doc.pdf.splitTextToSize(caText, CONTENT_W - 22) as string[], MARGIN_LEFT + 12, innerY + 10.5);
        doc.pdf.text(doc.pdf.splitTextToSize(paText, CONTENT_W - 22) as string[], MARGIN_LEFT + 12, innerY + 16.5);

        innerY += defBoxH + 4;
      }

      // Question Photos (Big Scale: Full-width for single photo, 2-per-row grid for multiple)
      if (photoIds.length > 0) {
        if (photoIds.length === 1) {
          const pW = CONTENT_W - 12;
          const pH = 68;
          const id1 = photoIds[0];
          const [img1, qPhotoDoc1] = await Promise.all([
            loadImage(id1),
            getPhotoDoc(id1),
          ]);
          if (img1) {
            drawPhotoCard(MARGIN_LEFT + 6, innerY, pW, pH, img1, qPhotoDoc1, `PHOTO #1 • ${question.ref}`);
          }
          innerY += pH + 4;
        } else {
          const pW = (CONTENT_W - 18) / 2;
          const pH = 55.5;
          for (let pIdx = 0; pIdx < photoIds.length; pIdx += 2) {
            const id1 = photoIds[pIdx];
            const id2 = photoIds[pIdx + 1];

            const [img1, img2, qPhotoDoc1, qPhotoDoc2] = await Promise.all([
              loadImage(id1),
              id2 ? loadImage(id2) : Promise.resolve(null),
              getPhotoDoc(id1),
              getPhotoDoc(id2),
            ]);

            if (img1) {
              drawPhotoCard(MARGIN_LEFT + 6, innerY, pW, pH, img1, qPhotoDoc1, `PHOTO #${pIdx + 1} • ${question.ref}`);
            }
            if (img2) {
              drawPhotoCard(MARGIN_LEFT + 6 + pW + 6, innerY, pW, pH, img2, qPhotoDoc2, `PHOTO #${pIdx + 2} • ${question.ref}`);
            }

            innerY += pH + 4;
          }
        }
      }

      doc.y += cardH + 4;
    }

    // Section Observations (if any)
    for (let fIdx = 0; fIdx < s.findings.length; fIdx++) {
      const fRow = s.findings[fIdx];
      const photoIds = fRow.photoIds || [];
      const photoRows = Math.ceil(photoIds.length / 2);
      let cardH = 28;
      if (fRow.finding.correctiveAction) cardH += 6;
      if (photoRows > 0) cardH += photoRows * 50 + 4;

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

      if (photoIds.length > 0) {
        curY += 2;
        if (photoIds.length === 1) {
          const pW = CONTENT_W - 16;
          const pH = 68;
          const id1 = photoIds[0];
          const [img1, photoDoc1] = await Promise.all([loadImage(id1), getPhotoDoc(id1)]);
          if (img1) {
            drawPhotoCard(MARGIN_LEFT + 8, curY, pW, pH, img1, photoDoc1, `PHOTO #1 • OBS ${fIdx + 1}`);
          }
          curY += pH + 4;
        } else {
          const pW = (CONTENT_W - 22) / 2;
          const pH = 55.5;
          for (let pIdx = 0; pIdx < photoIds.length; pIdx += 2) {
            const id1 = photoIds[pIdx];
            const id2 = photoIds[pIdx + 1];

            const [img1, img2, photoDoc1, photoDoc2] = await Promise.all([
              loadImage(id1),
              id2 ? loadImage(id2) : Promise.resolve(null),
              getPhotoDoc(id1),
              getPhotoDoc(id2),
            ]);

            if (img1) {
              drawPhotoCard(MARGIN_LEFT + 8, curY, pW, pH, img1, photoDoc1, `PHOTO #${pIdx + 1} • OBS ${fIdx + 1}`);
            }
            if (img2) {
              drawPhotoCard(MARGIN_LEFT + 8 + pW + 6, curY, pW, pH, img2, photoDoc2, `PHOTO #${pIdx + 2} • OBS ${fIdx + 1}`);
            }

            curY += pH + 4;
          }
        }
      }

      doc.y += cardH + 4;
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

      const pW = (CONTENT_W - 6) / 2;
      const pH = 55.5;
    const rowH = 58;
      let photosOnCurrentPage = 0;

      for (let pIdx = 0; pIdx < evidencePhotos.length; pIdx += 2) {
        if (photosOnCurrentPage >= 8 || doc.y + rowH > PAGE_H - BOTTOM_MARGIN) {
          doc.newPage();
          doc.sectionHeader(
            'Deficiency & Observation Visual Evidence',
            'Visual Evidence',
            'Photographs (Cont.)'
          );
          doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
          doc.setTextColor(TEXT_MUTED);
          doc.pdf.text('DEFICIENCY & OBSERVATION VISUAL EVIDENCE (CONTINUED)', MARGIN_LEFT, doc.y + 4);
          doc.y += 8;
          photosOnCurrentPage = 0;
        }

        const item1 = evidencePhotos[pIdx];
        const item2 = evidencePhotos[pIdx + 1];

        const [img1, img2, photoDoc1, photoDoc2] = await Promise.all([
          loadImage(item1.photoId),
          item2 ? loadImage(item2.photoId) : Promise.resolve(null),
          getPhotoDoc(item1.photoId),
          item2 ? getPhotoDoc(item2.photoId) : Promise.resolve(null),
        ]);

        const curRowY = doc.y;
        if (img1) {
          const mergedDoc1 = {
            ...photoDoc1,
            isDefect: true,
            description: photoDoc1?.description || item1.desc,
          };
          drawPhotoCard(MARGIN_LEFT, curRowY, pW, pH, img1, mergedDoc1, item1.label);
          photosOnCurrentPage++;
        }
        if (img2 && item2) {
          const mergedDoc2 = {
            ...photoDoc2,
            isDefect: true,
            description: photoDoc2?.description || item2.desc,
          };
          drawPhotoCard(MARGIN_LEFT + pW + 6, curRowY, pW, pH, img2, mergedDoc2, item2.label);
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

  // Split into individual recommendation lines for bullet-point display
  const rawConclusion = doc.pdf.splitTextToSize(conclusionText, CONTENT_W - 24) as string[];

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

  // Conclusion text box
  const conBoxH = Math.max(rawConclusion.length * 5 + 18, 30);
  doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, conBoxH, SLATE_BG, BORDER, 2);
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, doc.y, 3, conBoxH, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('CONCLUDING REMARKS', MARGIN_LEFT + 7, doc.y + 6.5);
  doc.setDraw(BORDER, 0.3);
  doc.pdf.line(MARGIN_LEFT + 7, doc.y + 8.5, PAGE_W - MARGIN_RIGHT - 7, doc.y + 8.5);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(8.5);
  doc.setTextColor(TEXT_BODY);
  let curCy = doc.y + 14;
  for (const line of rawConclusion) {
    doc.pdf.text(line, MARGIN_LEFT + 7, curCy);
    curCy += 5;
  }
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

  return doc.pdf.output('blob');
}


































