import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const testDbRelativePath = 'file:./prisma/test.db';
const testDbPath = path.resolve(projectRoot, 'prisma/test.db');
const cleanupTargets = [
  testDbPath,
  `${testDbPath}-shm`,
  `${testDbPath}-wal`,
  `${testDbPath}-journal`,
];

for (const target of cleanupTargets) {
  try {
    fs.rmSync(target, { force: true });
  } catch {
  }
}

fs.mkdirSync(path.dirname(testDbPath), { recursive: true });

const mode = process.argv[2] === 'run' ? 'run' : 'watch';
const vitestArgs = mode === 'run' ? ['run'] : [];
const forwardedArgs = process.argv.slice(mode === 'run' ? 3 : 2);

const env = {
  ...process.env,
  DATABASE_URL: testDbRelativePath,
  NODE_ENV: 'test',
};

const prismaBin = path.resolve(projectRoot, 'node_modules/prisma/build/index.js');
const schemaPath = path.resolve(projectRoot, 'prisma/schema.prisma');

const migrate = spawnSync(process.execPath, [prismaBin, 'migrate', 'deploy', '--schema', schemaPath], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
  shell: false,
});

if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1);
}

const vitestBin = path.resolve(projectRoot, 'node_modules/vitest/vitest.mjs');

const child = spawn(process.execPath, [vitestBin, ...vitestArgs, ...forwardedArgs], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
