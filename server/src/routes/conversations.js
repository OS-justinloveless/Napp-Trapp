import { Router } from 'express';
import { spawn, execSync } from 'child_process';
import crypto from 'crypto';
import { CursorChatReader } from '../utils/CursorChatReader.js';
import { CursorWorkspace } from '../utils/CursorWorkspace.js';
import { MobileChatStore } from '../utils/MobileChatStore.js';

const router = Router();
const chatReader = new CursorChatReader();
const workspaceManager = new CursorWorkspace();
const mobileChatStore = MobileChatStore.getInstance();

/**
 * Determine if a conversation is read-only from mobile's perspective.
 * 
 * Read-only conversations:
 * - Created in Cursor IDE (source: 'global', 'workspace', 'workspace-kv')
 * - Cannot have messages added from mobile (would be overwritten by Cursor)
 * 
 * Editable conversations:
 * - Created from mobile (source: 'mobile')
 * - Managed by cursor-agent, not Cursor IDE
 */
function isConversationReadOnly(chat) {
  // Mobile-created conversations are editable
  if (chat.source === 'mobile') {
    return false;
  }
  // Has mobile messages but was originally from Cursor - still read-only
  // because Cursor will overwrite any changes
  if (chat.hasMobileMessages && chat.source !== 'mobile') {
    return true;
  }
  // All other sources (global, workspace, workspace-kv) are read-only
  return true;
}

/**
 * Add read-only flag and metadata to conversations for mobile clients
 */
function enrichConversationForMobile(chat) {
  const isReadOnly = isConversationReadOnly(chat);
  return {
    ...chat,
    isReadOnly,
    // Provide a user-friendly reason
    readOnlyReason: isReadOnly 
      ? 'This conversation was created in Cursor IDE. You can view it but cannot add messages. Use "Fork" to create an editable copy.'
      : null,
    // Can this conversation be forked?
    canFork: isReadOnly && chat.messageCount > 0
  };
}

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
    
    // Enrich with mobile-specific metadata
    chats = chats.map(enrichConversationForMobile);
    
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
    
    res.json({ conversation: enrichConversationForMobile(chat) });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation details' });
  }
});

