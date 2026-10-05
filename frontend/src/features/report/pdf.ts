import { jsPDF } from 'jspdf';
import { STATUS_LABELS, type ApprovalEvent, type VesselParticularKey } from '@ozellar/shared';
import { photoSrc } from '../../offline/photoQueue';
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
const NAVY: [number, number, number] = [11, 37, 69];         // #0B2545 Primary Deep Navy
const NAVY_LIGHT: [number, number, number] = [19, 64, 116];   // #134074 Secondary Navy
const TEAL: [number, number, number] = [10, 130, 138];        // #0A828A Maritime Teal Accent
const TEAL_TINT: [number, number, number] = [230, 244, 245];  // #E6F4F5 Light Teal
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
  if (!ms) return '—';
  const d = typeof ms === 'string' ? new Date(ms) : new Date(ms);
  if (isNaN(d.getTime())) return String(ms);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// High-Performance Image Loader & Optimizer
// ---------------------------------------------------------------------------
interface LoadedImage {
  dataUrl: string;
  w: number;
  h: number;
}

async function loadImage(photoId: string): Promise<LoadedImage | null> {
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

    // Right tags
    if (zone) {
      const zoneW = this.pdf.getTextWidth(zone.toUpperCase()) + 8;
      const zoneX = PAGE_W - MARGIN_RIGHT - zoneW - (stat ? 38 : 0);
      this.setFill(NAVY_LIGHT);
      this.pdf.roundedRect(zoneX, this.y + 3, zoneW, 7, 1.5, 1.5, 'F');
      this.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
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
    const config = state === 'ok' ? { ...STATUS_OK, label: 'SATISFACTORY', icon: '✓' }
      : state === 'bad' ? { ...STATUS_BAD, label: 'OBSERVATION', icon: '!' }
      : state === 'na' ? { ...STATUS_NA, label: 'N / A', icon: '—' }
      : { ...STATUS_PENDING, label: 'PENDING', icon: '○' };

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
    this.pdf.text(value || '—', x + labelW, y);
  }
}

