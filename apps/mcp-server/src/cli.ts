#!/usr/bin/env node
import { access } from 'node:fs/promises';

import { probeBridgePort } from './config/doctor.js';
import { defaultConfigPath } from './config/paths.js';
import { createConfig, loadConfig } from './config/store.js';

async function setup(): Promise<void> {
  const path = defaultConfigPath();
  const config = await createConfig(path);
  console.log(`Created ${path}`);
  console.log('Paste this pairing secret into the Figma plugin:');
  console.log(config.secret);
}

async function doctor(): Promise<void> {
  const path = defaultConfigPath();
  await access(path);
  const config = await loadConfig(path);
  const port = await probeBridgePort(config);
  console.log(JSON.stringify({ configPath: path, host: config.host, port: config.port, portState: port }, null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'setup') await setup();
  else if (command === 'doctor') await doctor();
  else if (command === 'serve') throw new Error('The serve command is not wired yet.');
  else {
    console.error('Usage: figma-agent-mcp <setup|doctor|serve>');
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

