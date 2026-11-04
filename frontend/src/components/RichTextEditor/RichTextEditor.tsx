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

/**
 * RichTextEditor provides a sleek maritime-themed toolbar for:
 * - Bold (**text**)
 * - Italic (*text*)
 * - Underline (<u>text</u>)
 * - Bullet list (• item)
 * - Numbered list (1. item)
 * - Headings (# Title, ## Section)
 * - Font Families ([font:serif]...[/font], [font:mono]...[/font])
 * - Quick symbols (✓, ▲, →)
 * - Live formatted preview tab matching the Report PDF
 */
export function RichTextEditor({
  value = '',
  onChange,
  onBlur,
  placeholder = 'Type your notes or remarks here…',
  disabled = false,
  minHeight = 90,
  label,
  showFontSelector = true,
  className = '',
  style = {},
}: RichTextEditorProps) {
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Wrap or insert text around current selection
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

      // Re-position cursor inside or after wrapped text
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

  // Apply bullet or numbered list to current line or selected lines
  const applyListPrefix = useCallback(
    (type: 'bullet' | 'number') => {
      if (disabled) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      // Find start of current line
      const before = value.substring(0, start);
      const lineStart = before.lastIndexOf('\n') + 1;
      const after = value.substring(end);
      const lineEnd = end + (after.indexOf('\n') === -1 ? after.length : after.indexOf('\n'));

      const selectedBlock = value.substring(lineStart, lineEnd);
      const lines = selectedBlock.split('\n');

      const newLines = lines.map((line, idx) => {
        const trimmed = line.trimStart();
        if (type === 'bullet') {
          // Toggle off if already bullet
          if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            return line.replace(/^(\s*)([•\-\*]\s+)/, '');
          }
          return `• ${trimmed}`;
        } else {
          // Numbered list
          if (/^\d+[\.\)]\s+/.test(trimmed)) {
            return line.replace(/^(\s*)(\d+[\.\)]\s+)/, '');
          }
          return `${idx + 1}. ${trimmed}`;
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

  // Apply heading prefix (#, ##, ###)
  const applyHeading = useCallback(
    (level: 1 | 2 | 3) => {
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

  // Apply font family tag: [font:serif]...[/font] or [font:mono]...[/font]
  const applyFontTag = useCallback(
    (fontName: 'serif' | 'mono' | 'sans') => {
      if (disabled) return;
      if (fontName === 'sans') {
        // Remove font tags from selection
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = value.substring(start, end);
        const stripped = selected.replace(/\[font:\w+\]/g, '').replace(/\[\/font\]/g, '');
        onChange(value.substring(0, start) + stripped + value.substring(end));
        return;
      }
      applyInlineWrap(`[font:${fontName}]`, `[/font]`, 'formatted text');
    },
    [applyInlineWrap, disabled, value, onChange]
  );

  // Insert special symbol at cursor
  const insertSymbol = useCallback(
    (symbol: string) => {
      if (disabled) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const nextValue = value.substring(0, start) + symbol + value.substring(end);
      onChange(nextValue);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + symbol.length, start + symbol.length);
      }, 0);
    },
    [value, onChange, disabled]
  );

  // Smart Enter handling for bullet / numbered list continuation and keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;

    // Shortcuts: Ctrl+B / Cmd+B -> Bold, Ctrl+I -> Italic, Ctrl+U -> Underline
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

    // Enter key smart list continuation
    if (e.key === 'Enter') {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const beforeCursor = value.substring(0, start);
      const lineStart = beforeCursor.lastIndexOf('\n') + 1;
      const currentLine = beforeCursor.substring(lineStart);

      // Check if current line is a bullet:
      const bulletMatch = currentLine.match(/^(\s*)([•\-\*])\s+(.*)$/);
      if (bulletMatch) {
        const indent = bulletMatch[1];
        const content = bulletMatch[3];

        if (content.trim() === '') {
          // Empty bullet line -> exit list
          e.preventDefault();
          const nextVal = value.substring(0, lineStart) + value.substring(start);
          onChange(nextVal);
          setTimeout(() => {
            textarea.setSelectionRange(lineStart, lineStart);
          }, 0);
          return;
        } else {
          // Continue bullet on next line
          e.preventDefault();
          const insertion = `\n${indent}• `;
          const nextVal = value.substring(0, start) + insertion + value.substring(start);
          onChange(nextVal);
          setTimeout(() => {
            textarea.setSelectionRange(start + insertion.length, start + insertion.length);
          }, 0);
          return;
        }
      }

      // Check if current line is a numbered list:
      const numberMatch = currentLine.match(/^(\s*)(\d+)[\.\)]\s+(.*)$/);
      if (numberMatch) {
        const indent = numberMatch[1];
        const num = parseInt(numberMatch[2], 10);
        const content = numberMatch[3];

        if (content.trim() === '') {
          // Empty number line -> exit list
          e.preventDefault();
          const nextVal = value.substring(0, lineStart) + value.substring(start);
          onChange(nextVal);
          setTimeout(() => {
            textarea.setSelectionRange(lineStart, lineStart);
          }, 0);
          return;
        } else {
          // Increment number
          e.preventDefault();
          const insertion = `\n${indent}${num + 1}. `;
          const nextVal = value.substring(0, start) + insertion + value.substring(start);
          onChange(nextVal);
          setTimeout(() => {
            textarea.setSelectionRange(start + insertion.length, start + insertion.length);
          }, 0);
          return;
        }
      }
    }
  };

  // Convert raw text into styled HTML elements for Live Preview
  const renderLivePreview = () => {
    if (!value.trim()) {
      return <div className="rte-preview-empty">Nothing to preview. Enter text to see formatted output.</div>;
    }

    const lines = value.split('\n');
    return (
      <div className="rte-preview-content">
        {lines.map((line, lIdx) => {
          if (!line.trim()) {
            return <div key={lIdx} className="rte-preview-gap" />;
          }

          // Check Headings
          if (line.startsWith('# ')) {
            return (
              <h3 key={lIdx} className="rte-h1">
                {renderInlinePreview(line.substring(2))}
              </h3>
            );
          }
          if (line.startsWith('## ')) {
            return (
              <h4 key={lIdx} className="rte-h2">
                {renderInlinePreview(line.substring(3))}
              </h4>
            );
          }
          if (line.startsWith('### ')) {
            return (
              <h5 key={lIdx} className="rte-h3">
                {renderInlinePreview(line.substring(4))}
              </h5>
            );
          }

          // Check Bullets
          const bulletMatch = line.match(/^(\s*)([•\-\*])\s+(.*)$/);
          if (bulletMatch) {
            return (
              <div key={lIdx} className="rte-bullet-line">
                <span className="rte-bullet-dot" />
                <span className="rte-bullet-text">{renderInlinePreview(bulletMatch[3])}</span>
              </div>
            );
          }

          // Check Numbers
          const numMatch = line.match(/^(\s*)(\d+[\.\)])\s+(.*)$/);
          if (numMatch) {
            return (
              <div key={lIdx} className="rte-num-line">
                <span className="rte-num-badge">{numMatch[2]}</span>
                <span className="rte-num-text">{renderInlinePreview(numMatch[3])}</span>
              </div>
            );
          }

          // Normal Paragraph Line
          return (
            <p key={lIdx} className="rte-p">
              {renderInlinePreview(line)}
            </p>
          );
        })}
      </div>
    );
  };

  // Parse inline tokens into React elements for preview
  const renderInlinePreview = (text: string) => {
    // Regex for bold, italic, underline, and font tags
    const parts = text.split(
      /(\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|\*[\s\S]+?\*|<b>[\s\S]+?<\/b>|<i>[\s\S]+?<\/i>|<u>[\s\S]+?<\/u>|\[font:\w+\][\s\S]+?\[\/font\])/g
    );

    return parts.map((part, pIdx) => {
      if (part.startsWith('***') && part.endsWith('***')) {
        return <strong key={pIdx}><em>{part.slice(3, -3)}</em></strong>;
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={pIdx}>{part.slice(2, -2)}</strong>;
      }
      if (part.toLowerCase().startsWith('<b>') && part.toLowerCase().endsWith('</b>')) {
        return <strong key={pIdx}>{part.slice(3, -4)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={pIdx}>{part.slice(1, -1)}</em>;
      }
      if (part.toLowerCase().startsWith('<i>') && part.toLowerCase().endsWith('</i>')) {
        return <em key={pIdx}>{part.slice(3, -4)}</em>;
      }
      if (part.toLowerCase().startsWith('<u>') && part.toLowerCase().endsWith('</u>')) {
        return <u key={pIdx}>{part.slice(3, -4)}</u>;
      }
      if (part.toLowerCase().startsWith('[font:')) {
        const fontMatch = part.match(/^\[font:(\w+)\]([\s\S]+?)\[\/font\]/i);
        if (fontMatch) {
          const fName = fontMatch[1].toLowerCase();
          const fClass = fName === 'serif' || fName === 'times' ? 'font-serif' : fName === 'mono' || fName === 'courier' ? 'font-mono' : 'font-sans';
          return <span key={pIdx} className={fClass}>{renderInlinePreview(fontMatch[2])}</span>;
        }
      }
      return <React.Fragment key={pIdx}>{part}</React.Fragment>;
    });
  };

  return (
    <div className={`rte-container ${className} ${disabled ? 'disabled' : ''}`} style={style}>
      {/* ── Optional Header / Label Row ── */}
      {label && (
        <div className="rte-header-label">
          <span>{label}</span>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="rte-toolbar">
        <div className="rte-toolbar-group">
          {/* Headings */}
          <button
            type="button"
            className="rte-tool-btn"
            title="Heading 2 (## Title)"
            onClick={() => applyHeading(2)}
            disabled={disabled}
          >
            H2
          </button>
          <button
            type="button"
            className="rte-tool-btn"
            title="Heading 3 (### Subhead)"
            onClick={() => applyHeading(3)}
            disabled={disabled}
          >
            H3
          </button>
        </div>

        <div className="rte-divider" />

        <div className="rte-toolbar-group">
          {/* Bold */}
          <button
            type="button"
            className="rte-tool-btn rte-bold"
            title="Bold (**text** or Ctrl+B)"
            onClick={() => applyInlineWrap('**', '**', 'bold text')}
            disabled={disabled}
          >
            <strong>B</strong>
          </button>
          {/* Italic */}
          <button
            type="button"
            className="rte-tool-btn rte-italic"
            title="Italic (*text* or Ctrl+I)"
            onClick={() => applyInlineWrap('*', '*', 'italic text')}
            disabled={disabled}
          >
            <em>I</em>
          </button>
          {/* Underline */}
          <button
            type="button"
            className="rte-tool-btn rte-underline"
            title="Underline (<u>text</u> or Ctrl+U)"
            onClick={() => applyInlineWrap('<u>', '</u>', 'underlined text')}
            disabled={disabled}
          >
            <u>U</u>
          </button>
        </div>

        <div className="rte-divider" />

        <div className="rte-toolbar-group">
          {/* Bullet List */}
          <button
            type="button"
            className="rte-tool-btn"
            title="Bullet list (• Item)"
            onClick={() => applyListPrefix('bullet')}
            disabled={disabled}
          >
            <span style={{ fontSize: 14 }}>•</span> List
          </button>
          {/* Numbered List */}
          <button
            type="button"
            className="rte-tool-btn"
            title="Numbered list (1. Item)"
            onClick={() => applyListPrefix('number')}
            disabled={disabled}
          >
            1. List
          </button>
        </div>

        {showFontSelector && (
          <>
            <div className="rte-divider" />
            <div className="rte-toolbar-group">
              <select
                className="rte-font-select"
                title="Select font style"
                disabled={disabled}
                defaultValue="default"
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'serif' || val === 'mono' || val === 'sans') {
                    applyFontTag(val);
                  }
                  e.target.value = 'default';
                }}
              >
                <option value="default" disabled>Font Style…</option>
                <option value="sans">Standard (Sans)</option>
                <option value="serif">Executive (Serif)</option>
                <option value="mono">Technical (Mono)</option>
              </select>
            </div>
          </>
        )}

        <div className="rte-divider" />

        {/* Quick Symbols */}
        <div className="rte-toolbar-group rte-symbols">
          <button
            type="button"
            className="rte-tool-btn symbol"
            title="Insert Checkmark (✓)"
            onClick={() => insertSymbol('✓ ')}
            disabled={disabled}
          >
            ✓
          </button>
          <button
            type="button"
            className="rte-tool-btn symbol"
            title="Insert Defect / Warning Alert (▲)"
            onClick={() => insertSymbol('▲ ')}
            disabled={disabled}
          >
            ▲
          </button>
          <button
            type="button"
            className="rte-tool-btn symbol"
            title="Insert Action Arrow (→)"
            onClick={() => insertSymbol('→ ')}
            disabled={disabled}
          >
            →
          </button>
        </div>

        {/* Mode Switcher (Write vs Live PDF Preview) */}
        <div className="rte-toolbar-right">
          <div className="rte-tabs">
            <button
              type="button"
              className={`rte-tab-btn ${activeTab === 'write' ? 'active' : ''}`}
              onClick={() => setActiveTab('write')}
              title="Edit text"
            >
              Write
            </button>
            <button
              type="button"
              className={`rte-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => setActiveTab('preview')}
              title="Preview formatted output"
            >
              Preview
            </button>
          </div>
        </div>
      </div>

      {/* ── Editor Body ── */}
      <div className="rte-body" style={{ minHeight }}>
        {activeTab === 'write' ? (
          <textarea
            ref={textareaRef}
            className="rte-textarea"
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            onKeyDown={handleKeyDown}
            style={{ minHeight }}
          />
        ) : (
          <div className="rte-preview" style={{ minHeight }}>
            {renderLivePreview()}
          </div>
        )}
      </div>

      {/* ── Status Hint ── */}
      <div className="rte-hint-bar">
        <span>Formatting shortcuts: <strong>**bold**</strong>, <em>*italic*</em>, <u>&lt;u&gt;underline&lt;/u&gt;</u>, <strong>• bullets</strong>, <strong>1. numbers</strong>, <strong># headings</strong></span>
      </div>
    </div>
  );
}
