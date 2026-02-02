import { ptyManager } from './PTYManager.js';
import { getCLIAdapter } from './CLIAdapter.js';
import { LogManager } from './LogManager.js';
import { StreamParser, ContentBlockType, createContentBlock } from './OutputParser.js';
import { MobileChatStore } from './MobileChatStore.js';

const logger = LogManager.getInstance();
const chatStore = MobileChatStore.getInstance();

/**
 * CLISessionManager - Manages on-demand PTY sessions for AI CLI tools
 * 
 * Key features:
 * - Lazy PTY spawning: Sessions only created when user sends a message
 * - Automatic cleanup: PTY killed after inactivity timeout
 * - Session resume: CLI tools use session ID to restore conversation history
 * - Output streaming: Real-time output relayed to WebSocket clients
 * 
 * The conversation ID is used as the CLI session ID, so CLI tools
 * (claude, cursor-agent, etc.) can persist and resume conversations
 * using their native session storage.
 */

// Singleton instance
let _instance = null;

// Default configuration
const DEFAULT_INACTIVITY_TIMEOUT_MS = 60 * 1000; // 60 seconds
const MAX_CONCURRENT_SESSIONS = 20;

export class CLISessionManager {
  constructor(options = {}) {
    this.inactivityTimeout = options.inactivityTimeoutMs || DEFAULT_INACTIVITY_TIMEOUT_MS;
    this.maxConcurrentSessions = options.maxConcurrentSessions || MAX_CONCURRENT_SESSIONS;
    
    // Active sessions: conversationId -> { ptyId, tool, workspacePath, timer, adapter, parser, createdAt }
    this.activeSessions = new Map();
    
    // Output handlers per session: conversationId -> Set of callback functions
    // Handlers receive (contentBlocks[], rawData, metadata)
    this.outputHandlers = new Map();
    
    // Pending output buffer per session (for clients that connect after output starts)
    // Now stores parsed content blocks
    this.outputBuffers = new Map();
    this.maxBufferBlocks = 100; // Keep last 100 blocks per session
    
    // Also keep raw buffer for fallback
    this.rawBuffers = new Map();
    this.maxRawBufferSize = 32 * 1024; // 32KB per session
    
    // Phase 4: Load configuration from store asynchronously
    this.configLoaded = false;
    this.loadConfig();
    
    logger.info('CLISessionManager', 'Initialized', {
      inactivityTimeout: this.inactivityTimeout,
      maxConcurrentSessions: this.maxConcurrentSessions
    });
  }
  
  /**
   * Load configuration from persistent store
   */
  async loadConfig() {
    try {
      const config = await chatStore.getSessionConfig();
      this.inactivityTimeout = config.inactivityTimeoutMs || DEFAULT_INACTIVITY_TIMEOUT_MS;
      this.maxConcurrentSessions = config.maxConcurrentSessions || MAX_CONCURRENT_SESSIONS;
      this.configLoaded = true;
      
      logger.info('CLISessionManager', 'Config loaded from store', {
        inactivityTimeout: this.inactivityTimeout,
        maxConcurrentSessions: this.maxConcurrentSessions
      });
    } catch (err) {
      logger.error('CLISessionManager', 'Failed to load config', { error: err.message });
    }
  }
  
  /**
   * Update session configuration
   * @param {Object} config - Configuration options
   */
  async updateConfig(config) {
    const updated = await chatStore.updateSessionConfig(config);
    
    // Apply to current instance
    if (updated.inactivityTimeoutMs) {
      this.inactivityTimeout = updated.inactivityTimeoutMs;
    }
    if (updated.maxConcurrentSessions) {
      this.maxConcurrentSessions = updated.maxConcurrentSessions;
    }
    
    logger.info('CLISessionManager', 'Config updated', updated);
    return updated;
  }
  
  /**
   * Get current configuration
   */
  async getConfig() {
    return await chatStore.getSessionConfig();
  }
  
  /**
   * Get the singleton instance
   */
  static getInstance() {
    if (!_instance) {
      _instance = new CLISessionManager();
    }
    return _instance;
  }
  
