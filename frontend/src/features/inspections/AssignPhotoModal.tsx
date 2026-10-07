import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Photo } from '@ozellar/shared';
import { XIcon, SearchIcon, CameraIcon, CheckIcon } from '../../icons';
import './AssignPhotoModal.css';

interface QuestionOption {
  id: string;
  ref: string;
  text: string;
}

interface AssignPhotoModalProps {
  isOpen: boolean;
  photo: Photo | null;
  photoUrl?: string;
  questions: QuestionOption[];
  onAssign: (questionId: string) => Promise<void> | void;
  onClose: () => void;
}

export function AssignPhotoModal({
  isOpen,
  photo,
  photoUrl,
  questions,
  onAssign,
  onClose,
}: AssignPhotoModalProps) {
  const [filter, setFilter] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !savingId) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, savingId, onClose]);

  if (!isOpen || !photo) return null;

  const filtered = questions.filter(
    (q) =>
      q.ref.toLowerCase().includes(filter.toLowerCase()) ||
      q.text.toLowerCase().includes(filter.toLowerCase())
  );

  async function handleSelect(questionId: string) {
    if (savingId) return;
    setSavingId(questionId);
    try {
      await onAssign(questionId);
      onClose();
    } catch (err) {
      console.error('Failed to assign photo', err);
    } finally {
      setSavingId(null);
    }
  }

  return createPortal(
    <div className="apm-overlay" onClick={() => !savingId && onClose()}>
      <div className="apm-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="apm-header">
          <div className="apm-title-wrap">
            <div className="apm-icon-badge">
              <CameraIcon width={18} height={18} />
            </div>
            <div>
              <h3 className="apm-title">Assign Photo to Question</h3>
              <p className="apm-subtitle">Choose which question in this section to attach this photo to</p>
            </div>
          </div>
          <button
            type="button"
            className="apm-close-btn"
            onClick={onClose}
            disabled={!!savingId}
            aria-label="Close"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>

        {/* Photo Preview Strip */}
        <div className="apm-preview-row">
          {photoUrl ? (
            <img src={photoUrl} alt="Photo preview" className="apm-preview-img" />
          ) : (
            <div className="apm-preview-fallback">
              <CameraIcon width={24} height={24} />
            </div>
          )}
          <div className="apm-preview-info">
            <div className="apm-preview-label">Selected Photo</div>
            <div className="apm-preview-desc">
              {photo.isDefect ? 'Marked as Defect / Observation' : 'Standard Photo Evidence'}
            </div>
          </div>
        </div>

        {/* Search questions filter if more than 4 questions */}
        {questions.length > 4 && (
          <div className="apm-search-wrap">
            <SearchIcon width={15} height={15} className="apm-search-icon" />
            <input
              type="text"
              className="apm-search-input"
              placeholder="Filter questions by number or text..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            {filter && (
              <button
                type="button"
                className="apm-search-clear"
                onClick={() => setFilter('')}
              >
                <XIcon width={12} height={12} />
              </button>
            )}
          </div>
        )}

        {/* Question List */}
        <div className="apm-question-list">
          {filtered.length === 0 ? (
            <div className="apm-empty-state">No matching questions found</div>
          ) : (
            filtered.map((q) => (
              <button
                key={q.id}
                type="button"
                className={`apm-question-item ${savingId === q.id ? 'saving' : ''}`}
                onClick={() => handleSelect(q.id)}
                disabled={!!savingId}
              >
                <div className="apm-q-ref">{q.ref || 'Q'}</div>
                <div className="apm-q-text">{q.text}</div>
                <div className="apm-q-arrow">
                  {savingId === q.id ? (
                    <span className="apm-spinner" />
                  ) : (
                    <CheckIcon width={14} height={14} />
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="apm-footer">
          <span className="apm-footer-hint">Tip: On desktop, you can also drag & drop photos directly onto any question.</span>
          <button
            type="button"
            className="apm-cancel-btn"
            onClick={onClose}
            disabled={!!savingId}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
