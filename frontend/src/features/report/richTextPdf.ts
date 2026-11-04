import type { jsPDF } from 'jspdf';

export type SupportedFont = 'helvetica' | 'times' | 'courier';

export interface InlineToken {
  text: string;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
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
 * Tokenize a single line of text for inline formatting:
 * **bold**, *italic*, ***bold italic***, <b>bold</b>, <i>italic</i>, <u>underline</u>,
 * and [font:serif|mono|sans|times|courier|helvetica]...[/font]
 */
export function parseInlineFormatting(
  text: string,
  defaultFont: SupportedFont = 'helvetica'
): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern =
    /(\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|\*[\s\S]+?\*|<b>[\s\S]+?<\/b>|<i>[\s\S]+?<\/i>|<u>[\s\S]+?<\/u>|\[font:(serif|sans|mono|times|courier|helvetica)\][\s\S]+?\[\/font\])/gi;

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
    } else if (raw.toLowerCase().startsWith('[font:')) {
      const fontMatch = raw.match(
        /^\[font:(serif|sans|mono|times|courier|helvetica)\]([\s\S]+?)\[\/font\]/i
      );
      if (fontMatch) {
        let f: SupportedFont = defaultFont;
        const fontName = fontMatch[1].toLowerCase();
        if (fontName === 'serif' || fontName === 'times') f = 'times';
        else if (fontName === 'mono' || fontName === 'courier') f = 'courier';
        else if (fontName === 'sans' || fontName === 'helvetica') f = 'helvetica';

        // Recursively parse inner content inside font tag
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
 * Render multi-line rich text (with markdown headings, bullet lists,
 * numbered lists, bold, italics, font tags, and line wrapping) into a jsPDF document.
 * Returns the total height consumed in mm.
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

  const rawLines = rawText.split('\n');
  let curY = startY;

  for (let lIdx = 0; lIdx < rawLines.length; lIdx++) {
    const rawLine = rawLines[lIdx].trimEnd();

    // Empty blank line -> add paragraph spacing
    if (rawLine.trim() === '') {
      curY += lineGap * 0.7;
      continue;
    }

    let isBullet = false;
    let isNumbered = false;
    let numPrefix = '';
    let isHeading = false;
    let headingLevel = 0;
    let cleanLine = rawLine;

    const bulletMatch = rawLine.match(/^(\s*)([•\-\*])\s+(.*)$/);
    const numberMatch = rawLine.match(/^(\s*)(\d+[\.\)])\s+(.*)$/);
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
      indent = 5.5;
      cleanLine = bulletMatch[3];
    } else if (numberMatch) {
      isNumbered = true;
      numPrefix = numberMatch[2];
      indent = 6.5;
      cleanLine = numberMatch[3];
    }

    const contentX = startX + indent;
    const contentW = maxWidth - indent;

    // Draw bullet or number
    if (!dryRun) {
      if (isBullet) {
        doc.setFillColor(bulletColor[0], bulletColor[1], bulletColor[2]);
        doc.circle(startX + 1.8, curY - curFontSize * 0.12, 0.7, 'F');
      } else if (isNumbered) {
        doc.setFont(baseFont, 'bold').setFontSize(curFontSize);
        doc.setTextColor(bulletColor[0], bulletColor[1], bulletColor[2]);
        doc.text(numPrefix, startX, curY);
      }
    }

    // Parse inline tokens
    const tokens = parseInlineFormatting(cleanLine, baseFont);

    // Break tokens into words and whitespace
    const words: Array<{
      text: string;
      bold: boolean;
      italic: boolean;
      underline?: boolean;
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

      // Check for wrapping
      if (curX > contentX && curX + wWidth > contentX + contentW) {
        curY += effectiveLineGap;
        curX = contentX;
      }

      if (!dryRun) {
        doc.text(w.text, curX, curY);
        if (w.underline) {
          doc.line(curX, curY + 0.3, curX + wWidth, curY + 0.3);
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
