const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const STATUS_META = {
  verde: { label: 'Sin señal suficiente', rank: 0 },
  amarillo: { label: 'Atención', rank: 1 },
  naranja: { label: 'Problema', rank: 2 },
  rojo: { label: 'Crítico', rank: 3 }
};

const REASON_LABELS = {
  sin_evidencia_util: 'Sin evidencia útil',
  reporte_local_fuerte: 'Reporte local fuerte',
  dos_fuentes_locales_independientes: 'Dos fuentes locales independientes',
  incidente_local_infraestructura_sin_impacto_confirmado: 'Incidente local sin impacto confirmado',
  corte_programado_masivo: 'Corte programado masivo',
  corte_programado_confirmado: 'Corte programado confirmado',
  incidente_oficial_confirmado: 'Incidente oficial confirmado',
  impacto_oficial_250_mas_usuarios: '250+ usuarios afectados',
  impacto_oficial_5000_mas_usuarios: '5.000+ usuarios afectados',
  reporte_ciudadano_mas_confirmacion_oficial: 'Reporte ciudadano + confirmación oficial',
  guardrail_naranja_requiere_corrobacion: 'Naranja frenado por falta de corroboración',
  guardrail_rojo_requiere_crisis_corrobada: 'Rojo frenado por falta de crisis corroborada',
  score_sin_override: 'Score sin override'
};

const BARRIOS = [
  ['Saavedra',12,25,8],['Núñez',13,56,7],['Coghlan',12,38,15],['Belgrano',13,55,16],['Villa Urquiza',12,31,21],
  ['Villa Pueyrredón',12,20,25],['Colegiales',13,50,24],['Palermo',14,64,28],['Recoleta',2,72,34],['Retiro',1,84,31],
  ['Chacarita',15,42,29],['Villa Ortúzar',15,34,29],['Parque Chas',15,29,33],['Agronomía',15,19,35],['Villa Devoto',11,10,33],
  ['Villa del Parque',11,18,41],['La Paternal',15,34,37],['Villa Crespo',15,44,36],['Almagro',5,50,44],['Balvanera',3,60,46],
  ['San Nicolás',1,80,41],['Puerto Madero',1,90,46],['Monserrat',1,76,48],['San Telmo',1,78,55],['Constitución',1,68,59],
  ['Villa Real',10,6,45],['Monte Castro',10,12,50],['Villa Santa Rita',11,24,45],['Villa General Mitre',11,31,45],['Caballito',6,41,50],
  ['San Cristóbal',3,58,55],['Boedo',5,49,56],['Versalles',10,7,56],['Floresta',10,20,54],['Flores',7,30,56],
  ['Vélez Sarsfield',10,16,61],['Villa Luro',10,12,65],['Liniers',9,6,67],['Parque Avellaneda',9,27,69],['Parque Chacabuco',7,39,63],
  ['Parque Patricios',4,53,67],['La Boca',4,76,70],['Barracas',4,64,73],['Mataderos',9,13,77],['Nueva Pompeya',4,45,76],
  ['Villa Soldati',8,36,83],['Villa Lugano',8,23,86],['Villa Riachuelo',8,29,94]
].map(([name, comuna, x, y]) => ({ name, comuna, x, y }));

let currentData = null;
let currentRows = [];
let loading = false;

for (let comuna = 1; comuna <= 15; comuna += 1) {
  const option = document.createElement('option');
  option.value = String(comuna);
  option.textContent = `Comuna ${comuna}`;
  $('comunaFilter').appendChild(option);
}

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function rowByBarrio(name) {
  return currentRows.find(row => normalize(row.barrio) === normalize(name));
}

function fmtNumber(value) {
  return new Intl.NumberFormat('es-AR').format(Number(value) || 0);
}

