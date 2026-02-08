import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ProjectManager } from '../utils/ProjectManager.js';
import { tmuxManager } from '../utils/TmuxManager.js';

const router = Router();
const projectManager = new ProjectManager();

// Get list of projects
router.get('/', async (req, res) => {
  try {
    const projects = await projectManager.getRecentProjects();
    res.json({ projects });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get project details
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await projectManager.getProjectDetails(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ project });
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project details' });
  }
});

// Get project file tree
router.get('/:projectId/tree', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { depth = 3 } = req.query;
    const tree = await projectManager.getProjectTree(projectId, parseInt(depth));
    res.json({ tree });
  } catch (error) {
    console.error('Error fetching project tree:', error);
    res.status(500).json({ error: 'Failed to fetch project tree' });
  }
});

// Create a new project
router.post('/', async (req, res) => {
  try {
    const { name, path: projectPath, template, createGitRepo } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    // Expand ~ to home directory if present
    let basePath = projectPath || path.join(os.homedir(), 'Projects');
    if (basePath.startsWith('~')) {
      basePath = path.join(os.homedir(), basePath.slice(1));
    }
    const fullPath = path.join(basePath, name);
    
    // Create project directory
    await fs.mkdir(fullPath, { recursive: true });
    
    // Initialize with template if specified
    if (template) {
      await projectManager.initializeTemplate(fullPath, template);
    }
    
    // Create basic project structure
    await fs.mkdir(path.join(fullPath, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(fullPath, 'README.md'),
      `# ${name}\n\nCreated from Napp Trapp`
    );
    
    // Create .gitignore
    await fs.writeFile(
      path.join(fullPath, '.gitignore'),
      `# Dependencies
node_modules/
.venv/
venv/

# Build outputs
dist/
build/
*.egg-info/

# IDE
.idea/
.vscode/
*.swp
*.swo

# Environment
.env
.env.local

# OS
.DS_Store
Thumbs.db
`
    );
    
    let gitRepoUrl = null;
    let gitError = null;
    
    // Initialize git and create GitHub repo if requested
    if (createGitRepo) {
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        // Initialize git repo
        await execAsync('git init', { cwd: fullPath });
        
        // Add all files and create initial commit
        await execAsync('git add .', { cwd: fullPath });
        await execAsync('git commit -m "Initial commit from Napp Trapp"', { cwd: fullPath });
        
        // Create GitHub repo using gh CLI and push
        try {
          const { stdout } = await execAsync(`gh repo create ${name} --private --source=. --remote=origin --push`, { cwd: fullPath });
          
          // Extract repo URL from gh output or construct it
          const repoMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
          if (repoMatch) {
            gitRepoUrl = repoMatch[0];
          } else {
            // Try to get the remote URL
            const { stdout: remoteUrl } = await execAsync('git remote get-url origin', { cwd: fullPath });
            gitRepoUrl = remoteUrl.trim();
          }
        } catch (ghError) {
          console.error('GitHub repo creation failed:', ghError.message);
          gitError = `Git initialized but GitHub repo creation failed: ${ghError.message}`;
        }
      } catch (gitInitError) {
        console.error('Git initialization failed:', gitInitError.message);
        gitError = `Git initialization failed: ${gitInitError.message}`;
      }
    }
    
    const createdAt = new Date().toISOString();
    
    // Register the project so it shows up in the project list
    await projectManager.registerProject({
      name,
      path: fullPath,
      lastOpened: createdAt
    });
    
    // Clear cache so the new project shows up immediately
    projectManager.recentProjectsCache = null;
    projectManager.cacheTimestamp = null;
    
    res.json({ 
      success: true, 
      project: { 
        name, 
        path: fullPath,
        createdAt,
        gitRepoUrl,
        gitError
      } 
    });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Open an arbitrary folder as a project (register it so it shows up in the project list)
router.post('/open-folder', async (req, res) => {
  try {
    const { folderPath } = req.body;
    
    if (!folderPath) {
      return res.status(400).json({ error: 'folderPath is required' });
    }
    
    // Expand ~ to home directory if present
    let resolvedPath = folderPath;
    if (resolvedPath.startsWith('~')) {
      resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
    }
    resolvedPath = path.resolve(resolvedPath);
    
    // Verify the path exists and is a directory
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (e) {
      return res.status(404).json({ error: 'Directory does not exist' });
    }
    
    const projectName = path.basename(resolvedPath);
    const projectId = Buffer.from(resolvedPath).toString('base64');
    
    // Register the project
    await projectManager.registerProject({
      name: projectName,
      path: resolvedPath,
      lastOpened: new Date().toISOString()
    });
    
    // Clear cache so the project shows up immediately
    projectManager.recentProjectsCache = null;
    projectManager.cacheTimestamp = null;
    
    const project = {
      id: projectId,
      name: projectName,
      path: resolvedPath,
      lastOpened: new Date().toISOString()
    };
    
    res.json({ success: true, project });
  } catch (error) {
    console.error('Error opening folder as project:', error);
    res.status(500).json({ error: 'Failed to open folder as project' });
  }
});

// Remove a project from the list (doesn't delete files)
router.delete('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await projectManager.getProjectDetails(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    await projectManager.unregisterProject(project.path);
    
    // Clear cache
    projectManager.recentProjectsCache = null;
    projectManager.cacheTimestamp = null;
    
    res.json({ success: true, message: 'Project removed from list' });
  } catch (error) {
    console.error('Error removing project:', error);
    res.status(500).json({ error: 'Failed to remove project' });
  }
});

// Get chat windows for a specific project
// Chats are tmux windows with names starting with "chat-"
router.get('/:projectId/conversations', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await projectManager.getProjectDetails(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Get chat windows from tmux
    const chatWindows = tmuxManager.listChatWindows(project.path);
    
    // Format for API response
    const chats = chatWindows.map(w => ({
      id: w.id,
      terminalId: w.id,
      windowName: w.windowName,
      tool: w.tool,
      topic: w.topic,
      sessionName: w.sessionName,
      windowIndex: w.windowIndex,
      projectPath: project.path,
      type: 'chat',
      source: 'tmux',
      active: w.active,
      title: `${w.tool}: ${w.topic}`,
      timestamp: Date.now(),
      messageCount: 0,
      isReadOnly: false,
      canFork: false
    }));
    
    res.json({ 
      conversations: chats,
      chats,
      total: chats.length,
      projectName: project.name,
      projectPath: project.path
    });
  } catch (error) {
    console.error('Error fetching project chat windows:', error);
    res.status(500).json({ error: 'Failed to fetch project chat windows' });
  }
});

export { router as projectRoutes };
