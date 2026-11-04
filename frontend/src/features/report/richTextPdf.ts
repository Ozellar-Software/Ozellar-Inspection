import type { jsPDF } from 'jspdf';

export type SupportedFont = 'helvetica' | 'times' | 'courier';

export interface InlineToken {
  text: string;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  strike?: boolean;
  font?: SupportedFont;
}

export interface RichTextOptions {
  size?: number;
  lineGap?: number;
  font?: SupportedFont;
  color?: [number, number, number];
  bulletColor?: [number, number, number];
  dryRun?: boolean;
}

/**
 * Maps any web or system font family name to standard jsPDF supported fonts.
 */
export function mapToPdfFont(fontName: string): SupportedFont {
  const f = fontName.replace(/['"]/g, '').toLowerCase().trim();
  if (
    f.includes('times') ||
    f.includes('georgia') ||
    f.includes('garamond') ||
    f.includes('cambria') ||
    f.includes('palatino') ||
    f.includes('bookman') ||
    f.includes('serif')
  ) {
    return 'times';
  }
  if (
    f.includes('courier') ||
    f.includes('consolas') ||
    f.includes('monaco') ||
    f.includes('mono')
  ) {
    return 'courier';
  }
  return 'helvetica';
}

/**
 * Tokenize a single line of text for inline formatting:
 * **bold**, *italic*, <u>underline</u>, ~~strike~~, and [font:xxx]...[/font]
 */
export function parseInlineFormatting(
  text: string,
  defaultFont: SupportedFont = 'helvetica'
): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern =
    /(\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|\*[\s\S]+?\*|<b>[\s\S]+?<\/b>|<strong>[\s\S]+?<\/strong>|<i>[\s\S]+?<\/i>|<em>[\s\S]+?<\/em>|<u>[\s\S]+?<\/u>|~~[\s\S]+?~~|\[font:[^\]]+\][\s\S]+?\[\/font\])/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        text: text.substring(lastIndex, match.index),
        bold: false,
        italic: false,
        font: defaultFont,
      });
    }

    const raw = match[0];
    if (raw.startsWith('***') && raw.endsWith('***')) {
      tokens.push({
        text: raw.slice(3, -3),
        bold: true,
        italic: true,
        font: defaultFont,
      });
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push({
        text: raw.slice(2, -2),
        bold: true,
        italic: false,
        font: defaultFont,
      });
    } else if (raw.toLowerCase().startsWith('<b>') && raw.toLowerCase().endsWith('</b>')) {
      tokens.push({
        text: raw.slice(3, -4),
        bold: true,
        italic: false,
        font: defaultFont,
      });
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push({
        text: raw.slice(1, -1),
        bold: false,
        italic: true,
        font: defaultFont,
      });
    } else if (raw.toLowerCase().startsWith('<i>') && raw.toLowerCase().endsWith('</i>')) {
      tokens.push({
        text: raw.slice(3, -4),
        bold: false,
        italic: true,
        font: defaultFont,
      });
    } else if (raw.toLowerCase().startsWith('<u>') && raw.toLowerCase().endsWith('</u>')) {
      tokens.push({
        text: raw.slice(3, -4),
        bold: false,
        italic: false,
        underline: true,
        font: defaultFont,
      });
    } else if (raw.startsWith('~~') && raw.endsWith('~~')) {
      tokens.push({
        text: raw.slice(2, -2),
        bold: false,
        italic: false,
        strike: true,
        font: defaultFont,
      });
    } else if (raw.toLowerCase().startsWith('[font:')) {
      const fontMatch = raw.match(/^\[font:([^\]]+)\]([\s\S]+?)\[\/font\]/i);
      if (fontMatch) {
        const f = mapToPdfFont(fontMatch[1]);
        const inner = parseInlineFormatting(fontMatch[2], f);
        tokens.push(...inner);
      }
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      text: text.substring(lastIndex),
      bold: false,
      italic: false,
      font: defaultFont,
    });
  }

  return tokens;
}

/**
 * Normalizes rich HTML from WYSIWYG editors into line-based formatted text for jsPDF.
 */