  /**
   * Get or create a PTY session for a conversation
   * 
   * @param {string} conversationId - The conversation/session ID
   * @param {string} tool - CLI tool name ('claude', 'cursor-agent', 'gemini')
   * @param {string} workspacePath - Path to the project workspace
   * @param {object} options - Additional options (model, mode)
   * @returns {Promise<object>} Session info { ptyId, isNew, tool }
   */
  async getOrCreate(conversationId, tool, workspacePath, options = {}) {
    // Check if session already exists and is alive
    const existing = this.activeSessions.get(conversationId);
    if (existing) {
      const ptyInfo = ptyManager.getTerminal(existing.ptyId);
      if (ptyInfo && ptyInfo.active) {
        // Reset inactivity timer
        this.resetTimer(conversationId);
        logger.debug('CLISessionManager', 'Reusing existing session', { conversationId, ptyId: existing.ptyId });
        return { ptyId: existing.ptyId, isNew: false, tool: existing.tool };
      }
      // PTY died, clean up stale entry
      this.cleanupSession(conversationId);
    }
    
    // Check concurrent session limit
    if (this.activeSessions.size >= this.maxConcurrentSessions) {
      // Try to evict oldest inactive session
      const evicted = this.evictOldestSession();
      if (!evicted) {
        throw new Error(`Maximum concurrent sessions (${this.maxConcurrentSessions}) reached. Please close some conversations.`);
      }
    }
    
    // Get CLI adapter and build interactive args
    const adapter = getCLIAdapter(tool);
    
    // Check if CLI is available
    const isAvailable = await adapter.isAvailable();
    
    if (!isAvailable) {
      throw new Error(`${adapter.getDisplayName()} CLI not found. ${adapter.getInstallInstructions()}`);
    }
    
    // Build interactive args
    const args = adapter.buildInteractiveArgs({
      sessionId: conversationId,
      workspacePath,
      model: options.model,
      mode: options.mode
    });
    
    // Use resolved path (absolute path) instead of command name
    // This is needed because PTYManager.spawnTerminal uses fs.accessSync which requires an absolute path
    const executable = adapter.getResolvedExecutable();
    
    logger.info('CLISessionManager', 'Spawning new session', {
      conversationId,
      tool,
      executable,
      workspacePath
    });
    
    // Spawn PTY with CLI as the shell
    const ptyInfo = ptyManager.spawnTerminal({
      shell: executable,
      args,
      cwd: workspacePath || process.env.HOME,
      cols: 120,
      rows: 40,
      env: {
        // Ensure CLI tools run in non-interactive mode where appropriate
        TERM: 'xterm-256color',
        FORCE_COLOR: '1'
      }
    });
    
    // Create stream parser for this session
    const parser = new StreamParser(adapter);
    
    // Store session info
    this.activeSessions.set(conversationId, {
      ptyId: ptyInfo.id,
      tool,
      adapter,
      parser,
      workspacePath,
      model: options.model,
      mode: options.mode,
      timer: null,
      createdAt: Date.now()
    });
    
    // Initialize output buffers
    this.outputBuffers.set(conversationId, []);
    this.rawBuffers.set(conversationId, '');
    
    // Set up output handling (must be after session is stored)
    this.setupOutputHandler(conversationId, ptyInfo.id);
    
    // Start inactivity timer
    this.resetTimer(conversationId);
    
    logger.info('CLISessionManager', 'Session created', {
      conversationId,
      ptyId: ptyInfo.id,
      tool
    });
    
    // Phase 4: Update session state in store
    try {
      await chatStore.updateSessionState(conversationId, 'active');
    } catch (err) {
      logger.error('CLISessionManager', 'Failed to update session state', { error: err.message });
    }
    
    return { ptyId: ptyInfo.id, isNew: true, tool };
  }
  
  /**
   * Send input to a conversation's CLI session
   * 
   * @param {string} conversationId - The conversation ID
   * @param {string} input - Text to send to the CLI
   */
  async sendInput(conversationId, input) {
    const session = this.activeSessions.get(conversationId);
    if (!session) {
      throw new Error(`No active session for conversation ${conversationId}`);
    }
    
    const ptyInfo = ptyManager.getTerminal(session.ptyId);
    if (!ptyInfo || !ptyInfo.active) {
      this.cleanupSession(conversationId);
      throw new Error(`Session for conversation ${conversationId} is no longer active`);
    }
    
    // Reset inactivity timer on input
    this.resetTimer(conversationId);
    
    // Write input to PTY (add newline if not present)
    const inputWithNewline = input.endsWith('\n') ? input : input + '\n';
    ptyManager.writeToTerminal(session.ptyId, inputWithNewline);
    
    logger.debug('CLISessionManager', 'Input sent', {
      conversationId,
      inputLength: input.length
    });
  }
  
