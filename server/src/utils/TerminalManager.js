import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

/**
 * Manages Cursor IDE terminal sessions
 * Reads terminal state from Cursor's terminal files and allows sending input via TTY
 * 
 * Note: This manager only works with Cursor IDE terminals (those visible in Cursor's terminal panel).
 * It cannot create new terminals - those must be created within Cursor IDE.
 */
export class TerminalManager {
  constructor() {
    // Cache for TTY paths to avoid repeated lookups
    this.cursorTerminalTTYCache = new Map(); // cacheKey -> { ttyPath, pid, timestamp }
  }

  /**
   * Get the Cursor projects directory
   */
  getCursorProjectsPath() {
    const homeDir = os.homedir();
    return path.join(homeDir, '.cursor', 'projects');
  }

  /**
   * Convert a project path to the Cursor project directory name
   * Cursor uses the format: Users-username-path-to-project
   * Both slashes and dots are replaced with hyphens
   */
  projectPathToDirName(projectPath) {
    // Remove leading slash and replace slashes and dots with hyphens
    return projectPath.replace(/^\//, '').replace(/[\/\.]/g, '-');
  }

  /**
   * Get the Cursor terminals directory for a project
   */
  getCursorTerminalsPath(projectPath) {
    const projectsPath = this.getCursorProjectsPath();
    const projectDirName = this.projectPathToDirName(projectPath);
    return path.join(projectsPath, projectDirName, 'terminals');
  }

  /**
   * Parse Cursor IDE terminal file metadata
   * Terminal files have YAML-like front matter between --- markers
   */
  parseCursorTerminalFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      // Check for YAML front matter
      if (lines[0] !== '---') {
        return null;
      }
      
      const metadata = {};
      let i = 1;
      
      while (i < lines.length && lines[i] !== '---') {
        const line = lines[i].trim();
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          metadata[key] = value;
        }
        i++;
      }
      
