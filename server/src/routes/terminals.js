import express from 'express';
import { TerminalManager } from '../utils/TerminalManager.js';
import { ptyManager } from '../utils/PTYManager.js';

export const terminalRoutes = express.Router();
const terminalManager = new TerminalManager();

// Export managers for WebSocket use
export { terminalManager, ptyManager };

/**
 * GET /api/terminals
 * List all terminal sessions (both Cursor IDE and PTY terminals)
 * Query params:
 *   - projectPath: Filter by project path (required for Cursor IDE terminals)
 *   - includeHistory: Include old/inactive terminals (default: false)
 *   - source: Filter by source ('cursor-ide', 'mobile-pty', or 'all') (default: 'all')
 */
terminalRoutes.get('/', (req, res) => {
  try {
    const { projectPath, includeHistory, source = 'all' } = req.query;
    const includeHistoryBool = includeHistory === 'true';
    
    let terminals = [];
    
    // Get PTY terminals (our own)
    if (source === 'all' || source === 'mobile-pty') {
      const ptyTerminals = ptyManager.listTerminals(includeHistoryBool);
      terminals = terminals.concat(ptyTerminals);
    }
    
    // Get Cursor IDE terminals (if projectPath is provided)
    if ((source === 'all' || source === 'cursor-ide') && projectPath) {
      const cursorTerminals = terminalManager.readCursorIDETerminals(projectPath, includeHistoryBool);
      terminals = terminals.concat(cursorTerminals);
    }
    
    res.json({
      terminals,
      count: terminals.length
    });
  } catch (error) {
    console.error('Error listing terminals:', error);
    res.status(500).json({ 
      error: 'Failed to list terminals',
      message: error.message 
    });
  }
});

/**
 * POST /api/terminals
 * Create a new PTY terminal session
 * Body: { cwd, shell, cols, rows }
 */
terminalRoutes.post('/', (req, res) => {
  try {
    const { cwd, shell, cols, rows } = req.body;
    
    const terminal = ptyManager.spawnTerminal({
      cwd,
      shell,
      cols: cols || 80,
      rows: rows || 24
    });
    
    res.json({
      success: true,
      terminal
    });
  } catch (error) {
    console.error('Error creating terminal:', error);
    res.status(500).json({ 
      error: 'Failed to create terminal',
      message: error.message 
    });
  }
});

/**
 * GET /api/terminals/:id
 * Get terminal metadata and content
 * Query params:
 *   - projectPath: Project path (required for Cursor IDE terminals)
 *   - includeContent: Whether to include terminal output content (default: true)
 */
terminalRoutes.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { projectPath, includeContent } = req.query;
    const includeContentBool = includeContent !== 'false';
    
    // Check if it's a PTY terminal
    if (ptyManager.isPTYTerminal(id)) {
      const terminal = ptyManager.getTerminal(id);
      if (!terminal) {
        return res.status(404).json({ 
          error: 'Terminal not found',
          id 
        });
      }
      return res.json({ terminal });
    }
    
    // Check if it's a Cursor IDE terminal
    if (terminalManager.isCursorIDETerminal(id)) {
      if (!projectPath) {
        return res.status(400).json({ 
          error: 'projectPath query parameter is required for Cursor IDE terminals' 
        });
      }
      
      const terminalData = terminalManager.readCursorTerminalContent(id, projectPath);
      
      if (!terminalData) {
        return res.status(404).json({ 
          error: 'Terminal not found',
          id 
        });
      }
      
      const pid = parseInt(terminalData.metadata.pid, 10) || 0;
      let isActive = false;
      
      if (pid > 0) {
        try {
          process.kill(pid, 0);
          isActive = true;
        } catch (e) {
          // Process not running
        }
      }
      
      const response = {
        terminal: {
          id,
          name: terminalManager.generateTerminalName(
            terminalData.metadata.cwd || projectPath,
            terminalData.metadata.active_command
          ),
          pid,
          cwd: terminalData.metadata.cwd || projectPath,
          active: isActive,
          activeCommand: terminalData.metadata.active_command || null,
          lastCommand: terminalData.metadata.last_command || null,
          exitCode: terminalData.metadata.last_exit_code ? parseInt(terminalData.metadata.last_exit_code, 10) : null,
          source: 'cursor-ide'
        }
      };
      
      if (includeContentBool) {
        response.content = terminalData.content;
      }
      
      return res.json(response);
    }
    
    return res.status(400).json({ 
      error: 'Invalid terminal ID format',
      hint: 'Terminal IDs should be: pty-N (mobile) or cursor-N (Cursor IDE)'
    });
  } catch (error) {
    console.error('Error getting terminal:', error);
    res.status(500).json({ 
      error: 'Failed to get terminal',
      message: error.message 
    });
  }
});

