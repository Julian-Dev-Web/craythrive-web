import { build } from 'vite';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// A separate production bundle, with deliberately fake public configuration.
// The browser fixture intercepts every external request. The real dist is untouched.
process.env.VITE_SUPABASE_URL = 'https://qa.supabase.invalid';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_fixture_not_a_real_key';
process.env.VITE_SUPABASE_ANON_KEY = '';
process.env.VITE_APP_SITE_URL = 'http://127.0.0.1:4175';
const outDir = path.resolve('.security-qa-dist');
await build({ build: { outDir, emptyOutDir: true } });
const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  if (request.url === '/__qa_shutdown' && request.method === 'POST') {
    response.writeHead(200).end('done');
    server.close(() => process.exit(0));
    server.closeAllConnections();
    return;
  }
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const candidate = path.resolve(outDir, '.' + pathname);
  if (!candidate.startsWith(outDir + path.sep) && candidate !== outDir) {
    response.writeHead(400).end(); return;
  }
  const file = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(outDir, 'index.html');
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  response.writeHead(200, { ...headers, 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
}).listen(4175, '127.0.0.1', () => console.log('QA production fixture ready on port 4175'));
