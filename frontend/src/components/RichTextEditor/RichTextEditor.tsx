import React, { useState, useRef, useEffect, useCallback } from 'react';
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

const POPULAR_FONTS = [
  { label: 'Calibri', value: 'Calibri, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Roboto', value: 'Roboto, sans-serif' },
  { label: 'Consolas', value: 'Consolas, monospace' },
];

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Cleans Word MSO junk from copied text while strictly preserving font-family, bold, italic, underline, lists.
 */
function sanitizePastedHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/gi, '')
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<meta[\s\S]*?>/gi, '')
    .replace(/<link[\s\S]*?>/gi, '')
    .replace(/<\/?(html|body|head|title)[^>]*>/gi, '')
    .replace(/class=["'][^"']*mso[^"']*["']/gi, '')
    .trim();
}

/**
 * Normalizes plain text or markdown from existing inspections into standard HTML.
 */
function toInitialHtml(val: string): string {
  if (!val) return '';
  // If already contains HTML markup, pass through directly
  if (/<(p|div|ul|ol|li|b|strong|i|em|u|font|span|br|h[1-6])[^>]*>/i.test(val)) {
    return val;
  }

  // Convert markdown bold, italics, font tags
  let converted = val
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\[font:([^\]]+)\]([\s\S]+?)\[\/font\]/g, '<span style="font-family: $1">$2</span>');

  const lines = converted.split('\n');
  const blocks: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inUl) { blocks.push('</ul>'); inUl = false; }
      if (inOl) { blocks.push('</ol>'); inOl = false; }
      blocks.push('<p><br></p>');
      continue;
    }

    const bulletMatch = line.match(/^(\s*)([•○■□◆➢➔→✓–\-\*])\s+(.*)$/);
    const numMatch = line.match(/^(\s*)(\d+)[\.\)]\s+(.*)$/);

    if (bulletMatch) {
      if (inOl) { blocks.push('</ol>'); inOl = false; }
      if (!inUl) { blocks.push('<ul>'); inUl = true; }
      blocks.push(`<li>${bulletMatch[3]}</li>`);
    } else if (numMatch) {
      if (inUl) { blocks.push('</ul>'); inUl = false; }
      if (!inOl) { blocks.push('<ol>'); inOl = true; }
      blocks.push(`<li>${numMatch[3]}</li>`);
    } else {
      if (inUl) { blocks.push('</ul>'); inUl = false; }
      if (!inOl) { blocks.push('</ol>'); inOl = false; }
      blocks.push(`<p>${line}</p>`);
    }
  }

  if (inUl) blocks.push('</ul>');
  if (inOl) blocks.push('</ol>');

  return blocks.join('');
}

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
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef(false);

  const [isToolbarOpen, setIsToolbarOpen] = useState(false);
  const [activeFont, setActiveFont] = useState(POPULAR_FONTS[0].value);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isUl, setIsUl] = useState(false);
  const [isOl, setIsOl] = useState(false);
  const [isEmpty, setIsEmpty] = useState(!value || value.trim() === '');

  // Synchronize incoming value into editor without resetting user cursor
  useEffect(() => {
    if (editorRef.current && !isInternalUpdate.current) {
      const targetHtml = toInitialHtml(value);
      if (editorRef.current.innerHTML !== targetHtml) {
        editorRef.current.innerHTML = targetHtml;
      }
      const raw = editorRef.current.textContent || '';
      setIsEmpty(!raw.trim());
    }
    isInternalUpdate.current = false;
  }, [value]);

  // Query and reflect current formatting states at cursor position
  const updateActiveStates = useCallback(() => {
    if (disabled || !document.queryCommandState) return;
    try {
      setIsBold(document.queryCommandState('bold'));
      setIsItalic(document.queryCommandState('italic'));
      setIsUnderline(document.queryCommandState('underline'));
      setIsUl(document.queryCommandState('insertUnorderedList'));
      setIsOl(document.queryCommandState('insertOrderedList'));
    } catch {
      // Safe fallback
    }
  }, [disabled]);

  const handleInput = () => {
    if (!editorRef.current) return;
    isInternalUpdate.current = true;
    const html = editorRef.current.innerHTML;
    const text = editorRef.current.textContent || '';
    setIsEmpty(!text.trim());
    onChange(html);
    updateActiveStates();
  };

  const exec = (command: string, arg?: string) => {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    handleInput();
  };

  const handleFontChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const font = e.target.value;
    setActiveFont(font);
    exec('fontName', font);
  };

  const handleBlockChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'h2' || val === 'h3') {
      exec('formatBlock', `<${val}>`);
    } else {
      exec('formatBlock', '<p>');
    }
  };

  // Allow copying and pasting ANY type of text, HTML, and ANY font family
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');

    if (html) {
      e.preventDefault();
      const clean = sanitizePastedHtml(html);
      document.execCommand('insertHTML', false, clean);
      handleInput();
    } else if (text) {
      e.preventDefault();
      const lines = text.split(/\r?\n/);
      const formatted = lines
        .map((l) => (l.trim() ? `<p>${escapeHtml(l)}</p>` : '<p><br></p>'))
        .join('');
      document.execCommand('insertHTML', false, formatted);
      handleInput();
    }
  };

  return (
    <div
      className={`normal-word-editor ${className} ${disabled ? 'disabled' : ''} ${
        isToolbarOpen ? 'toolbar-open' : 'toolbar-closed'
      }`}
      style={style}
    >
      {label && <div className="normal-editor-label">{label}</div>}

      {/* ── Format Toggle Icon on the Right Side ── */}
      {!disabled && (
        <button
          type="button"
          className={`editor-toggle-btn ${isToolbarOpen ? 'active' : ''}`}
          onClick={() => setIsToolbarOpen((prev) => !prev)}
          title={isToolbarOpen ? 'Hide formatting toolbar' : 'Open text formatting & font tools'}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="toggle-icon-aa">Aa</span>
          <span className="toggle-icon-arrow">{isToolbarOpen ? '▲' : '▾'}</span>
        </button>
      )}

      {/* ── Standard Word Formatting Ribbon (Opens when user clicks right-side icon) ── */}
      {isToolbarOpen && (
        <div className="normal-word-toolbar">
          {/* Font Family Selector */}
          {showFontSelector && (
            <div className="toolbar-item">
              <select
                className="toolbar-select font-select"
                value={activeFont}
                onChange={handleFontChange}
                disabled={disabled}
                title="Font Family"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {POPULAR_FONTS.map((f) => (
                  <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Normal / Heading */}
          <div className="toolbar-item">
            <select
              className="toolbar-select block-select"
              defaultValue="p"
              onChange={handleBlockChange}
              disabled={disabled}
              title="Text Style"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value="p">Normal</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
            </select>
          </div>

          <div className="toolbar-sep" />

          {/* Bold, Italic, Underline */}
          <div className="toolbar-group">
            <button
              type="button"
              className={`toolbar-btn bold-btn ${isBold ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}
              disabled={disabled}
              title="Bold (Ctrl+B)"
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className={`toolbar-btn italic-btn ${isItalic ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}
              disabled={disabled}
              title="Italic (Ctrl+I)"
            >
              <em>I</em>
            </button>
            <button
              type="button"
              className={`toolbar-btn underline-btn ${isUnderline ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}
              disabled={disabled}
              title="Underline (Ctrl+U)"
            >
              <u>U</u>
            </button>
          </div>

          <div className="toolbar-sep" />

          {/* Bullet and Numbered Lists */}
          <div className="toolbar-group">
            <button
              type="button"
              className={`toolbar-btn list-btn ${isUl ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }}
              disabled={disabled}
              title="Bullet List"
            >
              <span style={{ fontSize: 13, marginRight: 2 }}>•</span> List
            </button>
            <button
              type="button"
              className={`toolbar-btn list-btn ${isOl ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }}
              disabled={disabled}
              title="Numbered List"
            >
              <span style={{ fontSize: 11, marginRight: 2 }}>1.</span> List
            </button>
          </div>

          <div className="toolbar-sep" />

          {/* Quick Survey Symbols */}
          <div className="toolbar-group">
            <button
              type="button"
              className="toolbar-btn check-btn"
              onMouseDown={(e) => { e.preventDefault(); exec('insertText', '✓ '); }}
              disabled={disabled}
              title="Insert Checkmark (✓)"
            >
              ✓
            </button>
            <button
              type="button"
              className="toolbar-btn defect-btn"
              onMouseDown={(e) => { e.preventDefault(); exec('insertText', '▲ DEFECT: '); }}
              disabled={disabled}
              title="Insert Defect Tag (▲)"
            >
              ▲ Defect
            </button>
          </div>

          {/* Clear formatting */}
          <div className="toolbar-group">
            <button
              type="button"
              className="toolbar-btn clear-btn"
              onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }}
              disabled={disabled}
              title="Clear Formatting"
            >
              T<span style={{ fontSize: 9 }}>x</span>
            </button>
          </div>

          {/* Close Toolbar Button on Right */}
          <button
            type="button"
            className="toolbar-btn close-btn"
            onMouseDown={(e) => { e.preventDefault(); setIsToolbarOpen(false); }}
            title="Close formatting bar"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Visual WYSIWYG Editor Body ── */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        className={`normal-word-body ${isEmpty ? 'is-empty' : ''}`}
        data-placeholder={placeholder}
        onInput={handleInput}
        onPaste={handlePaste}
        onBlur={onBlur}
        onKeyUp={updateActiveStates}
        onMouseUp={updateActiveStates}
        onSelect={updateActiveStates}
        style={{
          minHeight,
          fontFamily: activeFont,
        }}
      />
    </div>
  );
}
