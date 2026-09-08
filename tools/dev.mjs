/**
 * Starts every Nebula service at once and prefixes their output, so one terminal shows the
 * server, the web player and the backoffice together.
 *
 *   node tools/dev.mjs            # server + web + admin
 *   node tools/dev.mjs --mobile   # also starts the Expo dev server
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const withMobile = process.argv.includes('--mobile');

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const COLORS = { server: '\x1b[95m', web: '\x1b[96m', admin: '\x1b[93m', mobile: '\x1b[92m' };
const RESET = '\x1b[0m';

const services = [
  { name: 'server', cmd: 'pnpm', args: ['--filter', '@nebula/server', 'dev'] },
  { name: 'web', cmd: 'pnpm', args: ['--filter', '@nebula/web', 'dev'] },
  { name: 'admin', cmd: 'pnpm', args: ['--filter', '@nebula/admin', 'dev'] },
];
if (withMobile) {
  services.push({ name: 'mobile', cmd: 'pnpm', args: ['--filter', '@nebula/mobile', 'start'] });
}

const children = [];

for (const service of services) {
  const child = spawn(service.cmd, service.args, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);

  const prefix = `${COLORS[service.name] ?? ''}[${service.name}]${RESET}`;
  const pipe = (stream) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) console.log(`${prefix} ${line}`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on('exit', (code) => {
    console.log(`${prefix} saiu com código ${code}`);
  });
}

const ip = lanAddress();
setTimeout(() => {
  console.log(`
  Nebula rodando

  Web player   http://${ip}:5173
  Backoffice   http://${ip}:5174
  API          http://${ip}:4000
${withMobile ? `  Expo         escaneie o QR acima com o Expo Go\n` : ''}
  Abra o web player em dois navegadores (ou celular + desktop) para ver o
  controle remoto entre plataformas funcionando.
`);
}, 2500);

const shutdown = () => {
  for (const child of children) child.kill('SIGINT');
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
