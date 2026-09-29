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