function fmtUpdated(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function fmtEvidenceDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function rowStatus(row) {
  return row?.status && STATUS_META[row.status] ? row.status : 'verde';
}

function filtered(row, barrio) {
  const comuna = $('comunaFilter').value;
  const status = $('statusFilter').value;
  if (comuna !== 'all' && String(barrio.comuna) !== comuna) return false;
  if (status !== 'all' && rowStatus(row) !== status) return false;
  return true;
}

function alertSummary(row) {
  const evidence = row?.evidenceSummary || {};
  const bits = [];
  if (row?.mentions) bits.push(`${row.mentions} señales`);
  if (evidence.independentSources) bits.push(`${evidence.independentSources} fuentes independientes`);
  if (row?.officialConfirmation) bits.push('confirmación oficial');
  if (row?.affectedUsers) bits.push(`${fmtNumber(row.affectedUsers)} usuarios`);
  return bits.slice(0, 3).join(' · ') || 'Señal detectada';
}

function renderMap() {
  const layer = $('barriosLayer');
  layer.innerHTML = '';
  for (const barrio of BARRIOS) {
    const row = rowByBarrio(barrio.name);
    const status = rowStatus(row);
    const visible = filtered(row, barrio);
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `barrio-node ${status}`;
    node.style.left = `${barrio.x}%`;
    node.style.top = `${barrio.y}%`;
    node.style.opacity = visible ? '1' : '.16';
    node.title = `${barrio.name} · ${STATUS_META[status].label}`;
    node.setAttribute('aria-label', node.title);
    node.onclick = () => openDrawer(row || { barrio: barrio.name, comuna: barrio.comuna, status: 'verde', score: 0, confidence: 'baja', evidence: [] });
    layer.appendChild(node);

    if (status !== 'verde') {
      const label = document.createElement('span');
      label.className = 'barrio-label alert';
      label.style.left = `${barrio.x}%`;
      label.style.top = `${barrio.y}%`;
      label.style.opacity = visible ? '1' : '.15';
      label.textContent = barrio.name;
      layer.appendChild(label);
    }
  }
}

function renderAlerts() {
  const comuna = $('comunaFilter').value;
  const statusFilter = $('statusFilter').value;
  const alerts = currentRows
    .filter(row => rowStatus(row) !== 'verde')
    .filter(row => comuna === 'all' || String(row.comuna) === comuna)
    .filter(row => statusFilter === 'all' || rowStatus(row) === statusFilter)
    .sort((a, b) => STATUS_META[rowStatus(b)].rank - STATUS_META[rowStatus(a)].rank || (b.score || 0) - (a.score || 0));

  $('alerts').innerHTML = alerts.length ? alerts.map(row => {
    const status = rowStatus(row);
    return `<button class="alert-card" data-barrio="${esc(row.barrio)}" type="button">
      <span class="alert-dot ${status}"></span>
      <span class="alert-main"><strong>${esc(row.barrio)}</strong><span class="category">Electricidad</span><small>${esc(alertSummary(row))}</small></span>
      <span class="alert-state ${status}">${STATUS_META[status].label}</span>
    </button>`;
  }).join('') : '<div class="empty-state">No hay alertas con estos filtros.</div>';

  document.querySelectorAll('.alert-card').forEach(card => {
    card.onclick = () => openDrawer(rowByBarrio(card.dataset.barrio));
  });
}

function renderHeader() {
  const alerts = currentRows.filter(row => rowStatus(row) !== 'verde');
  $('updatedAt').textContent = fmtUpdated(currentData?.fetchedAt);
  $('alertCount').textContent = `${alerts.length} / 48`;

  const coverage = currentData?.coverage || {};
  const sources = [];
  if ((coverage.enreRawRecords || 0) > 0) sources.push('ENRE');
  if ((coverage.serperWebRaw || 0) > 0 || (coverage.territorialRaw || 0) > 0) sources.push('Web');
  if ((coverage.redditRaw || 0) > 0) sources.push('Social');
  $('sourceCount').textContent = sources.length ? sources.join(' · ') : 'Sin señal';
  $('systemState').textContent = currentData?.ok ? 'Operativo' : 'Parcial';
  $('systemDot').className = `status-dot ${currentData?.ok ? 'live' : 'warn'}`;

  const territorial = coverage.territorialEnabled ? `${coverage.territorialBarrios?.length || 0} barrios en este barrido` : 'barrido territorial no activo';
  $('coverageNote').textContent = `Piloto Electricidad · ${territorial}`;
}

function renderEditorialCases() {
  const cases = currentData?.editorialCases || [];
  const comuna = $('comunaFilter').value;
  const selected = cases.filter(item => comuna === 'all' || item.barrios.some(name => BARRIOS.some(b => b.name === name && String(b.comuna) === comuna)));
  $('editorialCases').innerHTML = selected.length ? selected.map(item => {
    const links = item.evidence.map(source => {
      let url;
      try { url = new URL(source.url); } catch { return ''; }
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(source.source)}</a> · ${esc(source.date || 'Sin fecha')}`;
    }).join('<br>');
    return `<article class="editorial-card"><small>${esc(item.evidenceLabel)} · ${esc(item.barrios.join(', '))}</small><h3>${esc(item.title)}</h3><p>${esc(item.reportedFact)}</p><p>${links}</p><p><strong>Pregunta a investigar:</strong> ${esc(item.question)}</p><p><strong>Responsabilidad:</strong> ${esc(item.responsibility.operator || 'Prestador por verificar')}; competencia y respuesta de gestión por verificar.</p><p><strong>Siguiente paso:</strong> ${esc(item.nextStep)}</p></article>`;
  }).join('') : '<div class="empty-state">Sin casos recuperados en esta captura para la comuna elegida. No implica ausencia de problemas.</div>';
}

function renderAll() {
  renderEditorialCases();
  renderHeader();
  renderMap();
  renderAlerts();
}

function evidenceHtml(row) {
  const evidence = Array.isArray(row?.evidence) ? row.evidence : [];
  if (!evidence.length) return '<div class="empty-state">No hay evidencia útil asociada a este barrio.</div>';
  return evidence.slice(0, 8).map(item => {
    const title = item.title || item.signalPhrases?.join(', ') || item.provider || 'Señal';
    const snippet = item.snippet || '';
    const source = item.source || item.provider || 'Fuente';
    return `<article class="evidence"><strong>${esc(title)}</strong>${snippet ? `<p>${esc(snippet)}</p>` : ''}<small>${esc(source)}${item.date ? ` · ${esc(fmtEvidenceDate(item.date))}` : ''}${item.evidenceQuality ? ` · ${esc(item.evidenceQuality)}` : ''}</small></article>`;
  }).join('');
}

function openDrawer(row) {
  if (!row) return;
  const status = rowStatus(row);
  const summary = row.evidenceSummary || {};
  const reasons = (row.statusReasonCodes || []).map(code => `<span class="reason">${esc(REASON_LABELS[code] || code.replace(/_/g,' '))}</span>`).join('');
  $('drawerContent').innerHTML = `<div class="drawer-title">
    <span class="eyebrow">Electricidad · Comuna ${esc(row.comuna || '—')}</span>
    <h2>${esc(row.barrio || 'Barrio')}</h2>
    <div class="drawer-sub">Termómetro territorial del piloto</div>
    <div class="drawer-status"><span class="pill ${status}">${STATUS_META[status].label}</span><span class="pill">Confianza ${esc(row.confidence || 'baja')}</span>${row.officialConfirmation ? '<span class="pill">Confirmación oficial</span>' : ''}</div>
  </div>
  <div class="drawer-grid">
    <div class="drawer-metric"><small>Score calibrado</small><strong>${fmtNumber(row.score)}</strong></div>
    <div class="drawer-metric"><small>Score bruto</small><strong>${fmtNumber(row.rawScore ?? row.score)}</strong></div>
    <div class="drawer-metric"><small>Fuentes independientes</small><strong>${fmtNumber(summary.independentSources ?? row.independentSources)}</strong></div>
    <div class="drawer-metric"><small>Usuarios afectados</small><strong>${fmtNumber(row.affectedUsers)}</strong></div>
  </div>
  ${reasons ? `<div class="section-title">Por qué tiene este color</div><div class="reason-list">${reasons}</div>` : ''}
  <div class="section-title">Evidencia</div>
  <div class="evidence-list">${evidenceHtml(row)}</div>`;

  $('drawerBackdrop').hidden = false;
  requestAnimationFrame(() => $('drawer').classList.add('open'));
  $('drawer').setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  setTimeout(() => { $('drawerBackdrop').hidden = true; }, 220);
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({ error: 'Respuesta inválida del backend' }));
  if (!response.ok) throw data;
  return data;
}

async function loadRadar() {
  if (loading) return;
  loading = true;
  $('refreshBtn').disabled = true;
  $('refreshBtn').textContent = 'Actualizando…';
  $('mapMessage').style.display = 'block';
  $('mapMessage').textContent = 'Escuchando CABA…';
  try {
    const span = $('spanFilter').value;
    currentData = await getJson(`/api/electricidad?span=${encodeURIComponent(span)}&territorial=1`);
    currentRows = Array.isArray(currentData.radar) ? currentData.radar : [];
    renderAll();
    $('mapMessage').style.display = 'none';
  } catch (error) {
    console.error(error);
    currentData = { ok: false, fetchedAt: new Date().toISOString(), coverage: {} };
    currentRows = [];
    renderAll();
    $('mapMessage').style.display = 'block';
    $('mapMessage').textContent = 'No pude actualizar el radar.';
  } finally {
    loading = false;
    $('refreshBtn').disabled = false;
    $('refreshBtn').textContent = 'Actualizar';
  }
}

$('refreshBtn').onclick = loadRadar;
$('spanFilter').onchange = loadRadar;
$('comunaFilter').onchange = renderAll;
$('statusFilter').onchange = renderAll;
$('drawerClose').onclick = closeDrawer;
$('drawerBackdrop').onclick = closeDrawer;
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });

renderMap();
loadRadar();