// ---------------------------------------------------------------------------
// Main PDF Export Function
// ---------------------------------------------------------------------------
export async function generateInspectionPdf(data: ReportData): Promise<Blob> {
  const { inspection, vessel, sections = [], observations = [], stats, approvalHistory = [] } = data;
  const doc = new Doc();

  // Compute overall stats
  const totalQuestions = stats?.totalQuestions || 0;
  const satisfactory = stats?.satisfactory || 0;
  const obsCount = stats?.observations || 0;
  const photoCount = stats?.photoCount || 0;
  const compliancePct = totalQuestions > 0 ? Math.round((satisfactory / totalQuestions) * 100) : 100;

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 1: EXECUTIVE COVER PAGE
  // ═══════════════════════════════════════════════════════════════════════════

  // Top Navy Header Banner
  doc.setFill(NAVY);
  doc.pdf.rect(0, 0, PAGE_W, 36, 'F');
  doc.setFill(TEAL);
  doc.pdf.rect(0, 34, PAGE_W, 2, 'F');

  // Brand Titles
  doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
  doc.setTextColor([180, 215, 235]);
  doc.pdf.text('OZELLAR MARITIME FLEET SYSTEMS', MARGIN_LEFT, 14);

  doc.pdf.setFont('helvetica', 'bold').setFontSize(16.5);
  doc.setTextColor(WHITE);
  doc.pdf.text('VESSEL INSPECTION & CONDITION REPORT', MARGIN_LEFT, 23);

  doc.pdf.setFont('helvetica', 'normal').setFontSize(8);
  doc.setTextColor([180, 205, 225]);
  doc.pdf.text('OFFICIAL STATUTORY & TECHNICAL AUDIT RECORD', MARGIN_LEFT, 29);

  // Top Right Audit Grade Pill
  const auditPillW = 44;
  doc.setFill(NAVY_LIGHT);
  doc.setDraw([30, 80, 130]);
  doc.pdf.roundedRect(PAGE_W - MARGIN_RIGHT - auditPillW, 12, auditPillW, 14, 2, 2, 'FD');
  doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
  doc.setTextColor([220, 240, 255]);
  doc.pdf.text('AUDIT CERTIFIED', PAGE_W - MARGIN_RIGHT - auditPillW + 6, 17.5);
  doc.pdf.setFont('helvetica', 'normal').setFontSize(7);
  doc.setTextColor([170, 200, 225]);
  doc.pdf.text(`ISSUED: ${fmtDate(inspection.startDate || new Date().toISOString())}`, PAGE_W - MARGIN_RIGHT - auditPillW + 6, 22.5);

  // Hero Cover Image or Maritime Silhouette Banner
  const heroY = 42;
  const heroH = 74;
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

    // Decorative inner grid / accent line
    doc.setFill([10, 130, 138]);
    doc.pdf.rect(MARGIN_LEFT + 10, heroY + 12, 20, 1.5, 'F');

    doc.pdf.setFont('helvetica', 'bold').setFontSize(22);
    doc.setTextColor(WHITE);
    doc.pdf.text((inspection.vesselName || 'VESSEL INSPECTION').toUpperCase(), MARGIN_LEFT + 10, heroY + 26);

    doc.pdf.setFont('helvetica', 'normal').setFontSize(10.5);
    doc.setTextColor([180, 225, 235]);
    doc.pdf.text(`IMO: ${inspection.imo || 'NOT SPECIFIED'}   ·   TYPE: ${(inspection.vesselType || 'COMMERCIAL VESSEL').toUpperCase()}`, MARGIN_LEFT + 10, heroY + 36);

    doc.pdf.setFont('helvetica', 'normal').setFontSize(9);
    doc.setTextColor([150, 180, 205]);
    doc.pdf.text(`PORT: ${inspection.port || 'NOT SET'}   ·   SURVEY DATE: ${fmtDate(inspection.startDate)}`, MARGIN_LEFT + 10, heroY + 45);

    // Subtle nautical banner badge
    doc.setFill([20, 50, 80]);
    doc.pdf.roundedRect(MARGIN_LEFT + 10, heroY + 53, 58, 8, 2, 2, 'F');
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.setTextColor([120, 215, 225]);
    doc.pdf.text('OFFICIAL CONDITION SURVEY', MARGIN_LEFT + 13, heroY + 58.5);
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
  const vMeta = [inspection.imo && `IMO ${inspection.imo}`, inspection.vesselType, vessel?.particulars?.flag && `Flag: ${vessel.particulars.flag}`].filter(Boolean).join('  ·  ');
  doc.pdf.text(vMeta, MARGIN_LEFT + 8, vcardY + 18.5);

  // Right status pill
  const statusLabel = (STATUS_LABELS[inspection.status] || inspection.status).toUpperCase();
  const stState = inspection.status === 'approved' ? 'ok'
    : inspection.status === 'returned' ? 'bad'
    : inspection.status === 'in_progress' ? 'pending' : 'ok';
  const stColor = stState === 'ok' ? STATUS_OK : stState === 'bad' ? STATUS_BAD : STATUS_PENDING;

  doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
  const stText = `●  ${statusLabel}`;
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
  doc.kvLine('Survey Type', INSPECTION_TYPE_LABELS[inspection.inspectionType] || inspection.inspectionType, col1X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Port / Location', inspection.port || '—', col1X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Commenced', fmtDate(inspection.startDate), col1X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Completed', fmtDate(inspection.completionDate || inspection.startDate), col1X, rowY, 36);

  // Right Column
  const col2X = MARGIN_LEFT + 96;
  rowY = detailsY + 18;
  doc.kvLine('Lead Surveyor', inspection.inspector || '—', col2X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Company', inspection.company || 'Ozellar Marine', col2X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Checklist Scope', `${sections.length} Maritime Sections`, col2X, rowY, 36);
  rowY += 7.5;
  doc.kvLine('Report Ref', `VIR-${inspection.id.slice(0, 8).toUpperCase()}`, col2X, rowY, 36);

  // Executive Metric KPI Ribbon (4 Metric Cards)
  const kpiY = detailsY + detailsH + 6;
  const kpiH = 26;
  const kpiW = (CONTENT_W - 3 * 4) / 4; // 4 cards with 4mm gap

  const kpis = [
    { label: 'Total Audited', val: `${totalQuestions}`, sub: 'Checklist Items', color: NAVY },
    { label: 'Compliance', val: `${compliancePct}%`, sub: `${satisfactory} Satisfactory`, color: [16, 185, 129] as [number, number, number] },
    { label: 'Observations', val: `${obsCount}`, sub: obsCount > 0 ? 'Deficiencies Found' : 'Zero Deficiencies', color: (obsCount > 0 ? [239, 68, 68] : [16, 185, 129]) as [number, number, number] },
    { label: 'Visual Evidence', val: `${photoCount}`, sub: 'Photos Captured', color: TEAL },
  ];

  kpis.forEach((kpi, idx) => {
    const kx = MARGIN_LEFT + idx * (kpiW + 4);
    doc.roundedBox(kx, kpiY, kpiW, kpiH, WHITE, BORDER, 2.5);

    // Accent line at top of card
    doc.setFill(kpi.color);
    doc.pdf.rect(kx + 4, kpiY + 2.5, kpiW - 8, 1.2, 'F');

    // Value
    doc.pdf.setFont('helvetica', 'bold').setFontSize(14.5);
    doc.setTextColor(kpi.color);
    doc.pdf.text(kpi.val, kx + 5, kpiY + 12);

    // Label
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.setTextColor(TEXT_DARK);
    doc.pdf.text(kpi.label, kx + 5, kpiY + 18);

    // Subtitle
    doc.pdf.setFont('helvetica', 'normal').setFontSize(6.5);
    doc.setTextColor(TEXT_MUTED);
    doc.pdf.text(kpi.sub, kx + 5, kpiY + 22.5);
  });

  // Cover Footer Certification Box
  const certY = kpiY + kpiH + 6;
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
  // PAGE 2: EXECUTIVE SUMMARY & TECHNICAL PARTICULARS
  // ═══════════════════════════════════════════════════════════════════════════
  doc.newPage();

  doc.subSectionTitle('1. Executive Summary');

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
  doc.y += sumBoxH + 8;

  // Conclusion Block
  doc.subSectionTitle('2. Conclusion & Recommendations');
  const conclusionText = inspection.conclusion?.trim() || 'No concluding remarks or formal recommendations logged.';
  const conclusionLines = doc.pdf.splitTextToSize(conclusionText, CONTENT_W - 16) as string[];
  const conBoxH = Math.max(conclusionLines.length * 4.6 + 12, 22);

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

  // Vessel Technical Specifications Table
  doc.subSectionTitle('3. Vessel Technical Particulars');
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
  // PAGES 3+: SECTION EVALUATIONS & CHECKLIST DETAILS
  // ═══════════════════════════════════════════════════════════════════════════
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const s = sections[sIdx];
    if (s.section.photoOnly) continue;

    doc.newPage();
    doc.sectionHeader(
      `Section ${sIdx + 1}: ${s.section.name}`,
      s.section.zone,
      `${s.questions.length} Items Evaluated`
    );

    // Section Level Photos (if any)
    if (s.sectionPhotoIds.length > 0) {
      doc.ensure(40);
      doc.pdf.setFont('helvetica', 'bold').setFontSize(8.5);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text('SECTION OVERVIEW PHOTOGRAPHS', MARGIN_LEFT, doc.y + 4);
      doc.y += 8;

      const pW = (CONTENT_W - 6) / 2;
      const pH = 52;
      for (let pIdx = 0; pIdx < s.sectionPhotoIds.length; pIdx += 2) {
        doc.ensure(pH + 10);
        const id1 = s.sectionPhotoIds[pIdx];
        const id2 = s.sectionPhotoIds[pIdx + 1];

        const [img1, img2] = await Promise.all([loadImage(id1), id2 ? loadImage(id2) : Promise.resolve(null)]);

        if (img1) {
          doc.roundedBox(MARGIN_LEFT, doc.y, pW, pH, SLATE_BG, BORDER, 2);
          const sc = Math.min((pW - 4) / img1.w, (pH - 4) / img1.h);
          const iw = img1.w * sc, ih = img1.h * sc;
          doc.pdf.addImage(img1.dataUrl, 'JPEG', MARGIN_LEFT + (pW - iw) / 2, doc.y + (pH - ih) / 2, iw, ih);
        }
        if (img2) {
          const px2 = MARGIN_LEFT + pW + 6;
          doc.roundedBox(px2, doc.y, pW, pH, SLATE_BG, BORDER, 2);
          const sc = Math.min((pW - 4) / img2.w, (pH - 4) / img2.h);
          const iw = img2.w * sc, ih = img2.h * sc;
          doc.pdf.addImage(img2.dataUrl, 'JPEG', px2 + (pW - iw) / 2, doc.y + (pH - ih) / 2, iw, ih);
        }
        doc.y += pH + 8;
      }
    }

    // Questions List
    for (const qRow of s.questions) {
      const { question, response, state, photoIds } = qRow;

      // Estimate card height
      const qLines = doc.pdf.splitTextToSize(question.text, CONTENT_W - 48) as string[];
      let cardH = 12 + qLines.length * 4.2;

      if (response?.remarks?.trim()) {
        const remLines = doc.pdf.splitTextToSize(`Remarks: ${response.remarks}`, CONTENT_W - 16) as string[];
        cardH += remLines.length * 4 + 6;
      }

      if (state === 'bad') {
        cardH += 26; // Deficiency callout block
      }

      const photoRows = Math.ceil(photoIds.length / 2);
      if (photoRows > 0) {
        cardH += photoRows * 54 + 6;
      }

      // Ensure whole card fits or start fresh page
      doc.ensure(cardH + 4);

      const cardY = doc.y;
      doc.roundedBox(MARGIN_LEFT, cardY, CONTENT_W, cardH, WHITE, BORDER, 2.5);

      // Top Question Header
      // Ref Pill: e.g. [ HULL-01 ]
      const refW = doc.pdf.getTextWidth(question.ref) + 8;
      doc.setFill(NAVY);
      doc.pdf.roundedRect(MARGIN_LEFT + 6, cardY + 5, refW, 5.8, 1.2, 1.2, 'F');
      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      doc.setTextColor(WHITE);
      doc.pdf.text(question.ref, MARGIN_LEFT + 10, cardY + 9.1);

      // Status Badge on Right
      const badgeX = PAGE_W - MARGIN_RIGHT - 36;
      doc.statusBadge(state, badgeX, cardY + 5);

      // Question Text
      doc.pdf.setFont('helvetica', 'bold').setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      let textY = cardY + 9.1;
      const textX = MARGIN_LEFT + refW + 10;
      doc.pdf.text(qLines[0] || '', textX, textY);
      for (let l = 1; l < qLines.length; l++) {
        textY += 4.2;
        doc.pdf.text(qLines[l], MARGIN_LEFT + 6, textY);
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
        doc.pdf.text('⚠  DEFICIENCY / ACTION REQUIRED', MARGIN_LEFT + 12, innerY + 5);

        doc.pdf.setFont('helvetica', 'normal').setFontSize(7.8);
        doc.setTextColor(TEXT_DARK);
        const caText = response?.correctiveAction ? `Corrective: ${response.correctiveAction}` : 'Corrective: Immediate rectification required';
        const paText = response?.preventiveAction ? `Preventive: ${response.preventiveAction}` : 'Preventive: Review preventive maintenance routine';
        doc.pdf.text(doc.pdf.splitTextToSize(caText, CONTENT_W - 22) as string[], MARGIN_LEFT + 12, innerY + 10.5);
        doc.pdf.text(doc.pdf.splitTextToSize(paText, CONTENT_W - 22) as string[], MARGIN_LEFT + 12, innerY + 16.5);

        innerY += defBoxH + 4;
      }

      // Question Photos Grid (2 per row)
      if (photoIds.length > 0) {
        const pW = (CONTENT_W - 18) / 2;
        const pH = 48;
        for (let pIdx = 0; pIdx < photoIds.length; pIdx += 2) {
          const id1 = photoIds[pIdx];
          const id2 = photoIds[pIdx + 1];

          const [img1, img2] = await Promise.all([loadImage(id1), id2 ? loadImage(id2) : Promise.resolve(null)]);

          if (img1) {
            const px1 = MARGIN_LEFT + 6;
            doc.roundedBox(px1, innerY, pW, pH, SLATE_BG, BORDER, 2);
            const sc = Math.min((pW - 4) / img1.w, (pH - 8) / img1.h);
            const iw = img1.w * sc, ih = img1.h * sc;
            doc.pdf.addImage(img1.dataUrl, 'JPEG', px1 + (pW - iw) / 2, innerY + (pH - 6 - ih) / 2, iw, ih);

            // Caption
            doc.pdf.setFont('helvetica', 'normal').setFontSize(6.5);
            doc.setTextColor(TEXT_MUTED);
            doc.pdf.text(`Photo ${pIdx + 1} · ${question.ref}`, px1 + 4, innerY + pH - 2);
          }

          if (img2) {
            const px2 = MARGIN_LEFT + 6 + pW + 6;
            doc.roundedBox(px2, innerY, pW, pH, SLATE_BG, BORDER, 2);
            const sc = Math.min((pW - 4) / img2.w, (pH - 8) / img2.h);
            const iw = img2.w * sc, ih = img2.h * sc;
            doc.pdf.addImage(img2.dataUrl, 'JPEG', px2 + (pW - iw) / 2, innerY + (pH - 6 - ih) / 2, iw, ih);

            // Caption
            doc.pdf.setFont('helvetica', 'normal').setFontSize(6.5);
            doc.setTextColor(TEXT_MUTED);
            doc.pdf.text(`Photo ${pIdx + 2} · ${question.ref}`, px2 + 4, innerY + pH - 2);
          }

          innerY += pH + 4;
        }
      }

      doc.y += cardH + 4;
    }

    // Section Extra Findings (if any)
    for (const fRow of s.findings) {
      doc.ensure(34);
      doc.roundedBox(MARGIN_LEFT, doc.y, CONTENT_W, 28, SLATE_BG, BORDER, 2.5);

      doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
      doc.setTextColor(NAVY);
      doc.pdf.text('ADDITIONAL OBSERVATION / FINDING', MARGIN_LEFT + 6, doc.y + 6);

      doc.statusBadge(fRow.state, PAGE_W - MARGIN_RIGHT - 36, doc.y + 4);

      doc.pdf.setFont('helvetica', 'normal').setFontSize(8.5);
      doc.setTextColor(TEXT_BODY);
      doc.pdf.text(doc.pdf.splitTextToSize(fRow.finding.text || '—', CONTENT_W - 16) as string[], MARGIN_LEFT + 6, doc.y + 13);

      if (fRow.finding.correctiveAction) {
        doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
        doc.setTextColor([185, 28, 28]);
        doc.pdf.text(`Action: ${fRow.finding.correctiveAction}`, MARGIN_LEFT + 6, doc.y + 22);
      }

      doc.y += 32;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFICIENCY SUMMARY TABLE (If Observations Exist)
  // ═══════════════════════════════════════════════════════════════════════════
  if (observations.length > 0) {
    doc.newPage();
    doc.sectionHeader('Deficiency Action Log & Remediation Plan', 'Action List', `${observations.length} Observations`);

    // Table Header
    doc.ensure(12);
    const thH = 8;
    doc.setFill(NAVY);
    doc.pdf.rect(MARGIN_LEFT, doc.y, CONTENT_W, thH, 'F');
    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.setTextColor(WHITE);
    doc.pdf.text('#', MARGIN_LEFT + 4, doc.y + 5.2);
    doc.pdf.text('SECTION & REF', MARGIN_LEFT + 14, doc.y + 5.2);
    doc.pdf.text('DEFICIENCY DESCRIPTION', MARGIN_LEFT + 64, doc.y + 5.2);
    doc.pdf.text('CORRECTIVE ACTION REQUIRED', MARGIN_LEFT + 124, doc.y + 5.2);
    doc.y += thH;

    observations.forEach((obs, idx) => {
      const descLines = doc.pdf.splitTextToSize(obs.text || obs.remarks || '—', 56) as string[];
      const caLines = doc.pdf.splitTextToSize(obs.correctiveAction || 'Immediate remediation required', 52) as string[];
      const rH = Math.max(descLines.length, caLines.length) * 4.2 + 6;

      doc.ensure(rH);
      const isAlt = idx % 2 === 1;
      if (isAlt) {
        doc.setFill(SLATE_BG);
        doc.pdf.rect(MARGIN_LEFT, doc.y, CONTENT_W, rH, 'F');
      }

      // Red left indicator
      doc.setFill([239, 68, 68]);
      doc.pdf.rect(MARGIN_LEFT, doc.y, 2, rH, 'F');

      doc.setDraw(BORDER);
      doc.pdf.line(MARGIN_LEFT, doc.y + rH, PAGE_W - MARGIN_RIGHT, doc.y + rH);

      // Cells
      doc.pdf.setFont('helvetica', 'bold').setFontSize(8);
      doc.setTextColor(NAVY);
      doc.pdf.text(String(idx + 1), MARGIN_LEFT + 4, doc.y + 5);

      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      doc.setTextColor(TEXT_DARK);
      doc.pdf.text(obs.ref || 'OBS', MARGIN_LEFT + 14, doc.y + 5);
      doc.pdf.setFont('helvetica', 'normal').setFontSize(6.8);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text(obs.sectionName.slice(0, 24), MARGIN_LEFT + 14, doc.y + 9);

      doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
      doc.setTextColor(TEXT_BODY);
      doc.pdf.text(descLines, MARGIN_LEFT + 64, doc.y + 5);
      doc.pdf.text(caLines, MARGIN_LEFT + 124, doc.y + 5);

      doc.y += rH;
    });

    doc.y += 10;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMAL AUDIT TRAIL & SIGN-OFF BLOCK
  // ═══════════════════════════════════════════════════════════════════════════
  doc.ensure(54);
  doc.subSectionTitle('4. Formal Verification & Approval Sign-Off');

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
  doc.pdf.text('✓  SUBMITTED & VERIFIED', MARGIN_LEFT + 8, sBoxY + 30.5);

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
  doc.pdf.text(tmEvent ? '✓  ENDORSED & APPROVED' : inspection.status === 'pending_tm' ? '○  AWAITING REVIEW' : '—  PENDING', bx2 + 8, sBoxY + 30.5);

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
  doc.pdf.text(dirEvent ? '✓  FINAL SIGN-OFF' : inspection.status === 'pending_director' ? '○  AWAITING SIGN-OFF' : '—  PENDING', bx3 + 8, sBoxY + 30.5);

  doc.y += signH + 10;

  // ═══════════════════════════════════════════════════════════════════════════
  // POST-PASS: DYNAMIC RUNNING HEADERS & FOOTERS (Page X of Y)
  // ═══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.pdf.getNumberOfPages();

  for (let pNum = 1; pNum <= totalPages; pNum++) {
    doc.pdf.setPage(pNum);

    if (pNum >= 2) {
      // Running Header (Pages 2+)
      doc.setFill(TEAL);
      doc.pdf.circle(MARGIN_LEFT + 1.2, 10.8, 1.2, 'F');

      doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
      doc.setTextColor(NAVY);
      doc.pdf.text('OZELLAR FLEET SYSTEMS', MARGIN_LEFT + 4.5, 11.5);

      doc.pdf.setFont('helvetica', 'normal').setFontSize(7.5);
      doc.setTextColor(TEXT_MUTED);
      doc.pdf.text(' |  VESSEL INSPECTION REPORT', MARGIN_LEFT + 44, 11.5);

      // Right Header
      const rightHead = `${inspection.vesselName || 'VESSEL'}${inspection.imo ? '  ·  IMO ' + inspection.imo : ''}`;
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
    doc.pdf.text('CONFIDENTIAL & PROPRIETARY  ·  OZELLAR MARINE INSPECTION PLATFORM', MARGIN_LEFT, footY + 1);

    doc.setTextColor(TEXT_FAINT);
    doc.pdf.text(`GENERATED: ${new Date().toLocaleDateString('en-GB')}`, PAGE_W / 2, footY + 1, { align: 'center' });

    doc.pdf.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.setTextColor(NAVY);
    doc.pdf.text(`Page ${pNum} of ${totalPages}`, PAGE_W - MARGIN_RIGHT, footY + 1, { align: 'right' });
  }

  return doc.pdf.output('blob');
}
