import { jsPDF } from 'jspdf';
import type { VesselParticularKey } from '@ozellar/shared';
import { STATUS_LABELS } from '@ozellar/shared';
import { photoSrc } from '../../offline/photoQueue';
import { PARTICULAR_LABELS } from '../vessels/particulars';
import type { ReportData } from './reportData';

const INSPECTION_TYPE_LABELS: Record<string, string> = { port: 'Port', remote: 'Remote', sailing: 'Sailing' };
const STATE_LABELS: Record<string, string> = { ok: 'Satisfactory', bad: 'Observation', na: 'N/A', pending: 'Pending' };

const PAGE_W = 210, PAGE_H = 297, MARGIN = 16, CONTENT_W = PAGE_W - MARGIN * 2;

/** Loads a photo (local blob or remote SAS URL) as a data URL image usable by jsPDF, or null if unavailable. */
async function loadImage(photoId: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
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
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

class Doc {
  pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  y = MARGIN;
  first = true;

  newPage() { this.pdf.addPage(); this.y = MARGIN; }
  ensure(h: number) { if (this.y + h > PAGE_H - MARGIN) this.newPage(); }

  title(text: string, size = 15) {
    this.ensure(10);
    this.pdf.setFont('helvetica', 'bold').setFontSize(size).setTextColor(20, 30, 40);
    this.pdf.text(text, MARGIN, this.y);
    this.y += size * 0.5;
    this.pdf.setDrawColor(210).line(MARGIN, this.y, PAGE_W - MARGIN, this.y);
    this.y += 6;
  }
  label(text: string) {
    this.ensure(6);
    this.pdf.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(90, 100, 110);
    this.pdf.text(text.toUpperCase(), MARGIN, this.y);
    this.y += 5;
  }
  para(text: string, opts: { size?: number; color?: number; bold?: boolean } = {}) {
    if (!text) return;
    const size = opts.size ?? 10.5;
    this.pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(size).setTextColor(opts.color ?? 30);
    const lines = this.pdf.splitTextToSize(text, CONTENT_W) as string[];
    for (const line of lines) {
      this.ensure(size * 0.5);
      this.pdf.text(line, MARGIN, this.y);
      this.y += size * 0.5;
    }
  }
  kv(k: string, v: string) {
    if (!v) return;
    this.ensure(6);
    this.pdf.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(70);
    this.pdf.text(`${k}:`, MARGIN, this.y);
    this.pdf.setFont('helvetica', 'normal').setTextColor(30);
    this.pdf.text(v, MARGIN + 42, this.y);
    this.y += 5.5;
  }
  gap(h = 4) { this.y += h; }
  async image(loaded: { dataUrl: string; w: number; h: number } | null, maxW: number, maxH: number) {
    if (!loaded) return;
    const scale = Math.min(maxW / loaded.w, maxH / loaded.h, 1) || maxH / loaded.h;
    const w = loaded.w * scale, h = loaded.h * scale;
    this.ensure(h + 2);
    this.pdf.addImage(loaded.dataUrl, 'JPEG', MARGIN, this.y, w, h);
    this.y += h + 3;
  }
}

export async function generateInspectionPdf(data: ReportData): Promise<Blob> {
  const { inspection, vessel, sections, observations } = data;
  const doc = new Doc();

  // Cover
  if (inspection.coverPhotoId) await doc.image(await loadImage(inspection.coverPhotoId), CONTENT_W, 90);
  doc.pdf.setFont('helvetica', 'bold').setFontSize(20).setTextColor(15, 25, 35);
  doc.pdf.text('Vessel Inspection Report', MARGIN, doc.y + 4);
  doc.y += 12;
  doc.pdf.setFont('helvetica', 'normal').setFontSize(13).setTextColor(50);
  doc.pdf.text(inspection.vesselName || 'Vessel', MARGIN, doc.y);
  doc.y += 10;
  doc.kv('IMO', inspection.imo);
  doc.kv('Vessel type', inspection.vesselType);
  doc.kv('Inspection type', INSPECTION_TYPE_LABELS[inspection.inspectionType] ?? inspection.inspectionType);
  doc.kv('Port', inspection.port);
  doc.kv('Start date', inspection.startDate ?? '');
  doc.kv('Completion date', inspection.completionDate ?? '');
  doc.kv('Inspector', inspection.inspector);
  doc.kv('Company', inspection.company);
  doc.kv('Status', STATUS_LABELS[inspection.status]);

  // Summary / conclusion
  doc.newPage();
  doc.title('Summary');
  doc.para(inspection.summary || '—');
  doc.gap(6);
  doc.title('Vessel particulars');
  if (vessel?.particulars && Object.values(vessel.particulars).some(Boolean)) {
    for (const key of Object.keys(PARTICULAR_LABELS) as VesselParticularKey[]) {
      const v = vessel.particulars[key];
      if (v) doc.kv(PARTICULAR_LABELS[key], v);
    }
  } else {
    doc.para('No particulars recorded for this vessel.', { color: 120 });
  }

  // Per-section detail
  for (const s of sections) {
    if (s.section.photoOnly) continue;
    doc.newPage();
    doc.title(s.section.name);
    doc.para(s.section.zone, { size: 9.5, color: 130 });
    doc.gap(2);

    for (const photoId of s.sectionPhotoIds) await doc.image(await loadImage(photoId), 70, 55);
    if (s.sectionPhotoIds.length) doc.gap(2);

    for (const row of s.questions) {
      doc.ensure(14);
      doc.pdf.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(30);
      doc.pdf.text(`${row.question.ref}  ${row.question.text}`.slice(0, 200), MARGIN, doc.y, { maxWidth: CONTENT_W - 30 });
      const tagColor: Record<string, [number, number, number]> = { ok: [46, 133, 85], bad: [190, 60, 55], na: [140, 140, 140], pending: [180, 150, 40] };
      const [r, g, b] = tagColor[row.state];
      doc.pdf.setTextColor(r, g, b).setFont('helvetica', 'bold').setFontSize(9);
      doc.pdf.text(STATE_LABELS[row.state], PAGE_W - MARGIN, doc.y, { align: 'right' });
      doc.y += 6;
      if (row.response?.remarks) doc.para(row.response.remarks, { size: 9.5, color: 60 });
      if (row.state === 'bad') {
        if (row.response?.correctiveAction) doc.para(`Corrective action: ${row.response.correctiveAction}`, { size: 9.5, color: 90 });
        if (row.response?.preventiveAction) doc.para(`Preventive action: ${row.response.preventiveAction}`, { size: 9.5, color: 90 });
      }
      for (const photoId of row.photoIds) await doc.image(await loadImage(photoId), 60, 48);
      doc.gap(3);
    }

    for (const row of s.findings) {
      doc.ensure(14);
      doc.pdf.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(30);
      doc.pdf.text('Additional observation', MARGIN, doc.y);
      const tagColor: Record<string, [number, number, number]> = { ok: [46, 133, 85], bad: [190, 60, 55], na: [140, 140, 140], pending: [180, 150, 40] };
      const [r, g, b] = tagColor[row.state];
      doc.pdf.setTextColor(r, g, b).setFont('helvetica', 'bold').setFontSize(9);
      doc.pdf.text(STATE_LABELS[row.state], PAGE_W - MARGIN, doc.y, { align: 'right' });
      doc.y += 6;
      doc.para(row.finding.text || '—', { size: 9.5, color: 60 });
      if (row.state === 'bad') {
        if (row.finding.correctiveAction) doc.para(`Corrective action: ${row.finding.correctiveAction}`, { size: 9.5, color: 90 });
        if (row.finding.preventiveAction) doc.para(`Preventive action: ${row.finding.preventiveAction}`, { size: 9.5, color: 90 });
      }
      for (const photoId of row.photoIds) await doc.image(await loadImage(photoId), 60, 48);
      doc.gap(3);
    }
  }

  // Observation list
  doc.newPage();
  doc.title('Observation list');
  if (!observations.length) {
    doc.para('No observations recorded.', { color: 120 });
  } else {
    for (const o of observations) {
      doc.ensure(12);
      doc.para(`${o.sectionName} — ${o.ref}`, { bold: true, size: 10 });
      doc.para(o.text, { size: 9.5, color: 60 });
      if (o.correctiveAction) doc.para(`Corrective: ${o.correctiveAction}`, { size: 9, color: 90 });
      if (o.preventiveAction) doc.para(`Preventive: ${o.preventiveAction}`, { size: 9, color: 90 });
      doc.gap(3);
    }
  }

  // Conclusion
  doc.newPage();
  doc.title('Conclusion');
  doc.para(inspection.conclusion || '—');

  return doc.pdf.output('blob');
}
