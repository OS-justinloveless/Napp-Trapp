import { Router } from 'express';
import { tmuxManager } from '../utils/TmuxManager.js';
import { ProjectManager } from '../utils/ProjectManager.js';
import { getSupportedTools, checkAllToolsAvailability } from '../utils/CLIAdapter.js';
import { logger } from '../utils/LogManager.js';

const router = Router();
const projectManager = new ProjectManager();

/**
 * Conversations API - Tmux Chat Windows
 * 
 * Chats are tmux windows running AI CLI tools directly.
 * This provides a simple, consistent experience:
 * - Create a chat = create a tmux window running claude/cursor-agent/gemini
 * - View a chat = attach to the tmux window via terminal view
 * - Chat history is managed by the CLI tools themselves
 * 
 * Window naming: chat-{tool}-{topic}
 * Examples: chat-claude-auth-bug, chat-cursor-refactor, chat-gemini-review
 */

// Get list of all chat windows for a project
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
    
    if (!resolvedProjectPath) {
      return res.json({
        chats: [],
        total: 0,
        message: 'No project path specified'
      });
    }

    // List chat windows from tmux
    const chatWindows = tmuxManager.listChatWindows(resolvedProjectPath);
    
    // Format for API response
    const chats = chatWindows.map(w => ({
      id: w.id,
      terminalId: w.id,
      windowName: w.windowName,
      tool: w.tool,
      topic: w.topic,
      sessionName: w.sessionName,
      windowIndex: w.windowIndex,
      projectPath: resolvedProjectPath,
      type: 'chat',
      source: 'tmux',
      active: w.active,
      title: `${w.tool}: ${w.topic}`,
      timestamp: Date.now(),
      messageCount: 0
    }));

    res.json({
      chats,
      conversations: chats, // Alias for backwards compatibility
      total: chats.length
    });
  } catch (error) {
    console.error('Error fetching chat windows:', error);
    res.status(500).json({ error: 'Failed to fetch chat windows' });
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

// Get specific chat window info
router.get('/:terminalId', async (req, res) => {
  try {
    const { terminalId } = req.params;
    
    // Check if this is a tmux terminal ID
    if (!tmuxManager.isTmuxTerminal(terminalId)) {
      return res.status(400).json({ 
        error: 'Invalid terminal ID',
        details: 'Terminal ID must be a tmux terminal (format: tmux-sessionName:windowIndex)'
      });
    }
    
    const { sessionName, windowIndex } = tmuxManager.parseTerminalId(terminalId);
    const windows = tmuxManager.listWindows(sessionName);
    const window = windows.find(w => w.index === windowIndex);
    
    if (!window) {
      return res.status(404).json({ error: 'Chat window not found' });
    }
    
    // Check if it's a chat window
    if (!tmuxManager.isChatWindow(window.name)) {
      return res.status(400).json({ 
        error: 'Not a chat window',
        details: 'This terminal is not a chat window'
      });
    }
    
    // Parse window name: chat-{tool}-{topic}
    const parts = window.name.split('-');
    const tool = parts[1] || 'unknown';
    const topic = parts.slice(2).join('-') || 'unknown';
    
    res.json({
      chat: {
        id: terminalId,
        terminalId,
        windowName: window.name,
        tool,
        topic,
        sessionName,
        windowIndex: window.index,
        currentPath: window.currentPath,
        active: window.active,
        type: 'chat',
        title: `${tool}: ${topic}`
      }
    });
  } catch (error) {
    console.error('Error fetching chat window:', error);
    res.status(500).json({ error: 'Failed to fetch chat window details' });
  }
});

// Create a new chat window
router.post('/', async (req, res) => {
  try {
    const { 
      projectPath, 
      projectId,
      tool = 'claude', 
      topic, 
      model, 
      mode = 'agent',
      initialPrompt 
    } = req.body;
    
    logger.info('Chat', 'Creating new chat window', {
      projectPath,
      projectId,
      tool,
      topic,
      model,
      mode
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

    // Create the chat window
    const chatWindow = tmuxManager.createChatWindow({
      projectPath: resolvedProjectPath,
      tool,
      topic,
      model,
      mode
    });
    
    // If there's an initial prompt, send it after a short delay
    if (initialPrompt && initialPrompt.trim()) {
      tmuxManager.sendInitialPrompt(
        chatWindow.sessionName,
        chatWindow.windowIndex,
        initialPrompt.trim(),
        2000 // 2 second delay to let CLI initialize
      );
    }

    logger.info('Chat', 'Chat window created', {
      terminalId: chatWindow.id,
      windowName: chatWindow.windowName,
      tool,
      topic: chatWindow.topic
    });
    
    console.log(`Created chat window: ${chatWindow.windowName} (${chatWindow.id})`);

    res.json({
      success: true,
      terminalId: chatWindow.id,
      windowName: chatWindow.windowName,
      sessionName: chatWindow.sessionName,
      windowIndex: chatWindow.windowIndex,
      tool,
      topic: chatWindow.topic,
      model: chatWindow.model,
      mode: chatWindow.mode,
      projectPath: resolvedProjectPath,
      projectName,
      chatId: chatWindow.id
    });
  } catch (error) {
    logger.error('Chat', 'Failed to create chat window', {
      errorMessage: error.message
    });
    
    console.error('Error creating chat window:', error);
    res.status(500).json({
      error: 'Failed to create chat window',
      details: error.message
    });
  }
});

// Close/delete a chat window
router.delete('/:terminalId', async (req, res) => {
  try {
    const { terminalId } = req.params;
    
    if (!tmuxManager.isTmuxTerminal(terminalId)) {
      return res.status(400).json({ 
        error: 'Invalid terminal ID'
      });
    }
    
    const { sessionName, windowIndex } = tmuxManager.parseTerminalId(terminalId);
    
    // Verify it's a chat window before killing
    const windows = tmuxManager.listWindows(sessionName);
    const window = windows.find(w => w.index === windowIndex);
    
    if (!window) {
      return res.status(404).json({ error: 'Window not found' });
    }
    
    if (!tmuxManager.isChatWindow(window.name)) {
      return res.status(400).json({ 
        error: 'Not a chat window',
        details: 'Use /api/terminals endpoint for regular terminals'
      });
    }
    
    // Kill the window
    tmuxManager.killWindow(sessionName, windowIndex);
    
    logger.info('Chat', 'Chat window closed', {
      terminalId,
      windowName: window.name
    });
    
    res.json({
      success: true,
      terminalId,
      windowName: window.name,
      message: 'Chat window closed'
    });
  } catch (error) {
    console.error('Error closing chat window:', error);
    res.status(500).json({ error: 'Failed to close chat window' });
  }
});

// Send initial prompt to an existing chat window
router.post('/:terminalId/prompt', async (req, res) => {
  try {
    const { terminalId } = req.params;
    const { prompt, delay = 500 } = req.body;
    
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    
    if (!tmuxManager.isTmuxTerminal(terminalId)) {
      return res.status(400).json({ error: 'Invalid terminal ID' });
    }
    
    const { sessionName, windowIndex } = tmuxManager.parseTerminalId(terminalId);
    
    // Send the prompt
    tmuxManager.sendInitialPrompt(sessionName, windowIndex, prompt.trim(), delay);
    
    res.json({
      success: true,
      terminalId,
      message: 'Prompt will be sent to the chat window'
    });
  } catch (error) {
    console.error('Error sending prompt:', error);
    res.status(500).json({ error: 'Failed to send prompt' });
  }
});

export { router as conversationRoutes };
