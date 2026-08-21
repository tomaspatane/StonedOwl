import worker from '../worker-v10.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      url.pathname = '/v10.html';
      return env.ASSETS.fetch(new Request(url.toString(), { headers: request.headers }));
    }
    return worker.fetch(request, env, ctx);
  },
  scheduled: worker.scheduled
};
