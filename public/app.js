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
  return '/api/stories?' + params.toString();
}

function updateTrends() {
  const params = new URLSearchParams({
    q: baseTerm(),
    geo: $('scope').value === 'argentina' ? 'AR' : ''
  });
  $('trends').href = 'https://trends.google.com/trends/explore?' + params.toString();
}

async function fetchNews() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(newsUrl(), { headers: { Accept: 'application/json' }, signal: controller.signal });
    const data = await response.json().catch(() => ({ error: 'Respuesta inválida del backend' }));
    if (!response.ok || data.ok !== true) throw data;
    return data;
  } finally { clearTimeout(timer); }
}

function renderMedia(articles) {
  const counts = Object.create(null);
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

function safeLink(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
function articleHtml(article) {
  const url = safeLink(article.url);
  return `<div class="article"><h4>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(article.title)}</a>` : esc(article.title)}</h4><div class="meta"><span class="media">${esc(articleSource(article))}</span><span>${esc(fmtDate(article.date))}</span>${article.locationMatched === false ? '<span>Ubicación en CABA sin confirmar</span>' : ''}</div></div>`;
}
function render(data) {
  const articles = data.articles || [];
  const stories = data.stories || [];
  $('m1').textContent = stories.length;
  $('m2').textContent = new Set(articles.map(articleSource)).size;
  $('m3').textContent = articles.length;
  $('m4').textContent = data.activeProviderCount;
  $('m4sub').textContent = data.coverage === 'partial' ? 'cobertura parcial' : 'consultadas';
  $('label').textContent = `${stories.length} historias · ${articles.length} notas`;
  $('articles').innerHTML = stories.length ? stories.map(story => `
    <details class="story">
      <summary><h4>${esc(story.title)}</h4><div class="meta"><span class="media">${story.sourceCount} medios</span><span>${story.articleCount} notas</span>${story.articles.some(a => a.locationMatched === false) ? '<span>Ubicación por verificar</span>' : ''}<span>${esc(fmtDate(story.latestPublishedAt))}</span></div><span class="story-action">Ver notas y fuentes</span></summary>
      ${story.articles.map(articleHtml).join('')}
    </details>`).join('') : '<div class="empty"><strong>No encontramos notas que coincidan</strong>Probá ampliar el período o usar otro término. Esto no significa que el tema no tenga cobertura.</div>';
  renderMedia(articles);
}

function sourceLine(name, source = {}) {
  if (source.ok) {
    return `<div><b style="color:#baff64">● ${esc(name)}</b> · ${source.count || 0} notas recibidas</div>`;
  }
  const error = source.error === 'timeout' ? ' · demoró demasiado' : '';
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
  if (term.length < 2) {
    $('q').focus();
    setStatus('Escribí al menos dos caracteres.', '');
    return;
  }

  updateTrends();
  setStatus('Buscando noticias…', 'load');
  if ($('go').disabled) return;
  $('go').disabled = true;
  for (const id of ['q', 'scope', 'span']) $(id).disabled = true;
  $('articles').setAttribute('aria-busy', 'true');
  $('label').textContent = 'Cargando…';
  $('diag').textContent = 'Consultando fuentes abiertas desde StonedOwl.';

  try {
    const data = await fetchNews();
    const articles = data.articles || [];
    render(data);
    $('diag').innerHTML = diagnostics(data.diagnostics);

    if (articles.length) {
      const excluded = data.excludedCount ? ` Se omitieron ${data.excludedCount} notas que no coincidían con el tema.` : '';
      setStatus(`Actualizado ${fmtDate(data.fetchedAt)}.${data.coverage === 'partial' ? ' Algunas fuentes no respondieron.' : ''}${excluded}`, 'ok');
    } else {
      setStatus('Las fuentes respondieron, pero no hubo resultados.', '');
    }
  } catch (error) {
    $('label').textContent = 'Consulta sin completar';
    $('m3').textContent = '—';
    $('media').innerHTML = '<div class="empty">No hay una muestra actual para contar medios.</div>';
    $('m1').textContent = '—';
    $('m2').textContent = '—';
    $('m4').textContent = error.coverage === 'unavailable' ? '0' : '—';
    $('m4sub').textContent = error.coverage === 'unavailable' ? 'sin fuentes' : 'sin verificar';
    $('articles').innerHTML = `<div class="empty"><strong>No pude traer resultados</strong>${esc(error.error || (error.name === 'AbortError' ? 'La consulta demoró demasiado. Volvé a intentar.' : 'No se pudo conectar. Volvé a intentar.'))}</div>`;
    $('diag').innerHTML = (error.error ? esc(error.error) + '<br>' : '') + diagnostics(error.diagnostics);
    setStatus('No se pudo completar la consulta. Podés reintentar.', 'err');
  } finally {
    $('go').disabled = false;
    for (const id of ['q', 'scope', 'span']) $(id).disabled = false;
    $('articles').setAttribute('aria-busy', 'false');
  }
}

$('go').onclick = search;
$('q').addEventListener('keydown', event => {
  if (event.key === 'Enter') search();
});
$('q').addEventListener('input', updateTrends);
$('scope').addEventListener('change', updateTrends);
updateTrends();

document.querySelectorAll('[data-query]').forEach(button => { button.onclick = () => { if ($('go').disabled) return; $('q').value = button.dataset.query; search(); }; });
