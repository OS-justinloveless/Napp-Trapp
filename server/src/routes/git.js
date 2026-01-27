import express from 'express';
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
  try {
    const { projectId } = req.params;
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const projectPath = await getProjectPath(projectId);
    const result = await gitManager.stageFiles(projectPath, files);
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
