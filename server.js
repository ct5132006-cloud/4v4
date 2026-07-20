import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = '0.0.0.0';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function resolveRequestPath(requestUrl) {
  let pathname;

  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(rootDirectory, `.${requestedPath}`);
  const relativePath = path.relative(rootDirectory, filePath);
  const isInsideRoot = relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  const [topLevelEntry] = relativePath.split(path.sep);
  const isPublicFile = relativePath === 'index.html'
    || relativePath === 'styles.css'
    || topLevelEntry === 'src'
    || topLevelEntry === 'assets';

  return isInsideRoot && isPublicFile ? filePath : null;
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    sendText(response, 405, 'Método não permitido');
    return;
  }

  const filePath = resolveRequestPath(request.url ?? '/');
  if (!filePath) {
    sendText(response, 404, 'Arquivo não encontrado');
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      sendText(response, 404, 'Arquivo não encontrado');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
      'Content-Length': fileStats.size,
      'Content-Type': contentTypes.get(extension) ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!response.headersSent) sendText(response, 500, 'Erro interno do servidor');
      else response.destroy();
    });
    stream.pipe(response);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      sendText(response, 404, 'Arquivo não encontrado');
      return;
    }

    console.error(error);
    sendText(response, 500, 'Erro interno do servidor');
  }
});

server.listen(port, host, () => {
  console.log(`K4 Arena disponível em http://${host}:${port}`);
});
