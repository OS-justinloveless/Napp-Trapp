import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { config } from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

import { setupRoutes } from './routes/index.js';
import { setupWebSocket } from './websocket/index.js';
import { AuthManager } from './auth/AuthManager.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.PORT || 3847;
const AUTH_TOKEN = process.env.AUTH_TOKEN || uuidv4();

// Initialize auth manager
const authManager = new AuthManager(AUTH_TOKEN);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Auth middleware for API routes
app.use('/api', (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!authManager.validateToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Setup routes
setupRoutes(app);

// Setup WebSocket
setupWebSocket(wss, authManager);

// Serve client app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           Cursor Mobile Access Server                          ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║ Server running on port ${PORT}                                   ║`);
  console.log('║                                                                 ║');
  console.log('║ Access from your phone:                                         ║');
  console.log(`║   http://<your-laptop-ip>:${PORT}                                 ║`);
  console.log('║                                                                 ║');
  console.log(`║ Auth Token: ${AUTH_TOKEN.substring(0, 8)}...                                      ║`);
  console.log('║                                                                 ║');
  console.log('║ Save your full token to connect:                                ║');
  console.log(`║ ${AUTH_TOKEN}                          ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
