import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { InspectionQuestion, InspectionSection, Photo } from '@ozellar/shared';
import { db } from '../../offline/db';
import {
  XIcon,
  SearchIcon,
  CameraIcon,
  CompassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowRightCircleIcon,
  ClipboardIcon,
} from '../../icons';
import './MovePhotoModal.css';

interface MovePhotoModalProps {
  isOpen: boolean;
  photo: Photo | null;
  photoUrl?: string;
  currentSectionId?: string;
  sections: InspectionSection[];
  onMove?: (targetSectionId: string) => Promise<void> | void;
  onMoveToSection?: (targetSectionId: string) => Promise<void> | void;
  onMoveToQuestion?: (questionId: string, sectionId: string) => Promise<void> | void;
  onClose: () => void;
}

export function MovePhotoModal({
  isOpen,
  photo,
  photoUrl,
  currentSectionId,
  sections,
  onMove,
  onMoveToSection,
  onMoveToQuestion,
  onClose,
}: MovePhotoModalProps) {
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'all' | 'sections' | 'questions'>('all');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [movingTarget, setMovingTarget] = useState<string | null>(null);

  // Query all checklist questions in database
  const allDbQuestions = useLiveQuery(
    () => db.inspectionQuestions.toArray(),
    []
  ) ?? [];

  // Group questions by inspectionSectionId for the current inspection's sections
  const questionsBySection = useMemo(() => {
    const sectionIdSet = new Set(sections.map((s) => s.id));
    const map: Record<string, InspectionQuestion[]> = {};
    for (const q of allDbQuestions) {
      if (sectionIdSet.has(q.inspectionSectionId)) {
        if (!map[q.inspectionSectionId]) map[q.inspectionSectionId] = [];
        map[q.inspectionSectionId].push(q);
      }
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }
    return map;
  }, [allDbQuestions, sections]);

  const totalQuestions = useMemo(() => {
    let count = 0;
    for (const sec of sections) {
      count += questionsBySection[sec.id]?.length || 0;
    }
    return count;
  }, [sections, questionsBySection]);

  // Handle ESC key and scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !movingTarget) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, movingTarget, onClose]);

  // Auto-expand sections when user is searching or in "questions" tab
  useEffect(() => {
    if (filter.trim() || tab === 'questions') {
      const autoExpand: Record<string, boolean> = {};
      sections.forEach((s) => {
        autoExpand[s.id] = true;
      });
      setExpandedSections(autoExpand);
    }
  }, [filter, tab, sections]);

  if (!isOpen || !photo) return null;

  const currentSection = sections.find((s) => s.id === currentSectionId);
  const normalizedFilter = filter.toLowerCase().trim();

  // Filter sections and questions
  const filteredSections = sections.filter((sec) => {
    const secQuestions = questionsBySection[sec.id] || [];
    const secNameMatches =
      sec.name.toLowerCase().includes(normalizedFilter) ||
      (sec.zone && sec.zone.toLowerCase().includes(normalizedFilter));

    const matchingQuestions = secQuestions.filter(
      (q) =>
        (q.ref && q.ref.toLowerCase().includes(normalizedFilter)) ||
        (q.text && q.text.toLowerCase().includes(normalizedFilter))
    );

    if (tab === 'sections') {
      return secNameMatches;
    }
    if (tab === 'questions') {
      return matchingQuestions.length > 0;
    }
    return secNameMatches || matchingQuestions.length > 0;
  });

  function toggleSectionExpand(secId: string) {
    setExpandedSections((prev) => ({
      ...prev,
      [secId]: !prev[secId],
    }));
  }

  // Handle moving to Section
  async function handleSelectSection(targetSectionId: string) {
    if (movingTarget) return;
    const isAlreadyInThisSection =
      photo?.target === 'section' && targetSectionId === currentSectionId;
    if (isAlreadyInThisSection) return;

    setMovingTarget(targetSectionId);
    try {
      const fn = onMoveToSection || onMove;
      if (fn) await fn(targetSectionId);
      onClose();
    } catch (err) {
      console.error('Failed to move photo to section', err);
    } finally {
      setMovingTarget(null);
    }
  }

  // Handle moving to Question
  async function handleSelectQuestion(targetQuestionId: string, sectionId: string) {
    if (movingTarget) return;

    setMovingTarget(targetQuestionId);
    try {
      if (onMoveToQuestion) {
        await onMoveToQuestion(targetQuestionId, sectionId);
      }
      onClose();
    } catch (err) {
      console.error('Failed to move photo to question', err);
    } finally {
      setMovingTarget(null);
    }
  }

  return createPortal(
    <div className="mpm-overlay" onClick={() => !movingTarget && onClose()}>
      <div className="mpm-card" onClick={(e) => e.stopPropagation()}>
        {/* Mobile handle indicator */}
        <div className="mpm-drag-handle hide-on-desktop" />

        {/* Header */}
        <div className="mpm-header">
          <div className="mpm-title-wrap">
            <div className="mpm-icon-badge">
              <CompassIcon width={18} height={18} />
            </div>
            <div>
              <h3 className="mpm-title">Move Photo</h3>
              <p className="mpm-subtitle">Move to another section or attach to a specific question</p>
            </div>
          </div>
          <button
            type="button"
            className="mpm-close-btn"
            onClick={onClose}
            disabled={!!movingTarget}
            aria-label="Close"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>

        {/* Selected Photo Info Card */}
        <div className="mpm-photo-preview-bar">
          {photoUrl ? (
            <img src={photoUrl} alt="Photo thumbnail" className="mpm-thumb-img" />
          ) : (
            <div className="mpm-thumb-fallback">
              <CameraIcon width={22} height={22} />
            </div>
          )}
          <div className="mpm-photo-meta">
            <span className={`mpm-badge ${photo.isDefect ? 'defect' : 'normal'}`}>
              {photo.isDefect ? 'Defect Image' : 'Normal Image'}
            </span>
            {currentSection && (
              <div className="mpm-current-sec">
                Currently in: <strong>{currentSection.name}</strong>
              </div>
            )}
          </div>
        </div>

        {/* Destination Type Filter Tabs */}
        {totalQuestions > 0 && (
          <div className="mpm-tabs-wrap">
            <button
              type="button"
              className={`mpm-tab-btn ${tab === 'all' ? 'active' : ''}`}
              onClick={() => setTab('all')}
            >
              <span>All</span>
              <span className="mpm-tab-count">{sections.length + totalQuestions}</span>
            </button>
            <button
              type="button"
              className={`mpm-tab-btn ${tab === 'sections' ? 'active' : ''}`}
              onClick={() => setTab('sections')}
            >
              <CompassIcon width={13} height={13} />
              <span>Sections</span>
              <span className="mpm-tab-count">{sections.length}</span>
            </button>
            <button
              type="button"
              className={`mpm-tab-btn ${tab === 'questions' ? 'active' : ''}`}
              onClick={() => setTab('questions')}
            >
              <ClipboardIcon width={13} height={13} />
              <span>Questions</span>
              <span className="mpm-tab-count">{totalQuestions}</span>
            </button>
          </div>
        )}

        {/* Search Input */}
        <div className="mpm-search-wrap">
          <SearchIcon width={15} height={15} className="mpm-search-icon" />
          <input
            type="text"
            className="mpm-search-input"
            placeholder="Search sections or questions by name, ref, or zone…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          {filter && (
            <button
              type="button"
              className="mpm-search-clear"
              onClick={() => setFilter('')}
              aria-label="Clear filter"
            >
              <XIcon width={12} height={12} />
            </button>
          )}
        </div>

        {/* Destinations List */}
        <div className="mpm-section-list">
          {filteredSections.length === 0 ? (
            <div className="mpm-empty-state">
              <div>
                No matching{' '}
                {tab === 'sections'
                  ? 'sections'
                  : tab === 'questions'
                  ? 'questions'
                  : 'sections or questions'}{' '}
                found
              </div>
              {filter && (
                <button
                  type="button"
                  className="mpm-btn-clear-search"
                  onClick={() => setFilter('')}
                >
                  Clear search filter
                </button>
              )}
            </div>
          ) : (
            filteredSections.map((sec) => {
              const secQuestions = questionsBySection[sec.id] || [];
              const isCurrentSection = sec.id === currentSectionId;
              const isSectionMoving = movingTarget === sec.id;
              const isExpanded = !!expandedSections[sec.id] || tab === 'questions';

              // Filter questions inside this section
              const displayedQuestions = secQuestions.filter((q) => {
                if (!normalizedFilter) return true;
                return (
                  (q.ref && q.ref.toLowerCase().includes(normalizedFilter)) ||
                  (q.text && q.text.toLowerCase().includes(normalizedFilter))
                );
              });

              const isAlreadySectionPhotoHere =
                photo.target === 'section' && isCurrentSection;

              return (
                <div
                  key={sec.id}
                  className={`mpm-sec-group ${isCurrentSection ? 'is-current-group' : ''}`}
                >
                  {/* Section Main Header Row */}
                  <div
                    className="mpm-sec-header-row"
                    onClick={() => {
                      if (secQuestions.length > 0 && tab !== 'sections') {
                        toggleSectionExpand(sec.id);
                      }
                    }}
                  >
                    <div className="mpm-sec-left">
                      <div className="mpm-sec-top-line">
                        <span className="mpm-sec-zone">{sec.zone || 'GENERAL'}</span>
                        {sec.photoOnly && (
                          <span className="mpm-sec-tag-photo">Photo Section</span>
                        )}
                        {isCurrentSection && (
                          <span className="mpm-sec-tag-current">Current Section</span>
                        )}
                      </div>
                      <div className="mpm-sec-name">{sec.name}</div>
                    </div>

                    <div className="mpm-sec-actions" onClick={(e) => e.stopPropagation()}>
                      {/* Button to move as section photo (hidden in questions tab) */}
                      {tab !== 'questions' && (
                        <button
                          type="button"
                          className="mpm-btn-move-section"
                          onClick={() => handleSelectSection(sec.id)}
                          disabled={isAlreadySectionPhotoHere || !!movingTarget}
                          title={
                            isAlreadySectionPhotoHere
                              ? 'Photo is already in this section'
                              : 'Move photo as a general section photo'
                          }
                        >
                          {isSectionMoving ? (
                            <span className="mpm-spinner" />
                          ) : (
                            <>
                              <CompassIcon width={13} height={13} />
                              <span>{isAlreadySectionPhotoHere ? 'Current' : 'To Section'}</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Expand / Collapse toggle for questions */}
                      {secQuestions.length > 0 && tab !== 'sections' && (
                        <button
                          type="button"
                          className={`mpm-btn-toggle-q ${isExpanded ? 'active' : ''}`}
                          onClick={() => toggleSectionExpand(sec.id)}
                          aria-label="Toggle questions"
                          title="Show checklist questions in this section"
                        >
                          <span>{secQuestions.length} Qs</span>
                          {isExpanded ? (
                            <ChevronDownIcon width={12} height={12} />
                          ) : (
                            <ChevronRightIcon width={12} height={12} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Questions Sublist (Accordion) */}
                  {isExpanded && displayedQuestions.length > 0 && tab !== 'sections' && (
                    <div className="mpm-questions-box">
                      {displayedQuestions.map((q) => {
                        const isQuestionMoving = movingTarget === q.id;
                        return (
                          <button
                            key={q.id}
                            type="button"
                            className="mpm-q-item"
                            onClick={() => handleSelectQuestion(q.id, sec.id)}
                            disabled={!!movingTarget}
                            title={`Attach photo to ${q.ref || 'question'}`}
                          >
                            <div className="mpm-q-left">
                              {q.ref && <span className="mpm-q-ref">{q.ref}</span>}
                              <span className="mpm-q-text">{q.text}</span>
                            </div>

                            <div className="mpm-q-action">
                              {isQuestionMoving ? (
                                <span className="mpm-spinner" />
                              ) : (
                                <>
                                  <ArrowRightCircleIcon width={13} height={13} />
                                  <span>Attach</span>
                                </>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="mpm-footer">
          <span className="mpm-footer-text">
            {sections.length} sections · {totalQuestions} checklist questions
          </span>
          <button
            type="button"
            className="mpm-cancel-btn"
            onClick={onClose}
            disabled={!!movingTarget}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
