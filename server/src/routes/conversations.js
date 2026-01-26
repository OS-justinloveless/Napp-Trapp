import { Router } from 'express';
import { spawn, execSync } from 'child_process';
import { CursorChatReader } from '../utils/CursorChatReader.js';
import { CursorWorkspace } from '../utils/CursorWorkspace.js';

const router = Router();
const chatReader = new CursorChatReader();
const workspaceManager = new CursorWorkspace();

// Get list of all chats (both chat logs and composer logs)
router.get('/', async (req, res) => {
  try {
    const { type, search } = req.query;
    
    let chats;
    
    if (search) {
      chats = await chatReader.searchChats(search);
    } else {
      chats = await chatReader.getAllChats();
    }
    
    // Filter by type if specified
    if (type && (type === 'chat' || type === 'composer')) {
      chats = chats.filter(chat => chat.type === type);
    }
    
    res.json({ 
      conversations: chats,
      total: chats.length
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get workspaces with chat counts
router.get('/workspaces', async (req, res) => {
  try {
    const workspaces = await chatReader.getWorkspacesWithCounts();
    res.json({ workspaces });
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    res.status(500).json({ error: 'Failed to fetch workspaces' });
  }
});

// Get chats for a specific workspace
router.get('/workspace/:workspaceId', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const allChats = await chatReader.getAllChats();
    
    const workspaceChats = allChats.filter(chat => chat.workspaceId === workspaceId);
    
    res.json({ 
      conversations: workspaceChats,
      total: workspaceChats.length
    });
  } catch (error) {
    console.error('Error fetching workspace conversations:', error);
    res.status(500).json({ error: 'Failed to fetch workspace conversations' });
  }
});

// Get specific conversation details
router.get('/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    // Find the chat in all chats
    const allChats = await chatReader.getAllChats();
    const chat = allChats.find(c => c.id === conversationId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    res.json({ conversation: chat });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation details' });
  }
});

// Get conversation messages
router.get('/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { type = 'chat', workspaceId = 'global' } = req.query;
    
    const messages = await chatReader.getChatMessages(conversationId, type, workspaceId);
    
    res.json({ 
      messages,
      total: messages.length
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Search across all chats
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    
    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    
    const results = await chatReader.searchChats(query);
    
    res.json({ 
      results,
      total: results.length,
      query
    });
  } catch (error) {
    console.error('Error searching conversations:', error);
    res.status(500).json({ error: 'Failed to search conversations' });
  }
});

// Create a new conversation
router.post('/', async (req, res) => {
  try {
    const { workspaceId } = req.body;
    
    // Get workspace path
    let workspacePath = null;
    if (workspaceId && workspaceId !== 'global') {
      const project = await workspaceManager.getProjectDetails(workspaceId);
      if (project) {
        workspacePath = project.path;
      }
    }
    
    // Create a new chat using cursor-agent
    const args = ['create-chat'];
    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }
    
    const result = await new Promise((resolve, reject) => {
      const process = spawn('cursor-agent', args);
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`cursor-agent failed: ${errorOutput}`));
        } else {
          resolve(output.trim());
        }
      });
      
      process.on('error', (err) => {
        reject(err);
      });
    });
    
    const chatId = result;
    
    res.json({ 
      chatId,
      success: true
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ 
      error: 'Failed to create conversation',
      details: error.message
    });
  }
});

