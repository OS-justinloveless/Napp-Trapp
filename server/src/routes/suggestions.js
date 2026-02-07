import { Router } from 'express';
import { ProjectManager } from '../utils/ProjectManager.js';
import { SuggestionsReader } from '../utils/SuggestionsReader.js';

const router = Router();
const projectManager = new ProjectManager();
const suggestionsReader = new SuggestionsReader();

/**
 * GET /api/suggestions/:projectId
 * 
 * Returns autocomplete suggestions for @ and / triggers.
 * 
 * Query params:
 *   - type: Filter by type (rules|agents|commands|skills|files|all)
 *   - query: Search filter string
 * 
 * Response:
 *   { suggestions: [...] }
 */
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { type = 'all', query = '' } = req.query;

    // Get project details to get the path
    const project = await projectManager.getProjectDetails(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Determine which types to fetch
    let types = null;
    if (type !== 'all') {
      // Map singular to plural for internal use
      const typeMap = {
        'rule': 'rules',
        'rules': 'rules',
        'agent': 'agents',
        'agents': 'agents',
        'command': 'commands',
        'commands': 'commands',
        'skill': 'skills',
        'skills': 'skills',
        'file': 'files',
        'files': 'files'
      };
      
      if (type.includes(',')) {
        types = type.split(',').map(t => typeMap[t.trim()] || t.trim());
      } else {
        types = [typeMap[type] || type];
      }
    }

    const suggestions = await suggestionsReader.getAllSuggestions(
      project.path,
      query,
      types
    );

    res.json({ 
      suggestions,
      total: suggestions.length,
      projectPath: project.path
    });
  } catch (error) {
    console.error('Error fetching suggestions:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

/**
 * GET /api/suggestions/:projectId/rules
 * Get only project rules
 */
router.get('/:projectId/rules', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await projectManager.getProjectDetails(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const rules = await suggestionsReader.getProjectRules(project.path);
    res.json({ suggestions: rules, total: rules.length });
  } catch (error) {
    console.error('Error fetching rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

/**
 * GET /api/suggestions/:projectId/agents
 * Get agents (project + user level)
 */
router.get('/:projectId/agents', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await projectManager.getProjectDetails(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const agents = await suggestionsReader.getAgents(project.path);
    res.json({ suggestions: agents, total: agents.length });
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

/**
 * GET /api/suggestions/:projectId/commands
 * Get slash commands
 */
router.get('/:projectId/commands', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await projectManager.getProjectDetails(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const commands = await suggestionsReader.getCommands(project.path);
    res.json({ suggestions: commands, total: commands.length });
  } catch (error) {
    console.error('Error fetching commands:', error);
    res.status(500).json({ error: 'Failed to fetch commands' });
  }
});

/**
 * GET /api/suggestions/skills
 * Get user skills (not project-specific)
 */
router.get('/skills', async (req, res) => {
  try {
    const skills = await suggestionsReader.getSkills();
    res.json({ suggestions: skills, total: skills.length });
  } catch (error) {
    console.error('Error fetching skills:', error);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

/**
 * POST /api/suggestions/clear-cache
 * Clear the suggestions cache
 */
router.post('/clear-cache', async (req, res) => {
  try {
    suggestionsReader.clearCache();
    res.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

export { router as suggestionsRoutes };
