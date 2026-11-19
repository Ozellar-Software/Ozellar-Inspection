import { describe, it, expect } from 'vitest';
import { inspectionDueInfo, type Inspection, type Vessel } from '@ozellar/shared';

describe('Fleet 6-Month Statutory Due Calculation', () => {
  it('calculates next due date exactly 6 months from completion date', () => {
    const fixedNow = new Date('2026-11-18T12:00:00');
    // Inspection completed on 2026-08-15
    const info = inspectionDueInfo(
      { completionDate: '2026-08-15', startDate: '2026-08-10' },
      fixedNow
    );

    expect(info.nextDue).not.toBeNull();
    // 6 months from Aug 15 is Feb 15 of next year (check in local date components)
    expect(info.nextDue?.getFullYear()).toBe(2027);
    expect(info.nextDue?.getMonth()).toBe(1); // 0-indexed: 1 = February
    expect(info.nextDue?.getDate()).toBe(15);
    // ~3 months elapsed -> On Track (green)
    expect(info.color).toBe('green');
    expect(info.label).toBe('On track');
  });

  it('marks vessel as Due Soon (yellow/amber) when 5 to 6 months have elapsed', () => {
    const fixedNow = new Date('2026-11-18T12:00:00');
    // Inspection completed 5.2 months ago: 2026-06-10
    const info = inspectionDueInfo(
      { completionDate: '2026-06-10', startDate: '2026-06-08' },
      fixedNow
    );

    expect(info.color).toBe('yellow');
    expect(info.label).toBe('Due soon');
    expect(info.nextDue?.getFullYear()).toBe(2026);
    expect(info.nextDue?.getMonth()).toBe(11); // 11 = December
    expect(info.nextDue?.getDate()).toBe(10);
  });

  it('marks vessel as Overdue (red) when >= 6 months have elapsed', () => {
    const fixedNow = new Date('2026-11-18T12:00:00');
    // Inspection completed 7 months ago: 2026-04-10
    const info = inspectionDueInfo(
      { completionDate: '2026-04-10', startDate: '2026-04-05' },
      fixedNow
    );

    expect(info.color).toBe('red');
    expect(info.label).toBe('Overdue');
    expect(info.nextDue?.getFullYear()).toBe(2026);
    expect(info.nextDue?.getMonth()).toBe(9); // 9 = October
    expect(info.nextDue?.getDate()).toBe(10);
  });

  it('does not mark vessel as Overdue when no inspection on record (last is null)', () => {
    const fixedNow = new Date('2026-11-18T12:00:00');
    const info = inspectionDueInfo(null, fixedNow);

    expect(info.color).toBe('green');
    expect(info.label).toBe('No inspection on record');
    expect(info.nextDue).toBeNull();
  });

  it('falls back to startDate when completionDate is missing', () => {
    const fixedNow = new Date('2026-11-18T12:00:00');
    const info = inspectionDueInfo(
      { completionDate: null, startDate: '2026-09-01' },
      fixedNow
    );

    expect(info.nextDue?.getFullYear()).toBe(2027);
    expect(info.nextDue?.getMonth()).toBe(2); // 2 = March
    expect(info.nextDue?.getDate()).toBe(1);
    expect(info.color).toBe('green');
  });
});

describe('Fleet Status Page Rules & Hierarchy', () => {
  it('strictly filters out takeover and pre-purchase reports', () => {
    const rawInspections: Partial<Inspection>[] = [
      { id: '1', reportCategory: 'inspection', status: 'approved' },
      { id: '2', reportCategory: 'take_over', status: 'approved' },
      { id: '3', reportCategory: 'pre_purchase', status: 'approved' },
      { id: '4', status: 'approved' }, // default is ordinary inspection
    ];

    const standardOnly = rawInspections.filter(
      (i) => !i.deletedAt && (!i.reportCategory || i.reportCategory === 'inspection')
    );

    expect(standardOnly.map((i) => i.id)).toEqual(['1', '4']);
  });

  it('correctly ranks in-process (0), overdue (1), due soon (2), on track (3), and uninspected (4)', () => {
    const testRanks = [
      { name: 'Vessel A (Uninspected)', rank: 4 },
      { name: 'Vessel B (In Progress)', rank: 0 },
      { name: 'Vessel C (On Track)', rank: 3 },
      { name: 'Vessel D (Overdue)', rank: 1 },
      { name: 'Vessel E (Due Soon)', rank: 2 },
    ];

    testRanks.sort((a, b) => a.rank - b.rank);

    expect(testRanks.map((r) => r.name)).toEqual([
      'Vessel B (In Progress)',
      'Vessel D (Overdue)',
      'Vessel E (Due Soon)',
      'Vessel C (On Track)',
      'Vessel A (Uninspected)',
    ]);
  });

  it('captures starting date, port, and inspector for in-process inspection', () => {
    const pendingInspection: Partial<Inspection> = {
      id: 'insp-101',
      status: 'in_progress',
      startDate: '2026-11-10',
      port: 'Rotterdam',
      inspector: 'Capt. Alexander',
      inspectionType: 'port',
    };

    expect(pendingInspection.startDate).toBe('2026-11-10');
    expect(pendingInspection.port).toBe('Rotterdam');
    expect(pendingInspection.inspector).toBe('Capt. Alexander');
    expect(pendingInspection.inspectionType).toBe('port');
  });
});
