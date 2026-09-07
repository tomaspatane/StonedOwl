import { normalize } from './articles.js';

const COMMUNES = {
  1: ['Retiro', 'San Nicolás', 'Puerto Madero', 'San Telmo', 'Monserrat', 'Constitución'],
  2: ['Recoleta'],
  3: ['Balvanera', 'San Cristóbal'],
  4: ['La Boca', 'Barracas', 'Parque Patricios', 'Nueva Pompeya'],
  5: ['Almagro', 'Boedo'],
  6: ['Caballito'],
  7: ['Flores', 'Parque Chacabuco'],
  8: ['Villa Soldati', 'Villa Riachuelo', 'Villa Lugano'],
  9: ['Liniers', 'Mataderos', 'Parque Avellaneda'],
  10: ['Villa Real', 'Monte Castro', 'Versalles', 'Floresta', 'Vélez Sársfield', 'Villa Luro'],
  11: ['Villa General Mitre', 'Villa Devoto', 'Villa del Parque', 'Villa Santa Rita'],
  12: ['Coghlan', 'Saavedra', 'Villa Urquiza', 'Villa Pueyrredón'],
  13: ['Núñez', 'Belgrano', 'Colegiales'],
  14: ['Palermo'],
  15: ['Chacarita', 'Villa Crespo', 'La Paternal', 'Villa Ortúzar', 'Agronomía', 'Parque Chas']
};

const BARRIOS = Object.entries(COMMUNES).flatMap(([commune, barrios]) =>
  barrios.map(name => ({ name, normalized: normalize(name), commune: Number(commune) }))
);

const BARRIO_ALIASES = [
  { alias: 'paternal', name: 'La Paternal', commune: 15 },
  { alias: 'pompeya', name: 'Nueva Pompeya', commune: 4 },
  { alias: 'villa ortuzar', name: 'Villa Ortúzar', commune: 15 },
  { alias: 'villa pueyrredon', name: 'Villa Pueyrredón', commune: 12 },
  { alias: 'nunez', name: 'Núñez', commune: 13 },
  { alias: 'velez sarsfield', name: 'Vélez Sársfield', commune: 10 }
];

const HOSPITALS = [
  { name: 'Argerich', barrio: 'La Boca', commune: 4 },
  { name: 'Durand', barrio: 'Caballito', commune: 6 },
  { name: 'Fernández', barrio: 'Palermo', commune: 14 },
  { name: 'Ramos Mejía', barrio: 'Balvanera', commune: 3 },
  { name: 'Penna', barrio: 'Parque Patricios', commune: 4 },
  { name: 'Piñero', barrio: 'Flores', commune: 7 },
  { name: 'Pirovano', barrio: 'Coghlan', commune: 12 },
  { name: 'Santojanni', barrio: 'Mataderos', commune: 9 },
  { name: 'Vélez Sarsfield', barrio: 'Monte Castro', commune: 10 },
  { name: 'Zubizarreta', barrio: 'Villa Devoto', commune: 11 },
  { name: 'Rivadavia', barrio: 'Recoleta', commune: 2 },
  { name: 'Elizalde', barrio: 'Constitución', commune: 1 },
  { name: 'Garrahan', barrio: 'Parque Patricios', commune: 4 },
  { name: 'Moyano', barrio: 'Barracas', commune: 4 },
  { name: 'Borda', barrio: 'Barracas', commune: 4 },
  { name: 'Udaondo', barrio: 'Parque Patricios', commune: 4 },
  { name: 'Muñiz', barrio: 'Parque Patricios', commune: 4 },
  { name: 'Sardá', barrio: 'Parque Patricios', commune: 4 },
  { name: 'Rocca', barrio: 'Floresta', commune: 10 },
  { name: 'Cecilia Grierson', barrio: 'Villa Lugano', commune: 8 }
];

