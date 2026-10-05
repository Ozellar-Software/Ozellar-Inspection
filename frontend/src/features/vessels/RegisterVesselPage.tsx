import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Vessel, VesselParticularKey } from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import './RegisterVesselPage.css';
import {
  ShipIcon, CompassIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon,
  AlertCircleIcon
} from '../../icons';
import { PARTICULAR_GROUPS, PARTICULAR_LABELS } from './particulars';

type ParticularsForm = Partial<Record<VesselParticularKey, string>>;

interface VesselForm {
  id?: string;
  name: string;
  imo: string;
  vesselType: string;
  particulars: ParticularsForm;
}

const blankVessel: VesselForm = {
  name: '',
  imo: '',
  vesselType: 'Bulk Carrier',
  particulars: {},
};

const COMMON_VESSEL_TYPES = [
  'Bulk Carrier',
  'Container Ship',
  'Oil Tanker',
  'Chemical Tanker',
  'Gas Carrier',
  'General Cargo',
  'Tug / Offshore'
];

const COMMON_VESSEL_TYPES_DATA = [
  { name: 'Bulk Carrier', key: 'bulk', color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
  { name: 'Container Ship', key: 'container', color: '#4F46E5', bg: '#EEF2FF', border: '#C7D2FE' },
  { name: 'Oil Tanker', key: 'tanker', color: '#E11D48', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Chemical Tanker', key: 'tanker', color: '#E11D48', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Gas Carrier', key: 'gas', color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  { name: 'General Cargo', key: 'general', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' },
  { name: 'Tug / Offshore', key: 'general', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' },
];

const WIZARD_TABS = [
  { id: 0, title: 'Core Profile', subtitle: 'Identification & Category' },
  { id: 1, title: 'Registration & Flag', subtitle: 'Port, Flag & Registry' },
  { id: 2, title: 'Class & Tonnage', subtitle: 'Society, DWT & Net Tonnage' },
  { id: 3, title: 'Dimensions & Draft', subtitle: 'LOA, Beam & Summer Draft' },
  { id: 4, title: 'Machinery & Power', subtitle: 'Main Engine & Propulsion' },
  { id: 5, title: 'Management & Comms', subtitle: 'Owner, Operator & Comms' },
];

const PARTICULAR_HINTS: Partial<Record<VesselParticularKey, string>> = {
  flag: 'e.g. Marshall Islands, Panama, Singapore, Liberia',
  portOfRegistry: 'e.g. Majuro, Panama City, Singapore, Monrovia',
  callSign: 'e.g. V7AB8, 3EPR9, 9V812',
  officialNo: 'e.g. 72910, 81920',
  yearBuilt: 'e.g. 2021',
  placeOfBuild: 'e.g. Imabari, Japan; Geoje, South Korea',
  classSociety: 'e.g. DNV, Lloyd\'s Register, ABS, Bureau Veritas',
  classNotation: 'e.g. 1A1 Bulk Carrier ESP, +100A1 Container',
  grossTonnage: 'Gross registered tonnage in MT (e.g. 43500)',
  netTonnage: 'Net registered tonnage in MT (e.g. 24200)',
  deadweight: 'Deadweight carrying capacity in MT (e.g. 82000)',
  loa: 'Length overall in meters (e.g. 229.0 m)',
  breadth: 'Moulded beam / breadth in meters (e.g. 32.26 m)',
  depth: 'Moulded depth in meters (e.g. 20.05 m)',
  summerDraft: 'Summer load line draft in meters (e.g. 14.5 m)',
  mainEngine: 'e.g. MAN B&W 6S60ME-C8.2, WinGD 6X72',
  mainEngineMakerModel: 'Engine maker & licensing model series',
  mainEnginePower: 'MCR continuous power (e.g. 9,600 kW @ 89 RPM)',
  propulsion: 'e.g. Single fixed pitch propeller, Dual azimuth',
  owner: 'Registered shipowner holding entity',
  managerOperator: 'Technical ship management company / ISM operator',
  email: 'Official shipboard email address',
  satellitePhone: 'Inmarsat / Sat phone (e.g. +870 773 241 890)',
};

export function RegisterVesselPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);

  const [activeTab, setActiveTab] = useState<number>(0);
  const [form, setForm] = useState<VesselForm>(blankVessel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditing && id) {
      db.vessels.get(id).then(v => {
        if (v) {
          setForm({
            id: v.id,
            name: v.name,
            imo: v.imo,
            vesselType: v.vesselType || 'Bulk Carrier',
            particulars: { ...v.particulars },
          });
        }
      });
    }
  }, [isEditing, id]);

  async function onSaveVessel(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Vessel name is required');
      return;
    }
    if (!form.imo.trim()) {
      setError('IMO number is required');
      return;
    }

    setBusy(true);
    setError(null);

    const vesselId = form.id || crypto.randomUUID();
    const vesselRecord: Vessel = {
      id: vesselId,
      name: form.name.trim(),
      imo: form.imo.trim(),
      vesselType: form.vesselType.trim(),
      particulars: form.particulars,
      updatedAt: new Date().toISOString(),
    };

    try {
      await db.vessels.put(vesselRecord as any);
      await localWrite('vessels', vesselId, vesselRecord as any);

      if (form.id) {
        await api(`/vessels/${form.id}`, { method: 'POST', body: vesselRecord }).catch(() => {});
      } else {
        await api('/vessels', { method: 'POST', body: vesselRecord }).catch(() => {});
      }

      navigate('/vessels');
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to save vessel details.');
    } finally {
      setBusy(false);
    }
  }

  const modalParticularsCount = useMemo(() => {
    return Object.values(form.particulars || {}).filter(Boolean).length;
  }, [form.particulars]);

  const modalCompletionPct = Math.round((modalParticularsCount / 23) * 100);

  return (
    <div className="rv-page-wrap">
      <header className="rv-header">
        <button className="rv-back-btn" onClick={() => navigate('/vessels')}>
          <ChevronLeftIcon width={16} height={16} />
          <span>Back to Fleet</span>
        </button>
        <div className="rv-header-title-group">
          <div className="rv-title-badge">
            <ShipIcon width={28} height={28} />
          </div>
          <div>
            <h1 className="rv-page-title">
              {isEditing ? `Edit Vessel: ${form.name}` : 'Register Vessel'}
            </h1>
            <p className="rv-page-subtitle">
              {isEditing
                ? 'Update master particulars, machinery specifications, and class details'
                : 'Enter comprehensive master fleet specifications verified against international ship registry data'}
            </p>
          </div>
        </div>
      </header>

      <div className="rv-content-container">
        {/* Sidebar Nav */}
        <aside className="rv-sidebar">
          <div className="rv-progress-card">
            <div className="rv-progress-header">
              <CompassIcon width={16} height={16} />
              <span>Completion Progress</span>
            </div>
            <div className="rv-progress-meta">
              <span>{modalParticularsCount}/23 Specs</span>
              <span>{modalCompletionPct}%</span>
            </div>
            <div className="rv-progress-track">
              <div
                className="rv-progress-bar"
                style={{ width: `${Math.max(modalCompletionPct, 4)}%` }}
              />
            </div>
          </div>
          
          <nav className="rv-stepper">
            {WIZARD_TABS.map((t, idx) => {
              const { filled, total } = (() => {
                if (t.id === 0) {
                  const cnt = (form.name ? 1 : 0) + (form.imo ? 1 : 0) + (form.vesselType ? 1 : 0);
                  return { filled: cnt, total: 3 };
                }
                const grp = PARTICULAR_GROUPS[t.id - 1];
                const cnt = grp ? grp.keys.filter(k => !!form.particulars[k]?.trim()).length : 0;
                return { filled: cnt, total: grp ? grp.keys.length : 0 };
              })();
              const isComplete = filled === total && total > 0;
              const isActive = activeTab === t.id;

              return (
                <button
                  key={t.id}
                  type="button"
                  className={`rv-step-item ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  <div className="rv-step-indicator">
                    {isComplete && !isActive ? <CheckIcon width={12} height={12} /> : (idx + 1)}
                  </div>
                  <div className="rv-step-text">
                    <span className="rv-step-title">{t.title}</span>
                    <span className="rv-step-subtitle">{t.subtitle}</span>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Form Body */}
        <main className="rv-main-form-area">
          <form onSubmit={onSaveVessel} className="rv-form-card">
            {error && (
              <div className="rv-error-banner">
                <AlertCircleIcon width={16} height={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="rv-form-body">
              {/* Tab 0 */}
              {activeTab === 0 && (
                <div className="rv-form-section">
                  <div className="rv-section-header">
                    <h2>Core Vessel Identification</h2>
                    <p>Official maritime name and mandatory IMO registry identification</p>
                  </div>

                  <div className="rv-grid two-cols">
                    <div className="rv-input-group">
                      <label className="rv-input-label">Vessel Name <span className="req">*</span></label>
                      <input
                        className="rv-text-input"
                        required
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        placeholder="e.g. MV Pacific Star"
                        autoFocus
                      />
                      <span className="rv-field-hint">Official commercial name inscribed on hull</span>
                    </div>

                    <div className="rv-input-group">
                      <label className="rv-input-label">IMO Number <span className="req">*</span></label>
                      <input
                        className="rv-text-input"
                        required
                        value={form.imo}
                        onChange={e => setForm({ ...form, imo: e.target.value })}
                        placeholder="e.g. 9234567"
                      />
                      <span className="rv-field-hint">Unique 7-digit International Maritime Organization identifier</span>
                    </div>
                  </div>

                  <div className="rv-category-box">
                    <div className="rv-category-header">
                      <label className="rv-input-label">Vessel Type & Fleet Class Category <span className="req">*</span></label>
                      <span className="rv-category-subhint">Click to select a standard category or specify a custom type below</span>
                    </div>
                    
                    <div className="rv-category-grid">
                      {COMMON_VESSEL_TYPES_DATA.map(t => {
                        const isSelected = form.vesselType === t.name;
                        return (
                          <button
                            key={t.name}
                            type="button"
                            className={`rv-category-tile ${isSelected ? 'selected' : ''}`}
                            style={{
                              borderColor: isSelected ? t.color : undefined,
                              background: isSelected ? t.bg : undefined,
                              color: isSelected ? t.color : undefined,
                            }}
                            onClick={() => setForm({ ...form, vesselType: t.name })}
                          >
                            <span className="rv-tile-dot" style={{ background: t.color }} />
                            <span className="rv-tile-name">{t.name}</span>
                            {isSelected && (
                              <span className="rv-tile-check"><CheckIcon width={13} height={13} /></span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    
                    <div className="rv-custom-type-row">
                      <label className="rv-custom-label">Custom Class / Specialty:</label>
                      <input
                        className="rv-text-input custom"
                        list="vessel-type-options"
                        value={form.vesselType}
                        onChange={e => setForm({ ...form, vesselType: e.target.value })}
                        placeholder="Type custom vessel type if not listed above..."
                      />
                      <datalist id="vessel-type-options">
                        {COMMON_VESSEL_TYPES.map(t => <option key={t} value={t} />)}
                      </datalist>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabs 1 to 5 */}
              {activeTab > 0 && activeTab <= PARTICULAR_GROUPS.length && (() => {
                const g = PARTICULAR_GROUPS[activeTab - 1];
                const tabDef = WIZARD_TABS[activeTab];
                const gridColsClass = g.keys.length >= 5 ? 'three-cols' : 'two-cols';

                return (
                  <div className="rv-form-section">
                    <div className="rv-section-header">
                      <h2>{tabDef.title} Specifications</h2>
                      <p>{tabDef.subtitle} — Verified against class registry and statutory certificates</p>
                    </div>

                    <div className={`rv-grid ${gridColsClass}`}>
                      {g.keys.map(k => {
                        const hint = PARTICULAR_HINTS[k] || `Enter ${PARTICULAR_LABELS[k].toLowerCase()}...`;
                        return (
                          <div key={k} className="rv-input-group">
                            <label className="rv-input-label">{PARTICULAR_LABELS[k]}</label>
                            <input
                              className="rv-text-input"
                              value={form.particulars[k] || ''}
                              onChange={e => setForm({
                                ...form,
                                particulars: { ...form.particulars, [k]: e.target.value }
                              })}
                              placeholder={hint}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="rv-form-footer">
              <div className="rv-footer-left">
                {activeTab > 0 && (
                  <button type="button" className="rv-btn-nav prev" onClick={() => setActiveTab(activeTab - 1)}>
                    <ChevronLeftIcon width={16} height={16} /> Previous
                  </button>
                )}
              </div>
              <div className="rv-footer-right">
                {activeTab < WIZARD_TABS.length - 1 && (
                  <button key="btn-next" type="button" className="rv-btn-nav next" onClick={() => setActiveTab(activeTab + 1)}>
                    Next Step <ChevronRightIcon width={16} height={16} />
                  </button>
                )}
                {activeTab === WIZARD_TABS.length - 1 && (
                  <button key="btn-submit" type="submit" className="rv-btn-save" disabled={busy}>
                    <CheckIcon width={16} height={16} />
                    {busy ? 'Saving...' : form.id ? 'Save Specifications' : 'Complete Registration'}
                  </button>
                )}
              </div>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
