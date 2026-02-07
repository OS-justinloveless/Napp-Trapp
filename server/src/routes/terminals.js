import express from 'express';
import { ptyManager } from '../utils/PTYManager.js';
import { tmuxManager } from '../utils/TmuxManager.js';

export const terminalRoutes = express.Router();

// Export managers for WebSocket use
export { ptyManager, tmuxManager };

/**
 * GET /api/terminals
 * List all terminal sessions (PTY and tmux terminals)
 * Query params:
 *   - projectPath: Filter by project path (required for tmux terminals)
 *   - includeHistory: Include old/inactive terminals (default: false)
 *   - source: Filter by source ('mobile-pty', 'tmux', or 'all') (default: 'all')
 */
terminalRoutes.get('/', (req, res) => {
  try {
    const { projectPath, includeHistory, source = 'all' } = req.query;
    const includeHistoryBool = includeHistory === 'true';
    
    console.log(`[Terminals] GET / - projectPath="${projectPath}", source="${source}"`);
    
    let terminals = [];
    
    // Get PTY terminals (our own)
    if (source === 'all' || source === 'mobile-pty') {
      try {
        const ptyTerminals = ptyManager.listTerminals(includeHistoryBool);
        console.log(`[Terminals] Found ${ptyTerminals.length} PTY terminals`);
        terminals = terminals.concat(ptyTerminals);
      } catch (ptyError) {
        console.error('[Terminals] Error listing PTY terminals:', ptyError);
      }
    }
    
    // Get tmux terminals (if projectPath is provided)
    if ((source === 'all' || source === 'tmux') && projectPath) {
      try {
        const tmuxTerminals = tmuxManager.listTerminals(projectPath);
        console.log(`[Terminals] Found ${tmuxTerminals.length} tmux terminals for project`);
        terminals = terminals.concat(tmuxTerminals);
      } catch (tmuxError) {
        console.error('[Terminals] Error listing tmux terminals:', tmuxError);
      }
    }
    
    console.log(`[Terminals] Returning ${terminals.length} total terminals`);
    
    res.json({
      terminals,
      count: terminals.length
    });
  } catch (error) {
    console.error('[Terminals] Error listing terminals:', error);
    res.status(500).json({ 
      error: 'Failed to list terminals',
      message: error.message 
    });
  }
});

/**
 * POST /api/terminals
 * Create a new terminal session (PTY or tmux)
 * Body: { cwd, shell, cols, rows, type, projectPath, windowName }
 *   - type: 'pty' (default) or 'tmux'
 *   - projectPath: Required for tmux sessions (used for session naming)
 *   - windowName: Optional name for the tmux window
 */
