import { describe, it, expect } from 'vitest';

interface TestSection {
  id: string;
  name: string;
  zone: string;
  photoOnly: boolean;
  applicable: boolean;
  done: number;
  total: number;
  photoCount: number;
}

describe('Section Applicability & Filtering Logic', () => {
  const sections: TestSection[] = [
    { id: '1', name: 'Hull & Structure', zone: 'Exterior', photoOnly: false, applicable: true, done: 5, total: 5, photoCount: 2 },
    { id: '2', name: 'Main Engine', zone: 'Machinery', photoOnly: false, applicable: true, done: 2, total: 6, photoCount: 1 },
    { id: '3', name: 'Inert Gas System', zone: 'Safety', photoOnly: false, applicable: false, done: 0, total: 4, photoCount: 0 },
    { id: '4', name: 'Bow Thruster', zone: 'Machinery', photoOnly: false, applicable: false, done: 1, total: 3, photoCount: 1 },
    { id: '5', name: 'Deck Overview Photos', zone: 'Exterior', photoOnly: true, applicable: true, done: 0, total: 0, photoCount: 4 },
    { id: '6', name: 'Cargo Hold Photos', zone: 'Cargo', photoOnly: true, applicable: true, done: 0, total: 0, photoCount: 0 },
  ];

  it('correctly calculates overall progress ignoring Not Applicable sections', () => {
    // Only normal applicable sections count towards checklist questions
    const applicableNormalSections = sections.filter((s) => !s.photoOnly && s.applicable);
    const totalDone = applicableNormalSections.reduce((a, s) => a + s.done, 0);
    const totalItems = applicableNormalSections.reduce((a, s) => a + s.total, 0);
    const overallPct = totalItems ? Math.round((totalDone / totalItems) * 100) : 0;

    // Applicable normal sections:
    // Hull & Structure (5/5)
    // Main Engine (2/6)
    // Total done: 7, Total items: 11
    expect(totalDone).toBe(7);
    expect(totalItems).toBe(11);
    expect(overallPct).toBe(Math.round((7 / 11) * 100)); // 64%
  });

  it('filters sections by status: incomplete excludes Not Applicable sections', () => {
    const incompleteSections = sections.filter((s) => {
      if (s.photoOnly) return s.photoCount === 0;
      return s.applicable && s.total > 0 && s.done < s.total;
    });

    const incompleteIds = incompleteSections.map((s) => s.id);
    // Main Engine (2/6, applicable) and Cargo Hold Photos (photoCount = 0)
    expect(incompleteIds).toContain('2');
    expect(incompleteIds).toContain('6');
    // N/A sections should NOT be in incomplete
    expect(incompleteIds).not.toContain('3');
    expect(incompleteIds).not.toContain('4');
  });

  it('filters sections by status: completed only includes applicable completed sections', () => {
    const completedSections = sections.filter((s) => {
      if (s.photoOnly) return s.photoCount > 0;
      return s.applicable && (s.total === 0 || s.done >= s.total);
    });

    const completedIds = completedSections.map((s) => s.id);
    expect(completedIds).toContain('1'); // Hull & Structure (5/5)
    expect(completedIds).toContain('5'); // Deck Overview Photos (photoCount = 4)
    expect(completedIds).not.toContain('3'); // N/A
    expect(completedIds).not.toContain('4'); // N/A
  });

  it('filters sections by status: na only returns Not Applicable sections', () => {
    const naSections = sections.filter((s) => !s.photoOnly && !s.applicable);
    const naIds = naSections.map((s) => s.id);
    expect(naIds).toEqual(['3', '4']);
  });
});
