#!/usr/bin/env node

/**
 * Napp Trapp CLI
 * 
 * Usage:
 *   npx napptrapp [options]
 *   napptrapp [options]
 * 
 * Options:
 *   --port, -p <port>   Port to run the server on (default: 3847)
 *   --token, -t <token> Authentication token (default: auto-generated)
 *   --help, -h          Show this help message
 *   --version, -v       Show version
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Parse command line arguments
const args = process.argv.slice(2);

function showHelp() {
  console.log(`
Napp Trapp v${packageJson.version}

Standalone mobile IDE - manage projects, edit files, and run AI coding tools from your phone.

Usage:
  npx napptrapp [options]
  napptrapp [options]

Options:
  --port, -p <port>     Port to run the server on (default: 3847)
  --token, -t <token>   Authentication token (default: auto-generated & persisted)
  --data-dir <path>     Directory for data storage (default: ~/.napptrapp)
  --help, -h            Show this help message
  --version, -v         Show version

Examples:
  npx napptrapp                    # Start with defaults
  npx napptrapp --port 8080        # Start on port 8080
  npx napptrapp -p 8080 -t mytoken # Custom port and token

Once started, scan the QR code with your phone to connect!
`);
}

function showVersion() {
  console.log(`napptrapp v${packageJson.version}`);
}

// Parse arguments
let port = null;
let token = null;
let dataDir = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--help' || arg === '-h') {
    showHelp();
    process.exit(0);
  }
  
  if (arg === '--version' || arg === '-v') {
    showVersion();
    process.exit(0);
  }
  
  if (arg === '--port' || arg === '-p') {
    port = args[++i];
    if (!port || isNaN(parseInt(port))) {
      console.error('Error: --port requires a valid port number');
      process.exit(1);
    }
  }
  
  if (arg === '--token' || arg === '-t') {
    token = args[++i];
    if (!token) {
      console.error('Error: --token requires a value');
      process.exit(1);
    }
  }
  
  if (arg === '--data-dir') {
    dataDir = args[++i];
    if (!dataDir) {
      console.error('Error: --data-dir requires a path');
      process.exit(1);
    }
  }
}

// Set environment variables for the server
if (port) {
  process.env.PORT = port;
}
if (token) {
  process.env.AUTH_TOKEN = token;
}
if (dataDir) {
  process.env.NAPPTRAPP_DATA_DIR = dataDir;
}

// Mark that we're running from CLI (for path resolution)
process.env.NAPPTRAPP_CLI = 'true';

// Import and run the server
const serverPath = path.join(__dirname, '../src/index.js');

// Use dynamic import to load the server
import(serverPath).catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
