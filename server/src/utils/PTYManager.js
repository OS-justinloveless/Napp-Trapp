import * as pty from 'node-pty';
import os from 'os';
import path from 'path';
import fs from 'fs';

console.log('[PTYManager] node-pty loaded successfully');

/**
 * Manages our own PTY (pseudo-terminal) sessions
 * These are fully controlled terminal sessions, separate from Cursor IDE terminals
 */
export class PTYManager {
  constructor() {
    // Map of terminal ID to PTY process and metadata
    this.terminals = new Map();
    this.nextId = 1;
    
    // Event handlers for terminal output
    this.outputHandlers = new Map(); // terminalId -> Set of callbacks
    
    // Output buffer for each terminal (stores recent output for replay on reconnect)
    this.outputBuffers = new Map(); // terminalId -> string
    this.maxBufferSize = 64 * 1024; // 64KB max buffer per terminal
    
    console.log('[PTYManager] Initialized');
  }

  /**
   * Get the default shell for the current OS
   */
  getDefaultShell() {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    
    // Try shells in order of preference
    const shells = [
      process.env.SHELL,
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh'
    ].filter(Boolean);
    
    for (const shell of shells) {
      try {
        fs.accessSync(shell, fs.constants.X_OK);
        console.log(`[PTYManager] Using shell: ${shell}`);
        return shell;
      } catch (e) {
        // Shell not found or not executable, try next
      }
    }
    
    // Fallback
    return '/bin/sh';
  }

