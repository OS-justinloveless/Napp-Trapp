import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

/**
 * Manages Git operations for projects
 * Uses execFile for safety (no shell injection)
 */
export class GitManager {
  constructor() {
    this.gitPath = 'git';
  }

  /**
   * Execute a git command in a project directory
   * @param {string} projectPath - The project directory
   * @param {string[]} args - Git command arguments
   * @param {object} options - Additional options
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async execGit(projectPath, args, options = {}) {
    const cwd = projectPath;
    
    // Verify the path exists
    if (!fs.existsSync(cwd)) {
      throw new Error(`Project path does not exist: ${cwd}`);
    }

    try {
      const result = await execFileAsync(this.gitPath, args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
        timeout: options.timeout || 30000,
        ...options
      });
      return result;
    } catch (error) {
      // Git commands may exit with non-zero codes for valid reasons
      // (e.g., no changes to commit), so we include the output
      if (error.stdout !== undefined) {
        return { stdout: error.stdout || '', stderr: error.stderr || '' };
      }
      throw error;
    }
  }

  /**
   * Check if a directory is a git repository
   */
  async isGitRepo(projectPath) {
    try {
      await this.execGit(projectPath, ['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get git status with detailed file information
   * @param {string} projectPath - Project directory
   * @returns {Promise<{branch: string, ahead: number, behind: number, staged: Array, unstaged: Array, untracked: Array}>}
   */
  async getStatus(projectPath) {
    // Use shorter timeout for status commands
    const statusTimeout = { timeout: 15000 };
    
    // Get current branch
    const { stdout: branchOutput } = await this.execGit(projectPath, ['branch', '--show-current'], statusTimeout);
    const branch = branchOutput.trim() || 'HEAD';

    // Get ahead/behind counts
    let ahead = 0;
    let behind = 0;
    try {
      const { stdout: statusOutput } = await this.execGit(projectPath, ['status', '-sb'], statusTimeout);
      const firstLine = statusOutput.split('\n')[0];
      const aheadMatch = firstLine.match(/ahead (\d+)/);
      const behindMatch = firstLine.match(/behind (\d+)/);
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
      if (behindMatch) behind = parseInt(behindMatch[1], 10);
    } catch {
      // Ignore errors getting ahead/behind
    }

    // Get porcelain status for file changes (limit untracked to avoid huge response)
    const { stdout: porcelainOutput } = await this.execGit(projectPath, ['status', '--porcelain=v1', '-u'], statusTimeout);
    
    const staged = [];
    const unstaged = [];
    const untracked = [];

    for (const line of porcelainOutput.split('\n')) {
      if (!line) continue;

      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePath = line.substring(3).trim();

      // Handle renames (format: "R  old -> new")
      let actualPath = filePath;
      let oldPath = null;
      if (filePath.includes(' -> ')) {
        const parts = filePath.split(' -> ');
        oldPath = parts[0];
        actualPath = parts[1];
      }

      // Determine status
      const getStatusName = (code) => {
        switch (code) {
          case 'M': return 'modified';
          case 'A': return 'added';
          case 'D': return 'deleted';
          case 'R': return 'renamed';
          case 'C': return 'copied';
          case 'U': return 'unmerged';
          default: return 'modified';
        }
      };

      // Staged changes (index status)
      if (indexStatus !== ' ' && indexStatus !== '?') {
        staged.push({
          path: actualPath,
          status: getStatusName(indexStatus),
          oldPath
        });
      }

      // Unstaged changes (work tree status)
      if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
        unstaged.push({
          path: actualPath,
          status: getStatusName(workTreeStatus),
          oldPath
        });
      }

      // Untracked files
      if (indexStatus === '?' && workTreeStatus === '?') {
        untracked.push(actualPath);
      }
    }

    return {
      branch,
      ahead,
      behind,
      staged,
      unstaged,
      untracked
    };
  }

  /**
   * Get list of branches
   * @param {string} projectPath - Project directory
   * @returns {Promise<Array<{name: string, isRemote: boolean, isCurrent: boolean}>>}
   */
  async getBranches(projectPath) {
    const { stdout } = await this.execGit(projectPath, ['branch', '-a', '--format=%(refname:short)|%(HEAD)']);
    
    const branches = [];
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      
      const [name, head] = line.split('|');
      const isCurrent = head === '*';
      const isRemote = name.startsWith('remotes/') || name.includes('/');
      
      // Clean up remote branch names
      let cleanName = name;
      if (name.startsWith('remotes/')) {
        cleanName = name.replace('remotes/', '');
      }
      
      // Skip HEAD references
      if (cleanName.includes('HEAD')) continue;
      
      branches.push({
        name: cleanName,
        isRemote,
        isCurrent
      });
    }

    return branches;
  }

  /**
   * Stage files
   * @param {string} projectPath - Project directory
   * @param {string[]} files - Files to stage (or ['.'] for all)
   */
  async stageFiles(projectPath, files) {
    if (!files || files.length === 0) {
      throw new Error('No files specified to stage');
    }
    await this.execGit(projectPath, ['add', ...files]);
    return { success: true };
  }

  /**
   * Unstage files
   * @param {string} projectPath - Project directory
   * @param {string[]} files - Files to unstage
   */
  async unstageFiles(projectPath, files) {
    if (!files || files.length === 0) {
      throw new Error('No files specified to unstage');
    }
    await this.execGit(projectPath, ['reset', 'HEAD', '--', ...files]);
    return { success: true };
  }

  /**
   * Discard changes in working directory
   * @param {string} projectPath - Project directory
   * @param {string[]} files - Files to discard changes for
   */
  async discardChanges(projectPath, files) {
    if (!files || files.length === 0) {
      throw new Error('No files specified to discard');
    }
    await this.execGit(projectPath, ['checkout', '--', ...files]);
    return { success: true };
  }

  /**
   * Create a commit
   * @param {string} projectPath - Project directory
   * @param {string} message - Commit message
   * @param {string[]} [files] - Optional files to stage before committing
   */
  async commit(projectPath, message, files = null) {
    if (!message || !message.trim()) {
      throw new Error('Commit message is required');
    }

    // Optionally stage files first
    if (files && files.length > 0) {
      await this.stageFiles(projectPath, files);
    }

    const { stdout, stderr } = await this.execGit(projectPath, ['commit', '-m', message]);
    
    // Check if commit was successful
    if (stderr && stderr.includes('nothing to commit')) {
      throw new Error('Nothing to commit');
    }

    // Parse commit hash from output
    const hashMatch = stdout.match(/\[[\w\s-]+\s+([a-f0-9]+)\]/);
    const hash = hashMatch ? hashMatch[1] : null;

    return {
      success: true,
      hash,
      message: stdout.trim()
    };
  }

  /**
   * Push to remote
   * @param {string} projectPath - Project directory
   * @param {string} [remote='origin'] - Remote name
   * @param {string} [branch] - Branch name (defaults to current)
   */
  async push(projectPath, remote = 'origin', branch = null) {
    const args = ['push', remote];
    if (branch) {
      args.push(branch);
    }

    const { stdout, stderr } = await this.execGit(projectPath, args);
    
    return {
      success: true,
      output: stdout || stderr
    };
  }

  /**
   * Pull from remote
   * @param {string} projectPath - Project directory
   * @param {string} [remote='origin'] - Remote name
   * @param {string} [branch] - Branch name (defaults to current)
   */
  async pull(projectPath, remote = 'origin', branch = null) {
    const args = ['pull', remote];
    if (branch) {
      args.push(branch);
    }

    const { stdout, stderr } = await this.execGit(projectPath, args);
    
    return {
      success: true,
      output: stdout || stderr
    };
  }

  /**
   * Checkout a branch
   * @param {string} projectPath - Project directory
   * @param {string} branch - Branch to checkout
   */
  async checkout(projectPath, branch) {
    if (!branch) {
      throw new Error('Branch name is required');
    }

    // Handle remote branches
    let checkoutBranch = branch;
    if (branch.startsWith('origin/')) {
      // Create local tracking branch from remote
      const localBranch = branch.replace('origin/', '');
      try {
        await this.execGit(projectPath, ['checkout', '-b', localBranch, branch]);
        return { success: true, branch: localBranch };
      } catch {
        // Branch might already exist locally
        checkoutBranch = localBranch;
      }
    }

    await this.execGit(projectPath, ['checkout', checkoutBranch]);
    return { success: true, branch: checkoutBranch };
  }

  /**
   * Create a new branch
   * @param {string} projectPath - Project directory
   * @param {string} name - New branch name
   * @param {boolean} [checkout=true] - Whether to checkout the new branch
   */
  async createBranch(projectPath, name, checkout = true) {
    if (!name) {
      throw new Error('Branch name is required');
    }

    if (checkout) {
      await this.execGit(projectPath, ['checkout', '-b', name]);
    } else {
      await this.execGit(projectPath, ['branch', name]);
    }

    return { success: true, branch: name };
  }

  /**
   * Get diff for a file
   * @param {string} projectPath - Project directory
   * @param {string} file - File to get diff for
   * @param {boolean} [staged=false] - Whether to get staged diff
   * @param {number} [maxLines=2000] - Maximum number of lines to return
   */
  async getDiff(projectPath, file, staged = false, maxLines = 2000) {
    const args = ['diff'];
    if (staged) {
      args.push('--cached');
    }
    if (file) {
      args.push('--', file);
    }

    const { stdout } = await this.execGit(projectPath, args, { timeout: 10000 });
    
    // Limit the diff size to prevent performance issues
    const lines = stdout.split('\n');
    const totalLines = lines.length;
    const truncated = totalLines > maxLines;
    
    const limitedDiff = truncated 
      ? lines.slice(0, maxLines).join('\n') + `\n\n... [Diff truncated: showing ${maxLines} of ${totalLines} lines]`
      : stdout;
    
    return { 
      diff: limitedDiff,
      truncated,
      totalLines
    };
  }

  /**
   * Get recent commits
   * @param {string} projectPath - Project directory
   * @param {number} [limit=10] - Number of commits to retrieve
   */
  async getLog(projectPath, limit = 10) {
    const { stdout } = await this.execGit(projectPath, [
      'log',
      `-${limit}`,
      '--format=%H|%h|%an|%ae|%at|%s'
    ]);

    const commits = [];
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      const [hash, shortHash, authorName, authorEmail, timestamp, subject] = line.split('|');
      commits.push({
        hash,
        shortHash,
        author: { name: authorName, email: authorEmail },
        timestamp: parseInt(timestamp, 10) * 1000,
        subject
      });
    }

    return commits;
  }

  /**
   * Get list of remotes
   * @param {string} projectPath - Project directory
   */
  async getRemotes(projectPath) {
    const { stdout } = await this.execGit(projectPath, ['remote', '-v']);
    
    const remotes = new Map();
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      const [name, url, type] = line.split(/\s+/);
      if (!remotes.has(name)) {
        remotes.set(name, { name, fetchUrl: null, pushUrl: null });
      }
      const remote = remotes.get(name);
      if (type === '(fetch)') {
        remote.fetchUrl = url;
      } else if (type === '(push)') {
        remote.pushUrl = url;
      }
    }

    return Array.from(remotes.values());
  }

  /**
   * Fetch from remote
   * @param {string} projectPath - Project directory
   * @param {string} [remote='origin'] - Remote name
   */
  async fetch(projectPath, remote = 'origin') {
    await this.execGit(projectPath, ['fetch', remote]);
    return { success: true };
  }
}
