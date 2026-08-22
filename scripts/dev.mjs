import { spawn } from 'node:child_process';
import { join } from 'node:path';

const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

const commands = [
  ['api', 'node', ['server/index.js']],
  ['web', 'node', [viteBin, '--host', '127.0.0.1']],
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' },
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
      for (const other of children) {
        if (other !== child && !other.killed) other.kill();
      }
    }
  });
  return child;
});

const shutdown = () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
