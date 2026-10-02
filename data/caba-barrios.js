export const CABA_BARRIOS = [
  { name: 'Agronomía', comuna: 15, aliases: ['Agronomia'] },
  { name: 'Almagro', comuna: 5, aliases: [] },
  { name: 'Balvanera', comuna: 3, aliases: ['Once'] },
  { name: 'Barracas', comuna: 4, aliases: [] },
  { name: 'Belgrano', comuna: 13, aliases: [] },
  { name: 'Boedo', comuna: 5, aliases: [] },
  { name: 'Caballito', comuna: 6, aliases: [] },
  { name: 'Chacarita', comuna: 15, aliases: [] },
  { name: 'Coghlan', comuna: 12, aliases: [] },
  { name: 'Colegiales', comuna: 13, aliases: [] },
  { name: 'Constitución', comuna: 1, aliases: ['Constitucion'] },
  { name: 'Flores', comuna: 7, aliases: [] },
  { name: 'Floresta', comuna: 10, aliases: [] },
  { name: 'La Boca', comuna: 4, aliases: ['Boca'] },
  { name: 'La Paternal', comuna: 15, aliases: ['Paternal'] },
  { name: 'Liniers', comuna: 9, aliases: [] },
  { name: 'Mataderos', comuna: 9, aliases: [] },
  { name: 'Monte Castro', comuna: 10, aliases: [] },
  { name: 'Monserrat', comuna: 1, aliases: ['Montserrat'] },
  { name: 'Nueva Pompeya', comuna: 4, aliases: ['Pompeya'] },
  { name: 'Núñez', comuna: 13, aliases: ['Nunez'] },
  { name: 'Palermo', comuna: 14, aliases: [] },
  { name: 'Parque Avellaneda', comuna: 9, aliases: [] },
  { name: 'Parque Chacabuco', comuna: 7, aliases: [] },
  { name: 'Parque Chas', comuna: 15, aliases: [] },
  { name: 'Parque Patricios', comuna: 4, aliases: [] },
  { name: 'Puerto Madero', comuna: 1, aliases: [] },
  { name: 'Recoleta', comuna: 2, aliases: [] },
  { name: 'Retiro', comuna: 1, aliases: [] },
  { name: 'Saavedra', comuna: 12, aliases: [] },
  { name: 'San Cristóbal', comuna: 3, aliases: ['San Cristobal'] },
  { name: 'San Nicolás', comuna: 1, aliases: ['San Nicolas', 'Microcentro'] },
  { name: 'San Telmo', comuna: 1, aliases: [] },
  { name: 'Vélez Sarsfield', comuna: 10, aliases: ['Velez Sarsfield'] },
  { name: 'Versalles', comuna: 10, aliases: [] },
  { name: 'Villa Crespo', comuna: 15, aliases: [] },
  { name: 'Villa del Parque', comuna: 11, aliases: [] },
  { name: 'Villa Devoto', comuna: 11, aliases: ['Devoto'] },
  { name: 'Villa General Mitre', comuna: 11, aliases: ['Villa Mitre', 'General Mitre'] },
  { name: 'Villa Lugano', comuna: 8, aliases: ['Lugano'] },
  { name: 'Villa Luro', comuna: 10, aliases: [] },
  { name: 'Villa Ortúzar', comuna: 15, aliases: ['Villa Ortuzar'] },
  { name: 'Villa Pueyrredón', comuna: 12, aliases: ['Villa Pueyrredon'] },
  { name: 'Villa Real', comuna: 10, aliases: [] },
  { name: 'Villa Riachuelo', comuna: 8, aliases: [] },
  { name: 'Villa Santa Rita', comuna: 11, aliases: ['Santa Rita'] },
  { name: 'Villa Soldati', comuna: 8, aliases: ['Soldati'] },
  { name: 'Villa Urquiza', comuna: 12, aliases: ['Urquiza'] }
];

export function normalizePlaceText(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholePhrase(text = '', phrase = '') {
  const normalizedText = normalizePlaceText(text);
  const normalizedPhrase = normalizePlaceText(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  const pattern = escapeRegex(normalizedPhrase).replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(normalizedText);
}

function barrioNames(barrio) {
  return [barrio.name, ...(barrio.aliases || [])];
}

export function findBarrioExact(value = '') {
  const normalized = normalizePlaceText(value);
  if (!normalized) return null;
  return CABA_BARRIOS.find((barrio) => barrioNames(barrio).map(normalizePlaceText).includes(normalized)) || null;
}

export function detectBarrios(text = '') {
  return CABA_BARRIOS.filter((barrio) => barrioNames(barrio).some((name) => containsWholePhrase(text, name)));
}

function hasLocativeCue(text = '', barrio) {
  const normalized = normalizePlaceText(text);
  for (const rawName of barrioNames(barrio)) {
    const name = normalizePlaceText(rawName);
    if (!name) continue;
    const pattern = escapeRegex(name).replace(/\s+/g, '\\s+');
    const re = new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'ig');
    let match;
    while ((match = re.exec(normalized))) {
      const start = match.index + (match[1] ? match[1].length : 0);
      const before = normalized.slice(Math.max(0, start - 48), start);
      if (/(?:\ben\s+|\bbarrio\s+|\bzona(?:\s+de)?\s+|\bdesde\s+|\bpor\s+|\bcerca\s+de\s+|\balrededores\s+de\s+|\bvecinos\s+de\s+)$/.test(before)) return true;
    }
  }
  return false;
}

export function resolveBarriosFromResult({ title = '', snippet = '' } = {}) {
  const titleMatches = detectBarrios(title);
  if (titleMatches.length > 0 && titleMatches.length <= 3) {
    return { barrios: titleMatches, precision: 'high', reason: 'title_match' };
  }
  if (titleMatches.length > 3) {
    return { barrios: [], precision: 'low', reason: 'title_geo_ambiguous' };
  }

  const snippetMatches = detectBarrios(snippet);
  const contextual = snippetMatches.filter((barrio) => hasLocativeCue(snippet, barrio));
  if (contextual.length > 0 && contextual.length <= 2) {
    return { barrios: contextual, precision: 'medium', reason: 'snippet_locative' };
  }
  if (contextual.length > 2) {
    return { barrios: [], precision: 'low', reason: 'snippet_geo_ambiguous' };
  }

  const normalizedSnippet = normalizePlaceText(snippet);
  const cabaMarker = /\bcaba\b|\bcapital federal\b|\bciudad de buenos aires\b/.test(normalizedSnippet);
  if (cabaMarker && snippetMatches.length === 1) {
    return { barrios: snippetMatches, precision: 'medium', reason: 'single_barrio_with_caba_marker' };
  }

  return { barrios: [], precision: 'low', reason: snippetMatches.length ? 'unanchored_barrio_mentions' : 'no_barrio' };
}
