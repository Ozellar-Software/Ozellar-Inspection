import { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  type TemplateSection, type TemplateQuestion,
  COMMON_VESSEL_TYPES,
} from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { syncNow } from '../../offline/sync';
import {
  BackIcon, PlusIcon, TrashIcon, ClipboardIcon, AlertCircleIcon,
  CheckIcon, EditIcon, ChevronRightIcon, UsersIcon, ShipIcon,
  CameraIcon, CompassIcon, ChevronDownIcon, SearchIcon, XIcon,
} from '../../icons';
import { ConfirmDeleteModal } from '../../app/ConfirmDeleteModal';
import './ChecklistPage.css';

const COMMON_VESSEL_TYPES_INFO: Array<{ name: string; key: string; color: string; bg: string; border: string }> = [
  { name: 'Bulk Carrier', key: 'bulk', color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
  { name: 'Container Ship', key: 'container', color: '#4F46E5', bg: '#EEF2FF', border: '#C7D2FE' },
  { name: 'Oil Tanker', key: 'tanker', color: '#E11D48', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Chemical Tanker', key: 'chemical', color: '#BE123C', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Gas Carrier', key: 'gas', color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  { name: 'General Cargo', key: 'general', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' },
  { name: 'Tug / Offshore', key: 'offshore', color: '#475569', bg: '#F1F5F9', border: '#CBD5E1' },
];

function getVesselTypeBadgeColor(type: string) {
  const match = COMMON_VESSEL_TYPES_INFO.find((t) => t.name.toLowerCase() === type.trim().toLowerCase());
  if (match) return match;
  return { name: type, key: 'custom', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' };
}

interface SectionFormData {
  id?: string;
  zone: string;
  name: string;
  photoOnly: boolean;
  vesselTypes: string[];
}

import { useCurrentUser } from '../../auth/useCurrentUser';

export function ChecklistPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const me = useCurrentUser();
  const rawSections = ((useLiveQuery(() => db.templateSections.toArray(), []) as unknown as TemplateSection[] | undefined) ?? [])
    .filter((s) => !s.deletedAt)
    .sort((a, b) => Number(Boolean(a.photoOnly)) - Number(Boolean(b.photoOnly)) || a.position - b.position);
  const allQuestions = ((useLiveQuery(() => db.templateQuestions.toArray(), []) as unknown as TemplateQuestion[] | undefined) ?? [])
    .filter((q) => !q.deletedAt);

  // Normalize sections so vesselTypes is always an array
  const sections = useMemo(() => {
    return rawSections.map((s) => ({
      ...s,
      vesselTypes: Array.isArray(s.vesselTypes) ? s.vesselTypes : [],
    }));
  }, [rawSections]);

  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [sectionForm, setSectionForm] = useState<SectionFormData | null>(null);
  const [newCustomType, setNewCustomType] = useState('');
  const [questionForm, setQuestionForm] = useState<{ id?: string; ref: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaultProgress, setDefaultProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [sectionToDelete, setSectionToDelete] = useState<(TemplateSection & { mergedIds?: string[] }) | null>(null);
  const [questionToDelete, setQuestionToDelete] = useState<TemplateQuestion | null>(null);
  const [isDeletingItem, setIsDeletingItem] = useState(false);

  // Filter state (initialize from ?category= if provided)
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    const paramCat = searchParams.get('category');
    return paramCat?.trim() ? paramCat.trim() : 'all';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const catDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (catDropdownRef.current && !catDropdownRef.current.contains(e.target as Node)) {
        setCategoryDropdownOpen(false);
      }
    }
    if (categoryDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [categoryDropdownOpen]);

  // Always reset scroll to top when opening a section view or modal/form
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [openSectionId, Boolean(sectionForm), Boolean(questionForm)]);

  const availableVesselTypes = useMemo(() => {
    const list: string[] = [...COMMON_VESSEL_TYPES];
    for (const s of sections) {
      for (const t of s.vesselTypes ?? []) {
        if (t.trim() && !list.includes(t.trim())) {
          list.push(t.trim());
        }
      }
    }
    return list;
  }, [sections]);

  useEffect(() => {
    // Keep local IndexedDB template sections updated with the master checklist
    async function hydrateTemplates() {
      try {
        const [serverSecs, serverQs] = await Promise.all([
          api<TemplateSection[]>('/templates/sections/list'),
          api<TemplateQuestion[]>('/templates/questions/list'),
        ]);
        if (Array.isArray(serverSecs)) {
          const activeSecIds = new Set(serverSecs.map((s) => s.id));
          const localSecs = await db.templateSections.toArray();
          const staleSecIds = localSecs.filter((s) => !activeSecIds.has(s.id)).map((s) => s.id);
          if (staleSecIds.length) await db.templateSections.bulkDelete(staleSecIds);
          if (serverSecs.length) {
            await db.templateSections.bulkPut(serverSecs as unknown as Record<string, unknown> & { id: string }[]);
          }
        }
        if (Array.isArray(serverQs)) {
          const activeQIds = new Set(serverQs.map((q) => q.id));
          const localQs = await db.templateQuestions.toArray();
          const staleQIds = localQs.filter((q) => !activeQIds.has(q.id)).map((q) => q.id);
          if (staleQIds.length) await db.templateQuestions.bulkDelete(staleQIds);
          if (serverQs.length) {
            await db.templateQuestions.bulkPut(serverQs as unknown as Record<string, unknown> & { id: string }[]);
          }
        }
      } catch {
        void syncNow();
      }
    }
    void hydrateTemplates();
  }, []);

  const openSection = sections.find((s) => s.id === openSectionId) ?? null;
  const questionsForOpen = allQuestions.filter((q) => q.sectionId === openSectionId).sort((a, b) => a.position - b.position);

  // Deduplicated "All Sections" list: merges rows with the same (name, photoOnly) so the same section
  // never shows 2 times in "All Sections" — instead it shows once with all vessel types it is used for.
  const deduplicatedAllSections = useMemo(() => {
    const groups = new Map<
      string,
      {
        rep: TemplateSection;
        mergedVesselTypes: string[];
        hasDefaultBlueprint: boolean;
        mergedIds: string[];
      }
    >();

    for (const s of sections) {
      const key = `${s.name.trim().toLowerCase()}::${Boolean(s.photoOnly)}`;
      const isUniv = !s.vesselTypes || s.vesselTypes.length === 0;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          rep: s,
          mergedVesselTypes: [...(s.vesselTypes ?? [])],
          hasDefaultBlueprint: isUniv,
          mergedIds: [s.id],
        });
      } else {
        existing.mergedIds.push(s.id);
        if (isUniv) existing.hasDefaultBlueprint = true;
        for (const vt of s.vesselTypes ?? []) {
          const vtTrim = vt.trim();
          if (vtTrim && !existing.mergedVesselTypes.some((m) => m.toLowerCase() === vtTrim.toLowerCase())) {
            existing.mergedVesselTypes.push(vtTrim);
          }
        }
        // Prefer a row that has questions (or non-universal row if editing vessel types) as representative
        const repQCount = allQuestions.filter((q) => q.sectionId === existing.rep.id).length;
        const curQCount = allQuestions.filter((q) => q.sectionId === s.id).length;
        if (curQCount > repQCount) {
          existing.rep = s;
        }
      }
    }

    return Array.from(groups.values()).map(({ rep, mergedVesselTypes, hasDefaultBlueprint, mergedIds }) => ({
      ...rep,
      vesselTypes: mergedVesselTypes,
      hasDefaultBlueprint,
      mergedIds,
    }));
  }, [sections, allQuestions]);

  // Category counts: All = deduplicated sections count; Universal = Default sections; each vessel type = unique sections for that type
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: deduplicatedAllSections.length,
      universal: sections.filter((s) => !s.vesselTypes || s.vesselTypes.length === 0).length,
    };
    for (const type of availableVesselTypes) {
      const catLower = type.trim().toLowerCase();
      const matching = sections.filter((s) =>
        (s.vesselTypes ?? []).some((t) => t.trim().toLowerCase() === catLower)
      );
      const uniqueKeys = new Set(matching.map((s) => `${s.name.trim().toLowerCase()}::${Boolean(s.photoOnly)}`));
      counts[type] = uniqueKeys.size;
    }
    return counts;
  }, [sections, deduplicatedAllSections, availableVesselTypes]);

  // Filtered sections list:
  // - In "all", show deduplicatedAllSections (never show the same section twice)
  // - In "universal", show Default (Universal) sections
  // - In a specific vessel type, show unique sections assigned to that vessel type
  // Always sorted with normal sections first, then photo sections last.
  const filteredSections = useMemo(() => {
    let list: Array<TemplateSection & { hasDefaultBlueprint?: boolean; mergedIds?: string[] }>;

    if (selectedCategory === 'all') {
      list = deduplicatedAllSections;
    } else if (selectedCategory === 'universal') {
      list = sections.filter((s) => !s.vesselTypes || s.vesselTypes.length === 0);
    } else {
      const catLower = selectedCategory.trim().toLowerCase();
      const rawMatches = sections.filter((s) =>
        (s.vesselTypes ?? []).some((t) => t.trim().toLowerCase() === catLower)
      );
      const seen = new Set<string>();
      list = [];
      for (const s of rawMatches) {
        const key = `${s.name.trim().toLowerCase()}::${Boolean(s.photoOnly)}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push(s);
        }
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        (s.zone && s.zone.toLowerCase().includes(q)) ||
        (s.vesselTypes && s.vesselTypes.some((t) => t.toLowerCase().includes(q)))
      );
    }

    return [...list].sort(
      (a, b) => Number(Boolean(a.photoOnly)) - Number(Boolean(b.photoOnly)) || a.position - b.position
    );
  }, [sections, deduplicatedAllSections, selectedCategory, searchQuery]);

  // How many Default (Universal) sections are not yet present in the currently selected vessel type
  const missingDefaultCount = useMemo(() => {
    if (!selectedCategory || selectedCategory === 'all' || selectedCategory === 'universal') return 0;
    const defaultSecs = sections.filter((s) => !s.vesselTypes || s.vesselTypes.length === 0);
    const catLower = selectedCategory.trim().toLowerCase();
    const existingForType = sections.filter((s) =>
      (s.vesselTypes ?? []).some((t) => t.trim().toLowerCase() === catLower)
    );
    const existingKeys = new Set(
      existingForType.map((s) => `${s.name.trim().toLowerCase()}::${Boolean(s.photoOnly)}`)
    );
    return defaultSecs.filter((ds) => !existingKeys.has(`${ds.name.trim().toLowerCase()}::${Boolean(ds.photoOnly)}`)).length;
  }, [sections, selectedCategory]);

  const filteredQuestionsCount = useMemo(() => {
    const secIds = new Set(filteredSections.map((s) => s.id));
    return allQuestions.filter((q) => secIds.has(q.sectionId)).length;
  }, [filteredSections, allQuestions]);

  async function handleApplyDefaultSections() {
    if (!selectedCategory || selectedCategory === 'all' || selectedCategory === 'universal') return;
    setBusy(true);
    setDefaultProgress('Preparing default sections…');
    setError(null);
    setSuccessMsg(null);
    try {
      let createdSections: TemplateSection[] = [];
      let createdQuestions: TemplateQuestion[] = [];

      const defaultSecs = sections.filter((s) => !s.vesselTypes || s.vesselTypes.length === 0);
      const catLower = selectedCategory.trim().toLowerCase();
      const existingForType = sections.filter((s) =>
        (s.vesselTypes ?? []).some((t) => t.trim().toLowerCase() === catLower)
      );
      const existingKeys = new Set(
        existingForType.map((s) => `${s.name.trim().toLowerCase()}::${Boolean(s.photoOnly)}`)
      );
      const toCreate = defaultSecs.filter(
        (ds) => !existingKeys.has(`${ds.name.trim().toLowerCase()}::${Boolean(ds.photoOnly)}`)
      );

      if (toCreate.length === 0) {
        setSuccessMsg(`All ${defaultSecs.length} Default (Universal) sections are already created in ${selectedCategory}.`);
        setTimeout(() => setSuccessMsg(null), 5000);
        return;
      }

      // Map of existing non-universal sections by (name, photoOnly) so we can append vesselType instead of duplicating rows
      const existingNonUniversalByKey = new Map<string, TemplateSection>();
      for (const s of sections) {
        if (s.vesselTypes && s.vesselTypes.length > 0) {
          const k = `${s.name.trim().toLowerCase()}::${Boolean(s.photoOnly)}`;
          if (!existingNonUniversalByKey.has(k)) {
            existingNonUniversalByKey.set(k, s);
          }
        }
      }

      if (!navigator.onLine) {
        let nextPos = sections.length;
        let nextSr = sections.reduce((max, s) => Math.max(max, s.sr ?? 0), 0) + 1;
        for (let i = 0; i < toCreate.length; i++) {
          const ds = toCreate[i];
          setDefaultProgress(`Creating ${i + 1}/${toCreate.length}…`);
          const key = `${ds.name.trim().toLowerCase()}::${Boolean(ds.photoOnly)}`;
          const existingOtherType = existingNonUniversalByKey.get(key);
          if (existingOtherType) {
            const updatedSec: TemplateSection = {
              ...existingOtherType,
              vesselTypes: [...existingOtherType.vesselTypes, selectedCategory],
            };
            createdSections.push(updatedSec);
            continue;
          }

          const newSec: TemplateSection = {
            id: crypto.randomUUID(),
            sr: nextSr++,
            zone: ds.zone,
            name: ds.name,
            position: nextPos++,
            photoOnly: ds.photoOnly,
            vesselTypes: [selectedCategory],
          };
          createdSections.push(newSec);

          const dsQuestions = allQuestions
            .filter((q) => q.sectionId === ds.id)
            .sort((a, b) => a.position - b.position);
          for (const q of dsQuestions) {
            createdQuestions.push({
              id: crypto.randomUUID(),
              sectionId: newSec.id,
              qid: q.qid,
              ref: q.ref,
              text: q.text,
              position: q.position,
            });
          }
        }
      } else {
        try {
          setDefaultProgress(`Creating ${toCreate.length} default sections…`);
          const res = await api<{
            createdSections: TemplateSection[];
            createdQuestions: TemplateQuestion[];
            skippedCount: number;
          }>('/templates/sections/apply-default', {
            method: 'POST',
            body: { vesselType: selectedCategory },
          });
          createdSections = res.createdSections ?? [];
          createdQuestions = res.createdQuestions ?? [];
        } catch (err) {
          // Fallback to existing endpoints if backend hasn't been restarted/redeployed with /apply-default yet
          if (err instanceof ApiError && err.status === 404) {
            for (let i = 0; i < toCreate.length; i++) {
              const ds = toCreate[i];
              setDefaultProgress(`Creating section ${i + 1}/${toCreate.length}…`);
              const key = `${ds.name.trim().toLowerCase()}::${Boolean(ds.photoOnly)}`;
              const existingOtherType = existingNonUniversalByKey.get(key);

              if (existingOtherType) {
                const nextTypes = [...existingOtherType.vesselTypes, selectedCategory];
                const savedSec = await api<TemplateSection>('/templates/sections', {
                  method: 'POST',
                  body: {
                    id: existingOtherType.id,
                    zone: existingOtherType.zone,
                    name: existingOtherType.name,
                    photoOnly: existingOtherType.photoOnly,
                    vesselTypes: nextTypes,
                  },
                });
                const secWithType: TemplateSection = {
                  ...savedSec,
                  vesselTypes: Array.isArray(savedSec.vesselTypes) && savedSec.vesselTypes.length
                    ? savedSec.vesselTypes
                    : nextTypes,
                };
                createdSections.push(secWithType);
                await db.templateSections.put(secWithType as unknown as Record<string, unknown> & { id: string });
                continue;
              }

              const savedSec = await api<TemplateSection>('/templates/sections', {
                method: 'POST',
                body: {
                  zone: ds.zone,
                  name: ds.name,
                  photoOnly: ds.photoOnly,
                  vesselTypes: [selectedCategory],
                },
              });
              const secWithType: TemplateSection = {
                ...savedSec,
                vesselTypes: Array.isArray(savedSec.vesselTypes) && savedSec.vesselTypes.length
                  ? savedSec.vesselTypes
                  : [selectedCategory],
              };
              createdSections.push(secWithType);
              await db.templateSections.put(secWithType as unknown as Record<string, unknown> & { id: string });

              const dsQuestions = allQuestions
                .filter((q) => q.sectionId === ds.id)
                .sort((a, b) => a.position - b.position);
              const savedQuestionsBatch: TemplateQuestion[] = [];
              for (const q of dsQuestions) {
                const savedQ = await api<TemplateQuestion>('/templates/questions', {
                  method: 'POST',
                  body: {
                    sectionId: savedSec.id,
                    ref: q.ref,
                    text: q.text,
                  },
                });
                createdQuestions.push(savedQ);
                savedQuestionsBatch.push(savedQ);
              }
              if (savedQuestionsBatch.length) {
                await db.templateQuestions.bulkPut(savedQuestionsBatch as unknown as Record<string, unknown> & { id: string }[]);
              }
            }
          } else {
            throw err;
          }
        }
      }

      if (createdSections.length) {
        await db.templateSections.bulkPut(createdSections as unknown as Record<string, unknown> & { id: string }[]);
      }
      if (createdQuestions.length) {
        await db.templateQuestions.bulkPut(createdQuestions as unknown as Record<string, unknown> & { id: string }[]);
      }

      if (createdSections.length > 0) {
        setSuccessMsg(
          `Loaded ${createdSections.length} Default section${createdSections.length === 1 ? '' : 's'} for ${selectedCategory}.`
        );
      } else {
        setSuccessMsg(`All Default (Universal) sections are already present in ${selectedCategory}.`);
      }
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create default sections');
    } finally {
      setBusy(false);
      setDefaultProgress(null);
    }
  }

  function handleOpenAddSection() {
    const initialVesselTypes: string[] =
      selectedCategory !== 'all' && selectedCategory !== 'universal'
        ? [selectedCategory]
        : [];
    setSectionForm({
      zone: '',
      name: '',
      photoOnly: false,
      vesselTypes: initialVesselTypes,
    });
    setNewCustomType('');
    setError(null);
  }

  function handleOpenEditSection(s: TemplateSection & { mergedIds?: string[] }) {
    // If editing from All Sections where a Default row and vessel-specific row were merged,
    // target the vessel-specific row if vesselTypes are present
    let targetId = s.id;
    if (s.mergedIds && s.mergedIds.length > 1 && s.vesselTypes.length > 0) {
      const nonUniv = sections.find((sec) => s.mergedIds!.includes(sec.id) && sec.vesselTypes.length > 0);
      if (nonUniv) targetId = nonUniv.id;
    }
    setSectionForm({
      id: targetId,
      zone: s.zone,
      name: s.name,
      photoOnly: s.photoOnly,
      vesselTypes: Array.isArray(s.vesselTypes) ? [...s.vesselTypes] : [],
    });
    setNewCustomType('');
    setError(null);
  }

  function handleAddCustomType() {
    if (!sectionForm || !newCustomType.trim()) return;
    const trimmed = newCustomType.trim();
    if (!sectionForm.vesselTypes.includes(trimmed)) {
      setSectionForm({
        ...sectionForm,
        vesselTypes: [...sectionForm.vesselTypes, trimmed],
      });
    }
    setNewCustomType('');
  }

  async function saveSection(e: React.FormEvent) {
    e.preventDefault();
    if (!sectionForm) return;
    setBusy(true); setError(null);
    try {
      const payload = {
        id: sectionForm.id,
        zone: sectionForm.zone,
        name: sectionForm.name,
        photoOnly: sectionForm.photoOnly,
        vesselTypes: sectionForm.vesselTypes,
      };
      const saved = await api<TemplateSection>('/templates/sections', { method: 'POST', body: payload });
      await db.templateSections.put(saved as unknown as Record<string, unknown> & { id: string });
      await syncNow();
      setSectionForm(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this section');
    } finally { setBusy(false); }
  }

  async function executeDeleteSection() {
    if (!sectionToDelete) return;
    const s = sectionToDelete;
    setIsDeletingItem(true); setBusy(true); setError(null);
    try {
      const idsToDelete = selectedCategory === 'all' && s.mergedIds?.length ? s.mergedIds : [s.id];
      const deletedAt = new Date().toISOString();
      for (const id of idsToDelete) {
        await api(`/templates/sections/${id}`, { method: 'DELETE' });
        await db.templateSections.update(id, { deletedAt });
        const sectionQuestions = await db.templateQuestions
          .filter((q) => (q as any).sectionId === id)
          .toArray();
        if (sectionQuestions.length) {
          await db.templateQuestions.bulkDelete(sectionQuestions.map((q) => q.id));
        }
        if (openSectionId === id) setOpenSectionId(null);
      }
      setSectionToDelete(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this section');
    } finally {
      setIsDeletingItem(false);
      setBusy(false);
    }
  }

  async function moveSection(s: TemplateSection, dir: -1 | 1) {
    const curIdx = sections.findIndex((item) => item.id === s.id);
    const targetIdx = curIdx + dir;
    if (targetIdx < 0 || targetIdx >= sections.length) return;
    const ids = sections.map((item) => item.id);
    [ids[curIdx], ids[targetIdx]] = [ids[targetIdx], ids[curIdx]];
    setBusy(true); setError(null);
    try {
      await api('/templates/sections/reorder', { method: 'POST', body: { ids } });
      await Promise.all(ids.map((id, i) => db.templateSections.update(id, { position: i })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reorder sections');
    } finally { setBusy(false); }
  }

  async function saveQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!questionForm || !openSectionId) return;
    setBusy(true); setError(null);
    try {
      const saved = await api<TemplateQuestion>('/templates/questions', { method: 'POST', body: { ...questionForm, sectionId: openSectionId } });
      await db.templateQuestions.put(saved as unknown as Record<string, unknown> & { id: string });
      setQuestionForm(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this question');
    } finally { setBusy(false); }
  }

  async function executeDeleteQuestion() {
    if (!questionToDelete) return;
    const q = questionToDelete;
    setIsDeletingItem(true); setBusy(true); setError(null);
    try {
      await api(`/templates/questions/${q.id}`, { method: 'DELETE' });
      await db.templateQuestions.update(q.id, { deletedAt: new Date().toISOString() });
      setQuestionToDelete(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this question');
    } finally {
      setIsDeletingItem(false);
      setBusy(false);
    }
  }

  async function moveQuestion(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= questionsForOpen.length) return;
    const ids = questionsForOpen.map((q) => q.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true); setError(null);
    try {
      await api('/templates/questions/reorder', { method: 'POST', body: { ids } });
      await Promise.all(ids.map((id, i) => db.templateQuestions.update(id, { position: i })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reorder questions');
    } finally { setBusy(false); }
  }

  // ─── Access Guard ───
  if (me.data && me.data.role !== 'admin') {
    return (
      <div className="cl-page-wrap">
        <header className="cl-page-header">
          <div className="cl-title-group">
            <button className="back-btn-premium" aria-label="Back" onClick={() => nav('/')}><BackIcon /></button>
            <div className="cl-title-row">
              <h1 className="cl-page-title">Checklist Templates</h1>
            </div>
          </div>
        </header>
        <div className="cl-empty-state">
          <div className="cl-empty-icon"><UsersIcon width={48} height={48} /></div>
          <h3 className="cl-empty-title">Administrator Access Required</h3>
          <p className="cl-empty-desc">Only system administrators can manage inspection checklist templates.</p>
          <button className="cl-primary-btn" onClick={() => nav('/')}>Return to Dashboard</button>
        </div>
      </div>
    );
  }

  // ─── Question Detail View ───
  if (openSection) {
    return (
      <div className="cl-page-wrap">
        <header className="cl-page-header">
          <div className="cl-title-group">
            <button className="back-btn-premium" aria-label="Back"
              onClick={() => (questionForm ? setQuestionForm(null) : setOpenSectionId(null))}>
              <BackIcon />
            </button>
            <div className="cl-title-row">
              <h1 className="cl-page-title">{openSection.name}</h1>
              <span className="cl-count-pill">{openSection.zone || 'Section'}</span>
              {(!openSection.vesselTypes || openSection.vesselTypes.length === 0) ? (
                <span className="cl-vessel-tag-header universal">All Vessels</span>
              ) : (
                <span className="cl-vessel-tag-header specific">
                  <ShipIcon width={13} height={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  {openSection.vesselTypes.join(', ')}
                </span>
              )}
            </div>
          </div>
          {!openSection.photoOnly && !questionForm && (
            <div className="cl-header-actions">
              <button className="cl-primary-btn" onClick={() => setQuestionForm({ ref: '', text: '' })}>
                <PlusIcon width={16} height={16} />
                <span className="cl-btn-text-full">Add Question</span>
                <span className="cl-btn-text-short">Add</span>
              </button>
            </div>
          )}
        </header>

        {error && (
          <div className="cl-error-banner">
            <AlertCircleIcon width={16} height={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Question Form */}
        {questionForm && (
          <div className="cl-form-card">
            <div className="cl-form-header">
              <h2>{questionForm.id ? 'Edit Question' : 'Add Question'}</h2>
              <p>Add an inspection checklist item to this section</p>
            </div>
            <form onSubmit={saveQuestion} className="cl-form-body">
              <div className="cl-form-field">
                <label className="cl-label">Reference ID</label>
                <input
                  className="cl-input"
                  value={questionForm.ref}
                  onChange={(e) => setQuestionForm({ ...questionForm, ref: e.target.value })}
                  placeholder="e.g. H-1, SR-03"
                />
              </div>
              <div className="cl-form-field">
                <label className="cl-label">Question Text <span className="cl-req">*</span></label>
                <textarea
                  className="cl-input cl-textarea"
                  value={questionForm.text}
                  onChange={(e) => setQuestionForm({ ...questionForm, text: e.target.value })}
                  required autoFocus
                  placeholder="What needs to be inspected or checked?"
                />
              </div>
              <div className="cl-form-actions">
                <button type="button" className="cl-btn-cancel" onClick={() => setQuestionForm(null)}>Cancel</button>
                <button type="submit" className="cl-btn-save" disabled={busy}>
                  <CheckIcon width={15} height={15} />
                  <span>{busy ? 'Saving…' : questionForm.id ? 'Save Changes' : 'Add Question'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Photo-only notice */}
        {openSection.photoOnly && !questionForm && (
          <div className="cl-info-banner">
            <CameraIcon width={16} height={16} />
            <span>Photo sections hold photos only — they have no checklist questions.</span>
          </div>
        )}

        {/* Questions List */}
        {!questionForm && !openSection.photoOnly && (
          <>
            <div className="cl-results-count">
              {questionsForOpen.length} question{questionsForOpen.length !== 1 ? 's' : ''} in this section
            </div>

            {questionsForOpen.length === 0 && (
              <div className="cl-empty-state" style={{ marginTop: 16 }}>
                <div className="cl-empty-icon"><ClipboardIcon width={40} height={40} /></div>
                <h3 className="cl-empty-title">No Questions Yet</h3>
                <p className="cl-empty-desc">Add inspection questions to this section using the button above.</p>
              </div>
            )}

            <div className="cl-list-container">
              {questionsForOpen.map((q, i) => (
                <div key={q.id} className="cl-row-card">
                  <div className="cl-row-header">
                    <div className="cl-row-main" onClick={() => setQuestionForm({ id: q.id, ref: q.ref, text: q.text })} style={{ cursor: 'pointer' }}>
                      <div className="cl-q-avatar">{q.ref || `Q${i + 1}`}</div>
                      <div className="cl-row-info">
                        <div className="cl-q-text">{q.text}</div>
                        <div className="cl-q-meta">
                          <span className="cl-sub-item">Reference: {q.ref || '—'}</span>
                          <span className="cl-sub-sep">•</span>
                          <span className="cl-sub-item">Position {i + 1} of {questionsForOpen.length}</span>
                        </div>
                      </div>
                    </div>
                    <div className="cl-row-controls">
                      <div className="cl-reorder-group">
                        <button className="cl-icon-btn" aria-label="Move up" disabled={i === 0}
                          onClick={(e) => { e.stopPropagation(); void moveQuestion(i, -1); }}>↑</button>
                        <button className="cl-icon-btn" aria-label="Move down" disabled={i === questionsForOpen.length - 1}
                          onClick={(e) => { e.stopPropagation(); void moveQuestion(i, 1); }}>↓</button>
                      </div>
                      <button className="cl-icon-btn edit" title="Edit question"
                        onClick={(e) => { e.stopPropagation(); setQuestionForm({ id: q.id, ref: q.ref, text: q.text }); }}>
                        <EditIcon width={14} height={14} />
                      </button>
                      <button className="cl-icon-btn delete" aria-label="Delete question"
                        onClick={(e) => { e.stopPropagation(); setQuestionToDelete(q); }}>
                        <TrashIcon width={14} height={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Confirm Delete Question Modal ── */}
        {questionToDelete && (
          <ConfirmDeleteModal
            isOpen={!!questionToDelete}
            title="Delete Question"
            description="Are you sure you want to delete this checklist question?"
            subdesc={
              questionToDelete.text
                ? `"${questionToDelete.text.slice(0, 100)}${questionToDelete.text.length > 100 ? '…' : ''}" will be permanently removed.`
                : undefined
            }
            confirmText="Delete Question"
            loading={isDeletingItem}
            onConfirm={executeDeleteQuestion}
            onCancel={() => {
              if (!isDeletingItem) setQuestionToDelete(null);
            }}
          />
        )}
      </div>
    );
  }

  // ─── Main Sections View ───
  const isVesselTypeActive = selectedCategory !== 'all' && selectedCategory !== 'universal';

  return (
    <div className="cl-page-wrap">
      <header className="cl-page-header">
        <div className="cl-title-group">
          <button className="back-btn-premium" aria-label="Back"
            onClick={() => (sectionForm ? setSectionForm(null) : nav('/'))}>
            <BackIcon />
          </button>
          <div className="cl-title-row">
            <h1 className="cl-page-title">Checklist Templates</h1>
            <span className="cl-count-pill">{categoryCounts.all} Section{categoryCounts.all !== 1 ? 's' : ''}</span>
          </div>
        </div>
        {!sectionForm && (
          <div className="cl-header-actions">
            {isVesselTypeActive && (
              <button
                type="button"
                className={`cl-header-default-btn ${missingDefaultCount === 0 && categoryCounts.universal > 0 ? 'applied' : ''}`}
                disabled={busy || categoryCounts.universal === 0}
                onClick={() => void handleApplyDefaultSections()}
                title={`Copy Default (Universal) sections and questions into ${selectedCategory}`}
              >
                <CompassIcon width={15} height={15} />
                <span className="cl-btn-text-full">
                  {defaultProgress
                    ? defaultProgress
                    : missingDefaultCount > 0
                    ? `Default (+${missingDefaultCount})`
                    : '✓ Default'}
                </span>
                <span className="cl-btn-text-short">
                  {defaultProgress ? '…' : 'Default'}
                </span>
              </button>
            )}
            <button className="cl-primary-btn" onClick={handleOpenAddSection}>
              <PlusIcon width={16} height={16} />
              <span className="cl-btn-text-full">Add Section</span>
              <span className="cl-btn-text-short">Add</span>
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="cl-error-banner">
          <AlertCircleIcon width={16} height={16} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="cl-success-banner">
          <div className="cl-success-banner-main">
            <CheckIcon width={16} height={16} />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            className="cl-success-banner-close"
            onClick={() => setSuccessMsg(null)}
            aria-label="Dismiss notification"
          >
            <XIcon width={14} height={14} />
          </button>
        </div>
      )}

      {/* Category Filter Toolbar */}
      {!sectionForm && (
        <div className="cl-filter-container">
          <div className="cl-filter-toolbar">
            <div className="cl-filter-left">
              {/* Quick Tab: All */}
              <button
                type="button"
                className={`cl-quick-tab ${selectedCategory === 'all' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedCategory('all');
                  setCategoryDropdownOpen(false);
                }}
              >
                <span className="cl-tab-text-full">All Sections</span>
                <span className="cl-tab-text-short">All</span>
                <span className="cl-tab-badge">{categoryCounts.all}</span>
              </button>

              {/* Quick Tab: Default (Universal) */}
              <button
                type="button"
                className={`cl-quick-tab ${selectedCategory === 'universal' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedCategory('universal');
                  setCategoryDropdownOpen(false);
                }}
                title="Default (Universal) template sections that can be loaded into any vessel type"
              >
                <CompassIcon width={14} height={14} />
                <span className="cl-tab-text-full">Default (Universal)</span>
                <span className="cl-tab-text-short">Default</span>
                <span className="cl-tab-badge">{categoryCounts.universal}</span>
              </button>

              {/* Vessel Category Dropdown */}
              <div className="cl-vessel-dropdown-wrap" ref={catDropdownRef}>
                <button
                  type="button"
                  className={`cl-vessel-dropdown-btn ${isVesselTypeActive ? 'active' : ''}`}
                  onClick={() => setCategoryDropdownOpen((prev) => !prev)}
                >
                  <ShipIcon width={14} height={14} />
                  <span className="cl-dropdown-label-full">
                    {isVesselTypeActive ? selectedCategory : 'Select Vessel Type'}
                  </span>
                  <span className="cl-dropdown-label-short">
                    {isVesselTypeActive ? selectedCategory : 'Vessel Type'}
                  </span>
                  {isVesselTypeActive && (
                    <span className="cl-tab-badge">{categoryCounts[selectedCategory] ?? 0}</span>
                  )}
                  <ChevronDownIcon width={14} height={14} className={`cl-chevron ${categoryDropdownOpen ? 'open' : ''}`} />
                </button>

                {categoryDropdownOpen && (
                  <div className="cl-vessel-dropdown-menu">
                    <div className="cl-dropdown-header">Vessel Category</div>
                    <div className="cl-dropdown-list">
                      {availableVesselTypes.map((type) => {
                        const isSelected = selectedCategory === type;
                        const count = categoryCounts[type] ?? 0;
                        return (
                          <button
                            key={type}
                            type="button"
                            className={`cl-dropdown-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedCategory(type);
                              setCategoryDropdownOpen(false);
                            }}
                          >
                            <div className="cl-dropdown-item-left">
                              <ShipIcon width={14} height={14} className="cl-dropdown-ship-icon" />
                              <span className="cl-dropdown-item-name">{type}</span>
                            </div>
                            <span className="cl-dropdown-item-count">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Clear Filter if any non-'all' filter is active */}
              {selectedCategory !== 'all' && (
                <button
                  type="button"
                  className="cl-filter-clear-btn"
                  onClick={() => {
                    setSelectedCategory('all');
                    setCategoryDropdownOpen(false);
                  }}
                  title="Clear category filter"
                >
                  <XIcon width={12} height={12} />
                  <span>Reset</span>
                </button>
              )}
            </div>

            {/* Right: Search Box */}
            <div className="cl-filter-right">
              <div className="cl-search-box">
                <SearchIcon width={14} height={14} className="cl-search-icon" />
                <input
                  type="text"
                  placeholder="Search sections or zones..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="cl-search-input"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="cl-search-clear-btn"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                  >
                    <XIcon width={12} height={12} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 1-Click Vessel Type Quick Access Pill Strip */}
          <div className="cl-vessel-pill-strip" role="tablist" aria-label="Vessel Types">
            {availableVesselTypes.map((type) => {
              const isSelected = selectedCategory === type;
              const count = categoryCounts[type] ?? 0;
              return (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`cl-vessel-pill ${isSelected ? 'active' : ''} ${count === 0 ? 'empty' : ''}`}
                  onClick={() => {
                    setSelectedCategory(type);
                    setCategoryDropdownOpen(false);
                  }}
                >
                  <ShipIcon width={13} height={13} />
                  <span className="cl-vessel-pill-name">{type}</span>
                  <span className="cl-vessel-pill-count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Subbar when Default (Universal) blueprint is active */}
          {selectedCategory === 'universal' && (
            <div className="cl-universal-subbar">
              <div className="cl-filter-hint">
                <CompassIcon width={15} height={15} />
                <span>
                  <strong>Default (Universal) Blueprint</strong> ({categoryCounts.universal} section{categoryCounts.universal === 1 ? '' : 's'} · {filteredQuestionsCount} question{filteredQuestionsCount === 1 ? '' : 's'}):
                  {' '}Select any vessel type above and click <strong>Default</strong> to create these sections for that vessel type.
                </span>
              </div>
            </div>
          )}

          {/* Action Card when a specific vessel category is active */}
          {isVesselTypeActive && (
            <div className="cl-vessel-action-card">
              <div className="cl-vessel-action-info">
                <div className="cl-vessel-action-title-row">
                  <span className="cl-vessel-action-dot" />
                  <strong className="cl-vessel-action-title">{selectedCategory} Checklist</strong>
                  <span className="cl-vessel-action-stats">
                    {categoryCounts[selectedCategory] ?? 0} section{(categoryCounts[selectedCategory] ?? 0) === 1 ? '' : 's'} · {filteredQuestionsCount} question{filteredQuestionsCount === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="cl-vessel-action-desc">
                  {missingDefaultCount > 0
                    ? `Inspections for ${selectedCategory} vessels only use ${selectedCategory} sections. Click "Default" to create ${missingDefaultCount === categoryCounts.universal ? `all ${categoryCounts.universal}` : `${missingDefaultCount} remaining`} Default (Universal) section${missingDefaultCount === 1 ? '' : 's'}, or add custom sections.`
                    : `All ${categoryCounts.universal} Default (Universal) sections are loaded for ${selectedCategory}. Inspections for ${selectedCategory} vessels will create these sections.`}
                </p>
              </div>
              <div className="cl-vessel-action-btns">
                <button
                  type="button"
                  className={`cl-btn-default-action ${missingDefaultCount === 0 && categoryCounts.universal > 0 ? 'applied' : ''}`}
                  disabled={busy || categoryCounts.universal === 0}
                  onClick={() => void handleApplyDefaultSections()}
                  title="Creates all Default (Universal) sections and questions for this vessel category"
                >
                  <CompassIcon width={14} height={14} />
                  <span>
                    {defaultProgress
                      ? defaultProgress
                      : missingDefaultCount > 0
                      ? `Default — Load Universal (${missingDefaultCount})`
                      : `✓ Default Sections Added (${categoryCounts.universal})`}
                  </span>
                </button>
                <button
                  type="button"
                  className="cl-btn-add-action"
                  onClick={handleOpenAddSection}
                >
                  <PlusIcon width={14} height={14} />
                  <span>Add New Section</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section Form */}
      {sectionForm && (
        <div className="cl-form-card">
          <div className="cl-form-header">
            <h2>{sectionForm.id ? 'Edit Section' : 'Add Section'}</h2>
            <p>Configure section name, zone, and vessel category applicability</p>
          </div>
          <form onSubmit={saveSection} className="cl-form-body">
            <div className="cl-form-grid">
              <div className="cl-form-field">
                <label className="cl-label">Zone</label>
                <input className="cl-input" value={sectionForm.zone}
                  onChange={(e) => setSectionForm({ ...sectionForm, zone: e.target.value })}
                  placeholder="e.g. Outside, Engine Room, Cargo Holds, Bridge" />
              </div>
              <div className="cl-form-field">
                <label className="cl-label">Section Name <span className="cl-req">*</span></label>
                <input className="cl-input" value={sectionForm.name}
                  onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })}
                  required autoFocus placeholder="e.g. Hull Condition, Cargo Tanks, Hatch Covers" />
              </div>
            </div>

            {/* Photo Section Toggle */}
            <label className={`cl-photo-toggle ${sectionForm.id ? 'disabled' : ''}`}>
              <input type="checkbox" checked={sectionForm.photoOnly} disabled={!!sectionForm.id}
                onChange={(e) => setSectionForm({ ...sectionForm, photoOnly: e.target.checked })} />
              <div className="cl-photo-toggle-text">
                <strong>Photo Section</strong>
                <span>Photos only — no checklist questions in this section</span>
              </div>
            </label>

            {/* Vessel Category Assignment Panel */}
            <div className="cl-vessel-assignment-box">
              <div className="cl-assignment-header">
                <label className="cl-label">Vessel Category Assignment <span className="cl-req">*</span></label>
                <span className="cl-assignment-subhint">
                  Save as a Default (Universal) template section or assign to 1 or more particular vessel categories
                </span>
              </div>

              {/* Mode Selector Toggle */}
              <div className="cl-vessel-mode-toggle">
                <button
                  type="button"
                  className={`cl-vessel-mode-btn ${sectionForm.vesselTypes.length === 0 ? 'active' : ''}`}
                  onClick={() => setSectionForm({ ...sectionForm, vesselTypes: [] })}
                >
                  <span className="cl-mode-icon"><CompassIcon width={20} height={20} /></span>
                  <div className="cl-mode-text">
                    <strong>Default (Universal) Section</strong>
                    <small>Master default section — created when clicking Default in a vessel type</small>
                  </div>
                </button>
                <button
                  type="button"
                  className={`cl-vessel-mode-btn ${sectionForm.vesselTypes.length > 0 ? 'active' : ''}`}
                  onClick={() => {
                    if (sectionForm.vesselTypes.length === 0) {
                      const initial = (selectedCategory !== 'all' && selectedCategory !== 'universal')
                        ? [selectedCategory]
                        : ['Bulk Carrier'];
                      setSectionForm({ ...sectionForm, vesselTypes: initial });
                    }
                  }}
                >
                  <span className="cl-mode-icon"><ShipIcon width={18} height={18} /></span>
                  <div className="cl-mode-text">
                    <strong>Specific Vessel Categories</strong>
                    <small>Assign to 1 or more particular vessel types</small>
                  </div>
                </button>
              </div>

              {/* Specific Categories Chips Grid */}
              {sectionForm.vesselTypes.length > 0 && (
                <div className="cl-specific-vessels-panel">
                  <div className="cl-panel-toolbar">
                    <span className="cl-selection-summary">
                      Assigned to <strong>{sectionForm.vesselTypes.length}</strong> vessel categor{sectionForm.vesselTypes.length === 1 ? 'y' : 'ies'}:
                    </span>
                    <div className="cl-quick-actions">
                      <button
                        type="button"
                        className="cl-text-action-btn"
                        onClick={() => setSectionForm({ ...sectionForm, vesselTypes: [...COMMON_VESSEL_TYPES] })}
                      >
                        Select All Standard
                      </button>
                      <span className="cl-action-sep">·</span>
                      <button
                        type="button"
                        className="cl-text-action-btn"
                        onClick={() => setSectionForm({ ...sectionForm, vesselTypes: ['Bulk Carrier'] })}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="cl-vessel-chips-grid">
                    {COMMON_VESSEL_TYPES.map((type) => {
                      const isSelected = sectionForm.vesselTypes.includes(type);
                      const theme = COMMON_VESSEL_TYPES_INFO.find((t) => t.name === type);
                      return (
                        <button
                          key={type}
                          type="button"
                          className={`cl-vessel-chip ${isSelected ? 'selected' : ''}`}
                          style={isSelected && theme ? { borderColor: theme.border, background: theme.bg, color: theme.color } : {}}
                          onClick={() => {
                            const current = sectionForm.vesselTypes;
                            const next = isSelected
                              ? current.filter((t) => t !== type)
                              : [...current, type];
                            setSectionForm({ ...sectionForm, vesselTypes: next });
                          }}
                        >
                          <span className="cl-chip-check">
                            {isSelected ? <CheckIcon width={13} height={13} /> : <span className="cl-chip-empty-dot" />}
                          </span>
                          <span className="cl-chip-label">{type}</span>
                        </button>
                      );
                    })}

                    {/* Custom types added */}
                    {sectionForm.vesselTypes
                      .filter((t) => !COMMON_VESSEL_TYPES.includes(t as any))
                      .map((type) => (
                        <button
                          key={type}
                          type="button"
                          className="cl-vessel-chip selected custom"
                          onClick={() => {
                            setSectionForm({
                              ...sectionForm,
                              vesselTypes: sectionForm.vesselTypes.filter((t) => t !== type),
                            });
                          }}
                        >
                          <span className="cl-chip-check"><CheckIcon width={13} height={13} /></span>
                          <span className="cl-chip-label">{type}</span>
                          <span className="cl-chip-remove">×</span>
                        </button>
                      ))}
                  </div>

                  {/* Add Custom Vessel Type */}
                  <div className="cl-add-custom-type-row">
                    <input
                      type="text"
                      className="cl-custom-type-input"
                      placeholder="Add custom vessel type (e.g. Ro-Ro, Chemical Barge)..."
                      value={newCustomType}
                      onChange={(e) => setNewCustomType(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomType();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="cl-btn-add-custom"
                      onClick={handleAddCustomType}
                      disabled={!newCustomType.trim()}
                    >
                      <PlusIcon width={14} height={14} /> Add
                    </button>
                  </div>

                  {sectionForm.vesselTypes.length === 0 && (
                    <div className="cl-warning-hint">
                      <AlertCircleIcon width={14} height={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                      No vessel categories selected. Switch to Default (Universal) or select at least 1 vessel category above.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="cl-form-actions">
              <button type="button" className="cl-btn-cancel" onClick={() => setSectionForm(null)}>Cancel</button>
              <button type="submit" className="cl-btn-save" disabled={busy}>
                <CheckIcon width={15} height={15} />
                <span>{busy ? 'Saving…' : sectionForm.id ? 'Save Changes' : 'Add Section'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sections List */}
      {!sectionForm && (
        <>
          <div className="cl-results-count">
            {filteredSections.length} section{filteredSections.length !== 1 ? 's' : ''}
            {selectedCategory !== 'all' && ` (${selectedCategory === 'universal' ? 'Default / Universal' : selectedCategory})`}
            {searchQuery && ` (matching "${searchQuery}")`}
            {' · '}
            {filteredQuestionsCount} question{filteredQuestionsCount !== 1 ? 's' : ''}
          </div>

          {filteredSections.length === 0 && (
            <div className="cl-empty-state">
              <div className="cl-empty-icon"><ClipboardIcon width={48} height={48} /></div>
              <h3 className="cl-empty-title">
                {searchQuery ? 'No Matching Sections' : isVesselTypeActive ? `No Sections in ${selectedCategory} Yet` : 'No Sections Found'}
              </h3>
              <p className="cl-empty-desc">
                {searchQuery
                  ? `No sections match your search "${searchQuery}".`
                  : isVesselTypeActive
                  ? `Click "Default" below to create all ${categoryCounts.universal} Default (Universal) sections for ${selectedCategory}, or click "Add New Section" to create a custom section.`
                  : 'Start building your inspection checklist by adding the first section above.'}
              </p>
              {isVesselTypeActive && (
                <div className="cl-empty-actions">
                  <button
                    type="button"
                    className="cl-btn-default-action"
                    disabled={busy || categoryCounts.universal === 0}
                    onClick={() => void handleApplyDefaultSections()}
                  >
                    <CompassIcon width={16} height={16} />
                    <span>
                      {defaultProgress
                        ? defaultProgress
                        : `Default — Create Universal Sections (${categoryCounts.universal})`}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cl-btn-add-action"
                    onClick={handleOpenAddSection}
                  >
                    <PlusIcon width={16} height={16} />
                    <span>Add New Section for {selectedCategory}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="cl-list-container">
            {filteredSections.map((s, idx) => {
              const count = allQuestions.filter((q) => q.sectionId === s.id).length;
              const isUniversal = !s.vesselTypes || s.vesselTypes.length === 0;
              const coversAllStandardTypes =
                !isUniversal &&
                COMMON_VESSEL_TYPES.every((vt) =>
                  s.vesselTypes.some((t) => t.trim().toLowerCase() === vt.toLowerCase())
                );

              return (
                <div key={s.id} className="cl-row-card">
                  <div className="cl-row-header" onClick={() => setOpenSectionId(s.id)} style={{ cursor: 'pointer' }}>
                    <div className="cl-row-main">
                      <div className={`cl-section-avatar ${s.photoOnly ? 'photo' : 'check'}`}>
                        {s.photoOnly ? <CameraIcon width={22} height={22} /> : <ClipboardIcon width={22} height={22} />}
                      </div>
                      <div className="cl-row-info">
                        <div className="cl-title-main">
                          <span className="cl-section-name">{s.name}</span>
                          {s.photoOnly && <span className="cl-type-chip photo-chip">Photo Section</span>}
                        </div>

                        {/* Vessel Category Badges */}
                        <div className="cl-vessel-tags-row">
                          {isUniversal ? (
                            <span className="cl-vessel-badge universal">Default (Universal)</span>
                          ) : coversAllStandardTypes ? (
                            <div className="cl-vessel-badge-cluster">
                              <span className="cl-vessel-badge universal">All Vessel Types ({s.vesselTypes.length})</span>
                              {s.vesselTypes.map((t) => {
                                const badge = getVesselTypeBadgeColor(t);
                                return (
                                  <span
                                    key={t}
                                    className="cl-vessel-badge specific"
                                    style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                                  >
                                    <ShipIcon width={12} height={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                    {t}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="cl-vessel-badge-cluster">
                              {selectedCategory === 'all' && s.hasDefaultBlueprint && (
                                <span className="cl-vessel-badge universal">Default</span>
                              )}
                              {s.vesselTypes.length > 1 && (
                                <span className="cl-vessel-badge-counter">
                                  {s.vesselTypes.length} Types:
                                </span>
                              )}
                              {s.vesselTypes.map((t) => {
                                const badge = getVesselTypeBadgeColor(t);
                                return (
                                  <span
                                    key={t}
                                    className="cl-vessel-badge specific"
                                    style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                                  >
                                    <ShipIcon width={12} height={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                    {t}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="cl-q-meta">
                          <span className="cl-sub-item">{s.zone || 'No zone'}</span>
                          <span className="cl-sub-sep">•</span>
                          <span className="cl-sub-item">{s.photoOnly ? 'Photos only' : `${count} question${count !== 1 ? 's' : ''}`}</span>
                          <span className="cl-sub-sep">•</span>
                          <span className="cl-sub-item">Position {idx + 1}</span>
                        </div>
                      </div>
                    </div>

                    <div className="cl-row-controls" onClick={(e) => e.stopPropagation()}>
                      <div className="cl-reorder-group" title={selectedCategory !== 'all' ? 'Filtering active — reordering adjusts overall template position' : ''}>
                        <button className="cl-icon-btn" aria-label="Move up" disabled={idx === 0}
                          onClick={() => void moveSection(s, -1)}>↑</button>
                        <button className="cl-icon-btn" aria-label="Move down" disabled={idx >= filteredSections.length - 1}
                          onClick={() => void moveSection(s, 1)}>↓</button>
                      </div>
                      <button className="cl-icon-btn edit" title="Edit section"
                        onClick={() => handleOpenEditSection(s)}>
                        <EditIcon width={14} height={14} />
                      </button>
                      <button className="cl-icon-btn delete" aria-label="Delete section"
                        onClick={() => setSectionToDelete(s)}>
                        <TrashIcon width={14} height={14} />
                      </button>
                      <ChevronRightIcon width={16} height={16} style={{ color: 'var(--faint)', flexShrink: 0 }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Confirm Delete Section Modal ── */}
      {sectionToDelete && (
        <ConfirmDeleteModal
          isOpen={!!sectionToDelete}
          title={`Delete Section "${sectionToDelete.name}"`}
          description={`Are you sure you want to delete the "${sectionToDelete.name}" section?`}
          subdesc="All checklist questions and configurations in this section will be permanently deleted."
          confirmText="Delete Section"
          loading={isDeletingItem}
          onConfirm={executeDeleteSection}
          onCancel={() => {
            if (!isDeletingItem) setSectionToDelete(null);
          }}
        />
      )}
    </div>
  );
}
