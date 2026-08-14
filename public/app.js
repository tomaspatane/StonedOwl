const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function switchView(view) {
  const radar = view === 'radar';
  $('radarView').hidden = !radar;
  $('searchView').hidden = radar;
  document.querySelectorAll('.nav-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });
}

document.querySelectorAll('.nav-btn').forEach(button => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});

function growthView(value, hasLatest, hasPrevious) {
  if (!hasLatest) return { text: 'Recolectando', className: 'waiting', arrow: '◌' };
  if (!hasPrevious || value === null) return { text: 'Primera medición', className: 'neutral', arrow: '→' };
  if (value > 2) return { text: `+${value}%`, className: 'up', arrow: '↑' };
  if (value < -2) return { text: `${value}%`, className: 'down', arrow: '↓' };
  return { text: 'Estable', className: 'neutral', arrow: '→' };
}

function renderRadar(monitors) {
  if (!monitors.length) {
    $('radarCards').innerHTML = '<div class="empty panel"><strong>No hay monitoreos activos</strong>La base está conectada, pero todavía no hay temas configurados.</div>';
    return;
  }

  $('radarCards').innerHTML = monitors.map(monitor => {
    const latest = monitor.latest;
    const growth = growthView(monitor.growthPercent, Boolean(latest), Boolean(monitor.previous));
    return `<button class="monitor-card" data-monitor="${esc(monitor.id)}">
      <div class="monitor-top"><div><span class="monitor-kicker">MONITOREO</span><h3>${esc(monitor.name)}</h3></div><span class="trend ${growth.className}">${growth.arrow} ${growth.text}</span></div>
      <div class="monitor-metrics">
        <div><span>Volumen</span><b>${latest ? latest.article_count : '—'}</b><small>noticias / 24 h</small></div>
        <div><span>Medios</span><b>${latest ? latest.source_count : '—'}</b><small>fuentes distintas</small></div>
        <div><span>Actualización</span><b class="small-value">${latest ? formatDate(latest.captured_at) : 'Pendiente'}</b><small>captura automática</small></div>
      </div>
      <div class="monitor-foot"><span>${latest ? 'Ver evolución y noticias' : 'Primera captura al inicio de la hora'}</span><b>→</b></div>
    </button>`;
  }).join('');

  document.querySelectorAll('[data-monitor]').forEach(card => {
    card.addEventListener('click', () => openMonitor(card.dataset.monitor));
  });
}

