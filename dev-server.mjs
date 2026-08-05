import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import contactHandler from './api/contact.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.GGD_DEV_PORT || '4178', 10);
const MAX_BODY_BYTES = 16_000;

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2']
]);

function sendText(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(message);
}

async function readRequestBody(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      sendText(res, 413, 'Request body too large');
      return null;
    }
  }
  return body;
}

function resolveStaticPath(urlPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPathname);
  } catch (_error) {
    return null;
  }

  const requested = pathname === '/' ? '/index.html' : pathname;
  const segments = requested.split('/').filter(Boolean);
  if (segments.some(segment => segment.startsWith('.'))) return null;

  const filePath = path.resolve(ROOT, `.${requested}`);
  return filePath.startsWith(`${ROOT}${path.sep}`) ? filePath : null;
}

async function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return sendText(res, 405, 'Method not allowed');
  }

  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) return sendText(res, 404, 'Not found');

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return sendText(res, 404, 'Not found');
    const body = req.method === 'HEAD' ? null : await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream');
    res.setHeader('Content-Length', fileStat.size);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  } catch (error) {
    if (error?.code === 'ENOENT') return sendText(res, 404, 'Not found');
    console.error('Static file error:', error?.message || 'unknown error');
    return sendText(res, 500, 'Internal server error');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (url.pathname === '/api/contact') {
    const rawBody = await readRequestBody(req, res);
    if (rawBody === null) return;
    req.body = rawBody;
    return contactHandler(req, res);
  }

  return serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  const emailStatus = process.env.RESEND_API_KEY ? 'email enabled' : 'email disabled: RESEND_API_KEY is not set';
  console.log(`Germany Growth Desk dev server: http://${HOST}:${PORT} (${emailStatus})`);
});

