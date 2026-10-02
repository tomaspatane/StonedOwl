import assert from 'node:assert/strict';
import { detectBarrios, resolveBarriosFromResult } from '../data/caba-barrios.js';

function names(result) {
  return result.barrios.map((b) => b.name).sort();
}

{
  const result = resolveBarriosFromResult({
    title: 'Apagón masivo: por qué si el incendio fue en Mendoza se cortó la luz',
    snippet: 'Caballito Flores Mataderos Parque Chacabuco'
  });
  assert.deepEqual(names(result), []);
  assert.equal(result.reason, 'unanchored_barrio_mentions');
}

{
  const result = resolveBarriosFromResult({
    title: 'Corte de luz en Flores y Caballito',
    snippet: 'Vecinos reclaman a la distribuidora.'
  });
  assert.deepEqual(names(result), ['Caballito', 'Flores']);
  assert.equal(result.precision, 'high');
}

{
  const result = resolveBarriosFromResult({
    title: 'Otra noche con cortes',
    snippet: 'Vecinos de Villa Lugano siguen sin luz desde la madrugada.'
  });
  assert.deepEqual(names(result), ['Villa Lugano']);
  assert.equal(result.reason, 'snippet_locative');
}

{
  const result = resolveBarriosFromResult({
    title: 'Problemas con el suministro',
    snippet: 'CABA: Almagro sigue con baja tensión y reclamos.'
  });
  assert.deepEqual(names(result), ['Almagro']);
  assert.equal(result.reason, 'single_barrio_with_caba_marker');
}

{
  const barrios = detectBarrios('Entonces volvió la luz después de una hora.');
  assert.equal(barrios.some((b) => b.name === 'Balvanera'), false);
}

{
  const result = resolveBarriosFromResult({
    title: 'Cortes en Flores, Caballito, Almagro y Boedo',
    snippet: 'Informe general sobre múltiples zonas.'
  });
  assert.deepEqual(names(result), []);
  assert.equal(result.reason, 'title_geo_ambiguous');
}

console.log('All territorial geo-context tests passed.');
