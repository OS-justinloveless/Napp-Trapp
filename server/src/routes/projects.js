import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { CursorWorkspace } from '../utils/CursorWorkspace.js';

const router = Router();
const cursorWorkspace = new CursorWorkspace();

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
    const { name, path: projectPath, template } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    const basePath = projectPath || path.join(os.homedir(), 'Projects');
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
      `# ${name}\n\nCreated from Cursor Mobile Access`
    );
    
    res.json({ 
      success: true, 
      project: { 
        name, 
        path: fullPath,
        createdAt: new Date().toISOString()
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

export { router as projectRoutes };
