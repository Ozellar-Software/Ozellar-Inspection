import type { VesselParticularKey } from '@ozellar/shared';

export const PARTICULAR_LABELS: Record<VesselParticularKey, string> = {
  flag: 'Flag', portOfRegistry: 'Port of registry', callSign: 'Call sign', officialNo: 'Official no.',
  yearBuilt: 'Year built', placeOfBuild: 'Place of build', classSociety: 'Class society', classNotation: 'Class notation',
  grossTonnage: 'Gross tonnage', netTonnage: 'Net tonnage', deadweight: 'Deadweight', loa: 'LOA', breadth: 'Breadth',
  depth: 'Depth', summerDraft: 'Summer draft', mainEngine: 'Main engine', mainEngineMakerModel: 'Main engine maker/model',
  mainEnginePower: 'Main engine power', propulsion: 'Propulsion', owner: 'Owner', managerOperator: 'Manager/operator',
  email: 'Email', satellitePhone: 'Satellite phone',
};

export const PARTICULAR_GROUPS: { title: string; keys: VesselParticularKey[] }[] = [
  { title: 'Registration', keys: ['flag', 'portOfRegistry', 'callSign', 'officialNo', 'yearBuilt', 'placeOfBuild'] },
  { title: 'Class & tonnage', keys: ['classSociety', 'classNotation', 'grossTonnage', 'netTonnage', 'deadweight'] },
  { title: 'Dimensions', keys: ['loa', 'breadth', 'depth', 'summerDraft'] },
  { title: 'Propulsion', keys: ['mainEngine', 'mainEngineMakerModel', 'mainEnginePower', 'propulsion'] },
  { title: 'Management & contact', keys: ['owner', 'managerOperator', 'email', 'satellitePhone'] },
];

export const COMMON_VESSEL_TYPES = [
  'Bulk Carrier',
  'Container Ship',
  'Oil Tanker',
  'Chemical Tanker',
  'Gas Carrier',
  'General Cargo',
  'Tug / Offshore',
];

export const COMMON_VESSEL_TYPES_DATA = [
  { name: 'Bulk Carrier', key: 'bulk', color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
  { name: 'Container Ship', key: 'container', color: '#4F46E5', bg: '#EEF2FF', border: '#C7D2FE' },
  { name: 'Oil Tanker', key: 'tanker', color: '#E11D48', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Chemical Tanker', key: 'tanker', color: '#E11D48', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Gas Carrier', key: 'gas', color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  { name: 'General Cargo', key: 'general', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' },
  { name: 'Tug / Offshore', key: 'general', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' },
];
