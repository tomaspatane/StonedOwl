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
  'Argerich', 'Durand', 'Fernández', 'Ramos Mejía', 'Penna', 'Piñero', 'Pirovano', 'Santojanni',
  'Tornú', 'Vélez Sarsfield', 'Zubizarreta', 'Rivadavia', 'Gutiérrez', 'Elizalde', 'Garrahan',
  'Moyano', 'Borda', 'Alvear', 'Udaondo', 'Muñiz', 'Sardá', 'Rocca', 'Cecilia Grierson', 'Clínicas'
];

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

function extractHospitals(text) {
  const normalized = normalize(text);
  return HOSPITALS.filter(name => includesPhrase(normalized, normalize(name))).map(name => `Hospital ${name}`);
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

  return {
    barrios: unique(barrios),
    communes: unique(communes).sort((a, b) => a - b),
    stations: extractStations(original),
    entities: extractHospitals(original)
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