export function htmlToPdfLines(rawText: string): string {
  if (!rawText) return '';
  if (!rawText.includes('<') && !rawText.includes('>')) return rawText;

  // Handle ordered lists by numbering each <li>
  let processed = rawText.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, listContent) => {
    let num = 1;
    return listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_2: string, item: string) => {
      return `\n${num++}. ${item.trim()}\n`;
    });
  });

  // Handle unordered lists with bullet symbol
  processed = processed.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, listContent) => {
    return listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_2: string, item: string) => {
      return `\n• ${item.trim()}\n`;
    });
  });

  // Convert line breaks and blocks
  processed = processed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<h2[^>]*>/gi, '## ')
    .replace(/<\/h2>/gi, '\n')
    .replace(/<h3[^>]*>/gi, '### ')
    .replace(/<\/h3>/gi, '\n')
    .replace(/<strong[^>]*>/gi, '<b>')
    .replace(/<\/strong>/gi, '</b>')
    .replace(/<em[^>]*>/gi, '<i>')
    .replace(/<\/em>/gi, '</i>')
    .replace(/<font\s+[^>]*face=["']([^"']+)["'][^>]*>([\s\S]*?)<\/font>/gi, '[font:$1]$2[/font]')
    .replace(/<span[^>]*style=["'][^"']*font-family:\s*([^;"']+)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '[font:$1]$2[/font]')
    .replace(/<p[^>]*style=["'][^"']*font-family:\s*([^;"']+)[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi, '[font:$1]$2[/font]\n')
    .replace(/<div[^>]*style=["'][^"']*font-family:\s*([^;"']+)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, '[font:$1]$2[/font]\n');

  // Strip any remaining unhandled HTML tags
  processed = processed.replace(/<(?!\/?(b|i|u)\b)[^>]+>/gi, '');

  // Decode common HTML entities
  processed = processed
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // Collapse excessive blank lines
  processed = processed.replace(/\n{3,}/g, '\n\n');

  return processed.trim();
}

/**
 * Render multi-line rich text with Word-style bullet types, numbered lists,
 * bold, italics, font tags, and wrapping into jsPDF.
 */
