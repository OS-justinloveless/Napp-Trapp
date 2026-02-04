import * as pty from 'node-pty';
import { execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Manages tmux sessions for mobile terminal access
 * 
 * Sessions are named: mobile-{projectDirName}-{timestamp}
 * This allows filtering by project and identifying mobile-created sessions.
 * 
 * Benefits:
 * - Sessions persist even when mobile app disconnects
 * - Sessions can be accessed from desktop via `tmux attach -t <session-name>`
 * - Multiple clients can attach to the same session
 */
export class TmuxManager {
  constructor() {
    // Map of session name to attached PTY processes
    this.attachedSessions = new Map(); // sessionName -> { ptyProcess, handlers, buffer }
    
    // Event handlers for terminal output
    this.outputHandlers = new Map(); // sessionName -> Set of callbacks
    
    // Output buffer for each attached session
    this.outputBuffers = new Map(); // sessionName -> string
    this.maxBufferSize = 64 * 1024; // 64KB max buffer
    
    console.log('[TmuxManager] Initialized');
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
   * Format: mobile-{projectDirName}-{timestamp}
   * @param {string} projectPath - The project path
   * @returns {string}
   */
  generateSessionName(projectPath) {
    const projectDirName = path.basename(projectPath)
      .replace(/[^a-zA-Z0-9_-]/g, '-') // Sanitize for tmux
      .substring(0, 30); // Keep it reasonable length
    const timestamp = Date.now();
    return `mobile-${projectDirName}-${timestamp}`;
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
    // Remove 'mobile-' prefix and timestamp suffix
    const parts = sessionName.substring(7).split('-');
    if (parts.length < 2) {
      return null;
    }
    // Remove the last part (timestamp)
    parts.pop();
    return parts.join('-');
  }

  /**
   * Check if a session belongs to a project
   * @param {string} sessionName - The tmux session name
   * @param {string} projectPath - The project path
   * @returns {boolean}
   */
  sessionBelongsToProject(sessionName, projectPath) {
    if (!sessionName.startsWith('mobile-')) {
      return false;
    }
    const projectDirName = path.basename(projectPath)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .substring(0, 30);
    const expectedPrefix = `mobile-${projectDirName}-`;
    const belongs = sessionName.startsWith(expectedPrefix);
    
    console.log(`[TmuxManager] sessionBelongsToProject: session="${sessionName}", projectPath="${projectPath}", projectDirName="${projectDirName}", expectedPrefix="${expectedPrefix}", belongs=${belongs}`);
    
    return belongs;
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
      // tmux list-sessions format: name: windows (created date) (dimensions) (attached?)
      // Use a custom format for easier parsing
      // Note: pane_current_path might not be available in all tmux versions, use session_path as fallback
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
          createdAt: parseInt(created, 10) * 1000, // Convert to milliseconds
          windowCount: parseInt(windows, 10),
          attached: attached === '1',
          currentPath: null, // Will be filled in if needed
          isMobileSession: name.startsWith('mobile-'),
          projectName: this.extractProjectName(name)
        };
      });

      console.log(`[TmuxManager] Found ${sessions.length} total sessions:`, sessions.map(s => s.name));
      return sessions;
    } catch (e) {
      // Check stderr for common messages
      const errorMsg = e.stderr?.toString() || e.message || '';
      
      // No sessions exist - this is normal
      if (errorMsg.includes('no server running') || 
          errorMsg.includes('no sessions') ||
          errorMsg.includes('error connecting')) {
        console.log('[TmuxManager] No tmux server or sessions');
        return [];
      }
      
      console.error('[TmuxManager] Error listing sessions:', errorMsg);
      console.error('[TmuxManager] Full error:', e);
      return [];
    }
  }

  /**
   * List tmux sessions for a specific project
   * @param {string} projectPath - The project path
   * @returns {Array<object>} - Array of session info
   */
  listSessionsForProject(projectPath) {
    console.log(`[TmuxManager] listSessionsForProject called with projectPath="${projectPath}"`);
    const allSessions = this.listAllSessions();
    console.log(`[TmuxManager] All sessions: ${allSessions.map(s => s.name).join(', ') || 'none'}`);
    
    const filtered = allSessions.filter(session => 
      this.sessionBelongsToProject(session.name, projectPath)
    );
    
    console.log(`[TmuxManager] Filtered sessions for project: ${filtered.map(s => s.name).join(', ') || 'none'}`);
    return filtered;
  }

  /**
   * Create a new tmux session
   * @param {object} options - Options
   * @param {string} options.projectPath - Project path (for naming and cwd)
   * @param {string} options.cwd - Working directory (defaults to projectPath)
   * @param {string} options.name - Custom session name (optional, auto-generated if not provided)
   * @param {string} options.shell - Shell to use (defaults to user's shell)
   * @returns {object} - Session info
   */
  createSession(options = {}) {
    if (!this.isTmuxAvailable()) {
      throw new Error('tmux is not installed or not available in PATH');
    }

    const projectPath = options.projectPath || os.homedir();
    const cwd = options.cwd || projectPath;
    const sessionName = options.name || this.generateSessionName(projectPath);
    const shell = options.shell || process.env.SHELL || '/bin/zsh';

    // Verify cwd exists
    if (!fs.existsSync(cwd)) {
      throw new Error(`Working directory does not exist: ${cwd}`);
    }

    // Create the tmux session (detached initially)
    try {
      execSync(
        `tmux new-session -d -s "${sessionName}" -c "${cwd}"`,
        { encoding: 'utf-8', cwd }
      );
      console.log(`[TmuxManager] Created session: ${sessionName} in ${cwd}`);
    } catch (e) {
      if (e.message.includes('duplicate session')) {
        throw new Error(`Session ${sessionName} already exists`);
      }
      throw new Error(`Failed to create tmux session: ${e.message}`);
    }

    // Get session info
    const sessions = this.listAllSessions();
    const session = sessions.find(s => s.name === sessionName);

    return {
      id: `tmux-${sessionName}`,
      name: sessionName,
      cwd,
      projectPath,
      createdAt: session?.createdAt || Date.now(),
      active: true,
      source: 'tmux',
      attached: false,
      windowCount: session?.windowCount || 1,
      projectName: this.extractProjectName(sessionName)
    };
  }

  /**
   * Attach to a tmux session via PTY
   * This spawns a PTY running `tmux attach` for real-time I/O
   * @param {string} sessionName - The tmux session name
   * @param {object} options - Options
   * @param {number} options.cols - Terminal columns (default 80)
   * @param {number} options.rows - Terminal rows (default 24)
   * @returns {object} - Attached session info with handlers
   */
  attachToSession(sessionName, options = {}) {
    if (!this.isTmuxAvailable()) {
      throw new Error('tmux is not installed');
    }

    // Check if session exists
    const sessions = this.listAllSessions();
    const session = sessions.find(s => s.name === sessionName);
    if (!session) {
      throw new Error(`Session ${sessionName} not found`);
    }

    // Check if already attached from this manager
    if (this.attachedSessions.has(sessionName)) {
      console.log(`[TmuxManager] Already attached to ${sessionName}, returning existing`);
      return this.attachedSessions.get(sessionName);
    }

    const cols = options.cols || 80;
    const rows = options.rows || 24;

    // Spawn PTY with tmux attach
    const ptyProcess = pty.spawn('tmux', ['attach', '-t', sessionName], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: session.currentPath || os.homedir(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    });

    const attachedSession = {
      sessionName,
      ptyProcess,
      cols,
      rows,
      attachedAt: Date.now()
    };

    this.attachedSessions.set(sessionName, attachedSession);
    this.outputHandlers.set(sessionName, new Set());
    this.outputBuffers.set(sessionName, '');

    // Handle PTY output
    ptyProcess.onData((data) => {
      this.appendToBuffer(sessionName, data);
      
      const handlers = this.outputHandlers.get(sessionName);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(data);
          } catch (error) {
            console.error(`[TmuxManager] Error in output handler for ${sessionName}:`, error);
          }
        }
      }
    });

    // Handle PTY exit (detached from session)
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`[TmuxManager] Detached from ${sessionName}, exit: ${exitCode}, signal: ${signal}`);
      this.attachedSessions.delete(sessionName);
      // Keep handlers and buffer for potential reattach
    });

    console.log(`[TmuxManager] Attached to session: ${sessionName}`);

    return {
      id: `tmux-${sessionName}`,
      name: sessionName,
      pid: ptyProcess.pid,
      cols,
      rows,
      attached: true,
      source: 'tmux'
    };
  }

  /**
   * Detach from a tmux session (close the PTY, session continues running)
   * @param {string} sessionName - The tmux session name
   */
  detachFromSession(sessionName) {
    const attached = this.attachedSessions.get(sessionName);
    if (!attached) {
      console.log(`[TmuxManager] Not attached to ${sessionName}`);
      return;
    }

    // Send Ctrl+B, D to detach gracefully
    attached.ptyProcess.write('\x02d');
    
    // Give it a moment, then kill if still running
    setTimeout(() => {
      if (this.attachedSessions.has(sessionName)) {
        attached.ptyProcess.kill();
        this.attachedSessions.delete(sessionName);
      }
    }, 500);

    console.log(`[TmuxManager] Detached from session: ${sessionName}`);
  }

  /**
   * Write data to an attached session
   * @param {string} sessionName - The tmux session name
   * @param {string} data - Data to write
   */
  writeToSession(sessionName, data) {
    const attached = this.attachedSessions.get(sessionName);
    if (!attached) {
      throw new Error(`Not attached to session ${sessionName}`);
    }
    attached.ptyProcess.write(data);
  }

  /**
   * Resize an attached session
   * @param {string} sessionName - The tmux session name
   * @param {number} cols - Number of columns
   * @param {number} rows - Number of rows
   */
  resizeSession(sessionName, cols, rows) {
    const attached = this.attachedSessions.get(sessionName);
    if (!attached) {
      throw new Error(`Not attached to session ${sessionName}`);
    }
    attached.ptyProcess.resize(cols, rows);
    attached.cols = cols;
    attached.rows = rows;
  }

  /**
   * Kill a tmux session entirely
   * @param {string} sessionName - The tmux session name
   */
  killSession(sessionName) {
    // Detach first if attached
    if (this.attachedSessions.has(sessionName)) {
      const attached = this.attachedSessions.get(sessionName);
      attached.ptyProcess.kill();
      this.attachedSessions.delete(sessionName);
    }

    // Kill the tmux session
    try {
      execSync(`tmux kill-session -t "${sessionName}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      console.log(`[TmuxManager] Killed session: ${sessionName}`);
    } catch (e) {
      if (!e.message.includes("session not found") && !e.message.includes("no server running")) {
        throw new Error(`Failed to kill session: ${e.message}`);
      }
    }

    // Clean up handlers and buffer
    this.outputHandlers.delete(sessionName);
    this.outputBuffers.delete(sessionName);
  }

  /**
   * Append data to the output buffer for a session
   * @param {string} sessionName - Session name
   * @param {string} data - Data to append
   */
  appendToBuffer(sessionName, data) {
    let buffer = this.outputBuffers.get(sessionName) || '';
    buffer += data;
    
    if (buffer.length > this.maxBufferSize) {
      buffer = buffer.slice(-this.maxBufferSize);
    }
    
    this.outputBuffers.set(sessionName, buffer);
  }

  /**
   * Get the buffered output for a session
   * @param {string} sessionName - Session name
   * @returns {string}
   */
  getBuffer(sessionName) {
    return this.outputBuffers.get(sessionName) || '';
  }

  /**
   * Clear the output buffer for a session
   * @param {string} sessionName - Session name
   */
  clearBuffer(sessionName) {
    this.outputBuffers.set(sessionName, '');
  }

  /**
   * Add an output handler for a session
   * @param {string} sessionName - Session name
   * @param {function} handler - Callback function
   */
  addOutputHandler(sessionName, handler) {
    if (!this.outputHandlers.has(sessionName)) {
      this.outputHandlers.set(sessionName, new Set());
    }
    const handlers = this.outputHandlers.get(sessionName);
    handlers.add(handler);
    console.log(`[TmuxManager] Added handler for ${sessionName}, total: ${handlers.size}`);
  }

  /**
   * Remove an output handler for a session
   * @param {string} sessionName - Session name
   * @param {function} handler - The handler to remove
   */
  removeOutputHandler(sessionName, handler) {
    const handlers = this.outputHandlers.get(sessionName);
    if (handlers) {
      handlers.delete(handler);
      console.log(`[TmuxManager] Removed handler for ${sessionName}, remaining: ${handlers.size}`);
    }
  }

  /**
   * Check if a terminal ID is a tmux session
   * @param {string} terminalId - Terminal ID (format: tmux-{sessionName})
   * @returns {boolean}
   */
  isTmuxTerminal(terminalId) {
    return terminalId.startsWith('tmux-');
  }

  /**
   * Extract session name from terminal ID
   * @param {string} terminalId - Terminal ID
   * @returns {string}
   */
  getSessionNameFromId(terminalId) {
    if (!this.isTmuxTerminal(terminalId)) {
      throw new Error(`Not a tmux terminal ID: ${terminalId}`);
    }
    return terminalId.substring(5); // Remove 'tmux-' prefix
  }

  /**
   * Check if currently attached to a session
   * @param {string} sessionName - Session name
   * @returns {boolean}
   */
  isAttached(sessionName) {
    return this.attachedSessions.has(sessionName);
  }

  /**
   * Get terminal info for API responses
   * @param {string} sessionName - Session name
   * @param {string} projectPath - Project path for context
   * @returns {object|null}
   */
  getTerminalInfo(sessionName, projectPath) {
    const sessions = this.listAllSessions();
    const session = sessions.find(s => s.name === sessionName);
    
    if (!session) {
      return null;
    }

    const attached = this.attachedSessions.get(sessionName);

    return {
      id: `tmux-${sessionName}`,
      name: session.name,
      cwd: session.currentPath || projectPath,
      projectPath,
      createdAt: session.createdAt,
      active: true, // tmux sessions are always "active"
      source: 'tmux',
      attached: !!attached,
      windowCount: session.windowCount,
      pid: attached?.ptyProcess?.pid || null,
      cols: attached?.cols || 80,
      rows: attached?.rows || 24,
      projectName: session.projectName
    };
  }

  /**
   * List terminals formatted for API response
   * @param {string} projectPath - Filter by project path
   * @returns {Array<object>}
   */
  listTerminals(projectPath) {
    console.log(`[TmuxManager] listTerminals called with projectPath="${projectPath}"`);
    
    try {
      const sessions = projectPath 
        ? this.listSessionsForProject(projectPath)
        : this.listAllSessions().filter(s => s.isMobileSession);

      const terminals = sessions.map(session => ({
        id: `tmux-${session.name}`,
        name: session.name,
        cwd: session.currentPath || projectPath,
        projectPath,
        createdAt: session.createdAt,
        active: true,
        source: 'tmux',
        attached: this.isAttached(session.name),
        windowCount: session.windowCount,
        pid: this.attachedSessions.get(session.name)?.ptyProcess?.pid || null,
        cols: this.attachedSessions.get(session.name)?.cols || 80,
        rows: this.attachedSessions.get(session.name)?.rows || 24,
        projectName: session.projectName,
        activeCommand: null,
        lastCommand: null,
        exitCode: null
      }));
      
      console.log(`[TmuxManager] Returning ${terminals.length} terminals`);
      return terminals;
    } catch (error) {
      console.error(`[TmuxManager] Error in listTerminals:`, error);
      return [];
    }
  }

  /**
   * Clean up all attached sessions
   */
  cleanup() {
    for (const [sessionName, attached] of this.attachedSessions) {
      try {
        attached.ptyProcess.kill();
      } catch (error) {
        console.error(`[TmuxManager] Error killing attached PTY for ${sessionName}:`, error);
      }
    }
    this.attachedSessions.clear();
    this.outputHandlers.clear();
    console.log('[TmuxManager] Cleaned up all attached sessions');
  }
}

// Singleton instance
export const tmuxManager = new TmuxManager();