/**
 * GET /api/terminals/:id/content
 * Get terminal output content (Cursor IDE terminals only)
 * Query params:
 *   - projectPath: Project path (required)
 *   - tail: Number of lines from the end (optional)
 */
terminalRoutes.get('/:id/content', (req, res) => {
  try {
    const { id } = req.params;
    const { projectPath, tail } = req.query;
    
    // PTY terminals don't have stored content (output is streamed via WebSocket)
    if (ptyManager.isPTYTerminal(id)) {
      return res.status(400).json({ 
        error: 'Content endpoint not available for PTY terminals',
        message: 'PTY terminal output is streamed in real-time via WebSocket'
      });
    }
    
    if (!projectPath) {
      return res.status(400).json({ 
        error: 'projectPath query parameter is required' 
      });
    }
    
    if (!terminalManager.isCursorIDETerminal(id)) {
      return res.status(400).json({ 
        error: 'Invalid terminal ID format' 
      });
    }
    
    const terminalData = terminalManager.readCursorTerminalContent(id, projectPath);
    
    if (!terminalData) {
      return res.status(404).json({ 
        error: 'Terminal not found',
        id 
      });
    }
    
    let content = terminalData.content;
    
    if (tail) {
      const tailLines = parseInt(tail, 10);
      if (tailLines > 0) {
        const lines = content.split('\n');
        content = lines.slice(-tailLines).join('\n');
      }
    }
    
    res.json({
      id,
      content,
      metadata: terminalData.metadata
    });
  } catch (error) {
    console.error('Error getting terminal content:', error);
    res.status(500).json({ 
      error: 'Failed to get terminal content',
      message: error.message 
    });
  }
});

/**
 * POST /api/terminals/:id/input
 * Send input to a terminal
 * Body: { data, projectPath (for Cursor IDE terminals) }
 */
terminalRoutes.post('/:id/input', (req, res) => {
  try {
    const { id } = req.params;
    const { data, projectPath } = req.body;
    
    if (data === undefined || data === null) {
      return res.status(400).json({ 
        error: 'data is required' 
      });
    }
    
    // Handle PTY terminals
    if (ptyManager.isPTYTerminal(id)) {
      ptyManager.writeToTerminal(id, data);
      return res.json({ success: true });
    }
    
    // Handle Cursor IDE terminals (read-only note)
    if (terminalManager.isCursorIDETerminal(id)) {
      return res.status(400).json({ 
        error: 'Input to Cursor IDE terminals is not fully supported',
        message: 'Due to macOS security restrictions, input injection to Cursor IDE terminals is limited. Use PTY terminals (POST /api/terminals) for full input support.',
        hint: 'Create a new terminal with POST /api/terminals for full bidirectional support'
      });
    }
    
    return res.status(400).json({ 
      error: 'Invalid terminal ID format'
    });
  } catch (error) {
    console.error('Error writing to terminal:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({ 
      error: 'Failed to write to terminal',
      message: error.message 
    });
  }
});

/**
 * POST /api/terminals/:id/resize
 * Resize a terminal
 * Body: { cols, rows }
 */
terminalRoutes.post('/:id/resize', (req, res) => {
  try {
    const { id } = req.params;
    const { cols, rows } = req.body;
    
    if (!cols || !rows) {
      return res.status(400).json({ 
        error: 'cols and rows are required' 
      });
    }
    
    // Handle PTY terminals
    if (ptyManager.isPTYTerminal(id)) {
      ptyManager.resizeTerminal(id, cols, rows);
      return res.json({ success: true });
    }
    
    // Cursor IDE terminals don't support resize via API
    if (terminalManager.isCursorIDETerminal(id)) {
      return res.status(400).json({
        error: 'Resize is not supported for Cursor IDE terminals',
        message: 'Cursor IDE terminal dimensions are managed by Cursor itself.'
      });
    }
    
    return res.status(400).json({ 
      error: 'Invalid terminal ID format'
    });
  } catch (error) {
    console.error('Error resizing terminal:', error);
    res.status(500).json({ 
      error: 'Failed to resize terminal',
      message: error.message 
    });
  }
});

/**
 * DELETE /api/terminals/:id
 * Kill/close a terminal
 */
terminalRoutes.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    // Handle PTY terminals
    if (ptyManager.isPTYTerminal(id)) {
      ptyManager.killTerminal(id);
      return res.json({ success: true });
    }
    
    // Cursor IDE terminals can't be deleted via API
    if (terminalManager.isCursorIDETerminal(id)) {
      return res.status(400).json({
        error: 'Deleting Cursor IDE terminals via API is not supported',
        message: 'Close terminals directly in the Cursor IDE.'
      });
    }
    
    return res.status(400).json({ 
      error: 'Invalid terminal ID format'
    });
  } catch (error) {
    console.error('Error deleting terminal:', error);
    res.status(500).json({ 
      error: 'Failed to delete terminal',
      message: error.message 
    });
  }
});
