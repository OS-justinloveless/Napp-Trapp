import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const router = Router();

// Get Cursor storage path based on OS
function getCursorStoragePath() {
  const homeDir = os.homedir();
  
  switch (process.platform) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');
    case 'win32':
      return path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'workspaceStorage');
    case 'linux':
      return path.join(homeDir, '.config', 'Cursor', 'User', 'workspaceStorage');
    default:
      return path.join(homeDir, '.cursor', 'workspaceStorage');
  }
}

// Get Cursor global storage path
function getCursorGlobalStoragePath() {
  const homeDir = os.homedir();
  
  switch (process.platform) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage');
    case 'win32':
      return path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage');
    case 'linux':
      return path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage');
    default:
      return path.join(homeDir, '.cursor', 'globalStorage');
  }
}

// Get list of conversations
router.get('/', async (req, res) => {
  try {
    const storagePath = getCursorStoragePath();
    const globalPath = getCursorGlobalStoragePath();
    const conversations = [];
    
    // Try to find conversation data in workspace storage
    try {
      const workspaces = await fs.readdir(storagePath);
      
      for (const workspace of workspaces) {
        const workspacePath = path.join(storagePath, workspace);
        const stats = await fs.stat(workspacePath);
        
        if (stats.isDirectory()) {
          // Look for state.vscdb or similar conversation storage
          const stateDbPath = path.join(workspacePath, 'state.vscdb');
          
          try {
            await fs.access(stateDbPath);
            
            // Parse workspace.json to get project name
            let projectName = workspace;
            try {
              const workspaceJsonPath = path.join(workspacePath, 'workspace.json');
              const workspaceJson = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'));
              projectName = workspaceJson.folder || workspace;
            } catch (e) {
              // Use folder hash as name
            }
            
            conversations.push({
              id: workspace,
              projectName,
              path: workspacePath,
              lastModified: stats.mtime.toISOString()
            });
          } catch (e) {
            // No state db in this workspace
          }
        }
      }
    } catch (e) {
      console.log('Could not read workspace storage:', e.message);
    }
    
    // Sort by last modified
    conversations.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    res.json({ conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get specific conversation details
router.get('/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const storagePath = getCursorStoragePath();
    const conversationPath = path.join(storagePath, conversationId);
    
    // Check if conversation exists
    try {
      await fs.access(conversationPath);
    } catch (e) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Get conversation metadata
    const stats = await fs.stat(conversationPath);
    
    // Try to read workspace info
    let workspaceInfo = null;
    try {
      const workspaceJsonPath = path.join(conversationPath, 'workspace.json');
      workspaceInfo = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'));
    } catch (e) {
      // No workspace info
    }
    
    res.json({
      conversation: {
        id: conversationId,
        path: conversationPath,
        lastModified: stats.mtime.toISOString(),
        workspace: workspaceInfo
      }
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation details' });
  }
});

// Get conversation messages (reads from Cursor's internal storage)
router.get('/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const storagePath = getCursorStoragePath();
    const conversationPath = path.join(storagePath, conversationId);
    
    // Look for message storage files
    const possiblePaths = [
      path.join(conversationPath, 'state.vscdb'),
      path.join(conversationPath, 'chat.json'),
      path.join(conversationPath, 'aichat.json')
    ];
    
    let messages = [];
    
    // Try to find and parse messages from available storage
    for (const msgPath of possiblePaths) {
      try {
        await fs.access(msgPath);
        
        if (msgPath.endsWith('.json')) {
          const content = await fs.readFile(msgPath, 'utf-8');
          const data = JSON.parse(content);
          messages = data.messages || data;
          break;
        }
      } catch (e) {
        // Try next path
      }
    }
    
    res.json({ messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

export { router as conversationRoutes };
