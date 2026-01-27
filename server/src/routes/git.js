import express from 'express';
import { spawn, execSync } from 'child_process';
import { GitManager } from '../utils/GitManager.js';
import { CursorWorkspace } from '../utils/CursorWorkspace.js';

export const gitRoutes = express.Router();
const gitManager = new GitManager();
const workspace = new CursorWorkspace();

/**
 * Helper to get project path from project ID
 */
async function getProjectPath(projectId) {
  const project = await workspace.getProjectDetails(projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  return project.path;
}

/**
 * GET /api/git/:projectId/status
 * Get git status for a project
 */
gitRoutes.get('/:projectId/status', async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectPath = await getProjectPath(projectId);
    
    // Check if it's a git repo
    const isRepo = await gitManager.isGitRepo(projectPath);
    if (!isRepo) {
      return res.status(400).json({
        error: 'Not a git repository',
        projectPath
      });
    }
    
    const status = await gitManager.getStatus(projectPath);
    res.json(status);
  } catch (error) {
    console.error('Error getting git status:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to get git status',
      message: error.message
    });
  }
});

/**
 * GET /api/git/:projectId/branches
 * Get list of branches for a project
 */
gitRoutes.get('/:projectId/branches', async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectPath = await getProjectPath(projectId);
    
    const branches = await gitManager.getBranches(projectPath);
    res.json({ branches });
  } catch (error) {
    console.error('Error getting branches:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to get branches',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/stage
 * Stage files
 * Body: { files: string[] }
 */
gitRoutes.post('/:projectId/stage', async (req, res) => {
  console.log('[git.js] POST /stage - projectId:', req.params.projectId, 'body:', req.body);
  try {
    const { projectId } = req.params;
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      console.log('[git.js] stage - files array is empty or invalid');
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const projectPath = await getProjectPath(projectId);
    console.log('[git.js] stage - projectPath:', projectPath, 'files:', files);
    const result = await gitManager.stageFiles(projectPath, files);
    console.log('[git.js] stage - result:', result);
    res.json(result);
  } catch (error) {
    console.error('Error staging files:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to stage files',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/unstage
 * Unstage files
 * Body: { files: string[] }
 */
gitRoutes.post('/:projectId/unstage', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.unstageFiles(projectPath, files);
    res.json(result);
  } catch (error) {
    console.error('Error unstaging files:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to unstage files',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/discard
 * Discard changes in working directory
 * Body: { files: string[] }
 */
gitRoutes.post('/:projectId/discard', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.discardChanges(projectPath, files);
    res.json(result);
  } catch (error) {
    console.error('Error discarding changes:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to discard changes',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/commit
 * Create a commit
 * Body: { message: string, files?: string[] }
 */
gitRoutes.post('/:projectId/commit', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message, files } = req.body;
    
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Commit message is required' });
    }
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.commit(projectPath, message, files);
    res.json(result);
  } catch (error) {
    console.error('Error creating commit:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to create commit',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/push
 * Push to remote
 * Body: { remote?: string, branch?: string }
 */
gitRoutes.post('/:projectId/push', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { remote, branch } = req.body;
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.push(projectPath, remote, branch);
    res.json(result);
  } catch (error) {
    console.error('Error pushing:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to push',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/pull
 * Pull from remote
 * Body: { remote?: string, branch?: string }
 */
gitRoutes.post('/:projectId/pull', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { remote, branch } = req.body;
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.pull(projectPath, remote, branch);
    res.json(result);
  } catch (error) {
    console.error('Error pulling:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to pull',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/checkout
 * Checkout a branch
 * Body: { branch: string }
 */
gitRoutes.post('/:projectId/checkout', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { branch } = req.body;
    
    if (!branch || typeof branch !== 'string') {
      return res.status(400).json({ error: 'Branch name is required' });
    }
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.checkout(projectPath, branch);
    res.json(result);
  } catch (error) {
    console.error('Error checking out branch:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to checkout branch',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/branch
 * Create a new branch
 * Body: { name: string, checkout?: boolean }
 */
gitRoutes.post('/:projectId/branch', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, checkout } = req.body;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Branch name is required' });
    }
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.createBranch(projectPath, name, checkout !== false);
    res.json(result);
  } catch (error) {
    console.error('Error creating branch:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to create branch',
      message: error.message
    });
  }
});

/**
 * GET /api/git/:projectId/diff
 * Get diff for a file
 * Query: file (required), staged (optional boolean), maxLines (optional, default 2000)
 */
gitRoutes.get('/:projectId/diff', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { file, staged, maxLines } = req.query;
    
    if (!file) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const projectPath = await getProjectPath(projectId);
    const limit = maxLines ? parseInt(maxLines, 10) : 2000;
    const result = await gitManager.getDiff(projectPath, file, staged === 'true', limit);
    res.json(result);
  } catch (error) {
    console.error('Error getting diff:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to get diff',
      message: error.message
    });
  }
});

/**
 * GET /api/git/:projectId/log
 * Get recent commits
 * Query: limit (optional, default 10)
 */
gitRoutes.get('/:projectId/log', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { limit } = req.query;
    
    const projectPath = await getProjectPath(projectId);
    const commits = await gitManager.getLog(projectPath, limit ? parseInt(limit, 10) : 10);
    res.json({ commits });
  } catch (error) {
    console.error('Error getting log:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to get log',
      message: error.message
    });
  }
});

/**
 * GET /api/git/:projectId/remotes
 * Get list of remotes
 */
gitRoutes.get('/:projectId/remotes', async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectPath = await getProjectPath(projectId);
    
    const remotes = await gitManager.getRemotes(projectPath);
    res.json({ remotes });
  } catch (error) {
    console.error('Error getting remotes:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to get remotes',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/fetch
 * Fetch from remote
 * Body: { remote?: string }
 */
gitRoutes.post('/:projectId/fetch', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { remote } = req.body;
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.fetch(projectPath, remote);
    res.json(result);
  } catch (error) {
    console.error('Error fetching:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to fetch',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/clean
 * Delete untracked files (undo adding new files)
 * Body: { files: string[] }
 */
gitRoutes.post('/:projectId/clean', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.cleanFiles(projectPath, files);
    res.json(result);
  } catch (error) {
    console.error('Error cleaning files:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to clean files',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/generate-commit-message
 * Generate a commit message using cursor-agent based on staged changes
 * Returns: { message: string }
 */
gitRoutes.post('/:projectId/generate-commit-message', async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectPath = await getProjectPath(projectId);
    
    console.log('[git.js] Generating commit message for project:', projectId);
    
    // Get the status to check for staged files
    const status = await gitManager.getStatus(projectPath);
    
    if (status.staged.length === 0) {
      return res.status(400).json({
        error: 'No staged changes',
        message: 'Please stage some changes before generating a commit message'
      });
    }
    
    // Get the diff for all staged changes
    const { stdout: stagedDiff } = await gitManager.execGit(projectPath, [
      'diff', '--cached', '--stat'
    ]);
    
    // Get a more detailed diff (limited to avoid token limits)
    const { stdout: detailedDiff } = await gitManager.execGit(projectPath, [
      'diff', '--cached', '-U3'  // 3 lines of context
    ], { timeout: 10000 });
    
    // Limit the diff size for the prompt
    const maxDiffLength = 8000;
    let diffForPrompt = detailedDiff;
    let truncated = false;
    if (detailedDiff.length > maxDiffLength) {
      diffForPrompt = detailedDiff.substring(0, maxDiffLength) + '\n\n[Diff truncated...]';
      truncated = true;
    }
    
    // Build the prompt for cursor-agent
    const prompt = `Generate a concise git commit message for the following staged changes. 

The message should:
- Start with a type prefix (feat:, fix:, refactor:, docs:, style:, test:, chore:)
- Be a single line, under 72 characters
- Describe WHAT changed and WHY, not HOW
- Use imperative mood (e.g., "Add feature" not "Added feature")

Staged files summary:
${stagedDiff}

${truncated ? '(Note: Full diff was truncated due to size)\n' : ''}
Detailed diff:
${diffForPrompt}

Respond with ONLY the commit message, nothing else. No quotes, no explanation, just the message.`;

    console.log('[git.js] Calling cursor-agent to generate commit message...');
    
    // Check if cursor-agent exists
    try {
      execSync('which cursor-agent', { stdio: 'pipe' });
    } catch (e) {
      return res.status(500).json({ 
        error: 'cursor-agent CLI not found',
        message: 'Please install cursor-agent: curl https://cursor.com/install -fsS | bash'
      });
    }
    
    // Call cursor-agent with the prompt
    const result = await new Promise((resolve, reject) => {
      const args = [
        '-p',  // Print mode (non-interactive)
        '--output-format', 'text',  // Plain text output
        prompt
      ];
      
      // Add workspace context for better understanding
      args.unshift('--workspace', projectPath);
      
      const agent = spawn('cursor-agent', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000  // 60 second timeout
      });
      
      let output = '';
      let errorOutput = '';
      
      agent.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      agent.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.log('[git.js] cursor-agent stderr:', data.toString());
      });
      
      agent.on('close', (code) => {
        if (code !== 0) {
          console.error('[git.js] cursor-agent failed with code:', code);
          console.error('[git.js] stderr:', errorOutput);
          reject(new Error(`cursor-agent failed: ${errorOutput || 'Unknown error'}`));
        } else {
          resolve(output.trim());
        }
      });
      
      agent.on('error', (err) => {
        console.error('[git.js] cursor-agent spawn error:', err);
        reject(err);
      });
    });
    
    // Clean up the response - remove any markdown formatting or extra content
    let message = result
      .replace(/^```[^\n]*\n?/, '')  // Remove opening code fence
      .replace(/\n?```$/, '')         // Remove closing code fence
      .replace(/^["']|["']$/g, '')    // Remove surrounding quotes
      .trim();
    
    // If the response is multi-line, take just the first meaningful line
    const lines = message.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      message = lines[0].trim();
    }
    
    // Ensure the message isn't too long
    if (message.length > 100) {
      message = message.substring(0, 97) + '...';
    }
    
    console.log('[git.js] Generated commit message:', message);
    
    res.json({ 
      message,
      stagedFiles: status.staged.length,
      truncated
    });
    
  } catch (error) {
    console.error('Error generating commit message:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to generate commit message',
      message: error.message
    });
  }
});