      return metadata;
    } catch (error) {
      console.error(`Error parsing terminal file ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Get the file path for a Cursor IDE terminal
   * @param {string} terminalId - Terminal ID like "cursor-1"
   * @param {string} projectPath - Project path
   * @returns {string|null} - File path or null if not found
   */
  getCursorTerminalFilePath(terminalId, projectPath) {
    if (!terminalId.startsWith('cursor-')) {
      return null;
    }
    
    const terminalNumber = terminalId.replace('cursor-', '');
    const terminalsPath = this.getCursorTerminalsPath(projectPath);
    const filePath = path.join(terminalsPath, `${terminalNumber}.txt`);
    
    if (fs.existsSync(filePath)) {
      return filePath;
    }
    
    return null;
  }

  /**
   * Read Cursor IDE terminal file content (after the metadata header)
   * @param {string} terminalId - Terminal ID like "cursor-1"
   * @param {string} projectPath - Project path
   * @returns {object|null} - { content, metadata, filePath } or null if not found
   */
  readCursorTerminalContent(terminalId, projectPath) {
    const filePath = this.getCursorTerminalFilePath(terminalId, projectPath);
    
    if (!filePath) {
      return null;
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      // Parse metadata and find content start
      const metadata = {};
      let contentStartIndex = 0;
      
      if (lines[0] === '---') {
        let i = 1;
        while (i < lines.length && lines[i] !== '---') {
          const line = lines[i].trim();
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            metadata[key] = value;
          }
          i++;
        }
        contentStartIndex = i + 1; // Skip the closing ---
      }
      
      // Get the terminal content (everything after the metadata)
      const terminalContent = lines.slice(contentStartIndex).join('\n');
      
      return {
        content: terminalContent,
        metadata,
        filePath
      };
    } catch (error) {
      console.error(`Error reading terminal content ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Check if a terminal ID is a Cursor IDE terminal
   */
  isCursorIDETerminal(terminalId) {
    return terminalId.startsWith('cursor-');
  }

  /**
   * Get the TTY device path for a given PID
   * Uses lsof to find the controlling terminal
   * @param {number} pid - Process ID
   * @returns {string|null} - TTY device path or null if not found
   */
  getTTYForPID(pid) {
    if (!pid || pid <= 0) {
      return null;
    }

    try {
      // Use lsof to find file descriptors for the process
      // Look for the controlling terminal (usually fd 0, 1, or 2)
      const output = execSync(`lsof -p ${pid} 2>/dev/null | grep -E '/dev/ttys[0-9]+' | head -1`, {
        encoding: 'utf-8',
        timeout: 5000
      });

      // Extract the TTY device path (e.g., /dev/ttys001)
      const match = output.match(/\/dev\/ttys\d+/);
      if (match) {
        return match[0];
      }

      // Alternative: try ps command
      const psOutput = execSync(`ps -p ${pid} -o tty= 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 5000
      }).trim();

      if (psOutput && psOutput !== '??') {
        // ps returns just the tty name like "ttys001", prepend /dev/
        return `/dev/${psOutput}`;
      }

      return null;
    } catch (error) {
      // Process might not exist or no TTY found
      console.error(`Error finding TTY for PID ${pid}:`, error.message);
      return null;
    }
  }

  /**
   * Write input to a Cursor IDE terminal
   * @param {string} terminalId - Terminal ID like "cursor-1"
   * @param {string} projectPath - Project path
   * @param {string} data - Data to write
   * @returns {object} - Result with success status
   */
  writeToCursorTerminal(terminalId, projectPath, data) {
    // Read the terminal metadata to get the PID
    const terminalData = this.readCursorTerminalContent(terminalId, projectPath);
    
    if (!terminalData) {
      throw new Error(`Terminal ${terminalId} not found`);
    }

    const pid = parseInt(terminalData.metadata.pid, 10);
    if (!pid || pid <= 0) {
      throw new Error(`Terminal ${terminalId} has no valid PID`);
    }

    // Check if the process is still running
    try {
      process.kill(pid, 0); // Signal 0 just checks if process exists
    } catch (error) {
      throw new Error(`Terminal ${terminalId} process (PID ${pid}) is not running`);
    }

    // Find the TTY for this process
    const ttyPath = this.getTTYForPID(pid);
    if (!ttyPath) {
      throw new Error(`Could not find TTY for terminal ${terminalId} (PID ${pid})`);
    }

    // Write to the TTY
    try {
      const fd = fs.openSync(ttyPath, 'w');
      fs.writeSync(fd, data);
      fs.closeSync(fd);
      return { success: true, ttyPath };
    } catch (error) {
      throw new Error(`Failed to write to TTY ${ttyPath}: ${error.message}`);
    }
  }

  /**
   * Get cached TTY path or look it up
   * @param {string} terminalId - Terminal ID
   * @param {string} projectPath - Project path
   * @returns {object|null} - { ttyPath, pid } or null
   */
  getCachedTTY(terminalId, projectPath) {
    const cacheKey = `${terminalId}:${projectPath}`;
    const cached = this.cursorTerminalTTYCache.get(cacheKey);
    
    // Cache valid for 30 seconds
    if (cached && Date.now() - cached.timestamp < 30000) {
      // Verify the process is still running
      try {
        process.kill(cached.pid, 0);
        return { ttyPath: cached.ttyPath, pid: cached.pid };
      } catch (e) {
        // Process died, invalidate cache
        this.cursorTerminalTTYCache.delete(cacheKey);
      }
    }

    // Look up fresh
    const terminalData = this.readCursorTerminalContent(terminalId, projectPath);
    if (!terminalData) {
      return null;
    }

    const pid = parseInt(terminalData.metadata.pid, 10);
    if (!pid || pid <= 0) {
      return null;
    }

    const ttyPath = this.getTTYForPID(pid);
    if (!ttyPath) {
      return null;
    }

    // Cache the result
    this.cursorTerminalTTYCache.set(cacheKey, {
      ttyPath,
      pid,
      timestamp: Date.now()
    });

    return { ttyPath, pid };
  }

  /**
   * Fast write to Cursor IDE terminal using cached TTY
   * @param {string} terminalId - Terminal ID
   * @param {string} projectPath - Project path  
   * @param {string} data - Data to write
   * @returns {object} - Result
   */
  writeToCursorTerminalFast(terminalId, projectPath, data) {
    const ttyInfo = this.getCachedTTY(terminalId, projectPath);
    
    if (!ttyInfo) {
      throw new Error(`Terminal ${terminalId} not found or not active`);
    }

    try {
      const fd = fs.openSync(ttyInfo.ttyPath, 'w');
      fs.writeSync(fd, data);
      fs.closeSync(fd);
      return { success: true };
    } catch (error) {
      // Invalidate cache on write failure
      this.cursorTerminalTTYCache.delete(`${terminalId}:${projectPath}`);
      throw new Error(`Failed to write to terminal: ${error.message}`);
    }
  }

  /**
   * Generate a terminal name matching Cursor's format: "shell directory"
   * e.g., "node server", "zsh ios-client"
   */
  generateTerminalName(cwd, activeCommand) {
    // Get the last directory from the cwd
    const lastDir = path.basename(cwd);
    
    // Determine the shell/process name from active command or default shell
    let shellName = 'zsh';
    if (activeCommand) {
      // Extract the first word of the command (e.g., "npm" from "npm start")
      const firstWord = activeCommand.split(' ')[0];
      // Use common mappings
      if (firstWord === 'npm' || firstWord === 'node' || firstWord === 'npx') {
        shellName = 'node';
      } else if (firstWord === 'python' || firstWord === 'python3') {
        shellName = 'python';
      } else if (firstWord === 'ruby') {
        shellName = 'ruby';
      } else if (['zsh', 'bash', 'sh', 'fish'].includes(firstWord)) {
        shellName = firstWord;
      } else {
        // For other commands, still show as the shell running them
        shellName = 'zsh';
      }
    }
    
    return `${shellName} ${lastDir}`;
  }

  /**
   * Read Cursor IDE terminals for a project
   * @param {boolean} includeHistory - Whether to include old/inactive terminals
   */
  readCursorIDETerminals(projectPath, includeHistory = false) {
    const terminals = [];
    const terminalsPath = this.getCursorTerminalsPath(projectPath);
    
    try {
      if (!fs.existsSync(terminalsPath)) {
        console.log(`Cursor terminals path does not exist: ${terminalsPath}`);
        return terminals;
      }
      
      const files = fs.readdirSync(terminalsPath);
      
      for (const file of files) {
        // Only process numbered terminal files (1.txt, 2.txt, etc.)
        if (!/^\d+\.txt$/.test(file)) {
          continue;
        }
        
        const terminalNumber = parseInt(file.replace('.txt', ''), 10);
        const filePath = path.join(terminalsPath, file);
        const metadata = this.parseCursorTerminalFile(filePath);
        
        if (metadata) {
          const terminalId = `cursor-${file.replace('.txt', '')}`;
          const pid = parseInt(metadata.pid, 10) || 0;
          const hasActiveCommand = !!metadata.active_command;
          const isActive = hasActiveCommand && pid > 0;
          
          // Filter out old terminals (high numbers that aren't active)
          // Main terminals are typically numbered 1-20, high numbers are temporary/old
          const isMainTerminal = terminalNumber <= 20;
          const isHistoryTerminal = terminalNumber > 20 && !isActive;
          
          if (!includeHistory && isHistoryTerminal) {
            continue; // Skip old terminals unless history is requested
          }
          
          const cwd = metadata.cwd || projectPath;
          const activeCommand = metadata.active_command || null;
          
          terminals.push({
            id: terminalId,
            name: this.generateTerminalName(cwd, activeCommand),
            shell: process.env.SHELL || '/bin/zsh',
            cwd: cwd,
            projectPath: projectPath,
            createdAt: Date.now(),
            pid: pid,
            cols: 80,
            rows: 30,
            active: isActive,
            source: 'cursor-ide',
            lastCommand: metadata.last_command || null,
            activeCommand: activeCommand,
            exitCode: metadata.last_exit_code ? parseInt(metadata.last_exit_code, 10) : null,
            isHistory: isHistoryTerminal
          });
        }
      }
    } catch (error) {
      console.error(`Error reading Cursor IDE terminals: ${error.message}`);
    }
    
    return terminals;
  }

  /**
   * Clear the TTY cache
   * Call this when you know terminal state has changed
   */
  clearTTYCache() {
    this.cursorTerminalTTYCache.clear();
  }
}
