import assert from 'node:assert/strict';
import { calibrateElectricityRow } from '../data/electricidad-thermometer.js';

function row(score, evidence) {
  return { barrio: 'Flores', score, evidence, mentions: evidence.length };
}

function official({ users = 0, type = 'media_tension' } = {}) {
  return {
    source: 'ENRE/EDESUR',
    provider: 'ENRE',
    sourceType: 'official',
    official: true,
    affectedUsers: users,
    enreType: type,
    title: `ENRE EDESUR: ${type.replace(/_/g, ' ')} en FLORES`,
    signalPhrases: [`ENRE: ${type.replace(/_/g, ' ')}`],
    url: `https://enre.test/${type}/${users}`,
    evidenceQuality: 'official'
  };
}

function citizen(id, quality = 'direct_local_report', maxWeight = 3) {
  return {
    source: 'facebook.com',
    provider: 'Google Web Territorial (Serper)',
    sourceType: 'territorial_web',
    evidenceQuality: quality,
    maxWeight,
    title: 'Otra vez sin luz',
    snippet: 'Flores sin luz desde anoche',
    url: `https://facebook.test/post/${id}`
  };
}

{
  const calibrated = calibrateElectricityRow(row(18, []));
  assert.equal(calibrated.status, 'verde');
  assert.equal(calibrated.score, 0);
}

{
  const calibrated = calibrateElectricityRow(row(12, [citizen('uno')]));
  assert.equal(calibrated.status, 'amarillo');
  assert.equal(calibrated.confidence, 'baja');
  assert.ok(calibrated.statusReasonCodes.includes('reporte_local_fuerte'));
}

{
  const calibrated = calibrateElectricityRow(row(24, [citizen('uno'), citizen('dos')]));
  assert.equal(calibrated.status, 'naranja');
  assert.equal(calibrated.confidence, 'media');
}

{
  const calibrated = calibrateElectricityRow(row(23, [official({ users: 12 })]));
  assert.equal(calibrated.status, 'amarillo');
  assert.equal(calibrated.confidence, 'alta');
}

{
  const calibrated = calibrateElectricityRow(row(27, [official({ users: 869 })]));
  assert.equal(calibrated.status, 'naranja');
  assert.ok(calibrated.statusReasonCodes.includes('impacto_oficial_250_mas_usuarios'));
}

{
  const calibrated = calibrateElectricityRow(row(48, [official({ users: 645, type: 'programado' })]));
  assert.equal(calibrated.status, 'amarillo');
  assert.equal(calibrated.score, 39);
  assert.ok(calibrated.statusReasonCodes.includes('corte_programado_confirmado'));
}

{
  const calibrated = calibrateElectricityRow(row(18, [official({ users: 12 }), citizen('uno')]));
  assert.equal(calibrated.status, 'naranja');
  assert.equal(calibrated.confidence, 'alta');
  assert.ok(calibrated.statusReasonCodes.includes('reporte_ciudadano_mas_confirmacion_oficial'));
}

{
  const calibrated = calibrateElectricityRow(row(72, [citizen('weak', 'weak_local_report', 4)]));
  assert.equal(calibrated.status, 'amarillo');
  assert.ok(calibrated.statusReasonCodes.includes('guardrail_naranja_requiere_corrobacion'));
}

{
  const calibrated = calibrateElectricityRow(row(66, [official({ users: 5100 })]));
  assert.equal(calibrated.status, 'rojo');
  assert.ok(calibrated.statusReasonCodes.includes('impacto_oficial_5000_mas_usuarios'));
}

{
  const calibrated = calibrateElectricityRow(row(80, [citizen('uno'), citizen('dos'), citizen('tres')]));
  assert.equal(calibrated.status, 'naranja');
  assert.ok(calibrated.statusReasonCodes.includes('guardrail_rojo_requiere_crisis_corrobada'));
}

console.log('Electricity thermometer calibration fixtures: OK');
