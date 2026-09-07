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
    <article class="radar-card" role="button" tabindex="0" data-monitor-id="${radarEsc(monitor.id)}" data-state="${radarEsc(momentum.status)}" data-emphasis="${radarEsc(emphasis)}" aria-label="Abrir detalle de ${radarEsc(monitor.name)}">
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
      <div class="radar-card-foot"><span>${momentum.comparable ? 'Capturas comparables' : 'No comparar todavía'}</span><span>Ver qué lo explica →</span></div>
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

function detailArticle(article) {
  const title = radarEsc(article.title || 'Sin título');
  const source = radarEsc(article.source || article.provider || 'Fuente');
  const url = String(article.url || '');
  let safeUrl = '';
  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol)) safeUrl = parsed.href;
  } catch {}
  return `<li>${safeUrl ? `<a href="${radarEsc(safeUrl)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}<span>${source}</span></li>`;
}

function renderMonitorDetail(data) {
  const signal = data.dominantSignal || {};
  const stories = data.stories || [];
  const articles = data.articles || [];
  const evidenceClass = signal.confirmed ? 'confirmed' : 'weak';
  const evidenceLabel = signal.confirmed ? 'Evidencia repetida' : 'Evidencia insuficiente';
  const topArticles = signal.title
    ? articles.filter(article => String(article.title || '').toLowerCase().includes(String(signal.title).toLowerCase().split(' ').slice(0, 3).join(' '))).slice(0, 5)
    : articles.slice(0, 5);

  return `
    <div class="signal-summary ${evidenceClass}">
      <div class="signal-badge">${evidenceLabel}</div>
      ${signal.locationLabel ? `<div class="signal-location">${radarEsc(signal.locationLabel)}</div>` : ''}
      <h3>${signal.title ? radarEsc(signal.title) : 'No hay un problema dominante confirmado'}</h3>
      <p>${radarEsc(signal.assessment || 'Todavía no hay evidencia suficiente.')}</p>
      ${signal.title ? `<div class="signal-stats"><span>${signal.sourceCount || 0} fuentes</span><span>${signal.articleCount || 0} notas</span><span>${radarEsc(radarTime(signal.latestPublishedAt))}</span></div>` : ''}
    </div>
    <div class="signal-columns">
      <div><h4>Qué sostiene esta señal</h4><ul class="signal-articles">${topArticles.length ? topArticles.map(detailArticle).join('') : '<li>Sin notas suficientes para mostrar.</li>'}</ul></div>
      <div><h4>Otras historias detectadas</h4><ul class="signal-stories">${stories.slice(1, 5).map(story => `<li><strong>${radarEsc(story.title)}</strong><span>${story.geo?.barrios?.length ? `${radarEsc(story.geo.barrios.join(', '))} · ` : ''}${story.sourceCount} fuentes · ${story.articleCount} notas</span></li>`).join('') || '<li>No hay otras historias agrupadas todavía.</li>'}</ul></div>
    </div>`;
}

async function openMonitorDetail(id, name) {
  const detail = document.getElementById('radar-detail');
  const title = document.getElementById('radar-detail-title');
  const body = document.getElementById('radar-detail-body');
  if (!detail || !title || !body) return;
  detail.hidden = false;
  title.textContent = name || 'Monitoreo';
  body.innerHTML = '<div class="radar-placeholder">Buscando qué historia explica esta señal…</div>';
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const response = await fetch(`/api/monitor?id=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({ ok: false, error: 'Respuesta inválida del monitoreo.' }));
    if (!response.ok || data.ok !== true) throw data;
    body.innerHTML = renderMonitorDetail(data);
  } catch (error) {
    body.innerHTML = `<div class="radar-placeholder"><strong>No pude abrir el detalle</strong>${radarEsc(error.error || 'No se pudo consultar el monitoreo.')}</div>`;
  }
}

function bindRadarCards() {
  document.querySelectorAll('[data-monitor-id]').forEach(card => {
    const open = () => openMonitorDetail(card.dataset.monitorId, card.querySelector('.radar-name')?.textContent);
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function territoryRow(item, type) {
  const label = type === 'commune' ? `Comuna ${item.commune}` : item.barrio;
  const problem = item.predominantProblem?.name || 'Sin predominio';
  const evidence = [...(item.entities || []), ...(item.stations || []).map(name => `Estación ${name}`)].slice(0, 2);
  return `<div class="territory-row">
    <div class="territory-rank"><b>${radarEsc(label)}</b><span>${radarEsc(problem)}${evidence.length ? ` · ${radarEsc(evidence.join(', '))}` : ''}</span></div>
    <div class="territory-count"><b>${Number(item.incidentCount || 0)}</b><span>incidentes</span></div>
  </div>`;
}

async function loadTerritory() {
  const communes = document.getElementById('territory-communes');
  const barrios = document.getElementById('territory-barrios');
  const coverage = document.getElementById('territory-coverage');
  if (!communes || !barrios || !coverage) return;

  try {
    const response = await fetch('/api/territory', { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({ ok: false, error: 'Respuesta territorial inválida.' }));
    if (!response.ok || data.ok !== true) throw data;
    const communeRows = (data.communes || []).slice(0, 8);
    const barrioRows = (data.barrios || []).slice(0, 8);
    communes.innerHTML = communeRows.length ? communeRows.map(item => territoryRow(item, 'commune')).join('') : '<div class="territory-empty">Todavía no hay incidentes con comuna identificable.</div>';
    barrios.innerHTML = barrioRows.length ? barrioRows.map(item => territoryRow(item, 'barrio')).join('') : '<div class="territory-empty">Todavía no hay incidentes con barrio identificable.</div>';
    const c = data.coverage || {};
    coverage.textContent = `${c.geolocatedArticles || 0}/${c.totalArticles || 0} incidentes ubicados · ${c.geolocatedPercent || 0}%`;
  } catch (error) {
    const message = radarEsc(error.error || 'No se pudo calcular el ranking territorial.');
    communes.innerHTML = `<div class="territory-empty">${message}</div>`;
    barrios.innerHTML = '<div class="territory-empty">Sin datos territoriales disponibles.</div>';
    coverage.textContent = 'Ranking no disponible';
  }
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
    bindRadarCards();
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

document.getElementById('radar-refresh')?.addEventListener('click', () => {
  loadRadar();
  loadTerritory();
});
document.getElementById('radar-detail-close')?.addEventListener('click', () => {
  document.getElementById('radar-detail').hidden = true;
});
loadRadar();
loadTerritory();
