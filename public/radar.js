const radarEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

const RADAR_LABELS = {
  rising: 'Subiendo',
  active: 'Activo',
  stable: 'Estable',
  cooling: 'Bajando',
  learning: 'Aprendiendo',
  coverage_changed: 'Cobertura cambió',
  unavailable: 'Sin cobertura'
};

function radarTime(value) {
  if (!value) return 'Sin capturas';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function growthText(momentum) {
  if (!momentum?.comparable || momentum.growthPercent === null) return '—';
  const value = Number(momentum.growthPercent);
  return `${value > 0 ? '+' : ''}${value}%`;
}

function radarCard(monitor) {
  const latest = monitor.latest;
  const momentum = monitor.momentum || { status: 'learning', comparable: false, growthPercent: null, explanation: 'Esperando datos comparables.' };
  const label = RADAR_LABELS[momentum.status] || momentum.status;
  return `
    <article class="radar-card" data-state="${radarEsc(momentum.status)}">
      <div class="radar-card-top">
        <div><span class="radar-name">${radarEsc(monitor.name)}</span><small>${radarEsc(monitor.span === '1d' ? 'últimas 24 h' : monitor.span)}</small></div>
        <span class="radar-pill">${radarEsc(label)}</span>
      </div>
      <div class="radar-numbers">
        <div><b>${latest ? latest.article_count : '—'}</b><span>notas</span></div>
        <div><b>${latest ? latest.source_count : '—'}</b><span>medios</span></div>
        <div><b>${growthText(momentum)}</b><span>variación</span></div>
        <div><b>${monitor.newArticleCount ?? '—'}</b><span>nuevas</span></div>
      </div>
      <p>${radarEsc(momentum.explanation)}</p>
      <div class="radar-card-foot"><span>${momentum.comparable ? 'Capturas comparables' : 'No comparar todavía'}</span><span>${radarEsc(radarTime(latest?.captured_at))}</span></div>
    </article>`;
}

async function loadRadar() {
  const grid = document.getElementById('radar-grid');
  const status = document.getElementById('radar-status');
  const refresh = document.getElementById('radar-refresh');
  if (!grid || !status) return;

  refresh.disabled = true;
  status.textContent = 'Leyendo capturas históricas…';
  try {
    const response = await fetch('/api/radar', { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({ ok: false, error: 'Respuesta inválida del Radar.' }));
    if (!response.ok || data.ok !== true) throw data;
    const monitors = data.monitors || [];
    grid.innerHTML = monitors.length
      ? monitors.map(radarCard).join('')
      : '<div class="radar-placeholder">No hay monitoreos activos todavía.</div>';
    const hot = monitors.filter(m => m.momentum?.status === 'rising').length;
    status.textContent = hot
      ? `${hot} monitoreo${hot === 1 ? '' : 's'} con aceleración detectada.`
      : `${monitors.length} monitoreo${monitors.length === 1 ? '' : 's'} activo${monitors.length === 1 ? '' : 's'}. Sin aceleraciones comparables por ahora.`;
  } catch (error) {
    grid.innerHTML = `<div class="radar-placeholder"><strong>Radar no disponible</strong>${radarEsc(error.error || 'No se pudo consultar el histórico.')}</div>`;
    status.textContent = 'No se pudo completar la lectura del Radar.';
  } finally {
    refresh.disabled = false;
  }
}

document.getElementById('radar-refresh')?.addEventListener('click', loadRadar);
loadRadar();
