import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * ProjectManager - Manages project discovery and registration
 * 
 * Projects are tracked via a local registry file. Users can:
 * - Register existing folders as projects
 * - Create new projects from templates
 * - Browse project file trees
 * 
 * This is IDE-agnostic -- it doesn't depend on any specific editor.
 */
export class ProjectManager {
  constructor(options = {}) {
    this.recentProjectsCache = null;
    this.cacheTimestamp = null;
    this.cacheDuration = 30000; // 30 seconds
    
    // Data directory can be configured (CLI uses ~/.napptrapp, dev uses local)
    this.dataDir = options.dataDir || path.join(process.cwd(), '.napp-trapp-data');
    this.registeredProjectsFile = path.join(this.dataDir, 'registered-projects.json');
    
    // Legacy path for migration
    this.legacyCreatedProjectsFile = path.join(this.dataDir, 'created-projects.json');
  }

  /**
   * Get all registered projects from disk
   */
  async getRegisteredProjects() {
    // Try new file first, then legacy
    for (const filePath of [this.registeredProjectsFile, this.legacyCreatedProjectsFile]) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
      } catch (e) {
        // File doesn't exist, try next
      }
    }
    return [];
  }

  /**
   * Save/register a project so it appears in the project list
   */
  async registerProject(project) {
    const projects = await this.getRegisteredProjects();
    
    // Avoid duplicates
    const existingIndex = projects.findIndex(p => p.path === project.path);
    
    const projectEntry = {
      id: Buffer.from(project.path).toString('base64'),
      name: project.name || path.basename(project.path),
      path: project.path,
      lastOpened: project.lastOpened || project.createdAt || new Date().toISOString()
    };
    
    if (existingIndex >= 0) {
      // Update existing entry
      projects[existingIndex] = { ...projects[existingIndex], ...projectEntry };
    } else {
      projects.push(projectEntry);
    }
    
    // Ensure directory exists
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.registeredProjectsFile, JSON.stringify(projects, null, 2));
  }

  /**
   * Unregister a project (remove from list, doesn't delete files)
   */
  async unregisterProject(projectPath) {
    const projects = await this.getRegisteredProjects();
    const filtered = projects.filter(p => p.path !== projectPath);
    
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.registeredProjectsFile, JSON.stringify(filtered, null, 2));
  }

  /**
   * Get all known projects (registered projects that still exist on disk)
   */
  async getRecentProjects() {
    // Check cache
    if (this.recentProjectsCache && 
        this.cacheTimestamp && 
        Date.now() - this.cacheTimestamp < this.cacheDuration) {
      return this.recentProjectsCache;
    }

    const registeredProjects = await this.getRegisteredProjects();
    const projects = [];
    
    for (const project of registeredProjects) {
      try {
        await fs.access(project.path);
        const stats = await fs.stat(project.path);
        
        if (stats.isDirectory()) {
          projects.push({
            id: project.id || Buffer.from(project.path).toString('base64'),
            name: project.name || path.basename(project.path),
            path: project.path,
            lastOpened: project.lastOpened || stats.mtime.toISOString()
          });
        }
      } catch (e) {
        // Project no longer exists on disk, skip it
      }
    }
    
    // Sort by last opened
    projects.sort((a, b) => new Date(b.lastOpened) - new Date(a.lastOpened));
    
    // Update cache
    this.recentProjectsCache = projects;
    this.cacheTimestamp = Date.now();
    
    return projects;
  }

  async getProjectDetails(projectId) {
    const projects = await this.getRecentProjects();
    const project = projects.find(p => p.id === projectId);
    
    if (!project) {
      // Try decoding as base64 path
      try {
        const projectPath = Buffer.from(projectId, 'base64').toString('utf-8');
        const stats = await fs.stat(projectPath);
        
        if (stats.isDirectory()) {
          return {
            id: projectId,
            name: path.basename(projectPath),
            path: projectPath,
            lastOpened: stats.mtime.toISOString()
          };
        }
      } catch (e) {
        return null;
      }
    }
    
    return project;
  }

  async getProjectTree(projectId, maxDepth = 3) {
    const project = await this.getProjectDetails(projectId);
    
    if (!project) {
      return null;
    }
    
    return this.buildTree(project.path, 0, maxDepth);
  }

  async buildTree(dirPath, currentDepth, maxDepth) {
    if (currentDepth >= maxDepth) {
      return null;
    }
    
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const tree = [];
    
    // Common directories to skip
    const skipDirs = ['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv'];
    
    for (const entry of entries) {
      // Skip hidden files and common large directories
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      if (skipDirs.includes(entry.name)) continue;
      
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        tree.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children: await this.buildTree(fullPath, currentDepth + 1, maxDepth)
        });
      } else {
        const stats = await fs.stat(fullPath);
        tree.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          size: stats.size,
          extension: path.extname(entry.name).slice(1)
        });
      }
    }
    
    // Sort: directories first, then files
    tree.sort((a, b) => {
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
    
    return tree;
  }

  async initializeTemplate(projectPath, template) {
    switch (template) {
      case 'node':
        await fs.writeFile(
          path.join(projectPath, 'package.json'),
          JSON.stringify({
            name: path.basename(projectPath),
            version: '1.0.0',
            main: 'index.js',
            scripts: {
              start: 'node index.js'
            }
          }, null, 2)
        );
        await fs.writeFile(
          path.join(projectPath, 'index.js'),
          'console.log("Hello from Napp Trapp!");\n'
        );
        break;
        
      case 'python':
        await fs.writeFile(
          path.join(projectPath, 'requirements.txt'),
          '# Add your dependencies here\n'
        );
        await fs.writeFile(
          path.join(projectPath, 'main.py'),
          'print("Hello from Napp Trapp!")\n'
        );
        break;
        
      case 'react':
        await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });
        await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
        await fs.writeFile(
          path.join(projectPath, 'package.json'),
          JSON.stringify({
            name: path.basename(projectPath),
            version: '1.0.0',
            scripts: {
              dev: 'vite',
              build: 'vite build'
            }
          }, null, 2)
        );
        break;
        
      default:
        // No template
        break;
    }
  }
}
