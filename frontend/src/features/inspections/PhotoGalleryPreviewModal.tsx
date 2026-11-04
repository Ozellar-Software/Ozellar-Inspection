import React, { useState, useEffect, useMemo } from 'react';
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
  const [selectedSection, setSelectedSection] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewerPhotoIndex, setViewerPhotoIndex] = useState<number | null>(null);

  // Section lookup map
  const sectionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of allSections) {
      map.set(s.id, s.name);
    }
    return map;
  }, [allSections]);

  // Counts
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
              <h2 className="pgpm-title">
                {title}
                <span className="pgpm-count-badge">
                  {filteredPhotos.length} of {activePhotos.length} Photos
                </span>
              </h2>
              <p className="pgpm-subtitle">
                {vesselName ? `${vesselName} • ` : ''}
                Click any photograph to inspect in full-resolution
              </p>
            </div>
          </div>

          <div className="pgpm-header-actions">
            {onDownloadZip && activePhotos.length > 0 && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => onDownloadZip('all')}
                title="Download all photos as ZIP archive"
                style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}
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
              <XIcon width={20} height={20} />
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
              All Photos
              <span className="pgpm-tab-badge">{activePhotos.length}</span>
            </button>
            <button
              type="button"
              className={`pgpm-tab tab-defect ${activeFilter === 'defect' ? 'active' : ''}`}
              onClick={() => setActiveFilter('defect')}
            >
              <WarningIcon style={{ width: 13, height: 13 }} />
              Defects
              <span className="pgpm-tab-badge">{defectCount}</span>
            </button>
            <button
              type="button"
              className={`pgpm-tab tab-normal ${activeFilter === 'normal' ? 'active' : ''}`}
              onClick={() => setActiveFilter('normal')}
            >
              <CheckIcon style={{ width: 13, height: 13 }} />
              Satisfactory
              <span className="pgpm-tab-badge">{normalCount}</span>
            </button>
          </div>

          <div className="pgpm-toolbar-right">
            {/* Section selector if multiple sections exist */}
            {allSections.length > 1 && (
              <select
                className="pgpm-section-select"
                value={selectedSection}
                onChange={(e) => setSelectedSection(e.target.value)}
                aria-label="Filter by section"
              >
                <option value="all">All Sections ({allSections.length})</option>
                {allSections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.name}
                  </option>
                ))}
              </select>
            )}

            {/* Keyword Search Input */}
            <div className="pgpm-search-wrap">
              <span className="pgpm-search-icon">
                <SearchIcon width={14} height={14} />
              </span>
              <input
                type="text"
                className="pgpm-search-input"
                placeholder="Search remarks / section…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* ── Scrollable Photo Grid ── */}
        <div className="pgpm-body">
          {filteredPhotos.length === 0 ? (
            <div className="pgpm-empty">
              <div className="pgpm-empty-icon">
                <CameraIcon width={28} height={28} />
              </div>
              <h3 className="pgpm-empty-title">No matching photos found</h3>
              <p className="pgpm-empty-sub">
                Try switching the filter tab or clearing your search query.
              </p>
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
                      // Find the index of this photo in the full activePhotos array
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
          <div>
            Showing <strong>{filteredPhotos.length}</strong> photo{filteredPhotos.length !== 1 ? 's' : ''}
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
