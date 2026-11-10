/**
 * Professional search logic for inspection section names.
 *
 * Features:
 * - Case-insensitive & accent/diacritic stripping (e.g. 'Café' matches 'cafe')
 * - Ampersand / 'and' synonym handling (e.g. 'hull & deck' === 'hull and deck')
 * - Punctuation stripping & whitespace normalization
 * - Multi-word conjunction (AND): all tokens must be present, order-independent (e.g. 'deck hull' matches 'Hull & Deck')
 * - Prefix & word-boundary intelligence (e.g. 'nav' matches 'Navigation')
 * - Maritime initialism/acronym matching (e.g. 'LSA' matches 'Life Saving Appliances')
 * - Relevance scoring & ranking
 */

export function normalizeSearchString(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')           // equate '&' and 'and'
    .replace(/[^a-z0-9]+/g, ' ')      // replace non-alphanumeric with space
    .trim()
    .replace(/\s+/g, ' ');           // collapse multi-spaces
}

/**
 * Extracts initials of words in a section name (e.g. 'Life Saving Appliances' -> 'lsa',
 * 'Main Engine & Generators' -> 'meg')
 */
export function extractAcronym(name: string): string {
  const normalized = normalizeSearchString(name);
  if (!normalized) return '';
  const stopWords = new Set(['and', 'or', 'of', 'for', 'the', 'in', 'on', 'at', 'to', 'a', 'an']);
  const words = normalized.split(' ').filter((w) => w.length > 0 && !stopWords.has(w));
  return words.map((w) => w[0]).join('');
}

export interface SectionMatchResult {
  matches: boolean;
  score: number;
}

export function matchSectionName(sectionName: string, rawQuery: string): SectionMatchResult {
  const query = normalizeSearchString(rawQuery);
  if (!query) {
    return { matches: true, score: 0 };
  }

  const target = normalizeSearchString(sectionName);
  if (!target) {
    return { matches: false, score: 0 };
  }

  // 1. Exact full name match
  if (target === query) {
    return { matches: true, score: 100 };
  }

  // 2. Starts with query
  if (target.startsWith(query)) {
    return { matches: true, score: 85 };
  }

  // 3. Acronym match (e.g. query 'lsa' -> 'Life Saving Appliances')
  const acronym = extractAcronym(sectionName);
  const compactQuery = query.replace(/\s+/g, '');
  if (acronym && (acronym === compactQuery || (compactQuery.length >= 2 && acronym.startsWith(compactQuery)))) {
    return { matches: true, score: 75 };
  }

  // 4. Token-based matching (every query token must match the section name)
  const queryTokens = query.split(' ').filter(Boolean);
  const targetWords = target.split(' ').filter(Boolean);

  let allTokensMatch = true;
  let allWordPrefixes = true;

  for (const token of queryTokens) {
    // Check if any target word starts with this token (word-boundary / prefix match)
    const prefixMatch = targetWords.some((w) => w.startsWith(token));
    if (prefixMatch) {
      continue;
    }
    allWordPrefixes = false;

    // Fall back to substring match within any word
    const subMatch = targetWords.some((w) => w.includes(token));
    if (!subMatch) {
      allTokensMatch = false;
      break;
    }
  }

  if (allTokensMatch) {
    if (allWordPrefixes) {
      // Bonus if all tokens match word boundaries (e.g. 'main gen' for 'Main Engine & Generators')
      return { matches: true, score: 65 };
    }
    // Substring token match
    return { matches: true, score: 45 };
  }

  // 5. Full query substring match (e.g. user typed a contiguous part of the phrase)
  if (target.includes(query)) {
    return { matches: true, score: 35 };
  }

  return { matches: false, score: 0 };
}

export function filterAndSortSectionsByName<T extends { name: string }>(
  sections: T[],
  rawQuery: string
): T[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return sections;
  }

  const scored: { item: T; score: number; originalIndex: number }[] = [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const result = matchSectionName(s.name, trimmed);
    if (result.matches) {
      scored.push({ item: s, score: result.score, originalIndex: i });
    }
  }

  // Sort by score descending; if score is equal, preserve original sequence
  scored.sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);

  return scored.map((s) => s.item);
}
