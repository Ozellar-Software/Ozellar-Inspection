import { CheckIcon } from '../../icons';
import { COMMON_VESSEL_TYPES, COMMON_VESSEL_TYPES_DATA } from './particulars';

export interface VesselCoreForm {
  name: string;
  imo: string;
  vesselType: string;
}

/** Core vessel identification fields (name, IMO, vessel type) — the minimum needed to register a vessel. */
export function VesselCoreFields({ form, setForm }: { form: VesselCoreForm; setForm: (f: VesselCoreForm) => void }) {
  return (
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
  );
}
