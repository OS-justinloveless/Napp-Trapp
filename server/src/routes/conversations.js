import { Router } from 'express';
import { chatProcessManager } from '../utils/ChatProcessManager.js';
import { ProjectManager } from '../utils/ProjectManager.js';
import { getSupportedTools, checkAllToolsAvailability } from '../utils/CLIAdapter.js';
import { logger } from '../utils/LogManager.js';

const router = Router();
const projectManager = new ProjectManager();

/**
 * Conversations API - AI Chat Sessions
 *
 * Chats are now managed by ChatProcessManager which spawns CLI processes
 * with structured JSON output. This provides:
 * - Clean content blocks (no ANSI codes)
 * - Proper message streaming
 * - Session resume support
 */

// Get list of all chats for a project
router.get('/', async (req, res) => {
  try {
    const { projectPath, projectId } = req.query;

    // Get project path from projectId if not provided directly
    let resolvedProjectPath = projectPath;
    if (!resolvedProjectPath && projectId && projectId !== 'global') {
      const project = await projectManager.getProjectDetails(projectId);
      if (project) {
        resolvedProjectPath = project.path;
      }
    }

    // List chats from ChatProcessManager
    const chats = chatProcessManager.listChats(resolvedProjectPath);

    // Format for API response
    const formattedChats = chats.map(chat => ({
      id: chat.id,
      conversationId: chat.id,
      tool: chat.tool,
      topic: chat.topic,
      model: chat.model,
      mode: chat.mode,
      projectPath: chat.projectPath,
      status: chat.status,
      createdAt: chat.createdAt,
      type: 'chat',
      title: `${chat.tool}: ${chat.topic}`,
      timestamp: chat.createdAt,
    }));

    res.json({
      chats: formattedChats,
      conversations: formattedChats, // Alias for backwards compatibility
      total: formattedChats.length
    });
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Get tool availability status
router.get('/tools/availability', async (req, res) => {
  try {
    const availability = await checkAllToolsAvailability();
    res.json({ tools: availability });
  } catch (error) {
    console.error('Error checking tool availability:', error);
    res.status(500).json({ error: 'Failed to check tool availability' });
  }
});

// Get supported tools list
router.get('/tools', async (req, res) => {
  try {
    const tools = getSupportedTools();
    const availability = await checkAllToolsAvailability();

    res.json({
      tools: tools.map(tool => ({
        id: tool,
        ...availability[tool]
      }))
    });
  } catch (error) {
    console.error('Error getting tools:', error);
    res.status(500).json({ error: 'Failed to get tools' });
  }
});

// Get specific chat info
router.get('/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;

    const chatInfo = chatProcessManager.getChat(conversationId);

    if (!chatInfo) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json({
      chat: {
        id: chatInfo.id,
        conversationId: chatInfo.id,
        tool: chatInfo.tool,
        topic: chatInfo.topic,
        model: chatInfo.model,
        mode: chatInfo.mode,
        projectPath: chatInfo.projectPath,
        status: chatInfo.status,
        createdAt: chatInfo.createdAt,
        pid: chatInfo.pid,
        type: 'chat',
        title: `${chatInfo.tool}: ${chatInfo.topic}`
      }
    });
  } catch (error) {
    console.error('Error fetching chat:', error);
    res.status(500).json({ error: 'Failed to fetch chat details' });
  }
});

// Create a new chat
router.post('/', async (req, res) => {
  try {
    const {
      projectPath,
      projectId,
      tool = 'claude',
      topic,
      model,
      mode = 'agent',
      permissionMode = 'default',
      sessionId,  // For resuming sessions
      initialPrompt,  // Optional initial message to send after CLI starts
    } = req.body;

    logger.info('Chat', 'Creating new chat', {
      projectPath,
      projectId,
      tool,
      topic,
      model,
      mode,
      permissionMode
    });

    // Resolve project path
    let resolvedProjectPath = projectPath;
    let projectName = null;

    if (!resolvedProjectPath && projectId && projectId !== 'global') {
      const project = await projectManager.getProjectDetails(projectId);
      if (project) {
        resolvedProjectPath = project.path;
        projectName = project.name;
      }
    }

    if (!resolvedProjectPath) {
      return res.status(400).json({
        error: 'Project path required',
        details: 'Either projectPath or a valid projectId must be provided'
      });
    }

    // Validate tool
    const validTools = getSupportedTools();
    if (!validTools.includes(tool)) {
      return res.status(400).json({
        error: 'Invalid tool',
        details: `Tool must be one of: ${validTools.join(', ')}`,
        validTools
      });
    }

    // Validate mode if provided
    const validModes = ['agent', 'plan', 'ask'];
    if (mode && !validModes.includes(mode)) {
      return res.status(400).json({
        error: 'Invalid mode',
        details: `Mode must be one of: ${validModes.join(', ')}`,
        validModes
      });
    }

    // Create the chat session
    const chatResult = await chatProcessManager.createChat({
      projectPath: resolvedProjectPath,
      tool,
      topic,
      model,
      mode,
      permissionMode,
      sessionId,
      initialPrompt,
    });

    logger.info('Chat', 'Chat created', {
      conversationId: chatResult.conversationId,
      tool,
      topic: chatResult.topic
    });

    console.log(`Created chat: ${chatResult.conversationId} (${tool})`);

    res.json({
      success: true,
      conversationId: chatResult.conversationId,
      chatId: chatResult.conversationId,  // Alias
      terminalId: chatResult.conversationId,  // Legacy alias
      tool,
      topic: chatResult.topic,
      model: chatResult.model,
      mode: chatResult.mode,
      projectPath: resolvedProjectPath,
      projectName,
      status: chatResult.status,
    });
  } catch (error) {
    logger.error('Chat', 'Failed to create chat', {
      errorMessage: error.message
    });

    console.error('Error creating chat:', error);
    res.status(500).json({
      error: 'Failed to create chat',
      details: error.message
    });
  }
});

// Close/delete a chat
router.delete('/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;

    const chatInfo = chatProcessManager.getChat(conversationId);

    if (!chatInfo) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    await chatProcessManager.closeChat(conversationId);

    logger.info('Chat', 'Chat closed', {
      conversationId,
      tool: chatInfo.tool
    });

    res.json({
      success: true,
      conversationId,
      message: 'Chat closed'
    });
  } catch (error) {
    console.error('Error closing chat:', error);
    res.status(500).json({ error: 'Failed to close chat' });
  }
});

