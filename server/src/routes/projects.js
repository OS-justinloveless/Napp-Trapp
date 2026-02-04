import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { CursorWorkspace } from '../utils/CursorWorkspace.js';
import { CursorChatReader } from '../utils/CursorChatReader.js';

/**
 * Determine if a conversation is read-only from mobile's perspective.
 */
function isConversationReadOnly(chat) {
  if (chat.source === 'mobile') {
    return false;
  }
  if (chat.hasMobileMessages && chat.source !== 'mobile') {
    return true;
  }
  return true;
}

/**
 * Add read-only flag and metadata to conversations for mobile clients
 */
function enrichConversationForMobile(chat) {
  const isReadOnly = isConversationReadOnly(chat);
  return {
    ...chat,
    isReadOnly,
    readOnlyReason: isReadOnly 
      ? 'This conversation was created in Cursor IDE. You can view it but cannot add messages.'
      : null,
    canFork: isReadOnly && chat.messageCount > 0
  };
}

const router = Router();
const cursorWorkspace = new CursorWorkspace();
const chatReader = new CursorChatReader();

// Get list of recent Cursor projects
router.get('/', async (req, res) => {
  try {
    const projects = await cursorWorkspace.getRecentProjects();
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
    const project = await cursorWorkspace.getProjectDetails(projectId);
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
    const tree = await cursorWorkspace.getProjectTree(projectId, parseInt(depth));
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
      await cursorWorkspace.initializeTemplate(fullPath, template);
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
    
    // Save to created projects list so it shows up in the projects drawer
    await cursorWorkspace.saveCreatedProject({
      name,
      path: fullPath,
      createdAt
    });
    
    // Clear cache so the new project shows up immediately
    cursorWorkspace.recentProjectsCache = null;
    cursorWorkspace.cacheTimestamp = null;
    
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

// Open project in Cursor
router.post('/:projectId/open', async (req, res) => {
  try {
    const { projectId } = req.params;
    const result = await cursorWorkspace.openInCursor(projectId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error opening project:', error);
    res.status(500).json({ error: 'Failed to open project in Cursor' });
  }
});

// Get conversations/chats for a specific project
router.get('/:projectId/conversations', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await cursorWorkspace.getProjectDetails(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const conversations = await chatReader.getChatsByProjectPath(project.path);
    
    // Estimate tokens for each conversation and enrich with mobile metadata
    let totalProjectTokens = 0;
    const conversationsWithTokens = await Promise.all(
      conversations.map(async (conv) => {
        const estimatedTokens = await chatReader.estimateConversationTokens(
          conv.id,
          conv.type,
          conv.workspaceId
        );
        totalProjectTokens += estimatedTokens;
        // Add mobile-specific fields (isReadOnly, readOnlyReason, canFork)
        const enriched = enrichConversationForMobile(conv);
        return {
          ...enriched,
          estimatedTokens
        };
      })
    );
    
    res.json({ 
      conversations: conversationsWithTokens,
      total: conversationsWithTokens.length,
      totalTokens: totalProjectTokens,
      projectName: project.name,
      projectPath: project.path
    });
  } catch (error) {
    console.error('Error fetching project conversations:', error);
    res.status(500).json({ error: 'Failed to fetch project conversations' });
  }
});

export { router as projectRoutes };
