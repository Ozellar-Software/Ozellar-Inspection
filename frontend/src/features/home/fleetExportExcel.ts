import type { DueInfo } from '@ozellar/shared';

export interface FleetExportRow {
  vesselName: string;
  imo: string;
  vesselType: string;
  due: DueInfo;
  statusLabel: string;
  statusType: 'in_progress' | 'green' | 'yellow' | 'red' | 'uninspected';
  daysText: string;
  reportRef?: string;
  dateCommenced?: string;
  dateCompleted?: string;
  lastInspectionDate: string;
  lastInspectionRelative: string;
  typeLabel: string;
  portLabel: string;
  nextDueFormatted: string;
  cyclePct: number;
  inspectorName: string;
}

export interface FleetSummaryKPIs {
  total: number;
  green: number;
  yellow: number;
  red: number;
  compliancePct: number;
}

/**
 * Generates an executive, branded Excel (.xlsx) file with:
 * - Branded maritime title & metadata header: Ozellar Marine Fleet Due & Status Report
 * - Executive 4-KPI compliance statistics summary cards
 * - Detailed columns matching inspection details (Report Ref, Commenced, Completed, Surveyor)
 * - Modern colorful column headers with custom palettes
 * - Color-coded status cells (Green / Amber / Red / In Progress)
 * - Auto-sized columns and frozen header pane
 */