// Send a message to a conversation
router.post('/:conversationId/messages', async (req, res) => {
  const startTime = Date.now();
  console.log('\n=== NEW MESSAGE REQUEST ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Conversation ID:', req.params.conversationId);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { conversationId } = req.params;
    const { message, workspaceId } = req.body;
    
    if (!message || message.trim() === '') {
      console.error('ERROR: Empty message');
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    
    // Get workspace path
    let workspacePath = null;
    if (workspaceId && workspaceId !== 'global') {
      console.log('Looking up workspace:', workspaceId);
      const project = await workspaceManager.getProjectDetails(workspaceId);
      if (project) {
        workspacePath = project.path;
        console.log('Workspace path:', workspacePath);
      } else {
        console.log('WARNING: Workspace not found:', workspaceId);
      }
    }
    
    // Set up SSE for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    console.log('SSE headers set');
    
    // Build cursor-agent command
    const args = [
      '--resume', conversationId,
      '-p',
      '--output-format', 'stream-json',
      message
    ];
    
    if (workspacePath) {
      args.splice(2, 0, '--workspace', workspacePath);
    }
    
    console.log('Spawning cursor-agent with args:', JSON.stringify(args));
    console.log('Full command:', `cursor-agent ${args.join(' ')}`);
    
    // Check if cursor-agent exists
    try {
      execSync('which cursor-agent', { stdio: 'pipe' });
      console.log('cursor-agent found in PATH');
    } catch (e) {
      console.error('ERROR: cursor-agent not found in PATH');
      return res.status(500).json({ 
        error: 'cursor-agent CLI not found',
        details: 'Please install cursor-agent: curl https://cursor.com/install -fsS | bash',
        code: 'CURSOR_AGENT_NOT_FOUND'
      });
    }
    
    // Spawn cursor-agent process
    const agent = spawn('cursor-agent', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let hasData = false;
    let errorOutput = '';
    
    console.log('Process spawned with PID:', agent.pid);
    
    // Send initial connection message
    res.write('data: {"type":"connected"}\n\n');
    console.log('Sent connected event');
    
    // Stream stdout data to client
    agent.stdout.on('data', (data) => {
      hasData = true;
      const dataStr = data.toString();
      console.log('stdout chunk:', dataStr.substring(0, 200));
      const lines = dataStr.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          // Try to parse as JSON to validate
          JSON.parse(line);
          res.write(`data: ${line}\n\n`);
        } catch (e) {
          // If not JSON, send as text message
          console.log('Non-JSON output:', line);
          res.write(`data: ${JSON.stringify({ type: 'text', content: line })}\n\n`);
        }
      }
    });
    
    // Log errors but continue
    agent.stderr.on('data', (data) => {
      const errorText = data.toString();
      errorOutput += errorText;
      console.error('cursor-agent stderr:', errorText);
      // Send error as event
      res.write(`data: ${JSON.stringify({ type: 'stderr', content: errorText })}\n\n`);
    });
    
    // Handle completion
    agent.on('close', (code) => {
      const duration = Date.now() - startTime;
      console.log('cursor-agent closed');
      console.log('Exit code:', code);
      console.log('Duration:', duration + 'ms');
      console.log('Had data:', hasData);
      
      if (code === 0) {
        console.log('SUCCESS: Message sent');
        res.write(`data: ${JSON.stringify({ type: 'complete', success: true })}\n\n`);
      } else {
        console.error('FAILED: Non-zero exit code');
        console.error('Full stderr output:', errorOutput);
        res.write(`data: ${JSON.stringify({ 
          type: 'complete', 
          success: false, 
          code,
          stderr: errorOutput 
        })}\n\n`);
      }
      
      res.end();
      console.log('=== REQUEST COMPLETE ===\n');
    });
    
    // Handle errors
    agent.on('error', (err) => {
      console.error('cursor-agent spawn error:', err);
      console.error('Error code:', err.code);
      console.error('Error message:', err.message);
      
      const errorMsg = err.code === 'ENOENT' 
        ? 'cursor-agent command not found. Please install: curl https://cursor.com/install -fsS | bash'
        : err.message;
      
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        content: errorMsg,
        code: err.code 
      })}\n\n`);
      res.end();
      console.log('=== REQUEST FAILED (spawn error) ===\n');
    });
    
    // Clean up on client disconnect
    req.on('close', () => {
      console.log('Client disconnected, killing process');
      if (!agent.killed) {
        agent.kill();
      }
    });
    
  } catch (error) {
    console.error('ERROR in message handler:', error);
    console.error('Stack trace:', error.stack);
    
    // If headers not sent, send error response
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to send message',
        details: error.message,
        stack: error.stack
      });
    } else {
      // If streaming started, send error event
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        content: error.message,
        stack: error.stack 
      })}\n\n`);
      res.end();
    }
    console.log('=== REQUEST FAILED (exception) ===\n');
  }
});

export { router as conversationRoutes };