const STATIONS = {
  medrano: { name: 'Medrano', barrio: 'Almagro', commune: 5 },
  'angel gallardo': { name: 'Ángel Gallardo', barrio: 'Villa Crespo', commune: 15 },
  malabia: { name: 'Malabia', barrio: 'Villa Crespo', commune: 15 },
  dorrego: { name: 'Dorrego', barrio: 'Chacarita', commune: 15 },
  'federico lacroze': { name: 'Federico Lacroze', barrio: 'Chacarita', commune: 15 },
  'juan manuel de rosas': { name: 'Juan Manuel de Rosas', barrio: 'Villa Urquiza', commune: 12 },
  'los incas parque chas': { name: 'Los Incas - Parque Chas', barrio: 'Parque Chas', commune: 15 },
  'primera junta': { name: 'Primera Junta', barrio: 'Caballito', commune: 6 },
  acoyte: { name: 'Acoyte', barrio: 'Caballito', commune: 6 },
  'rio de janeiro': { name: 'Río de Janeiro', barrio: 'Caballito', commune: 6 },
  'castro barros': { name: 'Castro Barros', barrio: 'Almagro', commune: 5 },
  loria: { name: 'Loria', barrio: 'Almagro', commune: 5 },
  'plaza miserere': { name: 'Plaza Miserere', barrio: 'Balvanera', commune: 3 },
  pueyrredon: { name: 'Pueyrredón', barrio: 'Balvanera', commune: 3 },
  'facultad de medicina': { name: 'Facultad de Medicina', barrio: 'Balvanera', commune: 3 },
  callao: { name: 'Callao', barrio: 'Balvanera', commune: 3 },
  congreso: { name: 'Congreso', barrio: 'Balvanera', commune: 3 },
  constitucion: { name: 'Constitución', barrio: 'Constitución', commune: 1 },
  retiro: { name: 'Retiro', barrio: 'Retiro', commune: 1 }
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function includesPhrase(text, phrase) {
  return new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text);
}

function extractExplicitCommunes(text) {
  const values = [];
  for (const match of text.matchAll(/\bcomuna\s*(?:n[°º.]?\s*)?(1[0-5]|[1-9])\b/gi)) values.push(Number(match[1]));
  return unique(values);
}

function extractStations(original) {
  const values = [];
  const pattern = /\bestaci[oó]n\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]*(?:\s+(?:de|del|la|las|los|y|[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]*)){0,3})/g;
  for (const match of original.matchAll(pattern)) {
    const value = match[1].trim().replace(/[,:;.!?]+$/, '');
    if (value.length >= 3 && value.length <= 60) values.push(value);
  }
  return unique(values);
}

function hospitalMatches(text) {
  const normalized = normalize(text);
  return HOSPITALS.filter(item => includesPhrase(normalized, normalize(item.name)));
}

function stationMetadata(stations = []) {
  return stations.map(name => STATIONS[normalize(name)]).filter(Boolean);
}

export function extractGeo(text = '') {
  const original = String(text || '');
  const normalized = normalize(original);
  const barrios = [];
  const communes = extractExplicitCommunes(original);

  for (const barrio of BARRIOS) {
    if (includesPhrase(normalized, barrio.normalized)) {
      barrios.push(barrio.name);
      communes.push(barrio.commune);
    }
  }
  for (const alias of BARRIO_ALIASES) {
    if (includesPhrase(normalized, alias.alias)) {
      barrios.push(alias.name);
      communes.push(alias.commune);
    }
  }

  const hospitals = hospitalMatches(original);
  for (const hospital of hospitals) {
    barrios.push(hospital.barrio);
    communes.push(hospital.commune);
  }

  const stations = extractStations(original);
  for (const station of stationMetadata(stations)) {
    barrios.push(station.barrio);
    communes.push(station.commune);
  }

  return {
    barrios: unique(barrios),
    communes: unique(communes).sort((a, b) => a - b),
    stations,
    entities: hospitals.map(item => `Hospital ${item.name}`)
  };
}

export function summarizeGeo(articles = []) {
  const aggregate = { barrios: [], communes: [], stations: [], entities: [] };
  for (const article of articles) {
    const geo = extractGeo(`${article?.title || ''} ${article?.description || ''}`);
    aggregate.barrios.push(...geo.barrios);
    aggregate.communes.push(...geo.communes);
    aggregate.stations.push(...geo.stations);
    aggregate.entities.push(...geo.entities);
  }
  return {
    barrios: unique(aggregate.barrios),
    communes: unique(aggregate.communes).sort((a, b) => a - b),
    stations: unique(aggregate.stations),
    entities: unique(aggregate.entities)
  };
}
