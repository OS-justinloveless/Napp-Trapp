import * as pty from 'node-pty';
import { execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Manages tmux sessions for mobile terminal access
 * 
 * Architecture: One base session per project, with grouped client sessions for each connected client
 * 
 * Base Sessions: mobile-{projectDirName}
 * Client Sessions: mobile-{projectDirName}-client-{clientId}
 * Terminal IDs: tmux-{sessionName}:{windowIndex}
 * 
 * Grouped Session Architecture:
 * - Base session holds all windows (terminals, chats)
 * - Each client (mobile app, desktop) gets their own "client session"
 * - Client sessions are grouped with the base session (tmux -t option)
 * - Grouped sessions share windows but have independent views
 * - Mobile creating a new window doesn't switch desktop's active window
 * - Each client can navigate windows independently
 * 
 * Benefits:
 * - Clean organization (one base session per project)
 * - Sessions persist even when mobile app disconnects
 * - Multiple clients can view/interact without affecting each other
 * - Desktop users can attach via `tmux new-session -t mobile-{project}` for independent view
 * - Multiple windows per project (like tabs)
 */
export class TmuxManager {
  constructor() {
    // Map of "sessionName:windowIndex" to attached PTY processes
    this.attachedWindows = new Map(); // "session:window" -> { ptyProcess, handlers, buffer }
    
    // Event handlers for terminal output
    this.outputHandlers = new Map(); // "session:window" -> Set of callbacks
    
    // Output buffer for each attached window
    this.outputBuffers = new Map(); // "session:window" -> string
    this.maxBufferSize = 64 * 1024; // 64KB max buffer
    
    console.log('[TmuxManager] Initialized with window-based architecture');
  }

  /**
   * Check if tmux is installed and available
   * @returns {boolean}
   */
  isTmuxAvailable() {
    try {
      execSync('which tmux', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get tmux version
   * @returns {string|null}
   */
  getTmuxVersion() {
    try {
      const output = execSync('tmux -V', { encoding: 'utf-8' }).trim();
      return output;
    } catch (e) {
      return null;
    }
  }

  /**
   * Generate a session name from a project path
   * Format: mobile-{projectDirName}
   * @param {string} projectPath - The project path
   * @returns {string}
   */
  generateSessionName(projectPath) {
    const projectDirName = path.basename(projectPath)
      .replace(/[^a-zA-Z0-9_-]/g, '-') // Sanitize for tmux
      .substring(0, 30); // Keep it reasonable length
    return `mobile-${projectDirName}`;
  }

  /**
   * Extract project name from a session name
   * @param {string} sessionName - The tmux session name
   * @returns {string|null}
   */
  extractProjectName(sessionName) {
    if (!sessionName.startsWith('mobile-')) {
      return null;
    }
    // Remove 'mobile-' prefix and any client suffix (-client-xxx)
    let name = sessionName.substring(7);
    const clientSuffixIndex = name.indexOf('-client-');
    if (clientSuffixIndex !== -1) {
      name = name.substring(0, clientSuffixIndex);
    }
    return name;
  }

  /**
   * Check if a session is a client session (grouped session)
   * @param {string} sessionName - The tmux session name
   * @returns {boolean}
   */
  isClientSession(sessionName) {
    return sessionName.includes('-client-');
  }

  /**
   * Get the base session name from a client session name
   * @param {string} sessionName - The session name (base or client)
   * @returns {string} - The base session name
   */
  getBaseSessionName(sessionName) {
    const clientSuffixIndex = sessionName.indexOf('-client-');
    if (clientSuffixIndex !== -1) {
      return sessionName.substring(0, clientSuffixIndex);
    }
    return sessionName;
  }

  /**
   * Generate a client session name
   * @param {string} baseSessionName - The base session name
   * @param {string} clientId - Unique client identifier
   * @returns {string}
   */
  generateClientSessionName(baseSessionName, clientId) {
    // Sanitize clientId
    const sanitizedClientId = clientId
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .substring(0, 20);
    return `${baseSessionName}-client-${sanitizedClientId}`;
  }

  /**
   * Check if a session belongs to a project
   * @param {string} sessionName - The tmux session name
   * @param {string} projectPath - The project path
   * @returns {boolean}
   */
  sessionBelongsToProject(sessionName, projectPath) {
    const expectedName = this.generateSessionName(projectPath);
    return sessionName === expectedName;
  }

  /**
   * List all tmux sessions
   * @returns {Array<object>} - Array of session info
   */
  listAllSessions() {
    if (!this.isTmuxAvailable()) {
      console.log('[TmuxManager] tmux not available');
      return [];
    }

    try {
      const output = execSync(
        'tmux list-sessions -F "#{session_name}|#{session_created}|#{session_windows}|#{session_attached}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();

      if (!output) {
        console.log('[TmuxManager] No output from tmux list-sessions');
        return [];
      }

      const sessions = output.split('\n').map(line => {
        const parts = line.split('|');
        const name = parts[0];
        const created = parts[1];
        const windows = parts[2];
        const attached = parts[3];
        
        return {
          name,
          createdAt: parseInt(created, 10) * 1000,
          windowCount: parseInt(windows, 10),
          attached: attached === '1',
          isMobileSession: name.startsWith('mobile-'),
          projectName: this.extractProjectName(name)
        };
      });

      console.log(`[TmuxManager] Found ${sessions.length} total sessions:`, sessions.map(s => s.name));
      return sessions;
    } catch (e) {
      const errorMsg = e.stderr?.toString() || e.message || '';
      
      if (errorMsg.includes('no server running') || 
          errorMsg.includes('no sessions') ||
          errorMsg.includes('error connecting')) {
        console.log('[TmuxManager] No tmux server or sessions');
        return [];
      }
      
      console.error('[TmuxManager] Error listing sessions:', errorMsg);
      return [];
    }
  }

  /**
   * List windows in a tmux session
   * @param {string} sessionName - The session name
   * @returns {Array<object>} - Array of window info
   */
  listWindows(sessionName) {
    if (!this.isTmuxAvailable()) {
      return [];
    }

    try {
      const output = execSync(
        `tmux list-windows -t "${sessionName}" -F "#{window_index}|#{window_name}|#{window_active}|#{pane_current_path}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();

      if (!output) {
        return [];
      }

      const windows = output.split('\n').map(line => {
        const parts = line.split('|');
        return {
          index: parseInt(parts[0], 10),
          name: parts[1],
          active: parts[2] === '1',
          currentPath: parts[3] || null
        };
      });

      return windows;
    } catch (e) {
      const errorMsg = e.stderr?.toString() || e.message || '';
      if (errorMsg.includes("session not found") || errorMsg.includes("can't find session")) {
        return [];
      }
      console.error(`[TmuxManager] Error listing windows for ${sessionName}:`, errorMsg);
      return [];
    }
  }

  /**
   * Check if a session exists
   * @param {string} sessionName - The session name
   * @returns {boolean}
   */
  sessionExists(sessionName) {
    const sessions = this.listAllSessions();
    return sessions.some(s => s.name === sessionName);
  }

  /**
   * Get the session for a project
   * @param {string} projectPath - The project path
   * @returns {object|null} - Session info or null
   */
  getSessionForProject(projectPath) {
    const sessionName = this.generateSessionName(projectPath);
    const sessions = this.listAllSessions();
    return sessions.find(s => s.name === sessionName) || null;
  }

  /**
   * Get or create a session for a project
   * @param {string} projectPath - The project path
   * @param {object} options - Options
   * @returns {object} - Session info with { name, isNew }
   */
  getOrCreateSession(projectPath, options = {}) {
    if (!this.isTmuxAvailable()) {
      throw new Error('tmux is not installed or not available in PATH');
    }

    const sessionName = this.generateSessionName(projectPath);
    const cwd = options.cwd || projectPath;

    // Check if session already exists
    if (this.sessionExists(sessionName)) {
      console.log(`[TmuxManager] Session ${sessionName} already exists`);
      return { name: sessionName, isNew: false };
    }

    // Verify cwd exists
    if (!fs.existsSync(cwd)) {
      throw new Error(`Working directory does not exist: ${cwd}`);
    }

    // Create the tmux session
    try {
      execSync(
        `tmux new-session -d -s "${sessionName}" -c "${cwd}"`,
        { encoding: 'utf-8', cwd }
      );
      
      // Disable mouse mode for mobile sessions to prevent scroll events from
      // being interpreted as mouse escape sequences (which appear as random text)
      try {
        execSync(
          `tmux set-option -t "${sessionName}" mouse off`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        console.log(`[TmuxManager] Disabled mouse mode for session: ${sessionName}`);
      } catch (mouseErr) {
        console.warn(`[TmuxManager] Could not disable mouse mode: ${mouseErr.message}`);
      }
      
      console.log(`[TmuxManager] Created session: ${sessionName} in ${cwd}`);
      return { name: sessionName, isNew: true };
    } catch (e) {
      if (e.message.includes('duplicate session')) {
        // Race condition - session was created between check and create
        return { name: sessionName, isNew: false };
      }
      throw new Error(`Failed to create tmux session: ${e.message}`);
    }
  }

  /**
   * Get or create a client session (grouped session with independent view)
   * This allows multiple clients (mobile, desktop) to have independent views
   * while sharing the same windows.
   * 
   * @param {string} baseSessionName - The base session name (e.g., mobile-MyProject)
   * @param {string} clientId - Unique client identifier (e.g., 'mobile-1', 'desktop')
   * @returns {object} - { name, isNew, baseSession }
   */
  getOrCreateClientSession(baseSessionName, clientId) {
    if (!this.isTmuxAvailable()) {
      throw new Error('tmux is not installed');
    }

    // Make sure base session exists
    if (!this.sessionExists(baseSessionName)) {
      throw new Error(`Base session ${baseSessionName} does not exist`);
    }

    const clientSessionName = this.generateClientSessionName(baseSessionName, clientId);

    // Check if client session already exists
    if (this.sessionExists(clientSessionName)) {
      console.log(`[TmuxManager] Client session ${clientSessionName} already exists`);
      return { name: clientSessionName, isNew: false, baseSession: baseSessionName };
    }

    // Create a grouped session
    // -t target creates a session grouped with target (shares windows, independent view)
    try {
      execSync(
        `tmux new-session -d -t "${baseSessionName}" -s "${clientSessionName}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.log(`[TmuxManager] Created grouped client session: ${clientSessionName} -> ${baseSessionName}`);
      return { name: clientSessionName, isNew: true, baseSession: baseSessionName };
    } catch (e) {
      if (e.message.includes('duplicate session')) {
        return { name: clientSessionName, isNew: false, baseSession: baseSessionName };
      }
      throw new Error(`Failed to create client session: ${e.message}`);
    }
  }

  /**
   * Get or create a session for a project, optionally with a client-specific view
   * @param {string} projectPath - The project path
   * @param {object} options - Options
   * @param {string} options.clientId - Optional client ID for grouped session
   * @returns {object} - Session info with { name, isNew, isClientSession, baseSession }
   */
  getOrCreateSessionWithClient(projectPath, options = {}) {
    // First, ensure base session exists
    const { name: baseSessionName, isNew: isBaseNew } = this.getOrCreateSession(projectPath, options);

    // If no clientId, just return the base session
    if (!options.clientId) {
      return { 
        name: baseSessionName, 
        isNew: isBaseNew, 
        isClientSession: false, 
        baseSession: baseSessionName 
      };
    }

    // Create or get client session
    const clientResult = this.getOrCreateClientSession(baseSessionName, options.clientId);
    return {
      name: clientResult.name,
      isNew: clientResult.isNew,
      isClientSession: true,
      baseSession: baseSessionName
    };
  }

  /**
   * List all client sessions for a base session
   * @param {string} baseSessionName - The base session name
   * @returns {Array<object>} - Array of client session info
   */
  listClientSessions(baseSessionName) {
    const allSessions = this.listAllSessions();
    return allSessions.filter(s => 
      s.name.startsWith(baseSessionName + '-client-')
    );
  }

  /**
   * Clean up client sessions for a base session (e.g., when base is destroyed)
   * @param {string} baseSessionName - The base session name
   */
  cleanupClientSessions(baseSessionName) {
    const clientSessions = this.listClientSessions(baseSessionName);
    for (const session of clientSessions) {
      try {
        this.destroySession(session.name);
        console.log(`[TmuxManager] Cleaned up client session: ${session.name}`);
      } catch (e) {
        console.warn(`[TmuxManager] Failed to cleanup client session ${session.name}: ${e.message}`);
      }
    }
  }

  /**
   * Create a new window in a session
   * @param {string} sessionName - The session name
   * @param {object} options - Options
   * @param {string} options.cwd - Working directory
   * @param {string} options.name - Window name (optional)
   * @param {boolean} options.background - Create in background without switching (default: true)
   * @returns {object} - Window info { sessionName, windowIndex, windowName }
   */
  createWindow(sessionName, options = {}) {
    if (!this.isTmuxAvailable()) {
      throw new Error('tmux is not installed');
    }

    if (!this.sessionExists(sessionName)) {
      throw new Error(`Session ${sessionName} does not exist`);
    }

    const cwd = options.cwd || os.homedir();
    const windowName = options.name || '';
    const background = options.background !== false; // Default to true

    // Build command - use -d flag to create in background (doesn't disrupt desktop users)
    let cmd = `tmux new-window${background ? ' -d' : ''} -t "${sessionName}" -c "${cwd}"`;
    if (windowName) {
      cmd += ` -n "${windowName}"`;
    }
    // Add -P to print window info
    cmd += ' -P -F "#{window_index}"';

    try {
      const output = execSync(cmd, { encoding: 'utf-8' }).trim();
      const windowIndex = parseInt(output, 10);
      
      console.log(`[TmuxManager] Created window ${windowIndex} in session ${sessionName}${background ? ' (background)' : ''}`);
      
      return {
        sessionName,
        windowIndex,
        windowName: windowName || `window-${windowIndex}`,
        cwd
      };
    } catch (e) {
      throw new Error(`Failed to create window: ${e.message}`);
    }
  }

  /**
   * Create a new terminal (session + window if needed, or just window)
   * This is the main entry point for creating terminals
   * @param {object} options - Options
   * @param {string} options.projectPath - Project path (required)
   * @param {string} options.cwd - Working directory (defaults to projectPath)
   * @param {string} options.windowName - Name for the window (optional)
   * @returns {object} - Terminal info
   */
  createTerminal(options = {}) {
    if (!options.projectPath) {
      throw new Error('projectPath is required');
    }

    const projectPath = options.projectPath;
    const cwd = options.cwd || projectPath;
    const windowName = options.windowName || '';

    // Get or create the session for this project
    const { name: sessionName, isNew: isNewSession } = this.getOrCreateSession(projectPath, { cwd });

    let windowIndex;
    
    if (isNewSession) {
      // New session already has window 0
      windowIndex = 0;
      // Rename window if name provided
      if (windowName) {
        this.renameWindow(sessionName, 0, windowName);
      }
    } else {
      // Create a new window in the existing session
      const windowInfo = this.createWindow(sessionName, { cwd, name: windowName });
      windowIndex = windowInfo.windowIndex;
    }

    const terminalId = this.buildTerminalId(sessionName, windowIndex);

    return {
      id: terminalId,
      sessionName,
      windowIndex,
      windowName: windowName || `window-${windowIndex}`,
      cwd,
      projectPath,
      createdAt: Date.now(),
      active: true,
      source: 'tmux',
      attached: false
    };
  }

  /**
   * Create a chat window that runs an AI CLI tool
   * 
   * Chat windows are tmux windows that run AI CLI tools (claude, cursor-agent, gemini)
   * instead of a regular shell. The window name follows the pattern: chat-{tool}-{topic}
   * 
   * @param {object} options - Options
   * @param {string} options.projectPath - Project path (required)
   * @param {string} options.tool - CLI tool to run: 'claude', 'cursor-agent', 'gemini' (required)
   * @param {string} options.topic - Topic/name for the chat (optional, defaults to timestamp)
   * @param {string} options.model - AI model to use (optional)
   * @param {string} options.mode - Chat mode: 'agent', 'plan', 'ask' (optional)
   * @param {string} options.initialPrompt - Initial prompt to send (optional)
   * @param {string} options.sessionId - Session ID for resume (optional, auto-generated if not provided)
   * @returns {object} - Chat window info
   */
  createChatWindow(options = {}) {
    console.log('[TmuxManager] createChatWindow called with:', JSON.stringify(options, null, 2));
    
    if (!options.projectPath) {
      throw new Error('projectPath is required');
    }
    if (!options.tool) {
      throw new Error('tool is required');
    }

    const { projectPath, tool, topic, model, mode, initialPrompt, sessionId } = options;
    
    // Validate tool
    const validTools = ['claude', 'cursor-agent', 'gemini'];
    if (!validTools.includes(tool)) {
      throw new Error(`Invalid tool: ${tool}. Must be one of: ${validTools.join(', ')}`);
    }

    // Generate window name: chat-{tool}-{topic}
    const sanitizedTopic = topic 
      ? topic.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 20)
      : Date.now().toString();
    const windowName = `chat-${tool}-${sanitizedTopic}`;
    
    console.log(`[TmuxManager] Creating chat window: ${windowName} for project: ${projectPath}`);
    
    // Generate session ID for CLI resume functionality
    const chatSessionId = sessionId || `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Get or create the tmux session for this project
    console.log(`[TmuxManager] Getting or creating session for project...`);
    const { name: sessionName, isNew: isNewSession } = this.getOrCreateSession(projectPath, { cwd: projectPath });
    console.log(`[TmuxManager] Session: ${sessionName}, isNew: ${isNewSession}`);

    // Build the CLI command
    const cliCommand = this.buildCLICommand(tool, {
      sessionId: chatSessionId,
      workspacePath: projectPath,
      model,
      mode,
      initialPrompt
    });

    let windowIndex;
    
    if (isNewSession) {
      // New session already has window 0
      windowIndex = 0;
      this.renameWindow(sessionName, 0, windowName);
    } else {
      // Create a new window with -d flag to not switch to it (doesn't disrupt desktop users)
      try {
        const cmd = `tmux new-window -d -t "${sessionName}" -c "${projectPath}" -n "${windowName}" -P -F "#{window_index}"`;
        const output = execSync(cmd, { encoding: 'utf-8' }).trim();
        windowIndex = parseInt(output, 10);
        console.log(`[TmuxManager] Created chat window ${windowIndex} in session ${sessionName} (background)`);
      } catch (e) {
        throw new Error(`Failed to create chat window: ${e.message}`);
      }
    }
    
    // Send the CLI command to the window
    // This keeps the window open even if the command fails, allowing users to see the error
    try {
      execSync(
        `tmux send-keys -t "${sessionName}:${windowIndex}" '${cliCommand.replace(/'/g, "'\\''")}' Enter`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.log(`[TmuxManager] Sent command to chat window: ${cliCommand}`);
    } catch (e) {
      console.error(`[TmuxManager] Error sending command to window: ${e.message}`);
      // Don't throw - the window is still created, user can debug manually
    }

    const terminalId = this.buildTerminalId(sessionName, windowIndex);
    
    // Verify the window was created
    const windows = this.listWindows(sessionName);
    const createdWindow = windows.find(w => w.index === windowIndex);
    console.log(`[TmuxManager] Verification - Windows in session ${sessionName}:`, windows.map(w => `${w.index}:${w.name}`));
    console.log(`[TmuxManager] Created window found: ${createdWindow ? 'yes' : 'no'}`);
    console.log(`[TmuxManager] Terminal ID: ${terminalId}`);

    return {
      id: terminalId,
      sessionName,
      windowIndex,
      windowName,
      tool,
      topic: sanitizedTopic,
      chatSessionId,
      model: model || null,
      mode: mode || 'agent',
      projectPath,
      createdAt: Date.now(),
      active: true,
      source: 'tmux',
      type: 'chat',
      attached: false
    };
  }

  /**
   * Build the CLI command string for an AI tool
   * @private
   */
  buildCLICommand(tool, options = {}) {
    const { sessionId, workspacePath, model, mode, initialPrompt } = options;
    
    let args = [];
    
    switch (tool) {
      case 'claude':
        // Claude Code CLI
        // Note: Claude runs in the current directory (set via tmux window's -c option)
        // There is no --workspace flag
        if (model) {
          args.push('--model', model);
        }
        // Map our mode to Claude's permission-mode
        if (mode === 'plan') {
          args.push('--permission-mode', 'plan');
        } else if (mode === 'ask') {
          // 'ask' mode - use plan mode for read-only behavior
          args.push('--permission-mode', 'plan');
        }
        // Note: We don't use --resume or --session-id here because:
        // - --resume opens a picker or resumes by ID
        // - --session-id requires a valid UUID
        // For new chats, we just start fresh in the project directory
        break;
        
      case 'cursor-agent':
        // Cursor Agent CLI (if it exists)
        if (sessionId) {
          args.push('--resume', sessionId);
        }
        if (workspacePath) {
          args.push('--workspace', workspacePath);
        }
        if (model) {
          args.push('--model', model);
        }
        if (mode && mode !== 'agent') {
          args.push('--mode', mode);
        }
        break;
        
      case 'gemini':
        // Gemini CLI (if it exists)
        if (model) {
          args.push('--model', model);
        }
        // Gemini CLI parameters may vary - keeping it simple
        break;
    }
    
    // Build the full command
    let command = `${tool} ${args.join(' ')}`.trim();
    
    // If there's an initial prompt, we can pipe it or use a here-doc approach
    // For interactive mode, we'll send it as a follow-up
    if (initialPrompt) {
      // The CLI will start, then we need to send the prompt
      // This is handled separately after window creation
      console.log(`[TmuxManager] Initial prompt will be sent after CLI starts: ${initialPrompt.substring(0, 50)}...`);
    }
    
    console.log(`[TmuxManager] Built CLI command: ${command}`);
    
    return command;
  }

  /**
   * Send an initial prompt to a chat window after the CLI has started
   * @param {string} sessionName - Session name
   * @param {number} windowIndex - Window index
   * @param {string} prompt - The prompt to send
   * @param {number} delay - Delay in ms before sending (to let CLI initialize)
   */
  sendInitialPrompt(sessionName, windowIndex, prompt, delay = 1000) {
    setTimeout(() => {
      try {
        // Escape the prompt for shell
        const escapedPrompt = prompt.replace(/'/g, "'\\''");
        execSync(
          `tmux send-keys -t "${sessionName}:${windowIndex}" '${escapedPrompt}' Enter`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        console.log(`[TmuxManager] Sent initial prompt to ${sessionName}:${windowIndex}`);
      } catch (e) {
        console.error(`[TmuxManager] Error sending initial prompt: ${e.message}`);
      }
    }, delay);
  }

  /**
   * List all chat windows for a project
   * Chat windows have names starting with "chat-"
   * @param {string} projectPath - Project path
   * @returns {Array<object>} - Array of chat window info
   */
  listChatWindows(projectPath) {
    const sessionName = this.generateSessionName(projectPath);
    console.log(`[TmuxManager] listChatWindows for project: ${projectPath}`);
    console.log(`[TmuxManager] Looking for session: ${sessionName}`);
    
    const sessions = this.listAllSessions();
    console.log(`[TmuxManager] All sessions:`, sessions.map(s => s.name));
    
    const windows = this.listWindows(sessionName);
    console.log(`[TmuxManager] Windows in session ${sessionName}:`, windows.map(w => `${w.index}:${w.name}`));
    
    const chatWindows = windows.filter(w => w.name && w.name.startsWith('chat-'));
    console.log(`[TmuxManager] Chat windows found:`, chatWindows.map(w => w.name));
    
    return chatWindows.map(w => {
        // Parse window name: chat-{tool}-{topic}
        const parts = w.name.split('-');
        const tool = parts[1] || 'unknown';
        const topic = parts.slice(2).join('-') || 'unknown';
        
        return {
          id: this.buildTerminalId(sessionName, w.index),
          sessionName,
          windowIndex: w.index,
          windowName: w.name,
          tool,
          topic,
          currentPath: w.currentPath,
          active: w.active,
          type: 'chat'
        };
      });
  }

  /**
   * Check if a window is a chat window
   * @param {string} windowName - Window name
   * @returns {boolean}
   */
  isChatWindow(windowName) {
    return windowName && windowName.startsWith('chat-');
  }

  /**
   * Get scrollback history from a tmux window
   * Uses tmux capture-pane to capture the scrollback buffer
   *
   * @param {string} sessionName - Session name
   * @param {number} windowIndex - Window index
   * @param {number} lines - Number of lines to capture (default: 2000)
   * @returns {string} - The scrollback content
   */
  getWindowScrollback(sessionName, windowIndex, lines = 2000) {
    if (!this.isTmuxAvailable()) {
      throw new Error('tmux is not installed');
    }

    try {
      // Use capture-pane with -p to print to stdout
      // -S specifies how far back to start (negative = lines before current)
      // -E specifies where to end (empty means current visible end)
      const output = execSync(
        `tmux capture-pane -t "${sessionName}:${windowIndex}" -p -S -${lines}`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
      );

      return output;
    } catch (e) {
      const errorMsg = e.stderr?.toString() || e.message || '';
      console.error(`[TmuxManager] Error capturing scrollback: ${errorMsg}`);
      throw new Error(`Failed to capture scrollback: ${errorMsg}`);
    }
  }

  /**
   * Copy a window's scrollback to a new pane or save to file
   * Useful for preserving history when forking chats
   *
   * @param {string} sessionName - Session name
   * @param {number} windowIndex - Window index
   * @param {string} outputPath - Path to save the scrollback (optional)
   * @returns {object} - { content: string, lines: number, savedTo?: string }
   */
  captureWindowHistory(sessionName, windowIndex, outputPath = null) {
    const content = this.getWindowScrollback(sessionName, windowIndex, 10000);
    const lines = content.split('\n').length;

    const result = { content, lines };

    if (outputPath) {
      try {
        fs.writeFileSync(outputPath, content, 'utf-8');
        result.savedTo = outputPath;
        console.log(`[TmuxManager] Saved scrollback to ${outputPath} (${lines} lines)`);
      } catch (e) {
        console.error(`[TmuxManager] Failed to save scrollback: ${e.message}`);
      }
    }

    return result;
  }

  /**
   * Rename a window
   * @param {string} sessionName - Session name
   * @param {number} windowIndex - Window index
   * @param {string} newName - New window name
   */
  renameWindow(sessionName, windowIndex, newName) {
    try {
      execSync(
        `tmux rename-window -t "${sessionName}:${windowIndex}" "${newName}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (e) {
      console.error(`[TmuxManager] Failed to rename window: ${e.message}`);
    }
  }

  /**
   * Build a terminal ID from session name and window index
   * Format: tmux-{sessionName}:{windowIndex}
   */
  buildTerminalId(sessionName, windowIndex) {
    return `tmux-${sessionName}:${windowIndex}`;
  }

  /**
   * Parse a terminal ID into session name and window index
   * @param {string} terminalId - Terminal ID
   * @returns {object} - { sessionName, windowIndex }
   */
  parseTerminalId(terminalId) {
    if (!this.isTmuxTerminal(terminalId)) {
      throw new Error(`Not a tmux terminal ID: ${terminalId}`);
    }
    
    // Remove 'tmux-' prefix
    const rest = terminalId.substring(5);
    
    // Find the last colon (window index separator)
    const lastColonIndex = rest.lastIndexOf(':');
    
    if (lastColonIndex === -1) {
      // Legacy format without window index - assume window 0
      return { sessionName: rest, windowIndex: 0 };
    }
    
    const sessionName = rest.substring(0, lastColonIndex);
    const windowIndex = parseInt(rest.substring(lastColonIndex + 1), 10);
    
    return { sessionName, windowIndex };
  }

  /**
   * Check if a terminal ID is a tmux terminal
   * @param {string} terminalId - Terminal ID
   * @returns {boolean}
   */
  isTmuxTerminal(terminalId) {
    return terminalId && terminalId.startsWith('tmux-');
  }

  /**
   * Get the window key for maps (sessionName:windowIndex)
   */
  getWindowKey(sessionName, windowIndex) {
    return `${sessionName}:${windowIndex}`;
  }

  /**
   * Attach to a specific window via PTY
   * @param {string} sessionName - The session name
   * @param {number} windowIndex - The window index
   * @param {object} options - Options (cols, rows)
   * @returns {object} - Attached window info
   */
  attachToWindow(sessionName, windowIndex, options = {}) {
    if (!this.isTmuxAvailable()) {
      throw new Error('tmux is not installed');
    }

    // Determine the base session (in case sessionName is already a client session)
    const baseSessionName = this.getBaseSessionName(sessionName);

    // Check if base session exists
    if (!this.sessionExists(baseSessionName)) {
      throw new Error(`Session ${baseSessionName} not found`);
    }

    // Check if window exists (windows are on the base session)
    const windows = this.listWindows(baseSessionName);
    const window = windows.find(w => w.index === windowIndex);
    if (!window) {
      throw new Error(`Window ${windowIndex} not found in session ${baseSessionName}`);
    }

    // Determine which session to attach to
    let attachSessionName = baseSessionName;
    
    // If clientId is provided, create/use a grouped client session
    if (options.clientId) {
      const clientResult = this.getOrCreateClientSession(baseSessionName, options.clientId);
      attachSessionName = clientResult.name;
      console.log(`[TmuxManager] Using client session ${attachSessionName} for independent view`);
    }

    // Use client-specific window key if clientId is provided
    const windowKey = options.clientId 
      ? this.getWindowKey(attachSessionName, windowIndex)
      : this.getWindowKey(baseSessionName, windowIndex);

    // Check if already attached
    if (this.attachedWindows.has(windowKey)) {
      console.log(`[TmuxManager] Already attached to ${windowKey}, returning existing`);
      return this.attachedWindows.get(windowKey);
    }

    const cols = options.cols || 80;
    const rows = options.rows || 24;

    // Disable mouse mode before attaching to prevent scroll events from being
    // interpreted as mouse escape sequences (which appear as random text on mobile)
    try {
      execSync(
        `tmux set-option -t "${baseSessionName}" mouse off`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.log(`[TmuxManager] Disabled mouse mode for session: ${baseSessionName}`);
    } catch (mouseErr) {
      console.warn(`[TmuxManager] Could not disable mouse mode: ${mouseErr.message}`);
    }

    // Spawn PTY with tmux attach to specific window in the appropriate session
    const ptyProcess = pty.spawn('tmux', ['attach', '-t', `${attachSessionName}:${windowIndex}`], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: window.currentPath || os.homedir(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    });

    const attachedWindow = {
      sessionName,
      windowIndex,
      windowKey,
      ptyProcess,
      cols,
      rows,
      attachedAt: Date.now()
    };

    this.attachedWindows.set(windowKey, attachedWindow);
    this.outputHandlers.set(windowKey, new Set());
    this.outputBuffers.set(windowKey, '');

    // Handle PTY output
    ptyProcess.onData((data) => {
      this.appendToBuffer(windowKey, data);
      
      const handlers = this.outputHandlers.get(windowKey);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(data);
          } catch (error) {
            console.error(`[TmuxManager] Error in output handler for ${windowKey}:`, error);
          }
        }
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`[TmuxManager] Detached from ${windowKey}, exit: ${exitCode}, signal: ${signal}`);
      this.attachedWindows.delete(windowKey);
    });

    console.log(`[TmuxManager] Attached to window: ${windowKey}${options.clientId ? ` (client: ${options.clientId})` : ''}`);

    // Use base session name for terminal ID (canonical reference)
    const terminalId = this.buildTerminalId(baseSessionName, windowIndex);

    return {
      id: terminalId,
      sessionName: baseSessionName,
      clientSessionName: options.clientId ? attachSessionName : null,
      clientId: options.clientId || null,
      windowIndex,
      windowName: window.name,
      pid: ptyProcess.pid,
      cols,
      rows,
      attached: true,
      source: 'tmux'
    };
  }

  /**
   * Detach from a window
   * @param {string} sessionName - Session name
   * @param {number} windowIndex - Window index
   */
  detachFromWindow(sessionName, windowIndex) {
    const windowKey = this.getWindowKey(sessionName, windowIndex);
    const attached = this.attachedWindows.get(windowKey);
    
    if (!attached) {
      console.log(`[TmuxManager] Not attached to ${windowKey}`);
      return;
    }

    // Send Ctrl+B, D to detach gracefully
    attached.ptyProcess.write('\x02d');
    
    setTimeout(() => {
      if (this.attachedWindows.has(windowKey)) {
        attached.ptyProcess.kill();
        this.attachedWindows.delete(windowKey);
      }
    }, 500);

    console.log(`[TmuxManager] Detached from window: ${windowKey}`);
  }

  /**
   * Write data to an attached window
   * @param {string} sessionName - Session name
   * @param {number} windowIndex - Window index
   * @param {string} data - Data to write
   */
  writeToWindow(sessionName, windowIndex, data) {
    const windowKey = this.getWindowKey(sessionName, windowIndex);
    const attached = this.attachedWindows.get(windowKey);
    
    if (!attached) {
      throw new Error(`Not attached to ${windowKey}`);
    }
    
    attached.ptyProcess.write(data);
  }

  /**
   * Resize an attached window
   * @param {string} sessionName - Session name
   * @param {number} windowIndex - Window index
   * @param {number} cols - Columns
   * @param {number} rows - Rows
   */
  resizeWindow(sessionName, windowIndex, cols, rows) {
    const windowKey = this.getWindowKey(sessionName, windowIndex);
    const attached = this.attachedWindows.get(windowKey);
    
    if (!attached) {
      throw new Error(`Not attached to ${windowKey}`);
    }
    
    attached.ptyProcess.resize(cols, rows);
    attached.cols = cols;
    attached.rows = rows;
  }

  /**
   * Kill a specific window
   * @param {string} sessionName - Session name
   * @param {number} windowIndex - Window index
   */
  killWindow(sessionName, windowIndex) {
    const windowKey = this.getWindowKey(sessionName, windowIndex);
    
    // Detach first if attached
    if (this.attachedWindows.has(windowKey)) {
      const attached = this.attachedWindows.get(windowKey);
      attached.ptyProcess.kill();
      this.attachedWindows.delete(windowKey);
    }

    // Kill the tmux window
    try {
      execSync(`tmux kill-window -t "${sessionName}:${windowIndex}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      console.log(`[TmuxManager] Killed window: ${windowKey}`);
    } catch (e) {
      const errorMsg = e.stderr?.toString() || e.message || '';
      if (!errorMsg.includes("window not found") && !errorMsg.includes("no server running")) {
        throw new Error(`Failed to kill window: ${e.message}`);
      }
    }

    // Clean up handlers and buffer
    this.outputHandlers.delete(windowKey);
    this.outputBuffers.delete(windowKey);

    // Check if this was the last window - if so, session will auto-close
    const windows = this.listWindows(sessionName);
    if (windows.length === 0) {
      console.log(`[TmuxManager] Session ${sessionName} has no more windows, it will close`);
    }
  }

  /**
   * Kill an entire session (all windows)
   * @param {string} sessionName - Session name
   */
  killSession(sessionName) {
    // Detach from all windows in this session
    for (const [windowKey, attached] of this.attachedWindows) {
      if (windowKey.startsWith(sessionName + ':')) {
        attached.ptyProcess.kill();
        this.attachedWindows.delete(windowKey);
        this.outputHandlers.delete(windowKey);
        this.outputBuffers.delete(windowKey);
      }
    }

    // Kill the tmux session
    try {
      execSync(`tmux kill-session -t "${sessionName}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      console.log(`[TmuxManager] Killed session: ${sessionName}`);
    } catch (e) {
      const errorMsg = e.stderr?.toString() || e.message || '';
      if (!errorMsg.includes("session not found") && !errorMsg.includes("no server running")) {
        throw new Error(`Failed to kill session: ${e.message}`);
      }
    }
  }

  /**
   * Destroy a session (alias for killSession)
   * @param {string} sessionName - Session name
   */
  destroySession(sessionName) {
    this.killSession(sessionName);
  }

  /**
   * Append data to output buffer
   */
  appendToBuffer(windowKey, data) {
    let buffer = this.outputBuffers.get(windowKey) || '';
    buffer += data;
    
    if (buffer.length > this.maxBufferSize) {
      buffer = buffer.slice(-this.maxBufferSize);
    }
    
    this.outputBuffers.set(windowKey, buffer);
  }

  /**
   * Get buffered output
   */
  getBuffer(sessionName, windowIndex) {
    const windowKey = this.getWindowKey(sessionName, windowIndex);
    return this.outputBuffers.get(windowKey) || '';
  }

  /**
   * Clear output buffer
   */
  clearBuffer(sessionName, windowIndex) {
    const windowKey = this.getWindowKey(sessionName, windowIndex);
    this.outputBuffers.set(windowKey, '');
  }

  /**
   * Add output handler
   */
  addOutputHandler(sessionName, windowIndex, handler) {
    const windowKey = this.getWindowKey(sessionName, windowIndex);
    if (!this.outputHandlers.has(windowKey)) {
      this.outputHandlers.set(windowKey, new Set());
    }
    this.outputHandlers.get(windowKey).add(handler);
    console.log(`[TmuxManager] Added handler for ${windowKey}`);
  }

  /**
   * Remove output handler
   */
  removeOutputHandler(sessionName, windowIndex, handler) {
    const windowKey = this.getWindowKey(sessionName, windowIndex);
    const handlers = this.outputHandlers.get(windowKey);
    if (handlers) {
      handlers.delete(handler);
      console.log(`[TmuxManager] Removed handler for ${windowKey}`);
    }
  }

  /**
   * Check if attached to a window
   */
  isAttached(sessionName, windowIndex) {
    const windowKey = this.getWindowKey(sessionName, windowIndex);
    return this.attachedWindows.has(windowKey);
  }

  /**
   * Get terminal info for API responses
   * @param {string} terminalId - Terminal ID
   * @param {string} projectPath - Project path for context
   * @returns {object|null}
   */
  getTerminalInfo(terminalId, projectPath) {
    const { sessionName, windowIndex } = this.parseTerminalId(terminalId);
    
    const sessions = this.listAllSessions();
    const session = sessions.find(s => s.name === sessionName);
    
    if (!session) {
      return null;
    }

    const windows = this.listWindows(sessionName);
    const window = windows.find(w => w.index === windowIndex);
    
    if (!window) {
      return null;
    }

    const windowKey = this.getWindowKey(sessionName, windowIndex);
    const attached = this.attachedWindows.get(windowKey);

    return {
      id: terminalId,
      sessionName,
      windowIndex,
      windowName: window.name,
      cwd: window.currentPath || projectPath,
      projectPath,
      createdAt: session.createdAt,
      active: true,
      source: 'tmux',
      attached: !!attached,
      windowCount: session.windowCount,
      pid: attached?.ptyProcess?.pid || null,
      cols: attached?.cols || 80,
      rows: attached?.rows || 24,
      projectName: this.extractProjectName(sessionName)
    };
  }

  /**
   * List all terminals (windows) for a project
   * @param {string} projectPath - Project path
   * @returns {Array<object>}
   */
  listTerminals(projectPath) {
    console.log(`[TmuxManager] listTerminals called with projectPath="${projectPath}"`);
    
    try {
      const sessionName = this.generateSessionName(projectPath);
      const session = this.listAllSessions().find(s => s.name === sessionName);
      
      if (!session) {
        console.log(`[TmuxManager] No session found for project`);
        return [];
      }

      const windows = this.listWindows(sessionName);
      
      const terminals = windows.map(window => {
        const terminalId = this.buildTerminalId(sessionName, window.index);
        const windowKey = this.getWindowKey(sessionName, window.index);
        const attached = this.attachedWindows.get(windowKey);

        return {
          id: terminalId,
          name: window.name || `Terminal ${window.index}`,
          sessionName,
          windowIndex: window.index,
          cwd: window.currentPath || projectPath,
          projectPath,
          createdAt: session.createdAt,
          active: true,
          source: 'tmux',
          attached: !!attached,
          windowCount: session.windowCount,
          pid: attached?.ptyProcess?.pid || null,
          cols: attached?.cols || 80,
          rows: attached?.rows || 24,
          projectName: session.projectName,
          activeCommand: null,
          lastCommand: null,
          exitCode: null
        };
      });
      
      console.log(`[TmuxManager] Returning ${terminals.length} terminals`);
      return terminals;
    } catch (error) {
      console.error(`[TmuxManager] Error in listTerminals:`, error);
      return [];
    }
  }

  /**
   * List all mobile terminals across all projects
   * @returns {Array<object>}
   */
  listAllMobileTerminals() {
    const allTerminals = [];
    const sessions = this.listAllSessions().filter(s => s.isMobileSession);
    
    for (const session of sessions) {
      const windows = this.listWindows(session.name);
      
      for (const window of windows) {
        const terminalId = this.buildTerminalId(session.name, window.index);
        const windowKey = this.getWindowKey(session.name, window.index);
        const attached = this.attachedWindows.get(windowKey);

        allTerminals.push({
          id: terminalId,
          name: window.name || `Terminal ${window.index}`,
          sessionName: session.name,
          windowIndex: window.index,
          cwd: window.currentPath || null,
          createdAt: session.createdAt,
          active: true,
          source: 'tmux',
          attached: !!attached,
          windowCount: session.windowCount,
          pid: attached?.ptyProcess?.pid || null,
          cols: attached?.cols || 80,
          rows: attached?.rows || 24,
          projectName: session.projectName
        });
      }
    }
    
    return allTerminals;
  }

  /**
   * Clean up all attached windows
   */
  cleanup() {
    for (const [windowKey, attached] of this.attachedWindows) {
      try {
        attached.ptyProcess.kill();
      } catch (error) {
        console.error(`[TmuxManager] Error killing attached PTY for ${windowKey}:`, error);
      }
    }
    this.attachedWindows.clear();
    this.outputHandlers.clear();
    this.outputBuffers.clear();
    console.log('[TmuxManager] Cleaned up all attached windows');
  }

  // ============ Legacy compatibility methods ============
  // These are kept for backward compatibility during migration

  /**
   * @deprecated Use parseTerminalId instead
   */
  getSessionNameFromId(terminalId) {
    const { sessionName } = this.parseTerminalId(terminalId);
    return sessionName;
  }

  /**
   * @deprecated Use createTerminal instead
   */
  createSession(options = {}) {
    console.warn('[TmuxManager] createSession is deprecated, use createTerminal instead');
    return this.createTerminal(options);
  }

  /**
   * @deprecated Use attachToWindow instead
   */
  attachToSession(sessionName, options = {}) {
    console.warn('[TmuxManager] attachToSession is deprecated, use attachToWindow instead');
    // Attach to window 0 of the session
    return this.attachToWindow(sessionName, 0, options);
  }

  /**
   * @deprecated Use detachFromWindow instead
   */
  detachFromSession(sessionName) {
    console.warn('[TmuxManager] detachFromSession is deprecated, use detachFromWindow instead');
    // Detach from window 0
    this.detachFromWindow(sessionName, 0);
  }

  /**
   * @deprecated Use writeToWindow instead
   */
  writeToSession(sessionName, data) {
    console.warn('[TmuxManager] writeToSession is deprecated, use writeToWindow instead');
    this.writeToWindow(sessionName, 0, data);
  }

  /**
   * @deprecated Use resizeWindow instead
   */
  resizeSession(sessionName, cols, rows) {
    console.warn('[TmuxManager] resizeSession is deprecated, use resizeWindow instead');
    this.resizeWindow(sessionName, 0, cols, rows);
  }
}

// Singleton instance
export const tmuxManager = new TmuxManager();
