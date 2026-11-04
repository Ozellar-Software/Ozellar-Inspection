import React, { useState, useRef, useCallback, useEffect } from 'react';
import './RichTextEditor.css';

export interface RichTextEditorProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
  label?: string;
  showFontSelector?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const WORD_FONTS = [
  // Standard & System
  { label: 'Calibri', value: 'Calibri, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", Tahoma, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },

  // Editorial & Formal Serif
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Cambria', value: 'Cambria, Georgia, serif' },
  { label: 'Palatino', value: '"Palatino Linotype", Palatino, serif' },

  // Modern Clean Sans
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Roboto', value: 'Roboto, sans-serif' },
  { label: 'Montserrat', value: 'Montserrat, sans-serif' },
  { label: 'Poppins', value: 'Poppins, sans-serif' },
  { label: 'Open Sans', value: '"Open Sans", sans-serif' },
  { label: 'Lato', value: 'Lato, sans-serif' },

  // Technical & Monospace
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'SF Mono', value: '"SF Mono", Menlo, monospace' },
];

const BULLET_STYLES = [
  { label: 'Disc (Solid Round)', symbol: '•', display: '• Disc' },
  { label: 'Circle (Hollow)', symbol: '○', display: '○ Circle' },
  { label: 'Square (Solid)', symbol: '■', display: '■ Square' },
  { label: 'Checkbox (Hollow)', symbol: '□', display: '□ Checkbox' },
  { label: 'Diamond', symbol: '◆', display: '◆ Diamond' },
  { label: 'Arrow', symbol: '➢', display: '➢ Arrow' },
  { label: 'Checkmark', symbol: '✓', display: '✓ Check' },
  { label: 'Dash', symbol: '–', display: '– Dash' },
  { label: 'Numbered (1, 2, 3)', symbol: 'num', display: '1. Number' },
  { label: 'Alphabet (a, b, c)', symbol: 'alpha', display: 'a. Alphabet' },
  { label: 'Roman (i, ii, iii)', symbol: 'roman', display: 'i. Roman' },
];