  /**
   * Spawn a new terminal session
   * @param {object} options - Options for the terminal
   * @param {string} options.cwd - Working directory (defaults to home)
   * @param {string} options.shell - Shell to use (defaults to user's shell)
   * @param {number} options.cols - Number of columns (defaults to 80)
   * @param {number} options.rows - Number of rows (defaults to 24)
   * @param {object} options.env - Additional environment variables
   * @returns {object} - Terminal info
   */
  spawnTerminal(options = {}) {
    const id = `pty-${this.nextId++}`;
    const shell = options.shell || this.getDefaultShell();
    const cwd = options.cwd || os.homedir();
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    console.log(`[PTYManager] Spawning terminal with shell: ${shell}, cwd: ${cwd}`);

    // Verify shell exists and is executable
    try {
      fs.accessSync(shell, fs.constants.X_OK);
      console.log(`[PTYManager] Shell ${shell} is executable`);
    } catch (e) {
      console.error(`[PTYManager] Shell ${shell} access check failed:`, e.message);
      throw new Error(`Shell not found or not executable: ${shell}`);
    }

    // Verify cwd exists
    try {
      fs.accessSync(cwd, fs.constants.R_OK);
      console.log(`[PTYManager] CWD ${cwd} is accessible`);
    } catch (e) {
      console.error(`[PTYManager] CWD ${cwd} access check failed:`, e.message);
      throw new Error(`Working directory not accessible: ${cwd}`);
    }

    // Merge environment variables - ensure PATH is set
    const env = {
      ...process.env,
      ...options.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
    };

    console.log(`[PTYManager] Environment PATH: ${env.PATH?.substring(0, 100)}...`);

    // Spawn the PTY process
    let ptyProcess;
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env
      });
    } catch (spawnError) {
      console.error(`[PTYManager] pty.spawn failed:`, spawnError);
      // Try with minimal options
      console.log(`[PTYManager] Retrying with minimal options...`);
      ptyProcess = pty.spawn(shell, [], {
        cols,
        rows,
        cwd
      });
    }

    const terminalInfo = {
      id,
      pid: ptyProcess.pid,
      shell,
      cwd,
      cols,
      rows,
      createdAt: Date.now(),
      active: true,
      source: 'mobile-pty',
      ptyProcess
    };

    this.terminals.set(id, terminalInfo);
    this.outputHandlers.set(id, new Set());
    this.outputBuffers.set(id, '');

    // Handle PTY output
    ptyProcess.onData((data) => {
      // Buffer the output for replay on reconnect
      this.appendToBuffer(id, data);
      
      // Send to all handlers
      const handlers = this.outputHandlers.get(id);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(data);
          } catch (error) {
            console.error(`Error in terminal output handler for ${id}:`, error);
          }
        }
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`Terminal ${id} exited with code ${exitCode}, signal ${signal}`);
      const info = this.terminals.get(id);
      if (info) {
        info.active = false;
        info.exitCode = exitCode;
        info.exitSignal = signal;
        info.exitedAt = Date.now();
      }
    });

    console.log(`[PTYManager] Spawned terminal ${id} (PID: ${ptyProcess.pid}) in ${cwd}`);

    return {
      id,
      name: this.generateTerminalName(cwd, shell),
      pid: ptyProcess.pid,
      shell,
      cwd,
      cols,
      rows,
      createdAt: terminalInfo.createdAt,
      active: true,
      source: 'mobile-pty'
    };
  }

  /**
   * Write data to a terminal
   * @param {string} id - Terminal ID
   * @param {string} data - Data to write
   */
  writeToTerminal(id, data) {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new Error(`Terminal ${id} not found`);
    }
    if (!terminal.active) {
      throw new Error(`Terminal ${id} is not active`);
    }
    terminal.ptyProcess.write(data);
  }

  /**
   * Resize a terminal
   * @param {string} id - Terminal ID
   * @param {number} cols - Number of columns
   * @param {number} rows - Number of rows
   */
  resizeTerminal(id, cols, rows) {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new Error(`Terminal ${id} not found`);
    }
    if (!terminal.active) {
      throw new Error(`Terminal ${id} is not active`);
    }
    terminal.ptyProcess.resize(cols, rows);
    terminal.cols = cols;
    terminal.rows = rows;
  }

  /**
   * Kill a terminal
   * @param {string} id - Terminal ID
   */
  killTerminal(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new Error(`Terminal ${id} not found`);
    }
    if (terminal.active) {
      terminal.ptyProcess.kill();
    }
    this.terminals.delete(id);
    this.outputHandlers.delete(id);
    this.outputBuffers.delete(id);
    console.log(`Killed terminal ${id}`);
  }

  /**
   * Append data to the output buffer for a terminal
   * @param {string} id - Terminal ID
   * @param {string} data - Data to append
   */
  appendToBuffer(id, data) {
    let buffer = this.outputBuffers.get(id) || '';
    buffer += data;
    
    // Trim if exceeds max size (keep the end)
    if (buffer.length > this.maxBufferSize) {
      buffer = buffer.slice(-this.maxBufferSize);
    }
    
    this.outputBuffers.set(id, buffer);
  }

  /**
   * Get the buffered output for a terminal
   * @param {string} id - Terminal ID
   * @returns {string} - Buffered output
   */
  getBuffer(id) {
    return this.outputBuffers.get(id) || '';
  }

  /**
   * Clear the output buffer for a terminal
   * @param {string} id - Terminal ID
   */
  clearBuffer(id) {
    this.outputBuffers.set(id, '');
  }

  /**
   * Add an output handler for a terminal
   * @param {string} id - Terminal ID
   * @param {function} handler - Callback function that receives output data
   */
  addOutputHandler(id, handler) {
    const handlers = this.outputHandlers.get(id);
    if (handlers) {
      handlers.add(handler);
      console.log(`[PTYManager] Added output handler for ${id}, total handlers: ${handlers.size}`);
    }
  }

  /**
   * Remove an output handler for a terminal
   * @param {string} id - Terminal ID
   * @param {function} handler - The handler to remove
   */
  removeOutputHandler(id, handler) {
    const handlers = this.outputHandlers.get(id);
    if (handlers) {
      const wasDeleted = handlers.delete(handler);
      console.log(`[PTYManager] Removed output handler for ${id}, was deleted: ${wasDeleted}, remaining handlers: ${handlers.size}`);
    }
  }

  /**
   * Get terminal info
   * @param {string} id - Terminal ID
   * @returns {object|null} - Terminal info (without ptyProcess)
   */
  getTerminal(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return null;
    }
    
    // Return info without the ptyProcess
    const { ptyProcess, ...info } = terminal;
    return {
      ...info,
      name: this.generateTerminalName(info.cwd, info.shell)
    };
  }

  /**
   * Check if a terminal exists and is ours (PTY terminal)
   * @param {string} id - Terminal ID
   * @returns {boolean}
   */
  isPTYTerminal(id) {
    return id.startsWith('pty-');
  }

  /**
   * List all PTY terminals
   * @param {boolean} includeInactive - Whether to include inactive terminals
   * @returns {array} - Array of terminal info
   */
  listTerminals(includeInactive = false) {
    const result = [];
    for (const [id, terminal] of this.terminals) {
      if (!includeInactive && !terminal.active) {
        continue;
      }
      const { ptyProcess, ...info } = terminal;
      result.push({
        ...info,
        name: this.generateTerminalName(info.cwd, info.shell)
      });
    }
    return result;
  }

  /**
   * Generate a terminal name
   * @param {string} cwd - Current working directory
   * @param {string} shell - Shell path
   * @returns {string}
   */
  generateTerminalName(cwd, shell) {
    const dirName = path.basename(cwd);
    const shellName = path.basename(shell);
    return `${shellName} ${dirName}`;
  }

  /**
   * Clean up all terminals
   */
  cleanup() {
    for (const [id, terminal] of this.terminals) {
      if (terminal.active) {
        try {
          terminal.ptyProcess.kill();
        } catch (error) {
          console.error(`Error killing terminal ${id}:`, error);
        }
      }
    }
    this.terminals.clear();
    this.outputHandlers.clear();
  }
}

// Singleton instance
export const ptyManager = new PTYManager();