terminalRoutes.post('/', (req, res) => {
  try {
    const { cwd, shell, cols, rows, type = 'pty', projectPath, windowName } = req.body;
    
    if (type === 'tmux') {
      // Create a tmux terminal (session + window)
      if (!projectPath) {
        return res.status(400).json({
          error: 'projectPath is required for tmux sessions'
        });
      }
      
      if (!tmuxManager.isTmuxAvailable()) {
        return res.status(400).json({
          error: 'tmux is not installed on this system',
          hint: 'Install tmux with: brew install tmux'
        });
      }
      
      const terminal = tmuxManager.createTerminal({
        projectPath,
        cwd: cwd || projectPath,
        windowName
      });
      
      return res.json({
        success: true,
        terminal
      });
    }
    
    // Default: create a PTY terminal
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
 * GET /api/terminals/tmux/status
 * Get tmux availability status
 */
terminalRoutes.get('/tmux/status', (req, res) => {
  try {
    const available = tmuxManager.isTmuxAvailable();
    const version = available ? tmuxManager.getTmuxVersion() : null;
    const sessions = available ? tmuxManager.listAllSessions().filter(s => s.isMobileSession) : [];
    
    res.json({
      available,
      version,
      sessionCount: sessions.length,
      sessions: sessions.map(s => ({
        name: s.name,
        windowCount: s.windowCount,
        attached: s.attached,
        projectName: s.projectName
      }))
    });
  } catch (error) {
    console.error('Error getting tmux status:', error);
    res.status(500).json({
      error: 'Failed to get tmux status',
      message: error.message
    });
  }
});

/**
 * GET /api/terminals/tmux/sessions/:sessionName/windows
 * List windows in a tmux session
 */
terminalRoutes.get('/tmux/sessions/:sessionName/windows', (req, res) => {
  try {
    const { sessionName } = req.params;
    
    if (!tmuxManager.sessionExists(sessionName)) {
      return res.status(404).json({
        error: 'Session not found',
        sessionName
      });
    }
    
    const windows = tmuxManager.listWindows(sessionName);
    
    res.json({
      sessionName,
      windows,
      count: windows.length
    });
  } catch (error) {
    console.error('Error listing windows:', error);
    res.status(500).json({
      error: 'Failed to list windows',
      message: error.message
    });
  }
});

/**
 * GET /api/terminals/:id
 * Get terminal metadata and content
 * Query params:
 *   - projectPath: Project path (required for tmux terminals)
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
    
    // Check if it's a tmux terminal
    if (tmuxManager.isTmuxTerminal(id)) {
      if (!projectPath) {
        return res.status(400).json({
          error: 'projectPath query parameter is required for tmux terminals'
        });
      }
      
      const terminal = tmuxManager.getTerminalInfo(id, projectPath);
      
      if (!terminal) {
        return res.status(404).json({
          error: 'Tmux terminal not found',
          id
        });
      }
      
      const response = { terminal };
      
      if (includeContentBool) {
        const { sessionName, windowIndex } = tmuxManager.parseTerminalId(id);
        if (tmuxManager.isAttached(sessionName, windowIndex)) {
          response.content = tmuxManager.getBuffer(sessionName, windowIndex);
        }
      }
      
      return res.json(response);
    }
    
    return res.status(400).json({ 
      error: 'Invalid terminal ID format',
      hint: 'Terminal IDs should be: pty-N (mobile) or tmux-{sessionName}:{windowIndex}'
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
 * POST /api/terminals/:id/input
 * Send input to a terminal
 * Body: { data }
 */
terminalRoutes.post('/:id/input', (req, res) => {
  try {
    const { id } = req.params;
    const { data } = req.body;
    
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
    
    // Handle tmux terminals
    if (tmuxManager.isTmuxTerminal(id)) {
      const { sessionName, windowIndex } = tmuxManager.parseTerminalId(id);
      if (!tmuxManager.isAttached(sessionName, windowIndex)) {
        return res.status(400).json({
          error: 'Tmux window is not attached',
          hint: 'Attach to the terminal first via WebSocket'
        });
      }
      tmuxManager.writeToWindow(sessionName, windowIndex, data);
      return res.json({ success: true });
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
    
    // Handle tmux terminals
    if (tmuxManager.isTmuxTerminal(id)) {
      const { sessionName, windowIndex } = tmuxManager.parseTerminalId(id);
      if (!tmuxManager.isAttached(sessionName, windowIndex)) {
        return res.status(400).json({
          error: 'Tmux window is not attached',
          hint: 'Attach to the terminal first via WebSocket'
        });
      }
      tmuxManager.resizeWindow(sessionName, windowIndex, cols, rows);
      return res.json({ success: true });
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
    
    // Handle tmux terminals
    if (tmuxManager.isTmuxTerminal(id)) {
      const { sessionName, windowIndex } = tmuxManager.parseTerminalId(id);
      tmuxManager.killWindow(sessionName, windowIndex);
      return res.json({ success: true });
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

/**
 * DELETE /api/terminals/tmux/sessions/:sessionName
 * Kill an entire tmux session (all windows)
 */
terminalRoutes.delete('/tmux/sessions/:sessionName', (req, res) => {
  try {
    const { sessionName } = req.params;
    
    if (!tmuxManager.sessionExists(sessionName)) {
      return res.status(404).json({
        error: 'Session not found',
        sessionName
      });
    }
    
    tmuxManager.killSession(sessionName);
    
    res.json({
      success: true,
      message: `Session ${sessionName} and all its windows have been killed`
    });
  } catch (error) {
    console.error('Error killing session:', error);
    res.status(500).json({
      error: 'Failed to kill session',
      message: error.message
    });
  }
});
