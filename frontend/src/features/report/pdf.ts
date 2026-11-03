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

    // ─── High-Impact Professional Photo Card Renderer (Defect vs Normal UI - Big Scale) ──
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

    // 1. Outer Card Container
    if (isDef) {
      // DEFECT: High-visibility crimson border and soft tinted background
      doc.roundedBox(px, py, pW, pH, [255, 245, 245], [220, 38, 38], 2);
      // Solid crimson left accent stripe
      doc.setFill([220, 38, 38]);
      doc.pdf.rect(px, py, 3.5, pH, 'F');
    } else {
      // NORMAL: Crisp executive slate surface and subtle border
      doc.roundedBox(px, py, pW, pH, SLATE_BG, BORDER_DARK, 2);
      // Subtle navy left accent stripe
      doc.setFill(NAVY);
      doc.pdf.rect(px, py, 2.5, pH, 'F');
    }

    // 2. Image Viewport (Big Scale: fills upper area of card with minimal margin)
    const bannerH = 10;
    const imgAreaH = pH - bannerH;
    if (img) {
      const maxW = pW - 4;
      const maxH = imgAreaH - 2;
      const sc = Math.min(maxW / img.w, maxH / img.h);
      const iw = img.w * sc, ih = img.h * sc;
      const imgX = px + 2 + (maxW - iw) / 2;
      const imgY = py + 1 + (maxH - ih) / 2;
      doc.pdf.addImage(img.dataUrl, 'JPEG', imgX, imgY, iw, ih);
    } else {
      doc.setFill(WHITE);
      doc.pdf.rect(px + 4, py + 4, pW - 8, imgAreaH - 6, 'F');
      doc.pdf.setFont('helvetica', 'italic').setFontSize(7);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text('Photo stored offline / unavailable', px + (pW / 2), py + (imgAreaH / 2), { align: 'center' });
    }

    // 3. Top-Right Status Pill Badge with Defect Warning Icon
    if (isDef) {
      const badgeW = 24;
      const badgeH = 5.2;
      const badgeX = px + pW - badgeW - 2.5;
      const badgeY = py + 2.5;

      // Dark Crimson Fill
      doc.setFill([220, 38, 38]);
      doc.pdf.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.2, 1.2, 'F');

      // Warning Triangle Icon (White polygon with inner exclamation point)
      const triX = badgeX + 3.5;
      const triY = badgeY + 1.1;
      doc.setFill(WHITE);
      doc.setDraw(WHITE);
      doc.pdf.triangle(triX, triY, triX - 1.9, triY + 3.0, triX + 1.9, triY + 3.0, 'FD');
      // Exclamation stem (crimson inside white triangle)
      doc.setFill([220, 38, 38]);
      doc.pdf.rect(triX - 0.25, triY + 1.0, 0.5, 1.0, 'F');
      doc.pdf.circle(triX, triY + 2.5, 0.22, 'F');

      // Badge Text
      doc.pdf.setFont('helvetica', 'bold').setFontSize(6.5);
      doc.setTextColor(WHITE);
      doc.pdf.text('DEFECT', badgeX + 6.8, badgeY + 3.8);
    } else {
      const badgeW = 22;
      const badgeH = 4.8;
      const badgeX = px + pW - badgeW - 2.5;
      const badgeY = py + 2.5;

      // Soft Emerald Tint Fill
      doc.setFill([236, 253, 245]);
      doc.pdf.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.2, 1.2, 'F');
      doc.setDraw([167, 243, 208]);
      doc.pdf.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.2, 1.2, 'S');

      // Badge Text
      doc.pdf.setFont('helvetica', 'bold').setFontSize(6.2);
      doc.setTextColor([6, 95, 70]);
      doc.pdf.text('[✓] NORMAL', badgeX + 2.5, badgeY + 3.5);
    }

    // 4. Bottom Sleek Caption & Description Banner (Height: 10mm)
    const capY = py + pH - bannerH;
    if (isDef) {
      doc.setFill([254, 242, 242]); // light red background
      doc.pdf.rect(px + 3.5, capY, pW - 4, bannerH - 0.5, 'F');
      doc.setDraw([252, 165, 165]); // soft red divider
      doc.pdf.line(px + 3.5, capY, px + pW - 0.5, capY);
    } else {
      doc.setFill(WHITE);
      doc.pdf.rect(px + 2.5, capY, pW - 3, bannerH - 0.5, 'F');
      doc.setDraw(BORDER);
      doc.pdf.line(px + 2.5, capY, px + pW - 0.5, capY);
    }

    // Line 1: Header Label (e.g. PHOTO #1) & Status Subtitle
    const labelY = capY + 3.8;
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.2);
    if (isDef) {
      doc.setTextColor([185, 28, 28]);
      doc.pdf.text(label, px + 5, labelY);

      doc.pdf.setFont('helvetica', 'bold').setFontSize(6.2);
      doc.setTextColor([220, 38, 38]);
      const labelW = doc.pdf.getTextWidth(label);
      doc.pdf.text('• DEFECT DETECTED', px + 6 + labelW, labelY);
    } else {
      doc.setTextColor(NAVY);
      doc.pdf.text(label, px + 5, labelY);

      doc.pdf.setFont('helvetica', 'normal').setFontSize(6.2);
      doc.setTextColor(TEXT_MUTED);
      const labelW = doc.pdf.getTextWidth(label);
      doc.pdf.text('• Satisfactory', px + 6 + labelW, labelY);
    }

    // Line 2: Clean Description Text
    const descY = capY + 7.6;
    const descMaxW = pW - 10;
    if (desc) {
      doc.pdf.setFont('helvetica', 'normal').setFontSize(6.4);
      doc.setTextColor(isDef ? [127, 29, 29] : TEXT_DARK);
      let dText = desc;
      if (doc.pdf.getTextWidth(dText) > descMaxW) {
        while (dText.length > 5 && doc.pdf.getTextWidth(dText + '...') > descMaxW) {
          dText = dText.slice(0, -1);
        }
        dText += '...';
      }
      doc.pdf.text(dText, px + 5, descY);
    } else {
      doc.pdf.setFont('helvetica', 'italic').setFontSize(6.0);
      doc.setTextColor(TEXT_FAINT);
      doc.pdf.text(
        isDef ? 'Defect identified during survey inspection' : 'Visual record logged for section survey',
        px + 5,
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

  // Hero Cover Image or Maritime Silhouette Banner
  const heroY = 30;
  const heroH = 62;
  let coverImgLoaded: LoadedImage | null = null;
  if (inspection.coverPhotoId) {
    coverImgLoaded = await loadImage(inspection.coverPhotoId);
  }

  if (coverImgLoaded) {
    // Render framed photo with subtle border
    doc.roundedBox(MARGIN_LEFT, heroY, CONTENT_W, heroH, SLATE_BG, BORDER, 3);
    const scale = Math.min(CONTENT_W / coverImgLoaded.w, heroH / coverImgLoaded.h);
    const imgW = coverImgLoaded.w * scale;
    const imgH = coverImgLoaded.h * scale;
    const imgX = MARGIN_LEFT + (CONTENT_W - imgW) / 2;
    const imgY = heroY + (heroH - imgH) / 2;
    doc.pdf.addImage(coverImgLoaded.dataUrl, 'JPEG', imgX, imgY, imgW, imgH);
  } else {
    // Executive Maritime Vector Card
    doc.roundedBox(MARGIN_LEFT, heroY, CONTENT_W, heroH, [13, 33, 56], [30, 65, 100], 3);

    doc.setFill([10, 130, 138]);
    doc.pdf.rect(MARGIN_LEFT + 10, heroY + 10, 20, 1.5, 'F');

    doc.pdf.setFont('helvetica', 'bold').setFontSize(19);
    doc.setTextColor(WHITE);
    doc.pdf.text((inspection.vesselName || 'VESSEL INSPECTION').toUpperCase(), MARGIN_LEFT + 10, heroY + 23);

    doc.pdf.setFont('helvetica', 'normal').setFontSize(9.5);
    doc.setTextColor([180, 225, 235]);
    doc.pdf.text(`IMO: ${inspection.imo || 'NOT SPECIFIED'}   |   TYPE: ${(inspection.vesselType || 'COMMERCIAL VESSEL').toUpperCase()}`, MARGIN_LEFT + 10, heroY + 32);

    doc.pdf.setFont('helvetica', 'normal').setFontSize(8.5);
    doc.setTextColor([150, 180, 205]);
    doc.pdf.text(`PORT: ${inspection.port || 'NOT SET'}   |   SURVEY DATE: ${fmtDate(inspection.startDate)}`, MARGIN_LEFT + 10, heroY + 40);

    doc.setFill([20, 50, 80]);
    doc.pdf.roundedRect(MARGIN_LEFT + 10, heroY + 47, 58, 8, 2, 2, 'F');
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.setTextColor([120, 215, 225]);
    doc.pdf.text('OFFICIAL CONDITION SURVEY', MARGIN_LEFT + 13, heroY + 52.5);
  }

  // Vessel Identity & Status Banner
  const vcardY = heroY + heroH + 6;
  const vcardH = 22;
  doc.roundedBox(MARGIN_LEFT, vcardY, CONTENT_W, vcardH, WHITE, BORDER, 2.5);

  // Left vessel info
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('INSPECTED VESSEL', MARGIN_LEFT + 8, vcardY + 6.5);

  doc.pdf.setFont('helvetica', 'bold').setFontSize(14.5);
  doc.setTextColor(NAVY);
  doc.pdf.text(inspection.vesselName || 'Unnamed Vessel', MARGIN_LEFT + 8, vcardY + 14);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  const vMeta = [inspection.imo && `IMO ${inspection.imo}`, inspection.vesselType, vessel?.particulars?.flag && `Flag: ${vessel.particulars.flag}`].filter(Boolean).join('  |  ');
  doc.pdf.text(vMeta, MARGIN_LEFT + 8, vcardY + 18.5);

  // Right status pill
  const statusLabel = (STATUS_LABELS[inspection.status] || inspection.status).toUpperCase();
  const stState = inspection.status === 'approved' ? 'ok'
    : inspection.status === 'returned' ? 'bad'
    : inspection.status === 'in_progress' ? 'pending' : 'ok';
  const stColor = stState === 'ok' ? STATUS_OK : stState === 'bad' ? STATUS_BAD : STATUS_PENDING;

  doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
  const stText = `*  ${statusLabel}`;
  const stW = doc.pdf.getTextWidth(stText) + 12;
  const stX = PAGE_W - MARGIN_RIGHT - stW - 8;
  doc.roundedBox(stX, vcardY + 6, stW, 8.5, stColor.bg, stColor.border, 2);
  doc.setTextColor(stColor.text);
  doc.pdf.text(stText, stX + 6, vcardY + 11.8);

  // Inspection Particulars 2-Column Grid
  const detailsY = vcardY + vcardH + 6;
  const detailsH = 50;
  doc.roundedBox(MARGIN_LEFT, detailsY, CONTENT_W, detailsH, SLATE_BG, BORDER, 2.5);

  // Section Header Line inside card
  doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
  doc.setTextColor(NAVY);
  doc.pdf.text('AUDIT & SURVEY PARTICULARS', MARGIN_LEFT + 8, detailsY + 8);
  doc.setDraw(BORDER);
  doc.pdf.line(MARGIN_LEFT + 8, detailsY + 11, PAGE_W - MARGIN_RIGHT - 8, detailsY + 11);

  // Left Column
  const col1X = MARGIN_LEFT + 8;
  let rowY = detailsY + 18;
  doc.kvLine('Survey Type', isPhotoOnly ? 'Photographic Condition Survey' : (INSPECTION_TYPE_LABELS[inspection.inspectionType] || inspection.inspectionType), col1X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Port / Location', inspection.port || '-', col1X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Commenced', fmtDate(inspection.startDate), col1X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Completed', fmtDate(inspection.completionDate || inspection.startDate), col1X, rowY, 36);

  // Right Column
  const col2X = MARGIN_LEFT + 96;
  rowY = detailsY + 18;
  doc.kvLine('Lead Surveyor', inspection.inspector || '-', col2X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Report Ref', `VIR-${inspection.id.slice(0, 8).toUpperCase()}`, col2X, rowY, 36);

  // Cover Footer Certification Box
  const certY = detailsY + detailsH + 6;
  const certH = 17;
  doc.roundedBox(MARGIN_LEFT, certY, CONTENT_W, certH, TEAL_TINT, [180, 220, 225], 2);

  doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
  doc.setTextColor(TEAL);
  doc.pdf.text('VERIFICATION STATEMENT & QUALITY CERTIFICATION', MARGIN_LEFT + 6, certY + 6);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
  doc.setTextColor(TEXT_BODY);
  const certMsg = 'This inspection was carried out in accordance with maritime safety regulations and approved company survey procedures. Findings and condition assessments represent accurate technical status at the time of inspection.';
  const certLines = doc.pdf.splitTextToSize(certMsg, CONTENT_W - 12) as string[];
  doc.pdf.text(certLines, MARGIN_LEFT + 6, certY + 10.5);

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 2: VESSEL TECHNICAL PARTICULARS
  // ═══════════════════════════════════════════════════════════════════════════
  doc.newPage();

  doc.subSectionTitle('1. Vessel Technical Particulars');
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

    // 2-Column Table of Particulars
    const rowH = 6.2;
    const halfW = (CONTENT_W - 4) / 2;
    const numRows = Math.ceil(rows.length / 2);

    for (let r = 0; r < numRows; r++) {
      doc.ensure(rowH + 2);
      const isAlt = r % 2 === 1;

      // Left Column item
      const item1 = rows[r];
      if (item1) {
        if (isAlt) doc.roundedBox(MARGIN_LEFT, doc.y, halfW, rowH, SLATE_BG, undefined, 1);
        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text(item1[0], MARGIN_LEFT + 4, doc.y + 4.3);
        doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
        doc.setTextColor(TEXT_DARK);
        doc.pdf.text(item1[1], MARGIN_LEFT + 42, doc.y + 4.3);
      }

      // Right Column item
      const item2 = rows[r + numRows];
      if (item2) {
        const rx = MARGIN_LEFT + halfW + 4;
        if (isAlt) doc.roundedBox(rx, doc.y, halfW, rowH, SLATE_BG, undefined, 1);
        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor(TEXT_MUTED);
        doc.pdf.text(item2[0], rx + 4, doc.y + 4.3);
        doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
        doc.setTextColor(TEXT_DARK);
        doc.pdf.text(item2[1], rx + 42, doc.y + 4.3);
      }

      doc.y += rowH;
    }
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

  doc.subSectionTitle('2. Executive Summary');

  const summaryText = inspection.summary?.trim() || 'No executive summary remarks recorded by the surveyor.';
  const summaryLines = doc.pdf.splitTextToSize(summaryText, CONTENT_W - 16) as string[];
  const sumBoxH = Math.max(summaryLines.length * 4.6 + 12, 22);

  doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, sumBoxH, SLATE_BG, BORDER, 2);
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT, doc.y, 2.5, sumBoxH, 'F');

  doc.pdf.setFont('helvetica', 'normal').setFontSize(8.8);
  doc.setTextColor(TEXT_BODY);
  let curSy = doc.y + 7;
  for (const line of summaryLines) {
    doc.pdf.text(line, MARGIN_LEFT + 8, curSy);
    curSy += 4.6;
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
  // FORMAL AUDIT TRAIL & SIGN-OFF BLOCK
  // ═══════════════════════════════════════════════════════════════════════════
  doc.newPage();
  doc.subSectionTitle('3. Formal Verification & Approval Sign-Off');

  const tmEvent = approvalHistory.find((e) => e.level === 'tm' && e.action === 'approved');
  const dirEvent = approvalHistory.find((e) => e.level === 'director' && e.action === 'approved');

  const signW = (CONTENT_W - 2 * 6) / 3;
  const signH = 38;
  const sBoxY = doc.y;

  // Box 1: Lead Inspector
  doc.roundedBox(MARGIN_LEFT, sBoxY, signW, signH, WHITE, BORDER, 2.5);
  doc.setFill(TEAL);
  doc.pdf.rect(MARGIN_LEFT + 4, sBoxY + 2.5, signW - 8, 1, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('LEAD SURVEYOR', MARGIN_LEFT + 5, sBoxY + 7);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(9);
  doc.setTextColor(NAVY);
  doc.pdf.text(inspection.inspector || 'Surveyor', MARGIN_LEFT + 5, sBoxY + 12);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
  doc.setTextColor(TEXT_BODY);
  doc.pdf.text(inspection.company || 'Survey Agency', MARGIN_LEFT + 5, sBoxY + 16.5);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text(`Date: ${fmtDate(inspection.startDate)}`, MARGIN_LEFT + 5, sBoxY + 22);

  // Status Badge
  doc.roundedBox(MARGIN_LEFT + 5, sBoxY + 26, signW - 10, 7, STATUS_OK.bg, STATUS_OK.border, 1.5);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(STATUS_OK.text);
  doc.pdf.text('[+]  SUBMITTED & VERIFIED', MARGIN_LEFT + 8, sBoxY + 30.5);

  // Box 2: Technical Manager
  const bx2 = MARGIN_LEFT + signW + 6;
  doc.roundedBox(bx2, sBoxY, signW, signH, WHITE, BORDER, 2.5);
  doc.setFill(NAVY_LIGHT);
  doc.pdf.rect(bx2 + 4, sBoxY + 2.5, signW - 8, 1, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('TECHNICAL MANAGER', bx2 + 5, sBoxY + 7);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(9);
  doc.setTextColor(NAVY);
  doc.pdf.text(tmEvent?.actorName || 'Technical Manager', bx2 + 5, sBoxY + 12);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
  doc.setTextColor(TEXT_BODY);
  doc.pdf.text(tmEvent?.actorDesignation || 'Technical Superintendent', bx2 + 5, sBoxY + 16.5);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text(`Date: ${fmtDate(tmEvent?.createdAt)}`, bx2 + 5, sBoxY + 22);

  const tmSt = tmEvent ? STATUS_OK : inspection.status === 'pending_tm' ? STATUS_PENDING : STATUS_NA;
  doc.roundedBox(bx2 + 5, sBoxY + 26, signW - 10, 7, tmSt.bg, tmSt.border, 1.5);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(tmSt.text);
  doc.pdf.text(tmEvent ? '[+]  ENDORSED & APPROVED' : inspection.status === 'pending_tm' ? '[?]  AWAITING REVIEW' : '-  PENDING', bx2 + 8, sBoxY + 30.5);

  // Box 3: Managing Director
  const bx3 = MARGIN_LEFT + 2 * (signW + 6);
  doc.roundedBox(bx3, sBoxY, signW, signH, WHITE, BORDER, 2.5);
  doc.setFill(NAVY);
  doc.pdf.rect(bx3 + 4, sBoxY + 2.5, signW - 8, 1, 'F');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text('MANAGING DIRECTOR', bx3 + 5, sBoxY + 7);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(9);
  doc.setTextColor(NAVY);
  doc.pdf.text(dirEvent?.actorName || 'Managing Director', bx3 + 5, sBoxY + 12);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
  doc.setTextColor(TEXT_BODY);
  doc.pdf.text(dirEvent?.actorDesignation || 'Director of Marine Safety', bx3 + 5, sBoxY + 16.5);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.pdf.text(`Date: ${fmtDate(dirEvent?.createdAt)}`, bx3 + 5, sBoxY + 22);

  const dirSt = dirEvent ? STATUS_OK : inspection.status === 'pending_director' ? STATUS_PENDING : STATUS_NA;
  doc.roundedBox(bx3 + 5, sBoxY + 26, signW - 10, 7, dirSt.bg, dirSt.border, 1.5);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7);
  doc.setTextColor(dirSt.text);
  doc.pdf.text(dirEvent ? '[+]  FINAL SIGN-OFF' : inspection.status === 'pending_director' ? '[?]  AWAITING SIGN-OFF' : '-  PENDING', bx3 + 8, sBoxY + 30.5);

  doc.y += signH + 10;

  // ═══════════════════════════════════════════════════════════════════════════
  // CONCLUSION & RECOMMENDATIONS (shown last)
  // ═══════════════════════════════════════════════════════════════════════════
  doc.subSectionTitle('4. Conclusion & Recommendations');
  const conclusionText = inspection.conclusion?.trim() || 'No concluding remarks or formal recommendations logged.';
  const conclusionLines = doc.pdf.splitTextToSize(conclusionText, CONTENT_W - 16) as string[];
  const conBoxH = Math.max(conclusionLines.length * 4.6 + 12, 22);

  doc.ensure(conBoxH + 4);
  doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, conBoxH, SLATE_BG, BORDER, 2);
  doc.setFill(NAVY);
  doc.pdf.rect(MARGIN_LEFT, doc.y, 2.5, conBoxH, 'F');

  doc.pdf.setFont('helvetica', 'normal').setFontSize(8.8);
  doc.setTextColor(TEXT_BODY);
  let curCy = doc.y + 7;
  for (const line of conclusionLines) {
    doc.pdf.text(line, MARGIN_LEFT + 8, curCy);
    curCy += 4.6;
  }
  doc.y += conBoxH + 10;

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


































