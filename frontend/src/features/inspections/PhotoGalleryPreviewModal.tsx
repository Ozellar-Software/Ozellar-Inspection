import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { InspectionSection, Photo } from '@ozellar/shared';
import { getPhotoUrls } from '../../offline/photoQueue';
import {
  EyeIcon,
  XIcon,
  DownloadIcon,
  WarningIcon,
  CheckIcon,
  SearchIcon,
  CameraIcon,
  ChevronDownIcon,
  ShipIcon,
} from '../../icons';
import { ImageViewerModal } from './ImageViewerModal';
import './PhotoGalleryPreviewModal.css';

type SyncedPhoto = Photo & { deletedAt?: string | null };

export interface PhotoGalleryPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: SyncedPhoto[];
  title?: string;
  vesselName?: string;
  allSections?: InspectionSection[];
  locked?: boolean;
  onDownloadZip?: (filter: 'all' | 'defect') => void;
  onPhotoToggled?: (photoId: string, isDefect: boolean) => void;
  onPhotoUpdated?: (photoId: string, updates: Partial<Photo>) => void;
  currentSectionId?: string;
  onMoveToSection?: (photoId: string, targetSectionId: string) => Promise<void> | void;
  onMoveToQuestion?: (photoId: string, questionId: string, sectionId: string) => Promise<void> | void;
}

interface SectionDropdownProps {
  sections: InspectionSection[];
  selectedSection: string;
  onSelectSection: (sectionId: string) => void;
  sectionPhotoCounts: Map<string, { total: number; defect: number }>;
  totalCount: number;
}

/**
 * Modern custom dropdown for filtering photos by section.
 * Replaces standard native HTML <select> with a rich, interactive menu.
 */