export async function exportFleetToExcel(
  rows: FleetExportRow[],
  kpis: FleetSummaryKPIs,
  filename?: string
) {
  const ExcelJSModule = await import('exceljs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (ExcelJSModule as any).default || ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ozellar Marine Global';
  workbook.lastModifiedBy = 'Ozellar Inspection System';
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet('Fleet Due & Status Report', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 8, showGridLines: true }],
  });

  // ── ROW 1-2: Executive Maritime Banner ──
  sheet.mergeCells('A1:M1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'OZELLAR MARINE · FLEET DUE & STATUS REPORT';
  titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0B2138' }, // Dark Navy
  };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 36;

  sheet.mergeCells('A2:M2');
  const subCell = sheet.getCell('A2');
  const todayFormatted = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  subCell.value = `Mandatory 6-Month Survey Cycle · Generated on ${todayFormatted}`;
  subCell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
  subCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF133352' }, // Soft Navy
  };
  subCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(2).height = 22;

  // Row 3: Blank separator
  sheet.getRow(3).height = 10;

  // ── ROW 4-5: Executive KPI Metric Block ──
  // Card 1: Total Fleet (Cols A-C)
  sheet.mergeCells('A4:C4');
  const kpi1Title = sheet.getCell('A4');
  kpi1Title.value = 'TOTAL MONITORED FLEET';
  kpi1Title.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF64748B' } };
  kpi1Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  kpi1Title.alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.mergeCells('A5:C5');
  const kpi1Val = sheet.getCell('A5');
  kpi1Val.value = `${kpis.total} Vessels (100% Active)`;
  kpi1Val.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF0F172A' } };
  kpi1Val.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  kpi1Val.alignment = { horizontal: 'center', vertical: 'middle' };

  // Card 2: On Track (Cols D-F)
  sheet.mergeCells('D4:F4');
  const kpi2Title = sheet.getCell('D4');
  kpi2Title.value = 'ON TRACK (< 5 MONTHS)';
  kpi2Title.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF15803D' } };
  kpi2Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
  kpi2Title.alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.mergeCells('D5:F5');
  const kpi2Val = sheet.getCell('D5');
  kpi2Val.value = `${kpis.green} Vessels (${kpis.total > 0 ? Math.round((kpis.green / kpis.total) * 100) : 0}%)`;
  kpi2Val.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF15803D' } };
  kpi2Val.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  kpi2Val.alignment = { horizontal: 'center', vertical: 'middle' };

  // Card 3: Due Soon (Cols G-I)
  sheet.mergeCells('G4:I4');
  const kpi3Title = sheet.getCell('G4');
  kpi3Title.value = 'DUE SOON (5–6 MONTHS)';
  kpi3Title.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB45309' } };
  kpi3Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  kpi3Title.alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.mergeCells('G5:I5');
  const kpi3Val = sheet.getCell('G5');
  kpi3Val.value = `${kpis.yellow} Vessels (${kpis.total > 0 ? Math.round((kpis.yellow / kpis.total) * 100) : 0}%)`;
  kpi3Val.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFB45309' } };
  kpi3Val.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
  kpi3Val.alignment = { horizontal: 'center', vertical: 'middle' };

  // Card 4: Overdue (Cols J-M)
  sheet.mergeCells('J4:M4');
  const kpi4Title = sheet.getCell('J4');
  kpi4Title.value = 'OVERDUE (6+ MONTHS)';
  kpi4Title.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
  kpi4Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
  kpi4Title.alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.mergeCells('J5:M5');
  const kpi4Val = sheet.getCell('J5');
  kpi4Val.value = `${kpis.red} Vessels (${kpis.total > 0 ? Math.round((kpis.red / kpis.total) * 100) : 0}%)`;
  kpi4Val.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFB91C1C' } };
  kpi4Val.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
  kpi4Val.alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.getRow(4).height = 18;
  sheet.getRow(5).height = 24;

  // Row 6: Blank separator
  sheet.getRow(6).height = 10;

  // ── ROW 7: MODERN, COLORFUL & UNIQUE HEADER ROW ──
  const headers = [
    { title: 'Vessel Name', width: 26, bg: 'FF1E293B' },          // Slate 800
    { title: 'IMO Number', width: 16, bg: 'FF334155' },           // Slate 700
    { title: 'Vessel Classification', width: 22, bg: 'FF475569' },// Slate 600
    { title: 'Statutory Status', width: 18, bg: 'FF0F172A' },      // Dark Ink
    { title: 'Compliance Countdown', width: 22, bg: 'FF1E1B4B' }, // Deep Indigo
    { title: 'Report Reference', width: 18, bg: 'FF0F766E' },     // Deep Teal
    { title: 'Survey Type', width: 20, bg: 'FF0369A1' },          // Sky Deep
    { title: 'Auditor / Surveyor', width: 24, bg: 'FF0D9488' },   // Teal
    { title: 'Port / Location', width: 22, bg: 'FF0284C7' },      // Sky Blue
    { title: 'Date Commenced', width: 18, bg: 'FF2563EB' },       // Blue
    { title: 'Date Completed', width: 18, bg: 'FF1D4ED8' },       // Royal Blue
    { title: 'Next Statutory Due', width: 20, bg: 'FF4338CA' },   // Indigo
    { title: '6-Mo Cycle Elapsed', width: 18, bg: 'FF3730A3' },   // Deep Indigo
  ];

  const headerRow = sheet.getRow(7);
  headerRow.height = 30;

  headers.forEach((h, idx) => {
    const colIdx = idx + 1;
    const cell = headerRow.getCell(colIdx);
    cell.value = h.title;
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: h.bg },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: idx === 0 || idx === 7 || idx === 8 ? 'left' : 'center',
      wrapText: false,
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
    sheet.getColumn(colIdx).width = h.width;
  });

  // ── ROW 8+: FORMATTED DATA ROWS WITH CUSTOM COLORS ──
  rows.forEach((r, idx) => {
    const rowNum = idx + 8;
    const row = sheet.getRow(rowNum);
    row.height = 24;

    const isZebra = idx % 2 === 1;
    const defaultRowBg = isZebra ? 'FFF8FAFC' : 'FFFFFFFF';

    // 1. Vessel Name
    const c1 = row.getCell(1);
    c1.value = r.vesselName;
    c1.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    c1.alignment = { vertical: 'middle', horizontal: 'left' };

    // 2. IMO
    const c2 = row.getCell(2);
    c2.value = r.imo ? `IMO ${r.imo}` : '—';
    c2.font = { name: 'Consolas', size: 9.5, color: { argb: 'FF334155' } };
    c2.alignment = { vertical: 'middle', horizontal: 'center' };

    // 3. Classification / Vessel Type
    const c3 = row.getCell(3);
    c3.value = r.vesselType || 'Fleet Vessel';
    c3.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF475569' } };
    c3.alignment = { vertical: 'middle', horizontal: 'center' };

    // 4. Statutory Status (Color-coded)
    const c4 = row.getCell(4);
    c4.value = r.statusLabel || r.due.label;
    if (r.statusType === 'in_progress') {
      c4.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0284C7' } };
      c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
    } else if (r.statusType === 'green') {
      c4.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF15803D' } };
      c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
    } else if (r.statusType === 'yellow') {
      c4.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFB45309' } };
      c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    } else if (r.statusType === 'red') {
      c4.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFB91C1C' } };
      c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    } else {
      // uninspected
      c4.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF64748B' } };
      c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    }
    c4.alignment = { vertical: 'middle', horizontal: 'center' };

    // 5. Countdown / Urgency
    const c5 = row.getCell(5);
    c5.value = r.daysText || '—';
    c5.font = {
      name: 'Segoe UI',
      size: 9.5,
      bold: r.statusType !== 'green' && r.statusType !== 'uninspected',
      color: {
        argb: r.statusType === 'red'
          ? 'FFDC2626'
          : r.statusType === 'yellow'
          ? 'FFD97706'
          : r.statusType === 'green'
          ? 'FF16A34A'
          : r.statusType === 'in_progress'
          ? 'FF0284C7'
          : 'FF64748B',
      },
    };
    c5.alignment = { vertical: 'middle', horizontal: 'center' };

    // 6. Report Reference (VIR-XXXX)
    const c6 = row.getCell(6);
    c6.value = r.reportRef || '—';
    c6.font = { name: 'Consolas', size: 9.5, bold: true, color: { argb: 'FF0F766E' } };
    c6.alignment = { vertical: 'middle', horizontal: 'center' };

    // 7. Survey Type
    const c7 = row.getCell(7);
    c7.value = r.typeLabel;
    c7.font = {
      name: 'Segoe UI',
      size: 9.5,
      bold: true,
      color: {
        argb: r.typeLabel === 'In Port' ? 'FF0284C7' : r.typeLabel === 'Remote' ? 'FF0D9488' : 'FF6366F1',
      },
    };
    c7.alignment = { vertical: 'middle', horizontal: 'center' };

    // 8. Auditor / Surveyor / Superintendent
    const c8 = row.getCell(8);
    c8.value = r.inspectorName || '—';
    c8.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F766E' } };
    c8.alignment = { vertical: 'middle', horizontal: 'left' };

    // 9. Port / Location
    const c9 = row.getCell(9);
    c9.value = r.portLabel;
    c9.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF334155' } };
    c9.alignment = { vertical: 'middle', horizontal: 'left' };

    // 10. Date Commenced
    const c10 = row.getCell(10);
    c10.value = r.dateCommenced || r.lastInspectionDate || '—';
    c10.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF0F172A' } };
    c10.alignment = { vertical: 'middle', horizontal: 'center' };

    // 11. Date Completed
    const c11 = row.getCell(11);
    c11.value = r.dateCompleted || (r.statusType === 'in_progress' ? 'Underway' : '—');
    c11.font = {
      name: 'Segoe UI',
      size: 9.5,
      bold: r.statusType === 'in_progress',
      color: { argb: r.statusType === 'in_progress' ? 'FF0284C7' : 'FF334155' },
    };
    c11.alignment = { vertical: 'middle', horizontal: 'center' };

    // 12. Next Statutory Due (+6 Calendar Months)
    const c12 = row.getCell(12);
    c12.value = r.nextDueFormatted;
    c12.font = {
      name: 'Segoe UI',
      size: 10,
      bold: true,
      color: {
        argb: r.statusType === 'red'
          ? 'FFB91C1C'
          : r.statusType === 'yellow'
          ? 'FFB45309'
          : r.statusType === 'green'
          ? 'FF15803D'
          : r.statusType === 'in_progress'
          ? 'FF0284C7'
          : 'FF64748B',
      },
    };
    c12.alignment = { vertical: 'middle', horizontal: 'center' };

    // 13. Cycle Progression %
    const c13 = row.getCell(13);
    c13.value = r.cyclePct > 0 ? `${r.cyclePct}% elapsed` : '—';
    c13.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF475569' } };
    c13.alignment = { vertical: 'middle', horizontal: 'center' };

    // Default borders & zebra fill for cells without custom fill
    for (let c = 1; c <= 13; c++) {
      const cell = row.getCell(c);
      if (c !== 4) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: defaultRowBg } };
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFF1F5F9' } },
        right: { style: 'thin', color: { argb: 'FFF1F5F9' } },
      };
    }
  });

  // Generate buffer and trigger browser download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = filename || `fleet-inspection-status-report-${dateStr}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
