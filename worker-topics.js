import electricityWorker from './worker-v11.js';
import { captureTopic, captureAllTopics } from './sources/caba-topic-capture.js';
import { TOPICS, CAPTURE_WINDOWS } from './data/caba-topics.js';
const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const topic = url.pathname.replace(/^\/api\//, '');
    if (!Object.hasOwn(TOPICS, topic) && url.pathname !== '/api/temas') return electricityWorker.fetch(request, env);
    if (request.method !== 'GET') return json({ ok: false, error: 'Método no permitido' }, 405);
    const span = url.searchParams.get('span') || '1w';
    if (!Object.hasOwn(CAPTURE_WINDOWS, span)) return json({ ok: false, error: 'Ventana no soportada; usar 6h, 1d, 3d o 1w' }, 400);
    const payload = url.pathname === '/api/temas' ? await captureAllTopics({ span }) : await captureTopic(topic, { span });
    return json(payload, payload.captureUsable ? 200 : 503);
  }
};
