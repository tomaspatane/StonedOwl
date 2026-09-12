const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

function setStatus(text, type = '') {
  $('status').textContent = text;
  $('dot').className = 'dot ' + type;
}

function fmtDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function articleSource(article) { return article.source || domainFromUrl(article.url) || 'Fuente'; }
function baseTerm() { return $('q').value.trim(); }

function newsUrl() {
  const params = new URLSearchParams({ q: baseTerm(), scope: $('scope').value, span: $('span').value });
  return '/api/news?' + params.toString();
}

function cabaUrl() {
  return '/api/caba?' + new URLSearchParams({ span: $('span').value }).toString();
}

function updateTrends() {
  const params = new URLSearchParams({ q: baseTerm(), geo: $('scope').value === 'argentina' ? 'AR' : '' });
  $('trends').href = 'https://trends.google.com/trends/explore?' + params.toString();
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({ error: 'Respuesta inválida del backend' }));
  if (!response.ok) throw data;
  return data;
}

function dedupe(articles) {
  const seen = new Set();
  return articles.filter(article => {
    const key = (article.title || article.url).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderMedia(articles) {
  const counts = {};
  articles.forEach(article => { const source = articleSource(article); counts[source] = (counts[source] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!top.length) {
    $('media').innerHTML = '<div class="empty"><strong>Sin fuentes</strong>No hay medios para contar.</div>';
    return;
  }
  const max = top[0][1];
  $('media').innerHTML = top.map(([source, count]) =>
    `<div class="barrow"><div class="barlabel"><span>${esc(source)}</span><b>${count}</b></div><div class="bar"><span style="width:${Math.max(6, count / max * 100)}%"></span></div></div>`
  ).join('');
}

function render(articles) {
  $('m1').textContent = articles.length;
  $('m2').textContent = new Set(articles.map(articleSource)).size;
  $('m3').textContent = $('span').options[$('span').selectedIndex].text.replace('Últimas ', '').replace('Último ', '');
  const active = [...new Set(articles.map(article => article.provider).filter(Boolean))];
  $('m4').textContent = active.length;
  $('m4sub').textContent = active.join(' + ') || 'sin fuentes';
  $('label').textContent = `${articles.length} resultados`;
  $('articles').innerHTML = articles.length
    ? articles.map(article => `<div class="article"><h4><a href="${esc(article.url)}" target="_blank" rel="noopener">${esc(article.title || 'Sin título')}</a></h4><div class="meta"><span class="media">${esc(articleSource(article))}</span><span>${esc(article.provider || '')}</span><span>${esc(fmtDate(article.date))}</span></div></div>`).join('')
    : '<div class="empty"><strong>No aparecieron noticias</strong>Probá ampliar el período o cambiar el término.</div>';
  renderMedia(articles);
}

function signalClass(signal) { return signal === 'alta' ? 'high' : signal === 'media' ? 'mid' : 'low'; }

function renderRadar(data) {
  const categories = Array.isArray(data.categories) ? data.categories : [];
  $('radarLabel').textContent = `${categories.length} categorías · ${$('span').options[$('span').selectedIndex].text.toLowerCase()}`;
  $('radarNote').textContent = data.note || 'La señal mide cobertura actual y diversidad de fuentes.';
  $('radarResults').innerHTML = categories.map(category => {
    const topics = (category.subtopics || []).slice(0, 5).map(t => `<span class="topic">${esc(t.label)} <b>${t.count}</b></span>`).join('');
    const examples = (category.articles || []).slice(0, 3).map(a => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>`).join('');
    return `<article class="radar-item">
      <div class="radar-top"><div><small>${esc(category.label)}</small><strong>${category.count}</strong></div><span class="signal ${signalClass(category.signal)}">${esc(category.signal)}</span></div>
      <div class="radar-meta">${category.sources} fuentes distintas</div>
      <div class="topics">${topics || '<span class="muted">Sin subtemas dominantes</span>'}</div>
      <div class="radar-links">${examples}</div>
    </article>`;
  }).join('') || '<div class="empty"><strong>Sin señal</strong>No hubo resultados para clasificar.</div>';
}

function sourceLine(name, source = {}) {
  if (source.ok) return `<div><b style="color:#baff64">● ${esc(name)}</b> · ${source.count || 0} resultados</div>`;
  const error = source.error ? ` · ${esc(String(source.error).slice(0, 120))}` : '';
  return `<div style="opacity:.62"><b>○ ${esc(name)}</b> · no disponible${error}</div>`;
}

function diagnostics(data = {}) {
  return [sourceLine('Bing News', data.bingNews), sourceLine('GDELT', data.gdelt), sourceLine('Google News', data.googleNews)].join('');
}

async function search() {
  const term = baseTerm();
  if (!term) { $('q').focus(); return; }
  updateTrends();
  setStatus('Buscando noticias…', 'load');
  $('go').disabled = true;
  $('label').textContent = 'Cargando…';
  $('diag').textContent = 'Consultando fuentes abiertas desde StonedOwl.';
  try {
    const data = await getJson(newsUrl());
    const articles = dedupe(data.articles || []);
    render(articles);
    $('diag').innerHTML = diagnostics(data.diagnostics);
    setStatus(articles.length ? `Listo: ${articles.length} noticias reales.` : 'Las fuentes respondieron, pero no hubo resultados.', articles.length ? 'ok' : '');
  } catch (error) {
    $('articles').innerHTML = `<div class="empty"><strong>No pude traer resultados</strong>${esc(error.error || 'Error de fuentes')}</div>`;
    $('diag').innerHTML = (error.error ? esc(error.error) + '<br>' : '') + diagnostics(error.diagnostics);
    setStatus('No hubo ninguna fuente disponible.', 'err');
  } finally { $('go').disabled = false; }
}

async function runRadar() {
  $('radar').disabled = true;
  $('radarLabel').textContent = 'analizando…';
  $('radarResults').innerHTML = '<div class="empty"><strong>Escuchando CABA</strong>Clasificando cobertura por problema urbano.</div>';
  setStatus('Corriendo Radar CABA…', 'load');
  try {
    const data = await getJson(cabaUrl());
    renderRadar(data);
    setStatus('Radar CABA actualizado.', 'ok');
  } catch (error) {
    $('radarResults').innerHTML = `<div class="empty"><strong>No pude correr el radar</strong>${esc(error.error || 'Error de fuentes')}</div>`;
    $('radarLabel').textContent = 'error';
    setStatus('Falló el Radar CABA.', 'err');
  } finally { $('radar').disabled = false; }
}

$('go').onclick = search;
$('radar').onclick = runRadar;
$('q').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
$('q').addEventListener('input', updateTrends);
$('scope').addEventListener('change', updateTrends);
updateTrends();