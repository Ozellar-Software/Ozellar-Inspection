import { describe, it, expect } from 'vitest';
import {
  normalizeSearchString,
  extractAcronym,
  matchSectionName,
  filterAndSortSectionsByName,
} from './sectionSearch';

describe('sectionSearch', () => {
  it('normalizes accents, symbols, and ampersands correctly', () => {
    expect(normalizeSearchString('Hull & Deck Structure')).toBe('hull and deck structure');
    expect(normalizeSearchString('Café / Galley')).toBe('cafe galley');
    expect(normalizeSearchString('  Co-2  System  ')).toBe('co 2 system');
  });

  it('extracts acronyms correctly', () => {
    expect(extractAcronym('Life Saving Appliances')).toBe('lsa');
    expect(extractAcronym('Main Engine & Generators')).toBe('meg');
    expect(extractAcronym('Navigation & Bridge Systems')).toBe('nbs');
  });

  it('matches exact and prefix queries', () => {
    expect(matchSectionName('Navigation & Bridge Systems', 'nav').matches).toBe(true);
    expect(matchSectionName('Navigation & Bridge Systems', 'Navigation').matches).toBe(true);
    expect(matchSectionName('Navigation & Bridge Systems', 'navigation & bridge systems').matches).toBe(true);
  });

  it('matches multi-word queries in any order', () => {
    expect(matchSectionName('Hull & Deck Structure', 'deck hull').matches).toBe(true);
    expect(matchSectionName('Main Engine & Generators', 'generators engine').matches).toBe(true);
  });

  it('handles ampersand and "and" interchangeably', () => {
    expect(matchSectionName('Hull & Deck Structure', 'hull and deck').matches).toBe(true);
    expect(matchSectionName('Hull and Deck Structure', 'hull & deck').matches).toBe(true);
  });

  it('matches maritime acronyms', () => {
    expect(matchSectionName('Life Saving Appliances', 'lsa').matches).toBe(true);
    expect(matchSectionName('Main Engine & Generators', 'meg').matches).toBe(true);
  });

  it('filters and ranks results by relevance', () => {
    const sections = [
      { name: 'Bridge Navigation Equipment' },
      { name: 'Navigation & Bridge Systems' },
      { name: 'Deck & Cargo Equipment' },
    ];

    const results = filterAndSortSectionsByName(sections, 'navigation');
    expect(results.length).toBe(2);
    // Starts with 'navigation' gets higher score than containing it later
    expect(results[0].name).toBe('Navigation & Bridge Systems');
    expect(results[1].name).toBe('Bridge Navigation Equipment');
  });

  it('does not match non-matching section names', () => {
    expect(matchSectionName('Life Saving Appliances', 'machinery').matches).toBe(false);
    expect(matchSectionName('Hull & Deck Structure', 'engine').matches).toBe(false);
  });
});
