import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { can, isEditable, STATUS_LABELS, type InspectionStatus, type User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { localDelete, localWrite } from '../../offline/outbox';
import { prefetchInspectionPhotos } from '../../offline/photoQueue';
import { BackIcon, CameraIcon, PlusIcon, XIcon, EyeIcon, DownloadIcon, WarningIcon, TrashIcon, PdfIcon, EditIcon, CheckIcon, FileIcon, SearchIcon, SlashIcon } from '../../icons';
import { ConfirmDeleteModal } from '../../app/ConfirmDeleteModal';
import { useLightMode } from '../home/useLightMode';
import { downloadPhotosAsZip } from './photoDownload';
import { DeleteInspectionModal } from './DeleteInspectionModal';
import { PhotoGalleryPreviewModal } from './PhotoGalleryPreviewModal';
import { ReportPdfPreviewModal } from '../report/ReportPdfPreviewModal';
import { loadReportData } from '../report/reportData';
import { generateInspectionPdf } from '../report/pdf';
import { filterAndSortSectionsByName } from './sectionSearch';
import './SectionListPage.css';

// ─── Zone colour pills ────────────────────────────────────────────────────
const ZONE_COLORS: Record<string, { bg: string; text: string }> = {
  'Exterior':      { bg: '#E4F1F1', text: '#0A5F67' },
  'Outside':       { bg: '#E4F1F1', text: '#0A5F67' },
  'Machinery':     { bg: '#FBF1DE', text: '#C98A1A' },
  'Bridge':        { bg: '#E6F0FA', text: '#1F5C99' },
  'Cargo':         { bg: '#F1EBF9', text: '#7C3EC6' },
  'Safety':        { bg: '#E7F5EC', text: '#1F8A57' },
  'Living':        { bg: '#FBEAE6', text: '#C1432A' },
  'Accommodation': { bg: '#FBEAE6', text: '#C1432A' },
  'Deck':          { bg: '#E4F1F1', text: '#0A5F67' },
  'Structure':     { bg: '#EBF4F5', text: '#276269' },
  'General':       { bg: '#EEF1F2', text: '#5B6B76' },
};

export function normalizeZone(zone?: string | null): string {
  return (zone || '').trim().toLowerCase();
}

export function canonicalZone(zone?: string | null): string {
  if (!zone) return '';
  const trimmed = zone.trim();
  const lower = trimmed.toLowerCase();
  const known = Object.keys(ZONE_COLORS).find((k) => k.toLowerCase() === lower);
  if (known) return known;
  if (/^[A-Z0-9]{2,4}$/.test(trimmed)) return trimmed;
  return trimmed
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function zoneColor(zone?: string | null) {
  if (!zone) return { bg: '#EEF1F2', text: '#5B6B76' };
  const lower = zone.trim().toLowerCase();
  const entry = Object.entries(ZONE_COLORS).find(([k]) => k.toLowerCase() === lower);
  return entry ? entry[1] : { bg: '#EEF1F2', text: '#5B6B76' };
}

// ─── Progress fill colour based on completion ─────────────────────────────
function progressColor(pct: number): string {
  if (pct === 100) return 'var(--ok)';
  if (pct >= 50)   return 'var(--accent)';
  if (pct > 0)     return 'var(--warn)';
  return '#CBD3D8';
}

import { useCurrentUser } from '../../auth/useCurrentUser';

export function SectionListPage() {
  const nav = useNavigate();
  const { id: inspectionId } = useParams<{ id: string }>();
  const me = useCurrentUser();
  const [light, setLight] = useLightMode();
  const [showAddSection, setShowAddSection] = useState(false);
  const [addName, setAddName] = useState('');
  const [addZone, setAddZone] = useState('Exterior');
  const [isSaving, setIsSaving] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isReportPreviewModalOpen, setIsReportPreviewModalOpen] = useState(false);
  const [previewObservationReport, setPreviewObservationReport] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState<{ id: string; name: string; count: number; findingCount: number } | null>(null);
  const [sectionToToggleNA, setSectionToToggleNA] = useState<{ id: string; name: string; targetApplicable: boolean; doneCount: number; photoCount: number } | null>(null);
  const [recheckedAccess, setRecheckedAccess] = useState(false);
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'incomplete' | 'completed' | 'na'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'normal' | 'photo'>('all');
  const [zoneDropdownOpen, setZoneDropdownOpen] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);

  function closeAllDropdowns() {
    setZoneDropdownOpen(false);
    setStatusDropdownOpen(false);
    setTypeDropdownOpen(false);
  }

  function adjustMenuPosition(el: HTMLDivElement | null) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 12;
    if (rect.right > window.innerWidth - pad) {
      el.style.left = 'auto';
      el.style.right = '0';
    }
    if (rect.left < pad) {
      el.style.left = '0';
      el.style.right = 'auto';
    }
  }

  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (controlsRef.current && !controlsRef.current.contains(e.target as Node)) {
        setZoneDropdownOpen(false);
        setStatusDropdownOpen(false);
        setTypeDropdownOpen(false);
      }
    }
    if (zoneDropdownOpen || statusDropdownOpen || typeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('touchstart', handleClickOutside);
      };
    }
  }, [zoneDropdownOpen, statusDropdownOpen, typeDropdownOpen]);

  useEffect(() => {
    if (inspectionId) {
      void prefetchInspectionPhotos(inspectionId);
    }
  }, [inspectionId]);

  const inspection = useLiveQuery(() => (inspectionId ? db.inspections.get(inspectionId) : undefined), [inspectionId]);

  // The cached /me profile (incl. assigned vesselIds) can be briefly stale right after access to a
  // vessel was just granted (e.g. registering it inline via a Pre Purchase / Take Over report) — a
  // real grant that happened server-side within the last few minutes won't show up locally until /me
  // refetches. Before concluding access is genuinely denied, refetch once to rule that out.
  useEffect(() => {
    if (!inspection || !me.data || recheckedAccess) return;
    if (can(me.data, 'inspection.view', { inspection })) return;
    void me.refetch().finally(() => setRecheckedAccess(true));
  }, [inspection, me.data, recheckedAccess, me]);
  const rawSections = useLiveQuery(
    () => (inspectionId ? db.inspectionSections.where('inspectionId').equals(inspectionId).sortBy('position') : []), [inspectionId]) ?? [];
  // Filter out soft-deleted sections and group photo sections at the top by default
  const sections = useMemo(
    () =>
      rawSections
        .filter((s) => !(s as any).deletedAt)
        .sort((a, b) => Number(Boolean(b.photoOnly)) - Number(Boolean(a.photoOnly)) || a.position - b.position),
    [rawSections]
  );

  const sectionIdSet = useMemo(() => new Set(sections.map((s) => s.id)), [sections]);
  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections]);

  const questions = useLiveQuery(
    () => (inspectionId && sectionIds.length > 0
      ? db.inspectionQuestions.where('inspectionSectionId').anyOf(sectionIds).toArray()
      : []),
    [inspectionId, sectionIds]) ?? [];
  const responses = useLiveQuery(
    () => (inspectionId ? db.responses.where('inspectionId').equals(inspectionId).toArray() : []), [inspectionId]) ?? [];
  const photos = useLiveQuery(
    () => (inspectionId ? db.photos.where('inspectionId').equals(inspectionId).toArray() : []), [inspectionId]) ?? [];

  const activePhotos = useMemo(() => photos.filter((p) => !p.deletedAt), [photos]);
  const defectPhotos = useMemo(() => activePhotos.filter((p) => !!p.isDefect), [activePhotos]);

  const findings = useLiveQuery(
    () => (inspectionId ? db.findings.where('inspectionId').equals(inspectionId).toArray() : []), [inspectionId]) ?? [];

  const findingsBySection = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of findings) {
      if (f.deletedAt) continue;
      if (f.inspectionSectionId) {
        map.set(f.inspectionSectionId, (map.get(f.inspectionSectionId) ?? 0) + 1);
      }
    }
    return map;
  }, [findings]);

  const photosBySection = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of photos) {
      if (p.deletedAt) continue;
      if (p.inspectionSectionId) {
        map.set(p.inspectionSectionId, (map.get(p.inspectionSectionId) ?? 0) + 1);
      }
    }
    return map;
  }, [photos]);

  const progressBySection = useMemo(() => {
    const answeredByQuestion = new Map(responses.map((r) => [r.inspectionQuestionId, r.answer != null || r.applicable === false]));
    const map = new Map<string, { done: number; total: number }>();
    for (const q of questions) {
      const cur = map.get(q.inspectionSectionId) ?? { done: 0, total: 0 };
      cur.total++;
      if (answeredByQuestion.get(q.id)) cur.done++;
      map.set(q.inspectionSectionId, cur);
    }
    return map;
  }, [questions, responses]);

  const isMock = !inspection && inspectionId?.startsWith('mock');
  const mockSections = useMemo(() => isMock ? [
    { id: 'sec-photo-1', inspectionId, name: 'Deck Overview Photos', zone: 'Exterior', position: 0, photoOnly: true, isCustom: true, applicable: true },
    { id: 'sec-photo-2', inspectionId, name: 'Cargo Hold 1 & 2 Photos', zone: 'Cargo', position: 1, photoOnly: true, isCustom: true, applicable: true },
    { id: 'sec-1', inspectionId, name: 'Hull & Deck Structure', zone: 'Exterior', position: 2, photoOnly: false, isCustom: false, applicable: true },
    { id: 'sec-2', inspectionId, name: 'Main Engine & Generators', zone: 'Machinery', position: 3, photoOnly: false, isCustom: false, applicable: true },
    { id: 'sec-3', inspectionId, name: 'Bow Thruster & Tunnel', zone: 'Machinery', position: 4, photoOnly: false, isCustom: false, applicable: false },
    { id: 'sec-4', inspectionId, name: 'Life Saving Appliances', zone: 'Safety', position: 5, photoOnly: false, isCustom: false, applicable: true },
  ] as any[] : [], [isMock, inspectionId]);

  const displayInspection = isMock
    ? ({
        id: inspectionId,
        vesselName: 'M/V Ozellar Pioneer',
        status: 'in_progress',
        vesselType: 'Bulk Carrier',
        vesselId: 'vessel-mock',
      } as any)
    : inspection;

  const effectiveSections = isMock ? mockSections : sections;

  const availableZones = useMemo(() => {
    const map = new Map<string, string>(); // lowerKey -> canonical display name
    for (const s of effectiveSections) {
      if (s.zone && s.zone.trim()) {
        const lower = normalizeZone(s.zone);
        if (!map.has(lower)) {
          map.set(lower, canonicalZone(s.zone));
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [effectiveSections]);

  if (!displayInspection) return null;

  if (displayInspection.deletedAt) {
    return (
      <div className="page-wrap" style={{ padding: 32, textAlign: 'center' }}>
        <h2 style={{ color: 'var(--bad)', fontSize: 18, marginBottom: 8 }}>Inspection Deleted</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
          This inspection has been deleted and is no longer available.
        </p>
        <button className="btn btn-outline" onClick={() => nav('/')}>Back to Home</button>
      </div>
    );
  }

  if (!isMock && me.data && !can(me.data, 'inspection.view', { inspection: displayInspection })) {
    if (!recheckedAccess) return null; // briefly confirming the permission cache isn't just stale
    return (
      <div className="page-wrap" style={{ padding: 32, textAlign: 'center' }}>
        <h2 style={{ color: 'var(--bad)', fontSize: 18, marginBottom: 8 }}>Access Restricted</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
          You do not have permission to view inspections for this vessel.
        </p>
        <button className="btn btn-outline" onClick={() => nav('/')}>Back to Home</button>
      </div>
    );
  }

  // Filter sections: In Light mode, show ONLY photo-only sections
  const activeSections = light ? effectiveSections.filter((s) => s.photoOnly) : effectiveSections;

  let normalBadgeIdx = 0;
  const displaySections = activeSections.map((s) => {
    const p = progressBySection.get(s.id) ?? { done: 0, total: 0 };
    const pCount = photosBySection.get(s.id) ?? 0;
    const isApplicable = (s as any).applicable !== false;
    const badgeNumber = s.photoOnly ? 0 : (isApplicable ? ++normalBadgeIdx : 0);
    return {
      id: s.id, name: s.name, zone: s.zone, inspectionId: s.inspectionId,
      position: s.position, done: p.done, total: p.total, photoOnly: s.photoOnly, photoCount: pCount,
      badgeNumber, applicable: isApplicable,
    };
  });

  const normalDisplaySections = displaySections.filter((s) => !s.photoOnly);
  const photoDisplaySections = displaySections.filter((s) => s.photoOnly);

  const hasActiveFilters = searchQuery.trim() !== '' || zoneFilter !== 'all' || statusFilter !== 'all' || typeFilter !== 'all';

  function resetAllFilters() {
    setSearchQuery('');
    setZoneFilter('all');
    setStatusFilter('all');
    setTypeFilter('all');
    closeAllDropdowns();
  }

  // 1. Filter by dropdown criteria (Type, Zone, Status)
  const zoneAndStatusNormalSections = normalDisplaySections.filter((s) => {
    if (typeFilter === 'photo') return false;
    if (zoneFilter !== 'all' && normalizeZone(s.zone) !== normalizeZone(zoneFilter)) return false;
    if (statusFilter === 'na') return !s.applicable;
    if (statusFilter === 'incomplete') return s.applicable && s.total > 0 && s.done < s.total;
    if (statusFilter === 'completed') return s.applicable && (s.total === 0 || s.done >= s.total);
    return true;
  });

  const zoneAndStatusPhotoSections = photoDisplaySections.filter((s) => {
    if (typeFilter === 'normal') return false;
    if (zoneFilter !== 'all' && normalizeZone(s.zone) !== normalizeZone(zoneFilter)) return false;
    if (statusFilter === 'na') return false;
    if (statusFilter === 'incomplete' && s.photoCount > 0) return false;
    if (statusFilter === 'completed' && s.photoCount === 0) return false;
    return true;
  });

  // 2. Search ONLY by Section Name using professional search & ranking logic
  const filteredNormalSections = filterAndSortSectionsByName(zoneAndStatusNormalSections, searchQuery);
  const filteredPhotoSections = filterAndSortSectionsByName(zoneAndStatusPhotoSections, searchQuery);

  const totalFilteredSections = filteredNormalSections.length + filteredPhotoSections.length;

  // Overall progress (checklist questions - only applicable normal sections count)
  const applicableNormalSections = normalDisplaySections.filter((s) => s.applicable);
  const totalDone  = applicableNormalSections.reduce((a, s) => a + s.done, 0);
  const totalItems = applicableNormalSections.reduce((a, s) => a + s.total, 0);
  const overallPct = totalItems ? Math.round((totalDone / totalItems) * 100) : 0;

  // Photo-mode overall progress
  const donePhotoSecs = displaySections.filter((s) => s.photoCount > 0 || displayInspection.status !== 'in_progress').length;
  const photoPct = displaySections.length ? Math.round((donePhotoSecs / displaySections.length) * 100) : 0;

  const canAddSection = Boolean(me.data && can(me.data, 'inspection.addSection', { inspection: displayInspection }) && isEditable(displayInspection.status));
  const canDelete = Boolean(me.data && can(me.data, 'inspection.delete', { inspection: displayInspection }));
  const sectionsLocked = !isEditable(displayInspection.status);

  async function handleToggleApplicable(
    sectionId: string,
    name: string,
    targetApplicable: boolean,
    doneCount: number,
    photoCount: number,
  ) {
    if (!targetApplicable && (doneCount > 0 || photoCount > 0)) {
      setSectionToToggleNA({
        id: sectionId,
        name,
        targetApplicable: false,
        doneCount,
        photoCount,
      });
      return;
    }
    await localWrite('inspectionSections', sectionId, { applicable: targetApplicable });
  }

  async function handleDownloadInspectionPhotos(filter: 'all' | 'defect') {
    try {
      setIsDownloadingZip(true);
      const zipName = `${displayInspection?.vesselName || 'inspection'}_${filter === 'defect' ? 'defect_photos' : 'all_photos'}`;
      await downloadPhotosAsZip(activePhotos, {
        zipFilename: zipName,
        filter,
        onProgress: (_curr, _tot, msg) => setDownloadProgress(msg),
      });
    } catch (err: any) {
      alert(err.message || 'Failed to download inspection photos');
    } finally {
      setIsDownloadingZip(false);
      setDownloadProgress(null);
    }
  }

  async function handleDownloadPhotoReportPdf() {
    if (!inspectionId) return;
    setIsExportingPdf(true);
    try {
      const rep = await loadReportData(inspectionId);
      if (!rep) {
        alert('Could not load inspection data for report');
        return;
      }
      const blob = await generateInspectionPdf({
        ...rep,
        reportType: 'photo_only',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = (displayInspection?.vesselName || 'inspection').replace(/[^a-z0-9]+/gi, '-');
      a.download = `${slug}-photo-section-report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to generate photo report PDF');
    } finally {
      setIsExportingPdf(false);
    }
  }

  async function handleCreatePhotoSection(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim() || !inspectionId) return;
    setIsSaving(true);
    try {
      const sectionId = crypto.randomUUID();
      await localWrite('inspectionSections', sectionId, {
        inspectionId,
        templateSr: null,
        zone: canonicalZone(addZone.trim() || 'General'),
        name: addName.trim(),
        position: sections.length,
        photoOnly: true,
        isCustom: true,
      });
      setAddName('');
      setShowAddSection(false);
    } catch (err) {
      console.error('Failed to create photo section', err);
    } finally {
      setIsSaving(false);
    }
  }

  function startRenameSection(e: React.MouseEvent, sectionId: string, currentName: string) {
    e.stopPropagation();
    setRenamingSectionId(sectionId);
    setRenameValue(currentName);
  }

  async function saveRenameSection(sectionId: string) {
    const name = renameValue.trim();
    setRenamingSectionId(null);
    if (!name) return;
    const current = await db.inspectionSections.get(sectionId);
    if (current && current.name === name) return;
    await localWrite('inspectionSections', sectionId, { name });
  }

  function renderSectionCard(s: (typeof displaySections)[number], badgeNumber: number) {
    const isPhoto = s.photoOnly;
    const isNA = !isPhoto && !s.applicable;
    const pCount = s.photoCount;
    const hasPhotos = pCount > 0;
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    const fillColor = isPhoto
      ? (hasPhotos ? '#10b981' : '#f59e0b')
      : isNA
        ? '#94a3b8'
        : progressColor(pct);
    const zone = zoneColor(s.zone);

    return (
      <div
        key={s.id}
        id={`sec-row-${s.id}`}
        className={`section-card-row ${isNA ? 'is-na' : ''}`}
        onClick={() => {
          if (inspectionId) {
            sessionStorage.setItem(`oz_last_sec_${inspectionId}`, `sec-row-${s.id}`);
          }
          nav(`/inspections/${inspectionId}/sections/${s.id}`);
        }}
      >
        {/* Section number or camera badge or N/A badge */}
        <div
          className="sec-card-badge"
          style={{
            background: isPhoto ? '#f0fdfa' : isNA ? '#f1f5f9' : fillColor + '15',
            border: `1.5px solid ${isPhoto ? '#2dd4bf' : isNA ? '#cbd5e1' : fillColor + '40'}`,
            color: isPhoto ? '#0d9488' : isNA ? '#64748b' : fillColor,
          }}
        >
          {isPhoto ? <CameraIcon width={18} height={18} /> : isNA ? <SlashIcon width={16} height={16} /> : badgeNumber}
        </div>

        <div className="sec-card-content">
          <div className="sec-card-header-row">
            {renamingSectionId === s.id ? (
              <div className="sec-card-rename-group" onClick={(e) => e.stopPropagation()}>
                <input
                  className="sec-card-rename-input"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveRenameSection(s.id);
                    if (e.key === 'Escape') setRenamingSectionId(null);
                  }}
                />
                <button
                  type="button"
                  className="sec-card-rename-confirm"
                  aria-label="Save name"
                  onClick={() => void saveRenameSection(s.id)}
                >
                  <CheckIcon width={13} height={13} />
                </button>
                <button
                  type="button"
                  className="sec-card-rename-cancel"
                  aria-label="Cancel rename"
                  onClick={() => setRenamingSectionId(null)}
                >
                  <XIcon width={13} height={13} />
                </button>
              </div>
            ) : (
              <span className="sec-card-name" style={{ color: isNA ? '#64748b' : undefined }}>{s.name}</span>
            )}
            {s.zone && (
              <span className="sec-card-zone" style={{ background: zone.bg, color: zone.text }}>
                {canonicalZone(s.zone)}
              </span>
            )}
            {isPhoto && (
              <span className="sec-card-photo-pill">
                PHOTO SECTION
              </span>
            )}
            {isNA && (
              <span className="sec-card-na-pill">
                <SlashIcon width={10} height={10} /> NOT APPLICABLE
              </span>
            )}
          </div>

          {/* Progress bar */}
          {isPhoto ? (
            <div className="sec-card-progress-row">
              <div className="sec-card-progress-track">
                <div style={{
                  height: '100%',
                  width: hasPhotos ? '100%' : '0%',
                  background: 'linear-gradient(90deg, #0A828A 0%, #10b981 100%)',
                  borderRadius: 99,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span className="sec-card-photo-stat" style={{ color: hasPhotos ? '#0d9488' : '#94a3b8' }}>
                <CameraIcon width={13} height={13} />
                {pCount} photo{pCount !== 1 ? 's' : ''}
              </span>
            </div>
          ) : isNA ? (
            <div className="sec-card-progress-row">
              <div className="sec-card-progress-track" style={{ background: '#e2e8f0' }}>
                <div style={{ height: '100%', width: '100%', background: '#94a3b8', borderRadius: 99, opacity: 0.35 }} />
              </div>
              <span className="sec-card-progress-stat" style={{ color: '#64748b', minWidth: 'auto', fontWeight: 600 }}>
                Not Applicable · Excluded from report
              </span>
            </div>
          ) : (
            <div className="sec-card-progress-row">
              <div className="sec-card-progress-track">
                <div style={{ height: '100%', width: `${pct}%`, background: fillColor, borderRadius: 99, transition: 'width 0.3s ease' }} />
              </div>
              <span className="sec-card-progress-stat">
                {s.done}/{s.total} · {pct}%
              </span>
            </div>
          )}
        </div>

        {/* ── Right-Side Action Controls & Navigation Indicator ── */}
        <div className="sec-card-right-group" onClick={(e) => e.stopPropagation()}>
          {isPhoto && !sectionsLocked && renamingSectionId !== s.id && (
            <div className="sec-card-actions-cluster">
              <button
                type="button"
                className="sec-card-icon-btn rename"
                aria-label="Rename this photo section"
                title="Rename photo section"
                onClick={(e) => startRenameSection(e, s.id, s.name)}
              >
                <EditIcon width={13} height={13} />
              </button>
              <button
                type="button"
                className="sec-card-icon-btn delete"
                aria-label="Delete this photo section"
                title="Delete photo section"
                onClick={(e) => {
                  e.stopPropagation();
                  setSectionToDelete({
                    id: s.id,
                    name: s.name,
                    count: s.photoCount,
                    findingCount: findingsBySection.get(s.id) || 0,
                  });
                }}
              >
                <TrashIcon width={13} height={13} />
              </button>
            </div>
          )}

          {!isPhoto && !sectionsLocked && (
            <button
              type="button"
              className={`sec-card-na-btn ${isNA ? 'restore' : ''}`}
              title={isNA ? 'Mark as applicable for this inspection' : 'Mark as Not Applicable for this inspection'}
              onClick={(e) => {
                e.stopPropagation();
                void handleToggleApplicable(s.id, s.name, isNA, s.done, s.photoCount);
              }}
            >
              {isNA ? (
                <>
                  <CheckIcon width={11} height={11} />
                  <span>Mark Applicable</span>
                </>
              ) : (
                <>
                  <SlashIcon width={11} height={11} />
                  <span>Mark N/A</span>
                </>
              )}
            </button>
          )}

          {/* Chevron */}
          <div
            className="sec-card-arrow-wrap"
            title="Open section"
            onClick={() => {
              if (inspectionId) {
                sessionStorage.setItem(`oz_last_sec_${inspectionId}`, `sec-row-${s.id}`);
              }
              nav(`/inspections/${inspectionId}/sections/${s.id}`);
            }}
          >
            <svg viewBox="0 0 24 24" className="sec-card-arrow" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Sub-header / appbar ── */}
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => nav('/')}>
          <BackIcon />
        </button>
        <div className="title-wrap">
          <h1>{displayInspection.vesselName || 'Inspection'}</h1>
          <div className="sub">{STATUS_LABELS[displayInspection.status as InspectionStatus] || displayInspection.status}</div>
        </div>
        {canDelete && (
          <button
            type="button"
            className="appbar-delete-btn"
            onClick={() => setShowDeleteModal(true)}
            title="Delete this inspection (Admin only)"
          >
            <TrashIcon width={15} height={15} />
            <span className="appbar-delete-text">Delete</span>
          </button>
        )}
      </div>

      <div className="page-wrap section-list-wrap" style={{ paddingTop: 20 }}>

        {/* ── Light Mode Top Alert Banner ── */}
        {light && (
          <div className="light-mode-inspection-alert">
            <div className="lmia-content">
              <span className="lmia-icon">
                <CameraIcon width={20} height={20} />
              </span>
              <div>
                <div className="lmia-title">Light Mode Active</div>
                <div className="lmia-desc">Showing Photo sections only. Standard checklist questions are hidden.</div>
              </div>
            </div>
            <button
              type="button"
              className="lmia-btn"
              onClick={() => setLight(false)}
            >
              Show All Sections
            </button>
          </div>
        )}

        {/* ── Premium Progress Card ── */}
        <div className="premium-progress-card">
          <div className="ppc-chart">
            <svg viewBox="0 0 100 100" className="ppc-chart-svg">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#f1f5f9" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="45" fill="none"
                stroke="url(#progress-grad)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray="282.74"
                strokeDashoffset={282.74 - (282.74 * (light ? photoPct : overallPct)) / 100}
                style={{ transition: 'stroke-dashoffset 1s ease-out' }}
              />
              <defs>
                <linearGradient id="progress-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4ECDC4" />
                  <stop offset="100%" stopColor="#0d9488" />
                </linearGradient>
              </defs>
            </svg>
            <div className="ppc-chart-text">{light ? `${photoPct}%` : `${overallPct}%`}</div>
          </div>
          <div className="ppc-content">
            <h2 className="ppc-title">{light ? 'Photo Section Progress' : 'Inspection Progress'}</h2>
            <p className="ppc-desc">
              {light ? (
                displaySections.length === 0 ? (
                  'No photo sections configured for this inspection.'
                ) : (
                  <>You have completed <b>{donePhotoSecs}</b> out of {displaySections.length} photo section{displaySections.length === 1 ? '' : 's'} with photos.</>
                )
              ) : (
                displaySections.length === 0 ? (
                  'No checklist sections configured for this vessel type. You can add photo sections below.'
                ) : (
                  <>You have answered <b>{totalDone}</b> out of {totalItems} questions.</>
                )
              )}
            </p>
            <div className="ppc-stats">
              <div className="ppc-stat-item">
                <span className="ppc-stat-label">{light ? 'Photo Sections' : 'Sections'}</span>
                <span className="ppc-stat-value">{displaySections.length}</span>
              </div>
              <div className="ppc-divider" />
              <div className="ppc-stat-item">
                <span className="ppc-stat-label">{light ? 'Total Photos' : 'Status'}</span>
                <span
                  className="ppc-stat-value"
                  style={{
                    color: light
                      ? '#0d9488'
                      : (overallPct === 100 ? '#10b981' : '#f59e0b')
                  }}
                >
                  {light
                    ? photos.filter((p) => !p.deletedAt).length
                    : (overallPct === 100 ? 'Completed' : 'In Progress')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Inspection Photo Download Bar ── */}
        {activePhotos.length > 0 && (
          <div className="inspection-photos-download-bar">
            <div className="ipdb-info">
              <span className="ipdb-icon-wrap">
                <CameraIcon width={18} height={18} />
              </span>
              <div className="ipdb-text">
                <span className="ipdb-title">{activePhotos.length} Inspection Photos</span>
                <span className="ipdb-sub">
                  {defectPhotos.length > 0 ? (
                    <span className="ipdb-defect-highlight">
                      {defectPhotos.length} Defect photo{defectPhotos.length > 1 ? 's' : ''} recorded
                    </span>
                  ) : (
                    'All photos in good/normal condition'
                  )}
                </span>
              </div>
            </div>
            <div className="ipdb-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm btn-preview-photos"
                onClick={() => setIsPreviewModalOpen(true)}
                title="Preview all inspection photos in visual gallery"
              >
                <EyeIcon style={{ width: 15, height: 15 }} />
                <span>Preview Photos ({activePhotos.length})</span>
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm btn-preview-report"
                onClick={() => setIsReportPreviewModalOpen(true)}
                title="Review official Report PDF with live high-resolution preview"
                style={{
                  background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                  borderColor: '#0f766e',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <FileIcon style={{ width: 14, height: 14 }} />
                <span>Report Review</span>
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => void handleDownloadPhotoReportPdf()}
                disabled={isExportingPdf}
                title="Download Photo Report as PDF"
              >
                <PdfIcon style={{ width: 14, height: 14 }} />
                {isExportingPdf ? 'Exporting PDF…' : 'Photo Report (PDF)'}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => handleDownloadInspectionPhotos('all')}
                disabled={isDownloadingZip}
                title="Download all photos across all sections as ZIP"
              >
                <DownloadIcon style={{ width: 14, height: 14 }} />
                Download All ({activePhotos.length})
              </button>
              {defectPhotos.length > 0 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm btn-defect-download"
                  onClick={() => handleDownloadInspectionPhotos('defect')}
                  disabled={isDownloadingZip}
                  title="Download only defect photos as ZIP"
                >
                  <WarningIcon style={{ width: 14, height: 14 }} />
                  Download Defects ({defectPhotos.length})
                </button>
              )}
            </div>
          </div>
        )}

        {downloadProgress && (
          <div className="ipdb-progress-banner">
            <div className="ivm-spinner-sm" />
            <span>{downloadProgress}</span>
          </div>
        )}

        {/* ── Report button ── */}
        {(() => {
          // Pre Purchase / Take Over reports skip the Tech Manager → Director chain entirely — an Admin
          // approves (or, for Pre Purchase, never approves) the vessel directly, so there's nothing to "submit".
          const isOrdinaryInspection = ((displayInspection as any).reportCategory ?? 'inspection') === 'inspection';
          const canSubmit = isOrdinaryInspection && me.data ? can(me.data, 'inspection.submit', { inspection: displayInspection }) : false;
          if (canSubmit) {
            return (
              <div className="section-pad fab-new" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {light ? (
                  <>
                    <button
                      className="btn btn-primary btn-block"
                      style={{
                        borderRadius: 12, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)', border: 'none',
                      }}
                      onClick={() => nav(`/inspections/${inspectionId}/report?mode=photo`)}
                    >
                      <CameraIcon width={18} height={18} />
                      Submit Photo Section Report
                    </button>
                    <button
                      className="btn btn-outline btn-block"
                      style={{ borderRadius: 12, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13 }}
                      onClick={() => nav(`/inspections/${inspectionId}/report?mode=full`)}
                    >
                      Full Checklist Report
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-primary btn-block"
                      style={{ borderRadius: 12, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                      onClick={() => nav(`/inspections/${inspectionId}/report?mode=full`)}
                    >
                      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                      </svg>
                      Submit for Approval
                    </button>
                    <button
                      className="btn btn-outline btn-block"
                      style={{
                        borderRadius: 12, minHeight: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        borderColor: '#0d9488', color: '#0d9488', fontSize: 13.5, fontWeight: 600,
                      }}
                      onClick={() => nav(`/inspections/${inspectionId}/report?mode=photo`)}
                    >
                      <CameraIcon width={16} height={16} />
                      Submit Photo Section Report
                    </button>
                  </>
                )}
              </div>
            );
          }
          return (
            <div className="section-pad fab-new" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <button
                className="btn btn-primary btn-block"
                style={{ borderRadius: 12, minHeight: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onClick={() => nav(`/inspections/${inspectionId}/report?mode=full`)}
              >
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                {displayInspection.status === 'pending_tm' || displayInspection.status === 'pending_director' ? 'Review Inspection' : 'Full Report'}
              </button>
              <button
                className="btn btn-outline btn-block"
                style={{ borderRadius: 12, minHeight: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderColor: '#0d9488', color: '#0d9488' }}
                onClick={() => nav(`/inspections/${inspectionId}/report?mode=photo`)}
              >
                <CameraIcon width={16} height={16} />
                Photo Report
              </button>
              <button
                className="btn btn-outline btn-block"
                style={{ borderRadius: 12, minHeight: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderColor: '#b45309', color: '#b45309' }}
                onClick={() => { setPreviewObservationReport(true); setIsReportPreviewModalOpen(true); }}
              >
                <WarningIcon width={16} height={16} />
                Observation Report
              </button>
            </div>
          );
        })()}

        {/* ── Search & Filter Controls Bar ── */}
        {displaySections.length > 0 && (
          <div ref={controlsRef} className="sec-controls-bar">
              {/* Search input */}
              <div className="sec-search-wrap">
                <span className="sec-search-icon"><SearchIcon width={16} height={16} /></span>
                <input
                  type="text"
                  placeholder={
                    (displayInspection as any).reportCategory === 'take_over'
                      ? 'Search take over sections by name…'
                      : (displayInspection as any).reportCategory === 'pre_purchase'
                      ? 'Search pre purchase sections by name…'
                      : light
                      ? 'Search photo sections by name…'
                      : 'Search sections by name…'
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setSearchQuery('');
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="sec-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <XIcon width={14} height={14} />
                  </button>
                )}
              </div>

              <div className="sec-ctrl-divider" />

              {/* Filters Row */}
              <div className="sec-filters-row">
                {/* Zone Filter Dropdown */}
                {availableZones.length > 1 && (
                  <div className={`sec-premium-filter-wrap ${zoneDropdownOpen ? 'open' : ''}`}>
                    <button
                      type="button"
                      className={`sec-premium-dropdown-trigger ${zoneDropdownOpen ? 'open' : ''} ${zoneFilter !== 'all' ? 'active' : ''}`}
                      onClick={() => {
                        setZoneDropdownOpen(!zoneDropdownOpen);
                        setStatusDropdownOpen(false);
                        setTypeDropdownOpen(false);
                      }}
                    >
                      <span className="sec-dropdown-label">Zone:</span>
                      <span className="sec-dropdown-val">
                        {zoneFilter === 'all' ? 'All' : canonicalZone(zoneFilter)}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="sec-dropdown-chevron">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {zoneDropdownOpen && (
                      <div ref={adjustMenuPosition} className="sec-premium-dropdown-menu">
                        <button
                          type="button"
                          className={`sec-dropdown-item ${zoneFilter === 'all' ? 'active' : ''}`}
                          onClick={() => {
                            setZoneFilter('all');
                            setZoneDropdownOpen(false);
                          }}
                        >
                          <span>All Zones</span>
                          <span className="sec-item-count">{activeSections.length}</span>
                        </button>
                        {availableZones.map((z) => {
                          const count = activeSections.filter((s) => normalizeZone(s.zone) === normalizeZone(z)).length;
                          const isActive = normalizeZone(zoneFilter) === normalizeZone(z);
                          return (
                            <button
                              key={z}
                              type="button"
                              className={`sec-dropdown-item ${isActive ? 'active' : ''}`}
                              onClick={() => {
                                setZoneFilter(z);
                                setZoneDropdownOpen(false);
                              }}
                            >
                              <span>{z}</span>
                              <span className="sec-item-count">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Status Filter Dropdown */}
                <div className={`sec-premium-filter-wrap ${statusDropdownOpen ? 'open' : ''}`}>
                  <button
                    type="button"
                    className={`sec-premium-dropdown-trigger ${statusDropdownOpen ? 'open' : ''} ${statusFilter !== 'all' ? 'active' : ''}`}
                    onClick={() => {
                      setStatusDropdownOpen(!statusDropdownOpen);
                      setZoneDropdownOpen(false);
                      setTypeDropdownOpen(false);
                    }}
                  >
                    <span className="sec-dropdown-label">Status:</span>
                    <span className="sec-dropdown-val">
                      {statusFilter === 'all' ? 'All' : statusFilter === 'incomplete' ? 'Incomplete' : statusFilter === 'completed' ? 'Completed' : 'Not Applicable'}
                    </span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="sec-dropdown-chevron">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {statusDropdownOpen && (
                    <div ref={adjustMenuPosition} className="sec-premium-dropdown-menu">
                      <button
                        type="button"
                        className={`sec-dropdown-item ${statusFilter === 'all' ? 'active' : ''}`}
                        onClick={() => {
                          setStatusFilter('all');
                          setStatusDropdownOpen(false);
                        }}
                      >
                        <span>All Status</span>
                        <span className="sec-item-count">{activeSections.length}</span>
                      </button>
                      <button
                        type="button"
                        className={`sec-dropdown-item ${statusFilter === 'incomplete' ? 'active' : ''}`}
                        onClick={() => {
                          setStatusFilter('incomplete');
                          setStatusDropdownOpen(false);
                        }}
                      >
                        <span>Incomplete</span>
                        <span className="sec-item-count">
                          {activeSections.filter((s) => s.photoOnly ? (photosBySection.get(s.id) ?? 0) === 0 : ((s as any).applicable !== false && ((progressBySection.get(s.id)?.total ?? 0) === 0 || (progressBySection.get(s.id)?.done ?? 0) < (progressBySection.get(s.id)?.total ?? 0)))).length}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`sec-dropdown-item ${statusFilter === 'completed' ? 'active' : ''}`}
                        onClick={() => {
                          setStatusFilter('completed');
                          setStatusDropdownOpen(false);
                        }}
                      >
                        <span>Completed</span>
                        <span className="sec-item-count">
                          {activeSections.filter((s) => s.photoOnly ? (photosBySection.get(s.id) ?? 0) > 0 : ((s as any).applicable !== false && (progressBySection.get(s.id)?.total ?? 0) > 0 && (progressBySection.get(s.id)?.done ?? 0) >= (progressBySection.get(s.id)?.total ?? 0))).length}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`sec-dropdown-item ${statusFilter === 'na' ? 'active' : ''}`}
                        onClick={() => {
                          setStatusFilter('na');
                          setStatusDropdownOpen(false);
                        }}
                      >
                        <span>Not Applicable</span>
                        <span className="sec-item-count">
                          {activeSections.filter((s) => !s.photoOnly && (s as any).applicable === false).length}
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Type Filter Dropdown (when both checklist and photo sections exist) */}
                {!light && normalDisplaySections.length > 0 && photoDisplaySections.length > 0 && (
                  <div className={`sec-premium-filter-wrap ${typeDropdownOpen ? 'open' : ''}`}>
                    <button
                      type="button"
                      className={`sec-premium-dropdown-trigger ${typeDropdownOpen ? 'open' : ''} ${typeFilter !== 'all' ? 'active' : ''}`}
                      onClick={() => {
                        setTypeDropdownOpen(!typeDropdownOpen);
                        setZoneDropdownOpen(false);
                        setStatusDropdownOpen(false);
                      }}
                    >
                      <span className="sec-dropdown-label">Type:</span>
                      <span className="sec-dropdown-val">
                        {typeFilter === 'all' ? 'All' : typeFilter === 'normal' ? 'Inspection Section' : 'Photo Section'}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="sec-dropdown-chevron">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {typeDropdownOpen && (
                      <div ref={adjustMenuPosition} className="sec-premium-dropdown-menu align-right">
                        <button
                          type="button"
                          className={`sec-dropdown-item ${typeFilter === 'all' ? 'active' : ''}`}
                          onClick={() => {
                            setTypeFilter('all');
                            setTypeDropdownOpen(false);
                          }}
                        >
                          <span>All Types</span>
                          <span className="sec-item-count">{displaySections.length}</span>
                        </button>
                        <button
                          type="button"
                          className={`sec-dropdown-item ${typeFilter === 'normal' ? 'active' : ''}`}
                          onClick={() => {
                            setTypeFilter('normal');
                            setTypeDropdownOpen(false);
                          }}
                        >
                          <span>Inspection Section</span>
                          <span className="sec-item-count">{normalDisplaySections.length}</span>
                        </button>
                        <button
                          type="button"
                          className={`sec-dropdown-item ${typeFilter === 'photo' ? 'active' : ''}`}
                          onClick={() => {
                            setTypeFilter('photo');
                            setTypeDropdownOpen(false);
                          }}
                        >
                          <span>Photo Section</span>
                          <span className="sec-item-count">{photoDisplaySections.length}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Reset button when any filter or search query is active */}
                {hasActiveFilters && (
                  <button
                    type="button"
                    className="sec-reset-filters-btn"
                    onClick={resetAllFilters}
                    title="Reset all filters and search"
                    aria-label="Reset all filters and search"
                  >
                    <XIcon width={13} height={13} />
                    <span className="sec-reset-text">Reset</span>
                  </button>
                )}
              </div>
            </div>
        )}

        {/* ── Section cards or Empty State ── */}
        {displaySections.length === 0 ? (
          <div className="empty-photo-sections-card">
            <div className="epsc-icon">
              <CameraIcon width={26} height={26} />
            </div>
            <h3 className="epsc-title">No Checklist Sections Configured</h3>
            <p className="epsc-desc">
              {light
                ? 'This inspection contains standard checklist question sections only. Switch to Normal Mode to view all checklist sections.'
                : 'No checklist sections have been configured for this vessel type yet. You can add photo sections below to conduct this inspection.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {light && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ borderRadius: 10, padding: '8px 20px', fontSize: 13 }}
                  onClick={() => setLight(false)}
                >
                  Switch to Normal Mode
                </button>
              )}
              {canAddSection && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ borderRadius: 10, padding: '10px 24px', fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setShowAddSection(true)}
                >
                  <PlusIcon width={15} height={15} /> Add Photo Section
                </button>
              )}
            </div>
          </div>
        ) : hasActiveFilters && totalFilteredSections === 0 ? (
          <div className="empty-search-sections-card">
            <div className="essc-icon">
              <SearchIcon width={24} height={24} />
            </div>
            <h3 className="essc-title">No matching sections</h3>
            <p className="essc-desc">
              {searchQuery.trim()
                ? `No sections found matching "${searchQuery}" with the active filters.`
                : 'No sections match the selected filter criteria.'}
            </p>
            <button
              type="button"
              className="btn btn-outline"
              onClick={resetAllFilters}
              style={{ borderRadius: 10, padding: '8px 20px', fontSize: 13 }}
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <>
            {/* ── Photo Sections Group (Rendered at TOP by default) ── */}
            {filteredPhotoSections.length > 0 && (
              <>
                <div className="section-list-header">
                  <div className="section-list-header-title" style={{ color: '#0d9488' }}>
                    <CameraIcon width={14} height={14} />
                    <span>
                      {hasActiveFilters
                        ? `Photo Sections (${filteredPhotoSections.length} of ${photoDisplaySections.length})`
                        : `Photo Sections (${photoDisplaySections.length})`}
                    </span>
                  </div>

                  {canAddSection && (
                    <button
                      type="button"
                      className="section-list-add-btn"
                      onClick={() => setShowAddSection(true)}
                    >
                      <PlusIcon width={14} height={14} /> <span>Add Photo Section</span>
                    </button>
                  )}
                </div>

                {filteredPhotoSections.map((s) => renderSectionCard(s, s.badgeNumber))}
              </>
            )}

            {/* ── Normal Inspection Checklist Sections Group (Rendered below photo sections) ── */}
            {!light && filteredNormalSections.length > 0 && (
              <>
                <div className="section-list-header" style={{ marginTop: filteredPhotoSections.length > 0 ? 22 : 8 }}>
                  <div className="section-list-header-title" style={{ color: '#64748b' }}>
                    <span>
                      {hasActiveFilters
                        ? `Inspection Sections (${filteredNormalSections.length} of ${normalDisplaySections.length})`
                        : `Inspection Sections (${normalDisplaySections.length})`}
                    </span>
                  </div>

                  {/* If no photo sections are visible at top, show Add Photo Section button on this header */}
                  {canAddSection && filteredPhotoSections.length === 0 && (
                    <button
                      type="button"
                      className="section-list-add-btn"
                      onClick={() => setShowAddSection(true)}
                    >
                      <PlusIcon width={14} height={14} /> <span>Add Photo Section</span>
                    </button>
                  )}
                </div>

                {filteredNormalSections.map((s) => renderSectionCard(s, s.badgeNumber))}
              </>
            )}
          </>
        )}

        {canDelete && (
          <div className="admin-inspection-danger-card">
            <div className="aidc-text">
              <span className="aidc-title">Admin Management</span>
              <span className="aidc-sub">Permanently delete this entire inspection and all its associated checklist data.</span>
            </div>
            <button
              type="button"
              className="aidc-btn"
              onClick={() => setShowDeleteModal(true)}
            >
              <TrashIcon width={14} height={14} />
              <span>Delete Inspection</span>
            </button>
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>

      {/* ── Add Photo Section Modal ── */}
      {showAddSection && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 16, backdropFilter: 'blur(3px)'
        }}>
          <div style={{
            background: '#ffffff', borderRadius: 16, width: '100%', maxWidth: 440,
            padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.18)', position: 'relative'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 8, background: '#ccfbf1',
                  color: '#0d9488', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <CameraIcon width={18} height={18} />
                </span>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: '#0f172a' }}>Add Photo Section</h2>
              </div>
              <button
                onClick={() => setShowAddSection(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}
              >
                <XIcon width={20} height={20} />
              </button>
            </div>
            <form onSubmit={handleCreatePhotoSection}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                  Zone
                </label>
                <input
                  className="input"
                  value={addZone}
                  onChange={(e) => setAddZone(e.target.value)}
                  placeholder="e.g. Outside, Machinery, Bridge, Cargo"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                  Section Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className="input"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  required autoFocus
                  placeholder="e.g. Deck Equipment Photos, Cargo Hold Photos"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
              </div>
              <div style={{
                padding: '10px 14px', borderRadius: 8, background: '#f0fdfa',
                border: '1px solid #99f6e4', color: '#0f766e', fontSize: 12, marginBottom: 18,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <CameraIcon width={16} height={16} />
                <span>This section holds photo evidence only without standard checklist questions.</span>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowAddSection(false)}
                  style={{ padding: '8px 16px', borderRadius: 8 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSaving}
                  style={{ padding: '8px 18px', borderRadius: 8 }}
                >
                  {isSaving ? 'Saving…' : 'Create Section'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isPreviewModalOpen && (
        <PhotoGalleryPreviewModal
          isOpen={isPreviewModalOpen}
          onClose={() => setIsPreviewModalOpen(false)}
          photos={activePhotos}
          title={`${displayInspection?.vesselName || 'Vessel'} Photo Gallery`}
          vesselName={displayInspection?.vesselName}
          allSections={sections}
          locked={sectionsLocked}
          onDownloadZip={handleDownloadInspectionPhotos}
        />
      )}

      {isReportPreviewModalOpen && inspectionId && (
        <ReportPdfPreviewModal
          isOpen={isReportPreviewModalOpen}
          onClose={() => { setIsReportPreviewModalOpen(false); setPreviewObservationReport(false); }}
          inspectionId={inspectionId}
          vesselName={displayInspection?.vesselName}
          defaultReportType={previewObservationReport ? 'observation' : (displayInspection as any)?.reportMode === 'photo' ? 'photo_only' : 'full'}
        />
      )}

      {canDelete && (
        <DeleteInspectionModal
          inspection={displayInspection}
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {
            nav('/');
          }}
        />
      )}

      {/* ── Delete Photo Section Confirmation Modal ── */}
      <ConfirmDeleteModal
        isOpen={Boolean(sectionToDelete)}
        onClose={() => setSectionToDelete(null)}
        onConfirm={async () => {
          if (!sectionToDelete) return;
          await localDelete('inspectionSections', sectionToDelete.id);
          setSectionToDelete(null);
        }}
        title="Delete Photo Section"
        description={<>Are you sure you want to delete <strong>{sectionToDelete?.name}</strong>?</>}
        subdesc={
          sectionToDelete && (sectionToDelete.count > 0 || sectionToDelete.findingCount > 0)
            ? `This will permanently remove ${sectionToDelete.count} photo(s) and ${sectionToDelete.findingCount} observation(s) in this section.`
            : 'This section will be removed from this inspection.'
        }
        confirmText="Yes, Delete Section"
      />

      {/* ── Mark Section as Not Applicable Confirmation Modal ── */}
      {sectionToToggleNA && (
        <ConfirmDeleteModal
          isOpen={Boolean(sectionToToggleNA)}
          onClose={() => setSectionToToggleNA(null)}
          onConfirm={async () => {
            if (!sectionToToggleNA) return;
            await localWrite('inspectionSections', sectionToToggleNA.id, { applicable: false });
            setSectionToToggleNA(null);
          }}
          title="Mark Section as Not Applicable"
          description={<>Mark <strong>{sectionToToggleNA.name}</strong> as Not Applicable for this inspection?</>}
          subdesc={`This section currently has ${sectionToToggleNA.doneCount} answered question(s) and ${sectionToToggleNA.photoCount} photo(s). Marking it as Not Applicable will exclude this section from the report and completion progress calculations.`}
          confirmText="Yes, Mark as N/A"
          cancelText="Cancel"
        />
      )}
    </>
  );
}