export function RichTextEditor({
  value = '',
  onChange,
  onBlur,
  placeholder = 'Type here…',
  disabled = false,
  minHeight = 70,
  label,
  showFontSelector = true,
  className = '',
  style = {},
}: RichTextEditorProps) {
  const [selectedFont, setSelectedFont] = useState(WORD_FONTS[0].value);
  const [isToolbarOpen, setIsToolbarOpen] = useState(false);
  const [isBulletMenuOpen, setIsBulletMenuOpen] = useState(false);
  const bulletMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Close bullet menu on outside click
  useEffect(() => {
    if (!isBulletMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (bulletMenuRef.current && !bulletMenuRef.current.contains(e.target as Node)) {
        setIsBulletMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isBulletMenuOpen]);

  // Wrap or insert text
  const applyInlineWrap = useCallback(
    (prefix: string, suffix: string, defaultText: string) => {
      if (disabled) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = value.substring(start, end);

      const replacement = selected ? `${prefix}${selected}${suffix}` : `${prefix}${defaultText}${suffix}`;
      const nextValue = value.substring(0, start) + replacement + value.substring(end);

      onChange(nextValue);

      setTimeout(() => {
        textarea.focus();
        if (selected) {
          textarea.setSelectionRange(start + prefix.length, end + prefix.length);
        } else {
          textarea.setSelectionRange(start + prefix.length, start + prefix.length + defaultText.length);
        }
      }, 0);
    },
    [value, onChange, disabled]
  );

  // Apply chosen bullet or number style
  const applyBulletStyle = useCallback(
    (symbol: string) => {
      if (disabled) return;
      setIsBulletMenuOpen(false);
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      const before = value.substring(0, start);
      const lineStart = before.lastIndexOf('\n') + 1;
      const after = value.substring(end);
      const lineEnd = end + (after.indexOf('\n') === -1 ? after.length : after.indexOf('\n'));

      const selectedBlock = value.substring(lineStart, lineEnd);
      const lines = selectedBlock.split('\n');

      const newLines = lines.map((line, idx) => {
        // Strip any existing bullet/number prefix
        const clean = line.replace(/^(\s*)([•○■□◆➢➔→✓–\-\*]|\d+[\.\)]|[a-zA-Z][\.\)]|[ivxlcdmIVXLCDM]+[\.\)])\s+/, '$1');
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';

        if (symbol === 'num') {
          return `${indent}${idx + 1}. ${clean.trimStart()}`;
        } else if (symbol === 'alpha') {
          const letter = String.fromCharCode(97 + (idx % 26));
          return `${indent}${letter}. ${clean.trimStart()}`;
        } else if (symbol === 'roman') {
          const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
          const r = romanNumerals[idx % romanNumerals.length];
          return `${indent}${r}. ${clean.trimStart()}`;
        } else {
          return `${indent}${symbol} ${clean.trimStart()}`;
        }
      });

      const nextBlock = newLines.join('\n');
      const nextValue = value.substring(0, lineStart) + nextBlock + value.substring(lineEnd);
      onChange(nextValue);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(lineStart, lineStart + nextBlock.length);
      }, 0);
    },
    [value, onChange, disabled]
  );

  // Apply heading (H2, H3)
  const applyHeading = useCallback(
    (level: 2 | 3) => {
      if (disabled) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const before = value.substring(0, start);
      const lineStart = before.lastIndexOf('\n') + 1;
      const after = value.substring(start);
      const lineEnd = start + (after.indexOf('\n') === -1 ? after.length : after.indexOf('\n'));

      const line = value.substring(lineStart, lineEnd);
      const cleanLine = line.replace(/^(#{1,3}\s*)/, '');
      const prefix = '#'.repeat(level) + ' ';
      const newLine = prefix + cleanLine;

      const nextValue = value.substring(0, lineStart) + newLine + value.substring(lineEnd);
      onChange(nextValue);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(lineStart + newLine.length, lineStart + newLine.length);
      }, 0);
    },
    [value, onChange, disabled]
  );

  // Apply font family tag to selected text or overall textarea
  const handleFontChange = (fontVal: string, fontLabel: string) => {
    setSelectedFont(fontVal);
    if (disabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start !== end) {
      applyInlineWrap(`[font:${fontLabel}]`, `[/font]`, 'text');
    }
  };

  // Smart enter key handling: carry current bullet or increment number
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;

    // Shortcuts: Ctrl+B, Ctrl+I, Ctrl+U
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        applyInlineWrap('**', '**', 'bold text');
        return;
      }
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        applyInlineWrap('*', '*', 'italic text');
        return;
      }
      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        applyInlineWrap('<u>', '</u>', 'underlined text');
        return;
      }
    }

    if (e.key === 'Enter') {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const beforeCursor = value.substring(0, start);
      const lineStart = beforeCursor.lastIndexOf('\n') + 1;
      const currentLine = beforeCursor.substring(lineStart);

      // Bullet continuation
      const bulletMatch = currentLine.match(/^(\s*)([•○■□◆➢➔→✓–\-\*])\s+(.*)$/);
      if (bulletMatch) {
        const indent = bulletMatch[1];
        const symbol = bulletMatch[2];
        const content = bulletMatch[3];

        if (content.trim() === '') {
          // Empty bullet line -> exit list
          e.preventDefault();
          const nextVal = value.substring(0, lineStart) + value.substring(start);
          onChange(nextVal);
          setTimeout(() => textarea.setSelectionRange(lineStart, lineStart), 0);
          return;
        } else {
          e.preventDefault();
          const insertion = `\n${indent}${symbol} `;
          const nextVal = value.substring(0, start) + insertion + value.substring(start);
          onChange(nextVal);
          setTimeout(() => textarea.setSelectionRange(start + insertion.length, start + insertion.length), 0);
          return;
        }
      }

      // Number continuation
      const numMatch = currentLine.match(/^(\s*)(\d+)[\.\)]\s+(.*)$/);
      if (numMatch) {
        const indent = numMatch[1];
        const num = parseInt(numMatch[2], 10);
        const content = numMatch[3];

        if (content.trim() === '') {
          e.preventDefault();
          const nextVal = value.substring(0, lineStart) + value.substring(start);
          onChange(nextVal);
          setTimeout(() => textarea.setSelectionRange(lineStart, lineStart), 0);
          return;
        } else {
          e.preventDefault();
          const insertion = `\n${indent}${num + 1}. `;
          const nextVal = value.substring(0, start) + insertion + value.substring(start);
          onChange(nextVal);
          setTimeout(() => textarea.setSelectionRange(start + insertion.length, start + insertion.length), 0);
          return;
        }
      }
    }
  };

  return (
    <div
      className={`word-editor-container ${className} ${disabled ? 'disabled' : ''} ${
        isToolbarOpen ? 'toolbar-open' : ''
      }`}
      style={style}
    >
      {label && <div className="word-editor-label">{label}</div>}

      {/* ── Discreet Format Trigger Button (Top-Right) ── */}
      {!disabled && (
        <button
          type="button"
          className={`rte-format-toggle ${isToolbarOpen ? 'active' : ''}`}
          onClick={() => setIsToolbarOpen((v) => !v)}
          title={isToolbarOpen ? 'Hide formatting tools' : 'Format text (Fonts, Bullets, Bold, Lists)'}
        >
          <span className="rte-format-icon">Aa</span>
          <span className="rte-format-text">{isToolbarOpen ? 'Hide' : 'Format'}</span>
        </button>
      )}

      {/* ── Word-Style Sleek Ribbon (Visible only when user opens formatting) ── */}
      {isToolbarOpen && (
        <div className="word-ribbon">
          {/* Font Family Selector */}
          {showFontSelector && (
            <div className="word-ribbon-item">
              <select
                className="word-font-select"
                value={selectedFont}
                onChange={(e) => {
                  const opt = WORD_FONTS.find((f) => f.value === e.target.value);
                  handleFontChange(e.target.value, opt ? opt.label : 'Calibri');
                }}
                disabled={disabled}
                title="Font Family"
              >
                {WORD_FONTS.map((f) => (
                  <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="word-ribbon-sep" />

          {/* Headings */}
          <div className="word-ribbon-group">
            <button
              type="button"
              className="word-btn"
              onClick={() => applyHeading(2)}
              disabled={disabled}
              title="Heading 2 (## Title)"
            >
              H2
            </button>
            <button
              type="button"
              className="word-btn"
              onClick={() => applyHeading(3)}
              disabled={disabled}
              title="Heading 3 (### Subhead)"
            >
              H3
            </button>
          </div>

          <div className="word-ribbon-sep" />

          {/* Inline Formatting: Bold, Italic, Underline, Strike */}
          <div className="word-ribbon-group">
            <button
              type="button"
              className="word-btn bold"
              onClick={() => applyInlineWrap('**', '**', 'bold text')}
              disabled={disabled}
              title="Bold (Ctrl+B)"
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className="word-btn italic"
              onClick={() => applyInlineWrap('*', '*', 'italic text')}
              disabled={disabled}
              title="Italic (Ctrl+I)"
            >
              <em>I</em>
            </button>
            <button
              type="button"
              className="word-btn underline"
              onClick={() => applyInlineWrap('<u>', '</u>', 'underlined text')}
              disabled={disabled}
              title="Underline (Ctrl+U)"
            >
              <u>U</u>
            </button>
            <button
              type="button"
              className="word-btn strike"
              onClick={() => applyInlineWrap('~~', '~~', 'strikethrough text')}
              disabled={disabled}
              title="Strikethrough"
            >
              <s>S</s>
            </button>
          </div>

          <div className="word-ribbon-sep" />

          {/* Word-Style Bullet Picker Popover */}
          <div className="word-bullet-wrap" ref={bulletMenuRef}>
            <button
              type="button"
              className="word-btn word-bullet-btn"
              onClick={() => setIsBulletMenuOpen((v) => !v)}
              disabled={disabled}
              title="Select Bullet Style or Numbered List"
            >
              <span className="word-bullet-icon">•</span>
              <span className="word-bullet-text">Bullets</span>
              <span className="word-chevron">▼</span>
            </button>

            {isBulletMenuOpen && (
              <div className="word-bullet-menu">
                <div className="word-bullet-menu-title">Select Bullet & List Style</div>
                <div className="word-bullet-grid">
                  {BULLET_STYLES.map((b) => (
                    <button
                      key={b.symbol}
                      type="button"
                      className="word-bullet-opt"
                      onClick={() => applyBulletStyle(b.symbol)}
                    >
                      <span className="word-bullet-sample">{b.display.split(' ')[0]}</span>
                      <span className="word-bullet-name">{b.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="word-ribbon-sep" />

          {/* Quick Survey Icons */}
          <div className="word-ribbon-group">
            <button
              type="button"
              className="word-btn symbol"
              onClick={() => applyBulletStyle('✓')}
              disabled={disabled}
              title="Add Checkmark (✓)"
            >
              ✓
            </button>
            <button
              type="button"
              className="word-btn symbol alert"
              onClick={() => applyInlineWrap('**▲ ', '**', 'DEFECT')}
              disabled={disabled}
              title="Add Defect Alert (▲)"
            >
              ▲
            </button>
          </div>

          {/* Close Ribbon Button */}
          <button
            type="button"
            className="word-btn word-close-btn"
            onClick={() => setIsToolbarOpen(false)}
            title="Close formatting bar"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Editor Textarea (Identical to original clean inputs, live font support) ── */}
      <textarea
        ref={textareaRef}
        className="word-textarea"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        style={{
          minHeight,
          fontFamily: selectedFont,
        }}
      />
    </div>
  );
}
