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
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function articleSource(article) {
  return article.source || domainFromUrl(article.url) || 'Fuente';
}

function baseTerm() {
  return $('q').value.trim();
}

function newsUrl() {
  const params = new URLSearchParams({
    q: baseTerm(),
    scope: $('scope').value,
    span: $('span').value
  });
  return '/api/news?' + params.toString();
}

function updateTrends() {
  const params = new URLSearchParams({
    q: baseTerm(),
    geo: $('scope').value === 'argentina' ? 'AR' : ''
  });
  $('trends').href = 'https://trends.google.com/trends/explore?' + params.toString();
}

async function fetchNews() {
  const response = await fetch(newsUrl(), { headers: { Accept: 'application/json' } });
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
  articles.forEach(article => {
    const source = articleSource(article);
    counts[source] = (counts[source] || 0) + 1;
  });

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
  $('m3').textContent = $('span').options[$('span').selectedIndex].text
    .replace('Últimas ', '')
    .replace('Último ', '');

  const active = [...new Set(articles.map(article => article.provider).filter(Boolean))];
  $('m4').textContent = active.length;
  $('m4sub').textContent = active.join(' + ') || 'sin fuentes';
  $('label').textContent = `${articles.length} resultados`;

  $('articles').innerHTML = articles.length
    ? articles.map(article =>
      `<div class="article"><h4><a href="${esc(article.url)}" target="_blank" rel="noopener">${esc(article.title || 'Sin título')}</a></h4><div class="meta"><span class="media">${esc(articleSource(article))}</span><span>${esc(article.provider || '')}</span><span>${esc(fmtDate(article.date))}</span></div></div>`
    ).join('')
    : '<div class="empty"><strong>No aparecieron noticias</strong>Probá ampliar el período o cambiar el término.</div>';

  renderMedia(articles);
}

function sourceLine(name, source = {}) {
  if (source.ok) {
    return `<div><b style="color:#baff64">● ${esc(name)}</b> · ${source.count || 0} resultados</div>`;
  }
  const error = source.error ? ` · ${esc(String(source.error).slice(0, 120))}` : '';
  return `<div style="opacity:.62"><b>○ ${esc(name)}</b> · no disponible${error}</div>`;
}

function diagnostics(data = {}) {
  return [
    sourceLine('Bing News', data.bingNews),
    sourceLine('GDELT', data.gdelt),
    sourceLine('Google News', data.googleNews)
  ].join('');
}

async function search() {
  const term = baseTerm();
  if (!term) {
    $('q').focus();
    return;
  }

  updateTrends();
  setStatus('Buscando noticias…', 'load');
  $('go').disabled = true;
  $('label').textContent = 'Cargando…';
  $('diag').textContent = 'Consultando fuentes abiertas desde StonedOwl.';

  try {
    const data = await fetchNews();
    const articles = dedupe(data.articles || []);
    render(articles);
    $('diag').innerHTML = diagnostics(data.diagnostics);

    if (articles.length) {
      setStatus(`Listo: ${articles.length} noticias reales.`, 'ok');
    } else {
      setStatus('Las fuentes respondieron, pero no hubo resultados.', '');
    }
  } catch (error) {
    $('m1').textContent = '—';
    $('m2').textContent = '—';
    $('m4').textContent = '0';
    $('m4sub').textContent = 'sin fuentes';
    $('articles').innerHTML = `<div class="empty"><strong>No pude traer resultados</strong>${esc(error.error || 'Error de fuentes')}</div>`;
    $('diag').innerHTML = (error.error ? esc(error.error) + '<br>' : '') + diagnostics(error.diagnostics);
    setStatus('No hubo ninguna fuente disponible.', 'err');
  } finally {
    $('go').disabled = false;
  }
}

$('go').onclick = search;
$('q').addEventListener('keydown', event => {
  if (event.key === 'Enter') search();
});
$('q').addEventListener('input', updateTrends);
$('scope').addEventListener('change', updateTrends);
updateTrends();