  /**
   * Attach an output handler to receive streaming output
   * 
   * @param {string} conversationId - The conversation ID
   * @param {function} handler - Callback function(contentBlocks, rawData, metadata)
   * @returns {function} Unsubscribe function
   */
  attachOutputHandler(conversationId, handler) {
    if (!this.outputHandlers.has(conversationId)) {
      this.outputHandlers.set(conversationId, new Set());
    }
    
    this.outputHandlers.get(conversationId).add(handler);
    
    // Send buffered blocks to new handler
    const blockBuffer = this.outputBuffers.get(conversationId);
    const rawBuffer = this.rawBuffers.get(conversationId);
    
    if ((blockBuffer && blockBuffer.length > 0) || (rawBuffer && rawBuffer.length > 0)) {
      try {
        handler(blockBuffer || [], rawBuffer || '', { isBuffer: true });
      } catch (err) {
        logger.error('CLISessionManager', 'Error sending buffer to handler', { error: err.message });
      }
    }
    
    logger.debug('CLISessionManager', 'Output handler attached', {
      conversationId,
      handlerCount: this.outputHandlers.get(conversationId).size
    });
    
    // Return unsubscribe function
    return () => {
      const handlers = this.outputHandlers.get(conversationId);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }
  
  /**
   * Detach an output handler
   * 
   * @param {string} conversationId - The conversation ID
   * @param {function} handler - The handler to remove
   */
  detachOutputHandler(conversationId, handler) {
    const handlers = this.outputHandlers.get(conversationId);
    if (handlers) {
      handlers.delete(handler);
    }
  }
  
  /**
   * Terminate a session manually (user closes conversation)
   * 
   * @param {string} conversationId - The conversation ID
   * @param {string} reason - Reason for termination (default: 'terminated')
   */
  async terminate(conversationId, reason = 'terminated') {
    const session = this.activeSessions.get(conversationId);
    if (!session) {
      return false;
    }
    
    logger.info('CLISessionManager', 'Terminating session', { conversationId, reason });
    
    // Clear timer
    if (session.timer) {
      clearTimeout(session.timer);
    }
    
    // Kill PTY
    try {
      ptyManager.killTerminal(session.ptyId);
    } catch (err) {
      logger.error('CLISessionManager', 'Error killing PTY', { conversationId, error: err.message });
    }
    
    // Notify handlers that session ended
    const endBlock = createContentBlock(ContentBlockType.SESSION_END, { reason });
    this.notifyHandlers(conversationId, [endBlock], null, { sessionEnded: true });
    
    // Phase 4: Update session state in store (session can be resumed later)
    try {
      await chatStore.updateSessionState(conversationId, 'suspended', reason);
    } catch (err) {
      logger.error('CLISessionManager', 'Failed to update session state', { error: err.message });
    }
    
    // Cleanup
    this.activeSessions.delete(conversationId);
    this.outputHandlers.delete(conversationId);
    this.outputBuffers.delete(conversationId);
    
    return true;
  }
  
  /**
   * Check if a session is currently active (PTY running)
   * 
   * @param {string} conversationId - The conversation ID
   * @returns {boolean}
   */
  isActive(conversationId) {
    const session = this.activeSessions.get(conversationId);
    if (!session) {
      return false;
    }
    
    const ptyInfo = ptyManager.getTerminal(session.ptyId);
    return ptyInfo && ptyInfo.active;
  }
  
  /**
   * Get session info
   * 
   * @param {string} conversationId - The conversation ID
   * @returns {object|null} Session info or null if not active
   */
  getSession(conversationId) {
    const session = this.activeSessions.get(conversationId);
    if (!session) {
      return null;
    }
    
    const ptyInfo = ptyManager.getTerminal(session.ptyId);
    const isAlive = ptyInfo && ptyInfo.active;
    
    return {
      conversationId,
      ptyId: session.ptyId,
      tool: session.tool,
      workspacePath: session.workspacePath,
      model: session.model,
      mode: session.mode,
      isActive: isAlive,
      createdAt: session.createdAt,
      uptime: Date.now() - session.createdAt
    };
  }
  
  /**
   * Get all active session IDs
   * 
   * @returns {string[]} Array of conversation IDs with active sessions
   */
  getActiveSessions() {
    const active = [];
    for (const [conversationId, session] of this.activeSessions) {
      const ptyInfo = ptyManager.getTerminal(session.ptyId);
      if (ptyInfo && ptyInfo.active) {
        active.push(conversationId);
      }
    }
    return active;
  }
  
  /**
   * Get session statistics
   */
  getStats() {
    return {
      activeSessions: this.activeSessions.size,
      maxConcurrentSessions: this.maxConcurrentSessions,
      inactivityTimeoutMs: this.inactivityTimeout
    };
  }
  
  // ============ Private Methods ============
  
  /**
   * Set up PTY output handler for a session
   */
  setupOutputHandler(conversationId, ptyId) {
    const handler = (data) => {
      const session = this.activeSessions.get(conversationId);
      if (!session) return;
      
      // Buffer raw output
      this.appendToRawBuffer(conversationId, data);
      
      // Reset timer on output (session is active)
      this.resetTimer(conversationId);
      
      // Parse the output into content blocks
      let contentBlocks = [];
      try {
        contentBlocks = session.parser.parse(data);
      } catch (err) {
        logger.error('CLISessionManager', 'Parse error', { conversationId, error: err.message });
        // Fallback to raw block
        contentBlocks = [createContentBlock(ContentBlockType.RAW, { content: data })];
      }
      
      // Buffer parsed blocks
      if (contentBlocks.length > 0) {
        this.appendToBlockBuffer(conversationId, contentBlocks);
      }
      
      // Notify all attached handlers with both parsed and raw
      this.notifyHandlers(conversationId, contentBlocks, data, { isBuffer: false });
    };
    
    ptyManager.addOutputHandler(ptyId, handler);
    
    // Store reference for cleanup
    const session = this.activeSessions.get(conversationId);
    if (session) {
      session.ptyOutputHandler = handler;
    }
  }
  
  /**
   * Notify all output handlers for a session
   * @param {string} conversationId
   * @param {Array} contentBlocks - Parsed content blocks
   * @param {string|null} rawData - Raw PTY output (null for session events)
   * @param {Object} metadata - Additional metadata
   */
  notifyHandlers(conversationId, contentBlocks, rawData, metadata) {
    const handlers = this.outputHandlers.get(conversationId);
    if (!handlers) return;
    
    for (const handler of handlers) {
      try {
        handler(contentBlocks, rawData, metadata);
      } catch (err) {
        logger.error('CLISessionManager', 'Output handler error', {
          conversationId,
          error: err.message
        });
      }
    }
  }
  
  /**
   * Append content blocks to buffer
   */
  appendToBlockBuffer(conversationId, blocks) {
    let buffer = this.outputBuffers.get(conversationId) || [];
    buffer = buffer.concat(blocks);
    
    // Trim if exceeds max blocks (keep the end)
    if (buffer.length > this.maxBufferBlocks) {
      buffer = buffer.slice(-this.maxBufferBlocks);
    }
    
    this.outputBuffers.set(conversationId, buffer);
  }
  
  /**
   * Append raw data to buffer
   */
  appendToRawBuffer(conversationId, data) {
    let buffer = this.rawBuffers.get(conversationId) || '';
    buffer += data;
    
    // Trim if exceeds max size (keep the end)
    if (buffer.length > this.maxRawBufferSize) {
      buffer = buffer.slice(-this.maxRawBufferSize);
    }
    
    this.rawBuffers.set(conversationId, buffer);
  }
  
  /**
   * Reset the inactivity timer for a session
   */
  resetTimer(conversationId) {
    const session = this.activeSessions.get(conversationId);
    if (!session) return;
    
    // Clear existing timer
    if (session.timer) {
      clearTimeout(session.timer);
    }
    
    // Set new timer
    session.timer = setTimeout(() => {
      this.onInactivityTimeout(conversationId);
    }, this.inactivityTimeout);
  }
  
  /**
   * Handle inactivity timeout - kill the PTY but preserve CLI session
   */
  async onInactivityTimeout(conversationId) {
    const session = this.activeSessions.get(conversationId);
    if (!session) return;
    
    logger.info('CLISessionManager', 'Session inactivity timeout', { conversationId });
    
    // Notify handlers before cleanup
    const suspendBlock = createContentBlock(ContentBlockType.SESSION_END, { 
      reason: 'inactivity',
      suspended: true 
    });
    this.notifyHandlers(conversationId, [suspendBlock], null, { 
      sessionSuspended: true,
      reason: 'inactivity'
    });
    
    // Phase 4: Update session state in store
    try {
      await chatStore.updateSessionState(conversationId, 'suspended', 'inactivity');
    } catch (err) {
      logger.error('CLISessionManager', 'Failed to update session state', { error: err.message });
    }
    
    // Kill PTY (CLI's session files remain on disk)
    try {
      if (session.ptyOutputHandler) {
        ptyManager.removeOutputHandler(session.ptyId, session.ptyOutputHandler);
      }
      ptyManager.killTerminal(session.ptyId);
    } catch (err) {
      logger.error('CLISessionManager', 'Error killing PTY on timeout', { 
        conversationId, 
        error: err.message 
      });
    }
    
    // Flush parser before cleanup
    if (session.parser) {
      try {
        session.parser.flush();
      } catch (err) {
        // Ignore
      }
    }
    
    // Cleanup internal state
    this.activeSessions.delete(conversationId);
    this.outputHandlers.delete(conversationId);
    this.outputBuffers.delete(conversationId);
    this.rawBuffers.delete(conversationId);
  }
  
  /**
   * Clean up a stale session entry
   */
  cleanupSession(conversationId) {
    const session = this.activeSessions.get(conversationId);
    if (!session) return;
    
    if (session.timer) {
      clearTimeout(session.timer);
    }
    
    if (session.ptyOutputHandler) {
      try {
        ptyManager.removeOutputHandler(session.ptyId, session.ptyOutputHandler);
      } catch (err) {
        // Ignore - PTY might already be dead
      }
    }
    
    // Flush parser
    if (session.parser) {
      try {
        session.parser.flush();
      } catch (err) {
        // Ignore
      }
    }
    
    this.activeSessions.delete(conversationId);
    this.outputHandlers.delete(conversationId);
    this.outputBuffers.delete(conversationId);
    this.rawBuffers.delete(conversationId);
  }
  
  /**
   * Evict the oldest session to make room for a new one
   * @returns {boolean} True if a session was evicted
   */
  evictOldestSession() {
    let oldest = null;
    let oldestTime = Infinity;
    
    for (const [conversationId, session] of this.activeSessions) {
      if (session.createdAt < oldestTime) {
        oldest = conversationId;
        oldestTime = session.createdAt;
      }
    }
    
    if (oldest) {
      logger.warn('CLISessionManager', 'Evicting oldest session', { conversationId: oldest });
      this.terminate(oldest);
      return true;
    }
    
    return false;
  }
  
  /**
   * Clean up all sessions (for shutdown)
   */
  async cleanup() {
    logger.info('CLISessionManager', 'Cleaning up all sessions');
    
    for (const conversationId of this.activeSessions.keys()) {
      await this.terminate(conversationId, 'server_shutdown');
    }
    
    // Mark all remaining active sessions as suspended
    try {
      const count = await chatStore.suspendAllSessions();
      if (count > 0) {
        logger.info('CLISessionManager', `Marked ${count} sessions as suspended`);
      }
    } catch (err) {
      logger.error('CLISessionManager', 'Failed to suspend sessions', { error: err.message });
    }
  }
  
  // ============ Phase 4: Session Resume and Discovery ============
  
  /**
   * Get all conversations with resumable sessions
   * @returns {Promise<Array>} Conversations that can be resumed
   */
  async getResumableSessions() {
    try {
      return await chatStore.getSuspendedSessions();
    } catch (err) {
      logger.error('CLISessionManager', 'Failed to get resumable sessions', { error: err.message });
      return [];
    }
  }
  
  /**
   * Get recently used sessions (for "Recent" section in app)
   * @param {number} hours - Number of hours to look back
   * @returns {Promise<Array>} Recently used conversations
   */
  async getRecentSessions(hours = 24) {
    try {
      return await chatStore.getRecentSessions(hours);
    } catch (err) {
      logger.error('CLISessionManager', 'Failed to get recent sessions', { error: err.message });
      return [];
    }
  }
  
  /**
   * Check if a conversation can be resumed
   * @param {string} conversationId - The conversation ID
   * @returns {Promise<boolean>}
   */
  async canResume(conversationId) {
    try {
      return await chatStore.isResumable(conversationId);
    } catch (err) {
      return false;
    }
  }
}

// Export singleton getter
export const cliSessionManager = CLISessionManager.getInstance();
