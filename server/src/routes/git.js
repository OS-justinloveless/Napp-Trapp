import express from 'express';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { GitManager } from '../utils/GitManager.js';
import { ProjectManager } from '../utils/ProjectManager.js';
import { getSupportedTools, getCLIAdapter } from '../utils/CLIAdapter.js';

export const gitRoutes = express.Router();
const gitManager = new GitManager();
const workspace = new ProjectManager();

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
 * Helper to resolve the actual repo path, optionally joining with repoPath
 * @param {string} projectId - Project ID
 * @param {string} repoPath - Optional relative path to sub-repository
 * @returns {Promise<string>} - Full file system path to the repository
 */
async function resolveRepoPath(projectId, repoPath) {
  const projectPath = await getProjectPath(projectId);
  if (repoPath && repoPath !== '.') {
    return path.join(projectPath, repoPath);
  }
  return projectPath;
}

/**
 * GET /api/git/:projectId/status
 * Get git status for a project
 * Query: repoPath (optional) - relative path to sub-repository
 */
gitRoutes.get('/:projectId/status', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    
    // Check if it's a git repo
    const isRepo = await gitManager.isGitRepo(repoFullPath);
    if (!isRepo) {
      return res.status(400).json({
        error: 'Not a git repository',
        projectPath: repoFullPath
      });
    }
    
    const status = await gitManager.getStatus(repoFullPath);
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
 * Query: repoPath (optional) - relative path to sub-repository
 */
gitRoutes.get('/:projectId/branches', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    
    const branches = await gitManager.getBranches(repoFullPath);
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
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { files: string[] }
 */
gitRoutes.post('/:projectId/stage', async (req, res) => {
  console.log('[git.js] POST /stage - projectId:', req.params.projectId, 'body:', req.body);
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      console.log('[git.js] stage - files array is empty or invalid');
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    console.log('[git.js] stage - repoFullPath:', repoFullPath, 'files:', files);
    const result = await gitManager.stageFiles(repoFullPath, files);
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
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { files: string[] }
 */
gitRoutes.post('/:projectId/unstage', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.unstageFiles(repoFullPath, files);
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
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { files: string[] }
 */
gitRoutes.post('/:projectId/discard', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.discardChanges(repoFullPath, files);
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
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { message: string, files?: string[] }
 */
gitRoutes.post('/:projectId/commit', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { message, files } = req.body;
    
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Commit message is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.commit(repoFullPath, message, files);
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
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { remote?: string, branch?: string }
 */
gitRoutes.post('/:projectId/push', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { remote, branch } = req.body;
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.push(repoFullPath, remote, branch);
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
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { remote?: string, branch?: string }
 */
gitRoutes.post('/:projectId/pull', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { remote, branch } = req.body;
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.pull(repoFullPath, remote, branch);
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
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { branch: string }
 */
gitRoutes.post('/:projectId/checkout', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { branch } = req.body;
    
    if (!branch || typeof branch !== 'string') {
      return res.status(400).json({ error: 'Branch name is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.checkout(repoFullPath, branch);
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
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { name: string, checkout?: boolean }
 */
gitRoutes.post('/:projectId/branch', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { name, checkout, startPoint } = req.body;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Branch name is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    let result;
    if (startPoint) {
      result = await gitManager.createBranchFrom(repoFullPath, name, startPoint, checkout !== false);
    } else {
      result = await gitManager.createBranch(repoFullPath, name, checkout !== false);
    }
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
 * Query: file (required), staged (optional boolean), commitHash (optional), maxLines (optional, default 2000), repoPath (optional)
 * When commitHash is provided, returns the diff for that file in that specific commit.
 */
gitRoutes.get('/:projectId/diff', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { file, staged, commitHash, maxLines, repoPath } = req.query;
    
    if (!file) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const limit = maxLines ? parseInt(maxLines, 10) : 2000;
    
    let result;
    if (commitHash) {
      result = await gitManager.getCommitDiff(repoFullPath, commitHash, file, limit);
    } else {
      result = await gitManager.getDiff(repoFullPath, file, staged === 'true', limit);
    }
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
 * Query: limit (optional, default 10), skip (optional, default 0), repoPath (optional)
 */
gitRoutes.get('/:projectId/log', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { limit, skip, repoPath } = req.query;
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const parsedSkip = skip ? parseInt(skip, 10) : 0;
    const commits = await gitManager.getLog(repoFullPath, parsedLimit, parsedSkip);
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
 * Query: repoPath (optional) - relative path to sub-repository
 */
gitRoutes.get('/:projectId/remotes', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    
    const remotes = await gitManager.getRemotes(repoFullPath);
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
 * GET /api/git/:projectId/scan-repos
 * Scan project for all git repositories (including sub-repos)
 * Query: maxDepth (optional, default 5) - maximum directory depth to scan
 * Returns: { repositories: [{ path: string, name: string }] }
 */
gitRoutes.get('/:projectId/scan-repos', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { maxDepth } = req.query;
    const projectPath = await getProjectPath(projectId);
    
    const options = {};
    if (maxDepth) {
      options.maxDepth = parseInt(maxDepth, 10);
    }
    
    const repositories = await gitManager.scanForRepositories(projectPath, options);
    res.json({ repositories });
  } catch (error) {
    console.error('Error scanning for repositories:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to scan for repositories',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/fetch
 * Fetch from remote
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { remote?: string }
 */
gitRoutes.post('/:projectId/fetch', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { remote } = req.body;
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.fetch(repoFullPath, remote);
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
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { files: string[] }
 */
gitRoutes.post('/:projectId/clean', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.cleanFiles(repoFullPath, files);
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
 * GET /api/git/:projectId/commit/:hash
 * Get detailed information for a single commit
 * Query: repoPath (optional) - relative path to sub-repository
 */
gitRoutes.get('/:projectId/commit/:hash', async (req, res) => {
  try {
    const { projectId, hash } = req.params;
    const { repoPath } = req.query;
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    
    const detail = await gitManager.getCommitDetail(repoFullPath, hash);
    res.json(detail);
  } catch (error) {
    console.error('Error getting commit detail:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to get commit detail',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/checkout-detached
 * Checkout a commit in detached HEAD mode
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { hash: string }
 */
gitRoutes.post('/:projectId/checkout-detached', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { hash } = req.body;
    
    if (!hash || typeof hash !== 'string') {
      return res.status(400).json({ error: 'Commit hash is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.checkoutCommit(repoFullPath, hash);
    res.json(result);
  } catch (error) {
    console.error('Error checking out commit:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to checkout commit',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/cherry-pick
 * Cherry-pick a commit onto the current branch
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { hash: string }
 */
gitRoutes.post('/:projectId/cherry-pick', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { hash } = req.body;
    
    if (!hash || typeof hash !== 'string') {
      return res.status(400).json({ error: 'Commit hash is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.cherryPick(repoFullPath, hash);
    res.json(result);
  } catch (error) {
    console.error('Error cherry-picking commit:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to cherry-pick commit',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/revert-commit
 * Revert a commit (creates a new revert commit)
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { hash: string }
 */
gitRoutes.post('/:projectId/revert-commit', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { hash } = req.body;
    
    if (!hash || typeof hash !== 'string') {
      return res.status(400).json({ error: 'Commit hash is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.revertCommit(repoFullPath, hash);
    res.json(result);
  } catch (error) {
    console.error('Error reverting commit:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to revert commit',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/tag
 * Create a tag on a commit
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { name: string, hash?: string, message?: string }
 */
gitRoutes.post('/:projectId/tag', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { name, hash, message } = req.body;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.createTag(repoFullPath, name, hash, message);
    res.json(result);
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to create tag',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/reset
 * Reset to a commit
 * Query: repoPath (optional) - relative path to sub-repository
 * Body: { hash: string, mode: "soft" | "mixed" | "hard" }
 */
gitRoutes.post('/:projectId/reset', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const { hash, mode } = req.body;
    
    if (!hash || typeof hash !== 'string') {
      return res.status(400).json({ error: 'Commit hash is required' });
    }
    
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    const result = await gitManager.resetToCommit(repoFullPath, hash, mode || 'mixed');
    res.json(result);
  } catch (error) {
    console.error('Error resetting to commit:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({
      error: 'Failed to reset to commit',
      message: error.message
    });
  }
});

/**
 * POST /api/git/:projectId/generate-commit-message
 * Generate a commit message using cursor-agent based on staged changes
 * Query: repoPath (optional) - relative path to sub-repository
 * Returns: { message: string }
 */
gitRoutes.post('/:projectId/generate-commit-message', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoPath } = req.query;
    const repoFullPath = await resolveRepoPath(projectId, repoPath);
    
    console.log('[git.js] Generating commit message for project:', projectId, 'repoPath:', repoPath);
    
    // Get the status to check for staged files
    const status = await gitManager.getStatus(repoFullPath);
    
    if (status.staged.length === 0) {
      return res.status(400).json({
        error: 'No staged changes',
        message: 'Please stage some changes before generating a commit message'
      });
    }
    
    // Get the diff for all staged changes
    const { stdout: stagedDiff } = await gitManager.execGit(repoFullPath, [
      'diff', '--cached', '--stat'
    ]);
    
    // Get a more detailed diff (limited to avoid token limits)
    const { stdout: detailedDiff } = await gitManager.execGit(repoFullPath, [
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
    
    // Build the prompt
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

    console.log('[git.js] Looking for available AI CLI tool to generate commit message...');
    
    // Find the first available AI CLI tool
    let availableTool = null;
    const toolPreference = ['claude', 'cursor-agent', 'gemini'];
    
    for (const toolName of toolPreference) {
      try {
        const adapter = getCLIAdapter(toolName);
        if (await adapter.isAvailable()) {
          availableTool = { name: toolName, adapter };
          break;
        }
      } catch (e) {
        // Tool not available, try next
      }
    }
    
    if (!availableTool) {
      return res.status(500).json({ 
        error: 'No AI CLI tool found',
        message: 'Please install an AI CLI tool (claude, cursor-agent, or gemini)'
      });
    }
    
    console.log(`[git.js] Using ${availableTool.name} to generate commit message...`);
    
    // Build the command based on the available tool
    const executable = availableTool.adapter.getResolvedExecutable();
    let args;
    
    switch (availableTool.name) {
      case 'claude':
        args = ['--print', '--output-format', 'text', prompt];
        break;
      case 'cursor-agent':
        args = ['--workspace', repoFullPath, '-p', '--output-format', 'text', prompt];
        break;
      case 'gemini':
        args = ['--prompt', prompt];
        break;
      default:
        args = [prompt];
    }
    
    // Call the AI CLI with the prompt
    const result = await new Promise((resolve, reject) => {
      const agent = spawn(executable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: repoFullPath,
        timeout: 60000  // 60 second timeout
      });
      
      let output = '';
      let errorOutput = '';
      
      agent.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      agent.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.log(`[git.js] ${availableTool.name} stderr:`, data.toString());
      });
      
      agent.on('close', (code) => {
        if (code !== 0) {
          console.error(`[git.js] ${availableTool.name} failed with code:`, code);
          console.error('[git.js] stderr:', errorOutput);
          reject(new Error(`${availableTool.name} failed: ${errorOutput || 'Unknown error'}`));
        } else {
          resolve(output.trim());
        }
      });
      
      agent.on('error', (err) => {
        console.error(`[git.js] ${availableTool.name} spawn error:`, err);
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
