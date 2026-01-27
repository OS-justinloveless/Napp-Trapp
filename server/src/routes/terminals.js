import express from 'express';
import { TerminalManager } from '../utils/TerminalManager.js';

export const terminalRoutes = express.Router();
const terminalManager = new TerminalManager();

// Export terminal manager for WebSocket use
export { terminalManager };

/**
 * GET /api/terminals
 * List all Cursor IDE terminal sessions
 * Query params:
 *   - projectPath: Filter by project path (required for Cursor IDE terminals)
 *   - includeHistory: Include old/inactive terminals (default: false)
 */
terminalRoutes.get('/', (req, res) => {
  try {
    const { projectPath, includeHistory } = req.query;
    const includeHistoryBool = includeHistory === 'true';
    
    if (!projectPath) {
      return res.json({
        terminals: [],
        count: 0,
        message: 'projectPath is required to list Cursor IDE terminals'
      });
    }
    
    // Only return Cursor IDE terminals
    const terminals = terminalManager.readCursorIDETerminals(projectPath, includeHistoryBool);
    
    res.json({
      terminals,
      count: terminals.length,
      source: 'cursor-ide'
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
 * GET /api/terminals/:id
 * Get terminal metadata and content for a Cursor IDE terminal
 * Query params:
 *   - projectPath: Project path (required)
 *   - includeContent: Whether to include terminal output content (default: true)
 */
terminalRoutes.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { projectPath, includeContent } = req.query;
    const includeContentBool = includeContent !== 'false';
    
    if (!projectPath) {
      return res.status(400).json({ 
        error: 'projectPath query parameter is required' 
      });
    }
    
    // Check if it's a Cursor IDE terminal
    if (!terminalManager.isCursorIDETerminal(id)) {
      return res.status(400).json({ 
        error: 'Only Cursor IDE terminals are supported',
        hint: 'Terminal IDs should be in format: cursor-N (e.g., cursor-1)'
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
    
    // Check if the process is still running
    if (pid > 0) {
      try {
        process.kill(pid, 0); // Signal 0 just checks if process exists
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
    
    res.json(response);
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
 * Get terminal output content for a Cursor IDE terminal
 * Query params:
 *   - projectPath: Project path (required)
 *   - tail: Number of lines from the end (optional)
 */
terminalRoutes.get('/:id/content', (req, res) => {
  try {
    const { id } = req.params;
    const { projectPath, tail } = req.query;
    
    if (!projectPath) {
      return res.status(400).json({ 
        error: 'projectPath query parameter is required' 
      });
    }
    
    if (!terminalManager.isCursorIDETerminal(id)) {
      return res.status(400).json({ 
        error: 'Only Cursor IDE terminals are supported' 
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
    
    // Optionally return only the last N lines
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
 * POST /api/terminals
 * Note: Creating terminals is not supported via the API.
 * Terminals must be created within the Cursor IDE.
 */
terminalRoutes.post('/', (req, res) => {
  res.status(400).json({
    error: 'Creating terminals via API is not supported',
    message: 'Terminals must be created within the Cursor IDE. This API can only interact with existing Cursor IDE terminals.',
    hint: 'Open a new terminal in Cursor IDE (Ctrl/Cmd + `) then use this API to list and interact with it.'
  });
});

/**
 * POST /api/terminals/:id/input
 * Send input to a Cursor IDE terminal
 * Body: { data, projectPath }
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
    
    if (!projectPath) {
      return res.status(400).json({ 
        error: 'projectPath is required' 
      });
    }
    
    if (!terminalManager.isCursorIDETerminal(id)) {
      return res.status(400).json({ 
        error: 'Only Cursor IDE terminals are supported',
        hint: 'Terminal IDs should be in format: cursor-N (e.g., cursor-1)'
      });
    }
    
    // Use the fast write method for Cursor IDE terminals
    const result = terminalManager.writeToCursorTerminalFast(id, projectPath, data);
    
    res.json({
      success: true,
      ...result
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
 * Resize is not supported for Cursor IDE terminals (they are managed by Cursor)
 */
terminalRoutes.post('/:id/resize', (req, res) => {
  res.status(400).json({
    error: 'Resize is not supported for Cursor IDE terminals',
    message: 'Cursor IDE terminal dimensions are managed by Cursor itself.'
  });
});

/**
 * DELETE /api/terminals/:id
 * Deleting Cursor IDE terminals is not supported via the API
 */
terminalRoutes.delete('/:id', (req, res) => {
  res.status(400).json({
    error: 'Deleting Cursor IDE terminals via API is not supported',
    message: 'Close terminals directly in the Cursor IDE.'
  });
});

/**
 * POST /api/terminals/:id/clear
 * Clearing Cursor IDE terminals is not supported via the API
 */
terminalRoutes.post('/:id/clear', (req, res) => {
  res.status(400).json({
    error: 'Clearing Cursor IDE terminals via API is not supported',
    message: 'Use Cmd+K or clear command in the Cursor IDE terminal.'
  });
});
