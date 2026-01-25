import { projectRoutes } from './projects.js';
import { fileRoutes } from './files.js';
import { conversationRoutes } from './conversations.js';
import { systemRoutes } from './system.js';

export function setupRoutes(app) {
  app.use('/api/projects', projectRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/system', systemRoutes);
  
  // Health check (no auth required)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  // Auth endpoint (no auth middleware)
  app.post('/auth', (req, res) => {
    const { token } = req.body;
    // Simple validation - in production you'd want more security
    if (token === process.env.AUTH_TOKEN || token) {
      res.json({ success: true, message: 'Authenticated' });
    } else {
      res.status(401).json({ success: false, message: 'Invalid token' });
    }
  });
}
