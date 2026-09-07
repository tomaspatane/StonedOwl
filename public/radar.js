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

const RADAR_PRIORITY = {
  rising: 0,
  active: 1,
  cooling: 2,
  coverage_changed: 3,
  learning: 4,
  stable: 5,
  unavailable: 6
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

function reasonText(monitor) {
  const momentum = monitor.momentum || {};
  const fresh = Number(monitor.newArticleCount || 0);
  const growth = momentum.growthPercent;
  if (momentum.status === 'rising') {
    const parts = [];
    if (fresh) parts.push(`${fresh} nota${fresh === 1 ? '' : 's'} nueva${fresh === 1 ? '' : 's'}`);
    if (growth !== null && growth !== undefined) parts.push(`${growth > 0 ? '+' : ''}${growth}% de variación`);
    return parts.length ? `Señal: ${parts.join(' y ')} frente a la captura comparable anterior.` : momentum.explanation;
  }
  if (momentum.status === 'active' && fresh) return `Señal: aparecieron ${fresh} nota${fresh === 1 ? '' : 's'} nueva${fresh === 1 ? '' : 's'} desde la captura anterior.`;
  if (momentum.status === 'cooling' && growth !== null && growth !== undefined) return `Señal: la cobertura bajó ${Math.abs(growth)}% frente a la captura comparable anterior.`;
  return momentum.explanation;
}

function radarCard(monitor, emphasis = 'context') {
  const latest = monitor.latest;
  const momentum = monitor.momentum || { status: 'learning', comparable: false, growthPercent: null, explanation: 'Esperando datos comparables.' };
  const label = RADAR_LABELS[momentum.status] || momentum.status;
  return `
    <article class="radar-card" data-state="${radarEsc(momentum.status)}" data-emphasis="${radarEsc(emphasis)}">
      <div class="radar-card-top">
        <div><span class="radar-name">${radarEsc(monitor.name)}</span><small>${radarEsc(monitor.span === '1d' ? 'últimas 24 h' : monitor.span)}</small></div>
        <span class="radar-pill">${radarEsc(label)}</span>
      </div>
      <p class="radar-why">${radarEsc(reasonText(monitor))}</p>
      <div class="radar-numbers">
        <div><b>${latest ? latest.article_count : '—'}</b><span>notas</span></div>
        <div><b>${latest ? latest.source_count : '—'}</b><span>medios</span></div>
        <div><b>${growthText(momentum)}</b><span>variación</span></div>
        <div><b>${monitor.newArticleCount ?? '—'}</b><span>nuevas</span></div>
      </div>
      <div class="radar-card-foot"><span>${momentum.comparable ? 'Capturas comparables' : 'No comparar todavía'}</span><span>${radarEsc(radarTime(latest?.captured_at))}</span></div>
    </article>`;
}

function sortMonitors(monitors) {
  return [...monitors].sort((a, b) => {
    const aState = a.momentum?.status || 'learning';
    const bState = b.momentum?.status || 'learning';
    const priority = (RADAR_PRIORITY[aState] ?? 99) - (RADAR_PRIORITY[bState] ?? 99);
    if (priority) return priority;
    return Number(b.newArticleCount || 0) - Number(a.newArticleCount || 0);
  });
}

function renderRadarGroups(monitors) {
  const urgent = sortMonitors(monitors).filter(m => ['rising', 'active', 'cooling'].includes(m.momentum?.status));
  const context = sortMonitors(monitors).filter(m => !['rising', 'active', 'cooling'].includes(m.momentum?.status));

  const urgentHtml = urgent.length
    ? `<div class="radar-group radar-group-hot"><div class="radar-group-title"><span>PRIORIDAD</span><strong>Señales para mirar ahora</strong></div><div class="radar-grid radar-grid-hot">${urgent.map(m => radarCard(m, 'priority')).join('')}</div></div>`
    : `<div class="radar-calm"><strong>Sin alertas comparables por ahora</strong><span>Los monitoreos siguen activos y vuelven a compararse en la próxima captura.</span></div>`;

  const contextHtml = context.length
    ? `<div class="radar-group radar-group-context"><div class="radar-group-title"><span>CONTEXTO</span><strong>Resto de los monitoreos</strong></div><div class="radar-grid radar-grid-context">${context.map(m => radarCard(m, 'context')).join('')}</div></div>`
    : '';

  return urgentHtml + contextHtml;
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
      ? renderRadarGroups(monitors)
      : '<div class="radar-placeholder">No hay monitoreos activos todavía.</div>';
    const rising = monitors.filter(m => m.momentum?.status === 'rising').length;
    const active = monitors.filter(m => m.momentum?.status === 'active').length;
    status.textContent = rising
      ? `${rising} señal${rising === 1 ? '' : 'es'} en aceleración${active ? ` · ${active} tema${active === 1 ? '' : 's'} activo${active === 1 ? '' : 's'}` : ''}.`
      : active
        ? `${active} tema${active === 1 ? '' : 's'} activo${active === 1 ? '' : 's'} sin aceleración fuerte.`
        : `${monitors.length} monitoreo${monitors.length === 1 ? '' : 's'} activo${monitors.length === 1 ? '' : 's'}. Sin alertas comparables por ahora.`;
  } catch (error) {
    grid.innerHTML = `<div class="radar-placeholder"><strong>Radar no disponible</strong>${radarEsc(error.error || 'No se pudo consultar el histórico.')}</div>`;
    status.textContent = 'No se pudo completar la lectura del Radar.';
  } finally {
    refresh.disabled = false;
  }
}

document.getElementById('radar-refresh')?.addEventListener('click', loadRadar);
loadRadar();
