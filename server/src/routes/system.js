import { Router } from 'express';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

// Get system info
router.get('/info', async (req, res) => {
  try {
    res.json({
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      },
      uptime: os.uptime(),
      homeDir: os.homedir(),
      username: os.userInfo().username
    });
  } catch (error) {
    console.error('Error fetching system info:', error);
    res.status(500).json({ error: 'Failed to fetch system info' });
  }
});

// Get network interfaces for connection info
router.get('/network', async (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    for (const [name, nets] of Object.entries(interfaces)) {
      for (const net of nets) {
        // Skip internal and non-IPv4 addresses
        if (!net.internal && net.family === 'IPv4') {
          addresses.push({
            name,
            address: net.address,
            netmask: net.netmask
          });
        }
      }
    }
    
    res.json({ addresses });
  } catch (error) {
    console.error('Error fetching network info:', error);
    res.status(500).json({ error: 'Failed to fetch network info' });
  }
});

// Check if Cursor is running
router.get('/cursor-status', async (req, res) => {
  try {
    let isRunning = false;
    let version = null;
    
    switch (os.platform()) {
      case 'darwin':
        try {
          const { stdout } = await execAsync('pgrep -x "Cursor" || pgrep -x "cursor"');
          isRunning = stdout.trim().length > 0;
        } catch (e) {
          isRunning = false;
        }
        break;
        
      case 'win32':
        try {
          const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Cursor.exe" /NH');
          isRunning = stdout.includes('Cursor.exe');
        } catch (e) {
          isRunning = false;
        }
        break;
        
      case 'linux':
        try {
          const { stdout } = await execAsync('pgrep -x cursor || pgrep -f "cursor --"');
          isRunning = stdout.trim().length > 0;
        } catch (e) {
          isRunning = false;
        }
        break;
    }
    
    res.json({
      isRunning,
      version,
      platform: os.platform()
    });
  } catch (error) {
    console.error('Error checking Cursor status:', error);
    res.status(500).json({ error: 'Failed to check Cursor status' });
  }
});

// Open Cursor with a specific path
router.post('/open-cursor', async (req, res) => {
  try {
    const { path: projectPath } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    let command;
    
    switch (os.platform()) {
      case 'darwin':
        command = `open -a Cursor "${projectPath}"`;
        break;
      case 'win32':
        command = `start "" "Cursor" "${projectPath}"`;
        break;
      case 'linux':
        command = `cursor "${projectPath}" &`;
        break;
      default:
        return res.status(400).json({ error: 'Unsupported platform' });
    }
    
    await execAsync(command);
    
    res.json({
      success: true,
      message: `Opening ${projectPath} in Cursor`
    });
  } catch (error) {
    console.error('Error opening Cursor:', error);
    res.status(500).json({ error: 'Failed to open Cursor' });
  }
});

// Execute a terminal command (with safety checks)
router.post('/exec', async (req, res) => {
  try {
    const { command, cwd } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }
    
    // Safety: block dangerous commands
    const dangerousPatterns = [
      /rm\s+-rf\s+[\/~]/,
      /sudo/,
      /mkfs/,
      /dd\s+if=/,
      />\s*\/dev\//,
      /chmod\s+777/
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return res.status(403).json({ error: 'Command blocked for safety' });
      }
    }
    
    const options = {
      cwd: cwd || os.homedir(),
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024 // 1MB max output
    };
    
    const { stdout, stderr } = await execAsync(command, options);
    
    res.json({
      success: true,
      stdout,
      stderr
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stderr: error.stderr || ''
    });
  }
});

export { router as systemRoutes };