function ModernSectionDropdown({
  sections,
  selectedSection,
  onSelectSection,
  sectionPhotoCounts,
  totalCount,
}: SectionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click / tap
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const selectedSectionObj = sections.find((s) => s.id === selectedSection);
  const selectedLabel =
    selectedSection === 'all'
      ? 'All Sections'
      : selectedSectionObj?.name || 'Selected Section';

  const selectedCount =
    selectedSection === 'all'
      ? totalCount
      : sectionPhotoCounts.get(selectedSection)?.total || 0;

  // Filter sections by search query if list is long
  const filteredSections = useMemo(() => {
    if (!filterQuery.trim()) return sections;
    const q = filterQuery.toLowerCase().trim();
    return sections.filter((s) => s.name.toLowerCase().includes(q));
  }, [sections, filterQuery]);

  return (
    <div className="pgpm-dropdown" ref={dropdownRef}>
      <button
        type="button"
        className={`pgpm-dropdown-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={`Filter by section: ${selectedLabel}`}
      >
        <span className="pgpm-dropdown-icon">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </span>
        <span className="pgpm-dropdown-label" title={selectedLabel}>
          {selectedLabel}
        </span>
        <span className="pgpm-dropdown-count-pill">{selectedCount}</span>
        <ChevronDownIcon
          className={`pgpm-dropdown-chevron ${isOpen ? 'rotate' : ''}`}
          style={{ width: 14, height: 14 }}
        />
      </button>

      {isOpen && (
        <div className="pgpm-dropdown-menu" role="listbox">
          {sections.length > 5 && (
            <div className="pgpm-dropdown-search-box">
              <SearchIcon width={13} height={13} className="pgpm-dropdown-search-icon" />
              <input
                type="text"
                className="pgpm-dropdown-search-input"
                placeholder="Find section…"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                autoFocus
              />
              {filterQuery && (
                <button
                  type="button"
                  className="pgpm-dropdown-search-clear"
                  onClick={() => setFilterQuery('')}
                  title="Clear"
                  aria-label="Clear section search"
                >
                  <XIcon width={11} height={11} />
                </button>
              )}
            </div>
          )}

          <div className="pgpm-dropdown-list">
            {/* "All Sections" option */}
            {(!filterQuery.trim() || 'all sections'.includes(filterQuery.toLowerCase())) && (
              <button
                type="button"
                className={`pgpm-dropdown-item ${selectedSection === 'all' ? 'selected' : ''}`}
                onClick={() => {
                  onSelectSection('all');
                  setIsOpen(false);
                }}
                role="option"
                aria-selected={selectedSection === 'all'}
              >
                <div className="pgpm-dropdown-item-left">
                  <span className="pgpm-dropdown-item-name">All Sections</span>
                </div>
                <div className="pgpm-dropdown-item-right">
                  <span className="pgpm-dropdown-badge">{totalCount}</span>
                  {selectedSection === 'all' && (
                    <CheckIcon className="pgpm-dropdown-check" style={{ width: 14, height: 14 }} />
                  )}
                </div>
              </button>
            )}

            {filteredSections.map((sec) => {
              const isSelected = selectedSection === sec.id;
              const counts = sectionPhotoCounts.get(sec.id) || { total: 0, defect: 0 };
              return (
                <button
                  key={sec.id}
                  type="button"
                  className={`pgpm-dropdown-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onSelectSection(sec.id);
                    setIsOpen(false);
                  }}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="pgpm-dropdown-item-left">
                    <span className="pgpm-dropdown-item-name" title={sec.name}>
                      {sec.name}
                    </span>
                  </div>
                  <div className="pgpm-dropdown-item-right">
                    {counts.defect > 0 && (
                      <span
                        className="pgpm-dropdown-badge-defect"
                        title={`${counts.defect} defect${counts.defect > 1 ? 's' : ''} in this section`}
                      >
                        {counts.defect} def
                      </span>
                    )}
                    <span className="pgpm-dropdown-badge">{counts.total}</span>
                    {isSelected && (
                      <CheckIcon className="pgpm-dropdown-check" style={{ width: 14, height: 14 }} />
                    )}
                  </div>
                </button>
              );
            })}

            {filteredSections.length === 0 && (
              <div className="pgpm-dropdown-empty">No matching sections</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PhotoGalleryPreviewModal({
  isOpen,
  onClose,
  photos,
  title = 'Inspection Photo Evidence Gallery',
  vesselName,
  allSections = [],
  locked = false,
  onDownloadZip,
  onPhotoToggled,
  onPhotoUpdated,
  currentSectionId,
  onMoveToSection,
  onMoveToQuestion,
}: PhotoGalleryPreviewModalProps) {
  const activePhotos = useMemo(() => photos.filter((p) => !p.deletedAt), [photos]);

  const [activeFilter, setActiveFilter] = useState<'all' | 'defect' | 'normal'>('all');
  const [selectedSection, setSelectedSection] = useState<string>(currentSectionId || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewerPhotoIndex, setViewerPhotoIndex] = useState<number | null>(null);

  // Sync selected section when modal opens or currentSectionId changes
  useEffect(() => {
    if (isOpen) {
      if (currentSectionId && allSections.some((s) => s.id === currentSectionId)) {
        setSelectedSection(currentSectionId);
      } else {
        setSelectedSection('all');
      }
    }
  }, [isOpen, currentSectionId, allSections]);

  // Section lookup map
  const sectionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of allSections) {
      map.set(s.id, s.name);
    }
    return map;
  }, [allSections]);

  // Section photo counts map (total + defect)
  const sectionPhotoCounts = useMemo(() => {
    const counts = new Map<string, { total: number; defect: number }>();
    for (const p of activePhotos) {
      const secId = p.inspectionSectionId || 'unassigned';
      const cur = counts.get(secId) || { total: 0, defect: 0 };
      cur.total += 1;
      if (p.isDefect) cur.defect += 1;
      counts.set(secId, cur);
    }
    return counts;
  }, [activePhotos]);

  // Global counts
  const defectCount = useMemo(() => activePhotos.filter((p) => !!p.isDefect).length, [activePhotos]);
  const normalCount = activePhotos.length - defectCount;

  // Filtered photos
  const filteredPhotos = useMemo(() => {
    return activePhotos.filter((p) => {
      // 1. Defect/Normal Filter
      if (activeFilter === 'defect' && !p.isDefect) return false;
      if (activeFilter === 'normal' && p.isDefect) return false;

      // 2. Section Filter
      if (selectedSection !== 'all') {
        const secId = p.inspectionSectionId;
        if (secId !== selectedSection) return false;
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const descMatch = p.description ? String(p.description).toLowerCase().includes(q) : false;
        const secName = p.inspectionSectionId ? sectionMap.get(p.inspectionSectionId) || '' : '';
        const secMatch = secName.toLowerCase().includes(q);
        if (!descMatch && !secMatch) return false;
      }

      return true;
    });
  }, [activePhotos, activeFilter, selectedSection, searchQuery, sectionMap]);

  // Load photo URLs
  useEffect(() => {
    if (!isOpen || activePhotos.length === 0) return;
    let isCancelled = false;

    const ids = activePhotos.map((p) => p.id);
    void getPhotoUrls(ids).then((loadedUrls) => {
      if (!isCancelled) {
        setUrls((prev) => ({ ...prev, ...loadedUrls }));
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, activePhotos]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewerPhotoIndex === null) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, viewerPhotoIndex]);

  // Clear all filters handler
  const handleResetFilters = () => {
    setActiveFilter('all');
    setSelectedSection('all');
    setSearchQuery('');
  };

  const hasActiveFilters = activeFilter !== 'all' || selectedSection !== 'all' || searchQuery.trim() !== '';

  if (!isOpen) return null;

  return (
    <div
      className="pgpm-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && viewerPhotoIndex === null) {
          onClose();
        }
      }}
    >
      <div className="pgpm-modal">
        {/* ── Top Header Bar ── */}
        <div className="pgpm-header">
          <div className="pgpm-header-left">
            <div className="pgpm-header-icon">
              <EyeIcon width={22} height={22} />
            </div>
            <div className="pgpm-header-text">
              <div className="pgpm-title-row">
                <h2 className="pgpm-title">{title}</h2>
                <span className="pgpm-count-badge">
                  {filteredPhotos.length} of {activePhotos.length}
                </span>
                {vesselName && (
                  <span className="pgpm-vessel-pill" title={vesselName}>
                    <ShipIcon style={{ width: 12, height: 12 }} />
                    {vesselName}
                  </span>
                )}
              </div>
              <p className="pgpm-subtitle">
                High-resolution inspection record viewer • Click any photo to inspect, zoom, or edit details
              </p>
            </div>
          </div>

          <div className="pgpm-header-actions">
            {onDownloadZip && activePhotos.length > 0 && (
              <button
                type="button"
                className="btn btn-outline btn-sm pgpm-download-btn"
                onClick={() => onDownloadZip('all')}
                title="Download all photos as ZIP archive"
              >
                <DownloadIcon style={{ width: 14, height: 14 }} />
                <span>Download All</span>
              </button>
            )}
            <button
              type="button"
              className="pgpm-close-btn"
              onClick={onClose}
              aria-label="Close photo preview gallery"
              title="Close gallery (Esc)"
            >
              <XIcon width={18} height={18} />
            </button>
          </div>
        </div>

        {/* ── Filter & Search Toolbar ── */}
        <div className="pgpm-toolbar">
          <div className="pgpm-tabs">
            <button
              type="button"
              className={`pgpm-tab ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              <span>All Photos</span>
              <span className="pgpm-tab-badge">{activePhotos.length}</span>
            </button>
            <button
              type="button"
              className={`pgpm-tab tab-defect ${activeFilter === 'defect' ? 'active' : ''}`}
              onClick={() => setActiveFilter('defect')}
            >
              <WarningIcon style={{ width: 13, height: 13 }} />
              <span>Defects</span>
              <span className="pgpm-tab-badge">{defectCount}</span>
            </button>
            <button
              type="button"
              className={`pgpm-tab tab-normal ${activeFilter === 'normal' ? 'active' : ''}`}
              onClick={() => setActiveFilter('normal')}
            >
              <CheckIcon style={{ width: 13, height: 13 }} />
              <span>Satisfactory</span>
              <span className="pgpm-tab-badge">{normalCount}</span>
            </button>
          </div>

          <div className="pgpm-toolbar-right">
            {/* Modern Section Selector Dropdown */}
            {allSections.length > 1 && (
              <ModernSectionDropdown
                sections={allSections}
                selectedSection={selectedSection}
                onSelectSection={setSelectedSection}
                sectionPhotoCounts={sectionPhotoCounts}
                totalCount={activePhotos.length}
              />
            )}

            {/* Keyword Search Input with Clear Button */}
            <div className="pgpm-search-wrap">
              <span className="pgpm-search-icon">
                <SearchIcon width={14} height={14} />
              </span>
              <input
                type="text"
                className="pgpm-search-input"
                placeholder="Search remarks, sections…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="pgpm-search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <XIcon width={12} height={12} />
                </button>
              )}
            </div>

            {/* Reset Filters Shortcut (shown only if filters are applied) */}
            {hasActiveFilters && (
              <button
                type="button"
                className="pgpm-reset-btn"
                onClick={handleResetFilters}
                title="Reset all filters"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* ── Scrollable Photo Grid ── */}
        <div className="pgpm-body">
          {filteredPhotos.length === 0 ? (
            <div className="pgpm-empty">
              <div className="pgpm-empty-icon">
                <CameraIcon width={30} height={30} />
              </div>
              <h3 className="pgpm-empty-title">No matching photos found</h3>
              <p className="pgpm-empty-sub">
                No photographs match the current filter selection or search criteria.
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm pgpm-empty-reset-btn"
                  onClick={handleResetFilters}
                >
                  Clear Filters & Show All Photos
                </button>
              )}
            </div>
          ) : (
            <div className="pgpm-grid">
              {filteredPhotos.map((photo, pIdx) => {
                const url = urls[photo.id];
                const isDef = !!photo.isDefect;
                const secName = photo.inspectionSectionId
                  ? sectionMap.get(photo.inspectionSectionId) || 'Section Survey'
                  : 'Survey Photo';
                const desc = photo.description ? String(photo.description).trim() : '';

                return (
                  <div
                    key={photo.id}
                    className={`pgpm-card ${isDef ? 'is-defect' : ''}`}
                    onClick={() => {
                      const fullIdx = activePhotos.findIndex((p) => p.id === photo.id);
                      setViewerPhotoIndex(fullIdx >= 0 ? fullIdx : pIdx);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        const fullIdx = activePhotos.findIndex((p) => p.id === photo.id);
                        setViewerPhotoIndex(fullIdx >= 0 ? fullIdx : pIdx);
                      }
                    }}
                  >
                    <div className="pgpm-thumb-wrap">
                      {url ? (
                        <img
                          src={url}
                          alt={desc || `Inspection photo ${pIdx + 1}`}
                          className="pgpm-img"
                          loading="lazy"
                        />
                      ) : (
                        <div className="pgpm-img-placeholder">
                          <span className="pgpm-placeholder-spinner" />
                          <span>Loading photo…</span>
                        </div>
                      )}

                      {/* Top Badges */}
                      <div className="pgpm-card-top">
                        <span className="pgpm-seq-badge">#{pIdx + 1}</span>
                        {isDef ? (
                          <span className="pgpm-status-pill defect">
                            <WarningIcon style={{ width: 10, height: 10 }} />
                            DEFECT
                          </span>
                        ) : (
                          <span className="pgpm-status-pill normal">
                            <CheckIcon style={{ width: 10, height: 10 }} />
                            NORMAL
                          </span>
                        )}
                      </div>

                      {/* Hover Overlay */}
                      <div className="pgpm-card-overlay">
                        <span className="pgpm-inspect-pill">
                          <EyeIcon width={14} height={14} />
                          Inspect Photo
                        </span>
                      </div>
                    </div>

                    {/* Bottom Caption & Meta */}
                    <div className="pgpm-card-caption">
                      <span className="pgpm-card-section">{secName}</span>
                      {desc ? (
                        <p className={`pgpm-card-desc ${isDef ? 'defect' : ''}`}>{desc}</p>
                      ) : (
                        <p className="pgpm-card-desc empty">
                          {isDef ? 'Defect flagged during inspection' : 'Visual survey record'}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer Bar ── */}
        <div className="pgpm-footer">
          <div className="pgpm-footer-left">
            <span className="pgpm-footer-stat">
              <span className="pgpm-footer-dot normal" />
              <strong>{normalCount}</strong> Satisfactory
            </span>
            <span className="pgpm-footer-stat">
              <span className="pgpm-footer-dot defect" />
              <strong>{defectCount}</strong> Defects
            </span>
          </div>
          <div className="pgpm-footer-right">
            Showing <strong>{filteredPhotos.length}</strong> of <strong>{activePhotos.length}</strong> photo
            {activePhotos.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* ── Fullscreen Interactive Photo Viewer Modal (when any photo is clicked) ── */}
      {viewerPhotoIndex !== null && (
        <ImageViewerModal
          photos={activePhotos}
          initialIndex={viewerPhotoIndex}
          isOpen={viewerPhotoIndex !== null}
          onClose={() => setViewerPhotoIndex(null)}
          locked={locked}
          title={title}
          initialUrls={urls}
          onPhotoToggled={onPhotoToggled}
          onPhotoUpdated={onPhotoUpdated}
          allSections={allSections}
          currentSectionId={currentSectionId}
          onMoveToSection={onMoveToSection}
          onMoveToQuestion={onMoveToQuestion}
        />
      )}
    </div>
  );
}
