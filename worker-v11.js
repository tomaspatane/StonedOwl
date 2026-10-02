import workerV10 from './worker-v10.js';
import { calibrateElectricityRadar } from './data/electricidad-thermometer.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await workerV10.fetch(request, env);
    if (url.pathname !== '/api/electricidad') return response;

    let payload;
    try { payload = await response.json(); }
    catch { return response; }
    if (!payload?.ok) return json(payload, response.status || 500);

    const radar = calibrateElectricityRadar(payload.radar || []);
    const counts = radar.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, { verde: 0, amarillo: 0, naranja: 0, rojo: 0 });

    return json({
      ...payload,
      version: '0.14-electricidad-calibrated-thermometer',
      provisional: true,
      methodology: `${payload.methodology || ''} La capa v0.14 agrega guardrails explícitos: una sola señal local fuerte puede abrir amarillo, naranja exige corroboración o impacto oficial relevante, y rojo queda reservado para crisis fuertemente corroboradas. Los cortes programados se distinguen de las fallas no programadas. El score numérico se ajusta al rango del color final y se conserva rawScore para auditoría.`,
      calibration: {
        version: 'electricidad-v1',
        thresholds: { verde: '0-19', amarillo: '20-39', naranja: '40-64', rojo: '65-100' },
        rules: [
          'Un reporte local fuerte aislado puede elevar a amarillo, no a naranja.',
          'Dos fuentes locales fuertes e independientes pueden elevar a naranja.',
          'Una falla oficial no programada con 250 o más usuarios afectados puede elevar a naranja.',
          'Reporte ciudadano local más confirmación oficial puede elevar a naranja.',
          'Rojo requiere 5000 o más usuarios afectados en una falla oficial no programada, o corroboración múltiple excepcional.',
          'Un corte programado confirmado queda normalmente en amarillo; sólo un impacto programado masivo puede llegar a naranja.',
          'Evidencia local débil o web genérica no puede producir naranja por sí sola.'
        ],
        statusCounts: counts
      },
      radar,
      fetchedAt: new Date().toISOString()
    }, response.status || 200);
  }
};