// Get chat history/messages
router.get('/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!chatProcessManager.hasChat(conversationId)) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const messages = chatProcessManager.getBufferedMessages(conversationId);

    res.json({
      conversationId,
      messages,
      total: messages.length
    });
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json({ error: 'Failed to fetch chat messages' });
  }
});

// Fork/clone a chat (creates new chat with same settings)
router.post('/:conversationId/fork', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { newTopic } = req.body;

    logger.info('Chat', 'Forking chat', { conversationId, newTopic });

    const sourceChat = chatProcessManager.getChat(conversationId);
    if (!sourceChat) {
      return res.status(404).json({ error: 'Source chat not found' });
    }

    // Generate new topic
    const forkTopic = newTopic || `${sourceChat.topic}-fork-${Date.now().toString(36)}`;

    // Create new chat with same settings
    const newChat = await chatProcessManager.createChat({
      projectPath: sourceChat.projectPath,
      tool: sourceChat.tool,
      topic: forkTopic,
      model: sourceChat.model,
      mode: sourceChat.mode,
    });

    logger.info('Chat', 'Chat forked successfully', {
      sourceConversationId: conversationId,
      newConversationId: newChat.conversationId,
      tool: sourceChat.tool,
    });

    res.json({
      success: true,
      conversationId: newChat.conversationId,
      sourceConversationId: conversationId,
      tool: sourceChat.tool,
      topic: forkTopic,
      originalTopic: sourceChat.topic,
      projectPath: sourceChat.projectPath,
      message: 'Chat forked successfully'
    });
  } catch (error) {
    logger.error('Chat', 'Failed to fork chat', {
      errorMessage: error.message
    });
    console.error('Error forking chat:', error);
    res.status(500).json({
      error: 'Failed to fork chat',
      details: error.message
    });
  }
});

export { router as conversationRoutes };
