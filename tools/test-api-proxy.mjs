import { createServer } from 'node:http';

const port = Number(process.env.TEST_PROXY_PORT ?? 3003);
const upstream = process.env.TEST_PROXY_UPSTREAM ?? 'http://127.0.0.1:3004';
createServer(async (request, response) => {
  try {
    if (process.env.TEST_PROXY_REJECT_SALES === '1' && request.method === 'POST' && /^\/stores\/[^/]+\/sales(?:\/sync)?$/.test(request.url.split('?')[0])) {
      response.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      response.end(JSON.stringify({ message: 'Тестовый отказ: проверьте продажу' }));
      return;
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(await Array.fromAsync(request));
    const target = await fetch(`${upstream}${request.url}`, { method: request.method, headers: { ...request.headers, host: new URL(upstream).host }, body });
    response.writeHead(target.status, Object.fromEntries(target.headers));
    response.end(Buffer.from(await target.arrayBuffer()));
  } catch { response.writeHead(502); response.end('Test proxy unavailable'); }
}).listen(port, '127.0.0.1', () => console.log(`Test proxy: http://127.0.0.1:${port} -> ${upstream}`));