async function loadRadar() {
  try {
    const response = await fetch('/api/radar', { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No respondió el Radar');
    renderRadar(data.monitors || []);
    $('radarStatus').textContent = `${data.monitors?.length || 0} monitoreo activo · actualización horaria`;
  } catch (error) {
    $('radarStatus').textContent = 'Radar temporalmente no disponible';
    $('radarCards').innerHTML = `<div class="empty panel"><strong>No pude cargar el Radar</strong>${esc(error.message)}</div>`;
  }
}

function snapshotChart(snapshots) {
  if (!snapshots.length) {
    return '<div class="detail-placeholder"><strong>El histórico empieza ahora</strong><p>La primera medición se guardará al inicio de la próxima hora. Con dos mediciones podremos calcular crecimiento.</p></div>';
  }
  const ordered = [...snapshots].slice(0, 12).reverse();
  const max = Math.max(...ordered.map(item => item.article_count), 1);
  return `<div class="history-bars">${ordered.map(item => {
    const height = Math.max(8, Math.round(item.article_count / max * 100));
    return `<div class="history-item" title="${esc(formatDate(item.captured_at))}: ${item.article_count}"><span style="height:${height}%"></span><small>${new Date(item.captured_at).getHours()}h</small></div>`;
  }).join('')}</div>`;
}

async function openMonitor(id) {
  $('monitorDetail').innerHTML = '<div class="detail-empty"><span class="owl-mark spin">◌</span><div><strong>Cargando monitoreo…</strong></div></div>';
  $('monitorDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const response = await fetch(`/api/monitor?id=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No respondió el monitoreo');
    const articles = data.articles || [];
    $('monitorDetail').innerHTML = `<div class="head detail-head"><div><span class="monitor-kicker">DETALLE</span><h2>${esc(data.monitor.name)}</h2></div><span>${data.snapshots.length} mediciones</span></div>
      <div class="detail-layout">
        <section class="history-panel"><div class="section-title"><h3>Evolución reciente</h3><span>volumen por captura</span></div>${snapshotChart(data.snapshots)}</section>
        <section class="detail-news"><div class="section-title"><h3>Noticias asociadas</h3><span>${articles.length} guardadas</span></div>
          ${articles.length ? articles.slice(0, 12).map(article => `<a class="detail-article" href="${esc(article.url)}" target="_blank" rel="noopener"><strong>${esc(article.title)}</strong><span>${esc(article.source || article.provider || 'Fuente')} · ${formatDate(article.last_seen_at)}</span></a>`).join('') : '<div class="detail-placeholder compact"><p>Las noticias aparecerán después de la primera captura.</p></div>'}
        </section>
      </div>`;
  } catch (error) {
    $('monitorDetail').innerHTML = `<div class="detail-empty"><span class="owl-mark">!</span><div><strong>No pude abrir el monitoreo</strong><p>${esc(error.message)}</p></div></div>`;
  }
}

function setStatus(text, type = '') {
  $('status').textContent = text;
  $('dot').className = 'dot ' + type;
}

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function articleSource(article) {
  return article.source || domainFromUrl(article.url) || 'Fuente';
}

function baseTerm() { return $('q').value.trim(); }

function newsUrl() {
  return '/api/news?' + new URLSearchParams({ q: baseTerm(), scope: $('scope').value, span: $('span').value });
}

function updateTrends() {
  const params = new URLSearchParams({ q: baseTerm(), geo: $('scope').value === 'argentina' ? 'AR' : '' });
  $('trends').href = 'https://trends.google.com/trends/explore?' + params;
}

function renderMedia(articles) {
  const counts = {};
  articles.forEach(article => { const source = articleSource(article); counts[source] = (counts[source] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!top.length) { $('media').innerHTML = '<div class="empty"><strong>Sin fuentes</strong>No hay medios para contar.</div>'; return; }
  const max = top[0][1];
  $('media').innerHTML = top.map(([source, count]) => `<div class="barrow"><div class="barlabel"><span>${esc(source)}</span><b>${count}</b></div><div class="bar"><span style="width:${Math.max(6, count / max * 100)}%"></span></div></div>`).join('');
}

function renderSearch(articles) {
  $('m1').textContent = articles.length;
  $('m2').textContent = new Set(articles.map(articleSource)).size;
  $('m3').textContent = $('span').options[$('span').selectedIndex].text.replace('Últimas ', '').replace('Último ', '');
  const active = [...new Set(articles.map(article => article.provider).filter(Boolean))];
  $('m4').textContent = active.length;
  $('m4sub').textContent = active.join(' + ') || 'sin fuentes';
  $('label').textContent = `${articles.length} resultados`;
  $('articles').innerHTML = articles.length ? articles.map(article => `<div class="article"><h4><a href="${esc(article.url)}" target="_blank" rel="noopener">${esc(article.title || 'Sin título')}</a></h4><div class="meta"><span class="media">${esc(articleSource(article))}</span><span>${esc(article.provider || '')}</span><span>${esc(formatDate(article.date))}</span></div></div>`).join('') : '<div class="empty"><strong>No aparecieron noticias</strong>Probá ampliar el período o cambiar el término.</div>';
  renderMedia(articles);
}

function sourceLine(name, source = {}) {
  if (source.ok) return `<div><b class="source-ok">● ${esc(name)}</b> · ${source.count || 0} resultados</div>`;
  const error = source.error ? ` · ${esc(String(source.error).slice(0, 120))}` : '';
  return `<div class="source-off"><b>○ ${esc(name)}</b> · no disponible${error}</div>`;
}

function diagnostics(data = {}) {
  return [sourceLine('Bing News', data.bingNews), sourceLine('GDELT', data.gdelt), sourceLine('Google News', data.googleNews)].join('');
}

async function search() {
  if (!baseTerm()) { $('q').focus(); return; }
  updateTrends();
  setStatus('Buscando noticias…', 'load');
  $('go').disabled = true;
  $('label').textContent = 'Cargando…';
  $('diag').textContent = 'Consultando fuentes abiertas desde StonedOwl.';
  try {
    const response = await fetch(newsUrl(), { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw data;
    const articles = data.articles || [];
    renderSearch(articles);
    $('diag').innerHTML = diagnostics(data.diagnostics);
    setStatus(articles.length ? `Listo: ${articles.length} noticias reales.` : 'Las fuentes respondieron, pero no hubo resultados.', articles.length ? 'ok' : '');
  } catch (error) {
    $('articles').innerHTML = `<div class="empty"><strong>No pude traer resultados</strong>${esc(error.error || 'Error de fuentes')}</div>`;
    $('diag').innerHTML = diagnostics(error.diagnostics);
    setStatus('No hubo ninguna fuente disponible.', 'err');
  } finally { $('go').disabled = false; }
}

$('go').addEventListener('click', search);
$('q').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
$('q').addEventListener('input', updateTrends);
$('scope').addEventListener('change', updateTrends);
updateTrends();
loadRadar();
setInterval(loadRadar, 300000);