export function renderRichText(
  doc: jsPDF,
  rawText: string,
  startX: number,
  startY: number,
  maxWidth: number,
  options: RichTextOptions = {}
): number {
  if (!rawText || !rawText.trim()) return 0;

  const baseFont = options.font || 'helvetica';
  const baseSize = options.size || 8.5;
  const lineGap = options.lineGap || 4.6;
  const textColor = options.color || [51, 65, 85];
  const bulletColor = options.bulletColor || [16, 89, 53];
  const dryRun = !!options.dryRun;

  const normalizedText = htmlToPdfLines(rawText);
  const rawLines = normalizedText.split('\n');
  let curY = startY;

  for (let lIdx = 0; lIdx < rawLines.length; lIdx++) {
    const rawLine = rawLines[lIdx].trimEnd();

    // Blank line
    if (rawLine.trim() === '') {
      curY += lineGap * 0.7;
      continue;
    }

    let isBullet = false;
    let bulletSymbol = '•';
    let isNumbered = false;
    let numPrefix = '';
    let isHeading = false;
    let headingLevel = 0;
    let cleanLine = rawLine;

    // Supports Disc (•), Circle (○), Square (■), Checkbox (□), Diamond (◆), Arrow (➢, ➔, →), Check (✓), Dash (–, -)
    const bulletMatch = rawLine.match(/^(\s*)([•○■□◆➢➔→✓–\-\*])\s+(.*)$/);
    // Supports 1., 1), a., a), i., i)
    const numberMatch = rawLine.match(/^(\s*)(\d+[\.\)]|[a-zA-Z][\.\)]|[ivxlcdmIVXLCDM]+[\.\)])\s+(.*)$/);
    const headingMatch = rawLine.match(/^(#{1,3})\s+(.*)$/);

    let curFontSize = baseSize;
    let indent = 0;

    if (headingMatch) {
      isHeading = true;
      headingLevel = headingMatch[1].length;
      cleanLine = headingMatch[2];
      if (headingLevel === 1) curFontSize = baseSize + 2.5;
      else if (headingLevel === 2) curFontSize = baseSize + 1.5;
      else curFontSize = baseSize + 0.8;
      if (lIdx > 0) curY += 2;
    } else if (bulletMatch) {
      isBullet = true;
      bulletSymbol = bulletMatch[2];
      indent = 6.0;
      cleanLine = bulletMatch[3];
    } else if (numberMatch) {
      isNumbered = true;
      numPrefix = numberMatch[2];
      indent = 7.0;
      cleanLine = numberMatch[3];
    }

    const contentX = startX + indent;
    const contentW = maxWidth - indent;

    // Draw bullet or number
    if (!dryRun) {
      if (isBullet) {
        doc.setFillColor(bulletColor[0], bulletColor[1], bulletColor[2]);
        doc.setDrawColor(bulletColor[0], bulletColor[1], bulletColor[2]);
        doc.setTextColor(bulletColor[0], bulletColor[1], bulletColor[2]);

        const bulletCenterY = curY - curFontSize * 0.12;

        if (bulletSymbol === '•' || bulletSymbol === '*' || bulletSymbol === '-') {
          // Solid round disc
          doc.circle(startX + 1.8, bulletCenterY, 0.75, 'F');
        } else if (bulletSymbol === '○') {
          // Hollow circle
          doc.setLineWidth(0.3);
          doc.circle(startX + 1.8, bulletCenterY, 0.75, 'S');
        } else if (bulletSymbol === '■') {
          // Solid square
          doc.rect(startX + 1.1, bulletCenterY - 0.7, 1.4, 1.4, 'F');
        } else if (bulletSymbol === '□') {
          // Hollow square / checkbox
          doc.setLineWidth(0.3);
          doc.rect(startX + 1.1, bulletCenterY - 0.7, 1.4, 1.4, 'S');
        } else if (bulletSymbol === '✓') {
          // Checkmark
          doc.setFont('helvetica', 'bold').setFontSize(curFontSize);
          doc.text('✓', startX, curY);
        } else if (bulletSymbol === '➢' || bulletSymbol === '➔' || bulletSymbol === '→') {
          // Arrow pointer
          doc.setFont('helvetica', 'bold').setFontSize(curFontSize);
          doc.text('→', startX, curY);
        } else if (bulletSymbol === '◆') {
          // Diamond (draw clean diamond polygon)
          const dx = startX + 1.8;
          const dy = bulletCenterY;
          const r = 0.85;
          doc.triangle(dx, dy - r, dx - r, dy, dx + r, dy, 'F');
          doc.triangle(dx, dy + r, dx - r, dy, dx + r, dy, 'F');
        } else if (bulletSymbol === '–') {
          // En dash
          doc.setLineWidth(0.4);
          doc.line(startX + 0.8, bulletCenterY, startX + 2.8, bulletCenterY);
        }
      } else if (isNumbered) {
        doc.setFont(baseFont, 'bold').setFontSize(curFontSize);
        doc.setTextColor(bulletColor[0], bulletColor[1], bulletColor[2]);
        doc.text(numPrefix, startX, curY);
      }
    }

    // Parse inline formatting tokens
    const tokens = parseInlineFormatting(cleanLine, baseFont);

    // Break tokens into words
    const words: Array<{
      text: string;
      bold: boolean;
      italic: boolean;
      underline?: boolean;
      strike?: boolean;
      font: SupportedFont;
      isSpace: boolean;
    }> = [];

    for (const t of tokens) {
      const parts = t.text.split(/(\s+)/);
      for (const p of parts) {
        if (p.length > 0) {
          words.push({
            text: p,
            bold: t.bold || isHeading,
            italic: t.italic,
            underline: t.underline,
            strike: t.strike,
            font: t.font || baseFont,
            isSpace: /^\s+$/.test(p),
          });
        }
      }
    }

    let curX = contentX;
    doc.setFontSize(curFontSize);

    if (!dryRun) {
      if (isHeading) {
        doc.setTextColor(16, 89, 53);
      } else {
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      }
    }

    const effectiveLineGap = isHeading ? lineGap * 1.25 : lineGap;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const style =
        w.bold && w.italic
          ? 'bolditalic'
          : w.bold
          ? 'bold'
          : w.italic
          ? 'italic'
          : 'normal';

      doc.setFont(w.font, style);
      const wWidth = doc.getTextWidth(w.text);

      if (w.isSpace) {
        if (curX > contentX && curX + wWidth <= contentX + contentW) {
          curX += wWidth;
        }
        continue;
      }

      // Check wrapping
      if (curX > contentX && curX + wWidth > contentX + contentW) {
        curY += effectiveLineGap;
        curX = contentX;
      }

      if (!dryRun) {
        doc.text(w.text, curX, curY);
        if (w.underline) {
          doc.setLineWidth(0.25);
          doc.line(curX, curY + 0.35, curX + wWidth, curY + 0.35);
        }
        if (w.strike) {
          doc.setLineWidth(0.25);
          doc.line(curX, curY - curFontSize * 0.12, curX + wWidth, curY - curFontSize * 0.12);
        }
      }

      curX += wWidth;
    }

    curY += effectiveLineGap;
  }

  return curY - startY;
}

/**
 * Measure exact height needed for rich text without drawing.
 */
export function measureRichText(
  doc: jsPDF,
  rawText: string,
  maxWidth: number,
  options: RichTextOptions = {}
): number {
  return renderRichText(doc, rawText, 0, 0, maxWidth, {
    ...options,
    dryRun: true,
  });
}