// Fork a Cursor IDE conversation to create an editable mobile copy
router.post('/:conversationId/fork', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { workspaceId } = req.body;
    
    console.log(`Forking conversation ${conversationId}`);
    
    // Get the original conversation
    const allChats = await chatReader.getAllChats();
    const originalChat = allChats.find(c => c.id === conversationId);
    
    if (!originalChat) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Get messages from the original conversation
    const messages = await chatReader.getChatMessages(
      conversationId, 
      originalChat.type, 
      originalChat.workspaceId
    );
    
    if (messages.length === 0) {
      return res.status(400).json({ error: 'Cannot fork empty conversation' });
    }
    
    // Generate new conversation ID
    const newConversationId = crypto.randomUUID();
    
    // Get workspace details
    let workspacePath = null;
    let projectName = originalChat.projectName;
    let workspaceFolder = originalChat.workspaceFolder;
    
    const targetWorkspaceId = workspaceId || originalChat.workspaceId;
    if (targetWorkspaceId && targetWorkspaceId !== 'global') {
      const project = await workspaceManager.getProjectDetails(targetWorkspaceId);
      if (project) {
        workspacePath = project.path;
        projectName = project.name;
        workspaceFolder = `file://${project.path}`;
      }
    }
    
    // Create the forked conversation in mobile store
    await mobileChatStore.upsertConversation(newConversationId, {
      title: `${originalChat.title} (Fork)`,
      type: 'chat',
      workspaceId: targetWorkspaceId || 'global',
      workspaceFolder,
      projectName,
      forkedFrom: conversationId
    });
    
    // Copy all messages to the new conversation
    for (const msg of messages) {
      await mobileChatStore.addMessage(newConversationId, {
        id: `${msg.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: msg.type,
        text: msg.text,
        timestamp: msg.timestamp || Date.now(),
        toolCalls: msg.toolCalls || null
      });
    }
    
    console.log(`Forked ${messages.length} messages to new conversation ${newConversationId}`);
    
    // Get the new conversation with enriched metadata
    const newChat = await mobileChatStore.getConversation(newConversationId);
    
    // Build a properly formatted conversation object for iOS
    // The mobile store uses createdAt/updatedAt but iOS expects timestamp
    const formattedConversation = {
      id: newConversationId,
      type: newChat.type || 'chat',
      title: newChat.title || `${originalChat.title} (Fork)`,
      timestamp: newChat.updatedAt || newChat.createdAt || Date.now(),
      messageCount: messages.length,
      workspaceId: newChat.workspaceId || targetWorkspaceId || 'global',
      source: 'mobile',
      projectName: newChat.projectName || projectName,
      workspaceFolder: newChat.workspaceFolder || workspaceFolder,
      isProjectChat: !!(newChat.workspaceId && newChat.workspaceId !== 'global'),
      // Mobile-created conversations are always editable
      isReadOnly: false,
      readOnlyReason: null,
      canFork: false
    };
    
    res.json({
      success: true,
      originalConversationId: conversationId,
      newConversationId,
      conversation: formattedConversation,
      messagesCopied: messages.length
    });
  } catch (error) {
    console.error('Error forking conversation:', error);
    res.status(500).json({ 
      error: 'Failed to fork conversation',
      details: error.message 
    });
  }
});

// Get conversation messages with optional pagination
router.get('/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { type = 'chat', workspaceId = 'global', limit, offset } = req.query;
    
    let messages = await chatReader.getChatMessages(conversationId, type, workspaceId);
    const total = messages.length;
    
    // Apply pagination if requested
    // If limit is specified, return the last N messages (from the end of the conversation)
    if (limit) {
      const limitNum = parseInt(limit, 10);
      const offsetNum = offset ? parseInt(offset, 10) : 0;
      
      if (!isNaN(limitNum) && limitNum > 0) {
        // Calculate the starting index from the end
        // offset 0 with limit 20 means: last 20 messages
        // offset 20 with limit 20 means: messages 20-40 from the end
        const startFromEnd = offsetNum;
        const endFromEnd = offsetNum + limitNum;
        
        // Convert to actual indices (from the start)
        const startIndex = Math.max(0, total - endFromEnd);
        const endIndex = Math.max(0, total - startFromEnd);
        
        messages = messages.slice(startIndex, endIndex);
      }
    }
    
    res.json({ 
      messages,
      total,
      hasMore: offset ? (parseInt(offset, 10) + messages.length < total) : false
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
    
    // Get workspace details
    let workspacePath = null;
    let projectName = null;
    let workspaceFolder = null;
    
    if (workspaceId && workspaceId !== 'global') {
      const project = await workspaceManager.getProjectDetails(workspaceId);
      if (project) {
        workspacePath = project.path;
        projectName = project.name;
        workspaceFolder = `file://${project.path}`;
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
    
    // Save conversation to mobile store for persistence
    await mobileChatStore.upsertConversation(chatId, {
      type: 'chat',
      workspaceId: workspaceId || 'global',
      workspaceFolder,
      projectName
    });
    
    console.log(`Created conversation ${chatId} and saved to mobile store`);
    
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
  console.log('Request body:', JSON.stringify({ ...req.body, attachments: req.body.attachments ? `${req.body.attachments.length} attachments` : 'none' }, null, 2));
  
  try {
    const { conversationId } = req.params;
    const { message, workspaceId, allowReadOnly, attachments } = req.body;
    
    if (!message || message.trim() === '') {
      console.error('ERROR: Empty message');
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    
    // Check if this is a Cursor IDE conversation (read-only)
    // unless allowReadOnly is explicitly set (for advanced use)
    if (!allowReadOnly) {
      const allChats = await chatReader.getAllChats();
      const existingChat = allChats.find(c => c.id === conversationId);
      
      if (existingChat && isConversationReadOnly(existingChat)) {
        console.log('Attempted to send message to read-only conversation');
        return res.status(403).json({
          error: 'This conversation is read-only',
          code: 'CONVERSATION_READ_ONLY',
          message: 'This conversation was created in Cursor IDE and cannot be modified from mobile. The conversation data would be overwritten by Cursor.',
          suggestion: 'Fork this conversation to create an editable copy.',
          forkUrl: `/api/conversations/${conversationId}/fork`,
          conversationId
        });
      }
    }
    
    // Get workspace details
    let workspacePath = null;
    let projectName = null;
    let workspaceFolder = null;
    
    if (workspaceId && workspaceId !== 'global') {
      console.log('Looking up workspace:', workspaceId);
      const project = await workspaceManager.getProjectDetails(workspaceId);
      if (project) {
        workspacePath = project.path;
        projectName = project.name;
        workspaceFolder = `file://${project.path}`;
        console.log('Workspace path:', workspacePath);
      } else {
        console.log('WARNING: Workspace not found:', workspaceId);
      }
    }
    
    // Ensure conversation exists in mobile store
    await mobileChatStore.upsertConversation(conversationId, {
      type: 'chat',
      workspaceId: workspaceId || 'global',
      workspaceFolder,
      projectName
    });
    
    // Save the user message to mobile store immediately
    const userMessageId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userMessageTimestamp = Date.now();
    
    // Process attachments if present
    let processedAttachments = null;
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      processedAttachments = attachments.map(att => ({
        id: att.id || crypto.randomUUID(),
        type: att.type || 'file',
        filename: att.filename || 'attachment',
        mimeType: att.mimeType || 'application/octet-stream',
        size: att.size || 0,
        data: att.data || null,
        url: att.url || null,
        thumbnailData: att.thumbnailData || null
      }));
      console.log(`Processing ${processedAttachments.length} attachment(s)`);
    }
    
    await mobileChatStore.addMessage(conversationId, {
      id: userMessageId,
      type: 'user',
      text: message.trim(),
      timestamp: userMessageTimestamp,
      attachments: processedAttachments
    });
    console.log('User message saved to mobile store:', userMessageId);
    
    // Note: We no longer write to Cursor's database directly because:
    // 1. Cursor IDE overwrites external changes when it closes
    // 2. Mobile-created conversations use cursor-agent which handles its own storage
    // 3. Read-only conversations from Cursor IDE are blocked above
    
    // Set up SSE for streaming - disable all buffering
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // Disable socket buffering for immediate data transmission
    res.socket.setNoDelay(true);
    
    // Flush headers immediately
    res.flushHeaders();
    console.log('SSE headers set and flushed');
    
    // Build cursor-agent command
    // Note: -f (force) flag is required to allow file edits in headless mode
    // Without -f, cursor-agent rejects edit operations when --workspace is set
    const args = [
      '--resume', conversationId,
      '-p',
      '-f',
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
    
    // Accumulate assistant response for mobile store
    let assistantText = '';
    let assistantToolCalls = [];
    
    console.log('Process spawned with PID:', agent.pid);
    
    // Send initial connection message with immediate flush
    res.write('data: {"type":"connected"}\n\n');
    // Force flush the data immediately
    if (res.flush) res.flush();
    console.log('Sent connected event (flushed)');
    
    // Keep-alive interval to prevent connection timeout
    const keepAliveInterval = setInterval(() => {
      if (!res.writableEnded) {
        // Send SSE comment (ignored by parsers but keeps connection alive)
        res.write(': keepalive\n\n');
        if (res.flush) res.flush();
      }
    }, 15000); // Every 15 seconds
    
    // Stream stdout data to client
    agent.stdout.on('data', (data) => {
      hasData = true;
      const dataStr = data.toString();
      console.log('stdout chunk:', dataStr.substring(0, 200));
      const lines = dataStr.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          // Try to parse as JSON to validate
          const parsed = JSON.parse(line);
          
          // Extract text and tool calls for mobile store
          if (parsed.type === 'assistant' && parsed.message?.content) {
            for (const item of parsed.message.content) {
              if (item.type === 'text' && item.text) {
                assistantText += item.text;
              } else if (item.type === 'tool_use') {
                assistantToolCalls.push({
                  id: item.id,
                  name: item.name,
                  input: item.input,
                  status: 'running'
                });
              } else if (item.type === 'tool_result') {
                const toolIndex = assistantToolCalls.findIndex(t => t.id === item.tool_use_id);
                if (toolIndex >= 0) {
                  assistantToolCalls[toolIndex].status = item.is_error ? 'error' : 'complete';
                  assistantToolCalls[toolIndex].result = item.content;
                }
              }
            }
          }
          
          res.write(`data: ${line}\n\n`);
          if (res.flush) res.flush();
        } catch (e) {
          // If not JSON, send as text message
          console.log('Non-JSON output:', line);
          assistantText += line + '\n';
          res.write(`data: ${JSON.stringify({ type: 'text', content: line })}\n\n`);
          if (res.flush) res.flush();
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
    agent.on('close', async (code) => {
      clearInterval(keepAliveInterval);
      const duration = Date.now() - startTime;
      console.log('cursor-agent closed');
      console.log('Exit code:', code);
      console.log('Duration:', duration + 'ms');
      console.log('Had data:', hasData);
      
      if (code === 0) {
        console.log('SUCCESS: Message sent');
        
        // Save assistant response to mobile store
        if (assistantText || assistantToolCalls.length > 0) {
          const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const assistantTimestamp = Date.now();
          
          try {
            // Mark any running tools as complete
            const finalToolCalls = assistantToolCalls.map(tc => ({
              ...tc,
              status: tc.status === 'running' ? 'complete' : tc.status
            }));
            
            // Save to mobile store
            await mobileChatStore.addMessage(conversationId, {
              id: assistantMessageId,
              type: 'assistant',
              text: assistantText,
              timestamp: assistantTimestamp,
              toolCalls: finalToolCalls.length > 0 ? finalToolCalls : null
            });
            console.log('Assistant message saved to mobile store:', assistantMessageId);
          } catch (saveError) {
            console.error('Error saving assistant message to mobile store:', saveError);
          }
        }
        
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
      
      if (res.flush) res.flush();
      res.end();
      console.log('=== REQUEST COMPLETE ===\n');
    });
    
    // Handle errors
    agent.on('error', (err) => {
      clearInterval(keepAliveInterval);
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
      if (res.flush) res.flush();
      res.end();
      console.log('=== REQUEST FAILED (spawn error) ===\n');
    });
    
    // Clean up on client disconnect
    // IMPORTANT: Use res.on('close') not req.on('close')!
    // req.on('close') fires when the incoming POST body is fully received,
    // but res.on('close') fires when the SSE connection to the client actually closes
    res.on('close', () => {
      clearInterval(keepAliveInterval);
      // Only log and kill if the process is still running and response hasn't ended normally
      if (!agent.killed && !res.writableEnded) {
        console.log('Client disconnected, killing process');
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
