import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * SuggestionsReader - Reads rules, agents, commands, and skills from the filesystem
 * for @ and / autocomplete suggestions.
 * 
 * IDE-agnostic: scans common config directory patterns used by various tools
 * (e.g., .cursor/, .vscode/, .claude/, project-local config).
 */
export class SuggestionsReader {
  constructor() {
    this.homeDir = os.homedir();
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30 seconds
    
    // Config directory names to scan for rules/agents/commands
    // Supports multiple IDEs and tools
    this.configDirs = ['.cursor', '.vscode', '.claude', '.napptrapp'];
  }

  /**
   * Parse YAML frontmatter from markdown/mdc files
   * Returns { frontmatter: {...}, content: '...' }
   */
  parseFrontmatter(content) {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
    const match = content.match(frontmatterRegex);
    
    if (!match) {
      return { frontmatter: {}, content: content };
    }

    const frontmatterText = match[1];
    const bodyContent = match[2];
    const frontmatter = {};

    // Simple YAML parsing for key: value pairs
    const lines = frontmatterText.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();
        
        // Handle quoted strings
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        // Handle booleans
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        
        frontmatter[key] = value;
      }
    }

    return { frontmatter, content: bodyContent };
  }

  /**
   * Extract description from markdown content (first paragraph or heading)
   */
  extractDescription(content) {
    const lines = content.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and headings
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Return first non-empty, non-heading line as description
      return trimmed.substring(0, 200); // Limit to 200 chars
    }
    return null;
  }

  /**
   * Read project rules from {configDir}/rules/*.mdc or *.md
   * Scans across multiple config directories
   */
  async getProjectRules(projectPath) {
    const rules = [];

    for (const configDir of this.configDirs) {
      const rulesDir = path.join(projectPath, configDir, 'rules');

      try {
        const files = await fs.readdir(rulesDir);
        
        for (const file of files) {
          if (!file.endsWith('.mdc') && !file.endsWith('.md')) continue;
          
          try {
            const filePath = path.join(rulesDir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const { frontmatter } = this.parseFrontmatter(content);
            
            const ext = path.extname(file);
            const name = path.basename(file, ext);
            
            // Skip duplicates (first config dir wins)
            if (rules.find(r => r.name === name)) continue;
            
            rules.push({
              id: `rule:${name}`,
              type: 'rule',
              name: name,
              description: frontmatter.description || null,
              alwaysApply: frontmatter.alwaysApply || false,
              globs: frontmatter.globs || null,
              path: filePath,
              source: configDir
            });
          } catch (e) {
            // Skip files that can't be read
            console.error(`Error reading rule file ${file}:`, e.message);
          }
        }
      } catch (e) {
        // Rules directory doesn't exist for this config dir
      }
    }

    return rules;
  }

  /**
   * Read agents from project and user-level config directories
   */
  async getAgents(projectPath) {
    const agents = [];
    const locations = [];

    // Project-level agents
    for (const configDir of this.configDirs) {
      locations.push({
        dir: path.join(projectPath, configDir, 'agents'),
        scope: 'project'
      });
    }

    // User-level agents
    for (const configDir of this.configDirs) {
      locations.push({
        dir: path.join(this.homeDir, configDir, 'agents'),
        scope: 'user'
      });
    }

    for (const { dir, scope } of locations) {
      try {
        const files = await fs.readdir(dir);
        
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          
          try {
            const filePath = path.join(dir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const { frontmatter } = this.parseFrontmatter(content);
            
            const name = frontmatter.name || path.basename(file, '.md');
            
            // Check if we already have this agent (first match wins)
            if (agents.find(a => a.name === name)) continue;
            
            agents.push({
              id: `agent:${name}`,
              type: 'agent',
              name: name,
              description: frontmatter.description || null,
              model: frontmatter.model || null,
              readonly: frontmatter.readonly || false,
              scope: scope,
              path: filePath
            });
          } catch (e) {
            console.error(`Error reading agent file ${file}:`, e.message);
          }
        }
      } catch (e) {
        // Agents directory doesn't exist
      }
    }

    return agents;
  }

  /**
   * Read commands from {configDir}/commands/*.md
   */
  async getCommands(projectPath) {
    const commands = [];

    for (const configDir of this.configDirs) {
      const commandsDir = path.join(projectPath, configDir, 'commands');

      try {
        const files = await fs.readdir(commandsDir);
        
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          
          try {
            const filePath = path.join(commandsDir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const { frontmatter, content: bodyContent } = this.parseFrontmatter(content);
            
            const name = path.basename(file, '.md');
            
            // Skip duplicates
            if (commands.find(c => c.name === name)) continue;
            
            const description = frontmatter.description || this.extractDescription(bodyContent);
            
            commands.push({
              id: `command:${name}`,
              type: 'command',
              name: name,
              description: description,
              path: filePath
            });
          } catch (e) {
            console.error(`Error reading command file ${file}:`, e.message);
          }
        }
      } catch (e) {
        // Commands directory doesn't exist
      }
    }

    return commands;
  }

  /**
   * Read skills from user-level skill directories
   */
  async getSkills() {
    const skills = [];
    const skillsLocations = [];

    // Scan for skills across multiple config directories
    for (const configDir of this.configDirs) {
      skillsLocations.push(path.join(this.homeDir, configDir, 'skills'));
      skillsLocations.push(path.join(this.homeDir, configDir, 'skills-cursor'));
    }
    // Also check legacy paths
    skillsLocations.push(path.join(this.homeDir, '.codex', 'skills'));

    for (const skillsDir of skillsLocations) {
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('.')) continue;
          
          const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
          
          try {
            const content = await fs.readFile(skillFile, 'utf-8');
            const { frontmatter } = this.parseFrontmatter(content);
            
            const name = frontmatter.name || entry.name;
            
            // Skip if we already have this skill
            if (skills.find(s => s.name === name)) continue;
            
            skills.push({
              id: `skill:${name}`,
              type: 'skill',
              name: name,
              description: frontmatter.description || null,
              path: skillFile
            });
          } catch (e) {
            // SKILL.md doesn't exist in this directory
          }
        }
      } catch (e) {
        // Skills directory doesn't exist
      }
    }

    return skills;
  }

  /**
   * Search project files for @ file mentions
   */
  async searchFiles(projectPath, query, maxResults = 20) {
    const files = [];
    const skipDirs = ['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv', 'Pods'];
    
    const searchDir = async (dirPath, relativePath = '') => {
      if (files.length >= maxResults) return;
      
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (files.length >= maxResults) break;
          
          // Skip hidden and common large directories
          if (entry.name.startsWith('.')) continue;
          if (skipDirs.includes(entry.name)) continue;
          
          const fullPath = path.join(dirPath, entry.name);
          const relPath = path.join(relativePath, entry.name);
          
          if (entry.isDirectory()) {
            await searchDir(fullPath, relPath);
          } else if (entry.isFile()) {
            // Filter by query if provided
            if (query && !entry.name.toLowerCase().includes(query.toLowerCase()) &&
                !relPath.toLowerCase().includes(query.toLowerCase())) {
              continue;
            }
            
            files.push({
              id: `file:${relPath}`,
              type: 'file',
              name: entry.name,
              description: relPath,
              path: fullPath,
              relativePath: relPath
            });
          }
        }
      } catch (e) {
        // Can't read directory
      }
    };

    await searchDir(projectPath);
    return files;
  }

  /**
   * Get all suggestions for a project
   */
  async getAllSuggestions(projectPath, query = '', types = null) {
    const cacheKey = `${projectPath}:${query}:${types?.join(',') || 'all'}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    const allTypes = types || ['rules', 'agents', 'commands', 'skills', 'files'];
    let suggestions = [];

    // Fetch all types in parallel
    const promises = [];
    
    if (allTypes.includes('rules')) {
      promises.push(this.getProjectRules(projectPath).then(items => suggestions.push(...items)));
    }
    if (allTypes.includes('agents')) {
      promises.push(this.getAgents(projectPath).then(items => suggestions.push(...items)));
    }
    if (allTypes.includes('commands')) {
      promises.push(this.getCommands(projectPath).then(items => suggestions.push(...items)));
    }
    if (allTypes.includes('skills')) {
      promises.push(this.getSkills().then(items => suggestions.push(...items)));
    }
    if (allTypes.includes('files') && query) {
      // Only search files if there's a query (to avoid returning too many results)
      promises.push(this.searchFiles(projectPath, query).then(items => suggestions.push(...items)));
    }

    await Promise.all(promises);

    // Filter by query if provided
    if (query) {
      const lowerQuery = query.toLowerCase();
      suggestions = suggestions.filter(s => 
        s.name.toLowerCase().includes(lowerQuery) ||
        (s.description && s.description.toLowerCase().includes(lowerQuery))
      );
    }

    // Sort by type priority and name
    const typePriority = { rule: 1, agent: 2, command: 3, skill: 4, file: 5 };
    suggestions.sort((a, b) => {
      const priorityDiff = (typePriority[a.type] || 99) - (typePriority[b.type] || 99);
      if (priorityDiff !== 0) return priorityDiff;
      return a.name.localeCompare(b.name);
    });

    // Cache the results
    this.cache.set(cacheKey, { data: suggestions, timestamp: Date.now() });

    return suggestions;
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }
}
