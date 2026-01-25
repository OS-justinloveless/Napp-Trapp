import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CursorWorkspace {
  constructor() {
    this.recentProjectsCache = null;
    this.cacheTimestamp = null;
    this.cacheDuration = 30000; // 30 seconds
  }

  getCursorConfigPath() {
    const homeDir = os.homedir();
    
    switch (process.platform) {
      case 'darwin':
        return path.join(homeDir, 'Library', 'Application Support', 'Cursor');
      case 'win32':
        return path.join(homeDir, 'AppData', 'Roaming', 'Cursor');
      case 'linux':
        return path.join(homeDir, '.config', 'Cursor');
      default:
        return path.join(homeDir, '.cursor');
    }
  }

  async getRecentProjects() {
    // Check cache
    if (this.recentProjectsCache && 
        this.cacheTimestamp && 
        Date.now() - this.cacheTimestamp < this.cacheDuration) {
      return this.recentProjectsCache;
    }

    const projects = [];
    const configPath = this.getCursorConfigPath();
    
    // Try to read from various Cursor storage locations
    const storagePaths = [
      path.join(configPath, 'User', 'globalStorage', 'storage.json'),
      path.join(configPath, 'storage.json'),
      path.join(configPath, 'User', 'workspaceStorage')
    ];
    
    // Try reading global storage for recent files
    try {
      const storageJson = path.join(configPath, 'storage.json');
      const content = await fs.readFile(storageJson, 'utf-8');
      const data = JSON.parse(content);
      
      if (data.openedPathsList && data.openedPathsList.workspaces3) {
        for (const workspace of data.openedPathsList.workspaces3) {
          const workspacePath = workspace.replace('file://', '');
          try {
            const stats = await fs.stat(workspacePath);
            if (stats.isDirectory()) {
              projects.push({
                id: Buffer.from(workspacePath).toString('base64'),
                name: path.basename(workspacePath),
                path: workspacePath,
                lastOpened: stats.mtime.toISOString()
              });
            }
          } catch (e) {
            // Path no longer exists
          }
        }
      }
    } catch (e) {
      // Storage file not found
    }
    
    // Also scan workspace storage for active projects
    try {
      const workspaceStorage = path.join(configPath, 'User', 'workspaceStorage');
      const workspaces = await fs.readdir(workspaceStorage);
      
      for (const workspace of workspaces) {
        const workspacePath = path.join(workspaceStorage, workspace);
        const stats = await fs.stat(workspacePath);
        
        if (stats.isDirectory()) {
          try {
            // Try to read workspace.json to get the actual project path
            const workspaceJsonPath = path.join(workspacePath, 'workspace.json');
            const workspaceData = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'));
            
            if (workspaceData.folder) {
              const projectPath = workspaceData.folder.replace('file://', '');
              const projectName = path.basename(projectPath);
              
              // Check if project path exists
              try {
                await fs.access(projectPath);
                
                // Avoid duplicates
                if (!projects.find(p => p.path === projectPath)) {
                  projects.push({
                    id: workspace,
                    name: projectName,
                    path: projectPath,
                    lastOpened: stats.mtime.toISOString()
                  });
                }
              } catch (e) {
                // Project path no longer exists
              }
            }
          } catch (e) {
            // No workspace.json
          }
        }
      }
    } catch (e) {
      // Workspace storage not found
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
      return { truncated: true };
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

  async openInCursor(projectId) {
    const project = await this.getProjectDetails(projectId);
    
    if (!project) {
      throw new Error('Project not found');
    }
    
    let command;
    
    switch (process.platform) {
      case 'darwin':
        command = `open -a Cursor "${project.path}"`;
        break;
      case 'win32':
        command = `start "" "Cursor" "${project.path}"`;
        break;
      case 'linux':
        command = `cursor "${project.path}" &`;
        break;
      default:
        throw new Error('Unsupported platform');
    }
    
    await execAsync(command);
    
    return {
      opened: true,
      project
    };
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
          'console.log("Hello from Cursor Mobile!");\n'
        );
        break;
        
      case 'python':
        await fs.writeFile(
          path.join(projectPath, 'requirements.txt'),
          '# Add your dependencies here\n'
        );
        await fs.writeFile(
          path.join(projectPath, 'main.py'),
          'print("Hello from Cursor Mobile!")\n'
        );
        break;
        
      case 'react':
        // For React, just create a basic structure
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
