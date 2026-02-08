import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { readdir, stat } from 'fs/promises';

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
   * Unquote a git path that may be quoted with double quotes
   * Git quotes paths containing spaces or special characters
   * @param {string} path - The potentially quoted path
   * @returns {string} - The unquoted path
   */
  unquotePath(path) {
    if (!path) return path;
    
    // Check if the path is quoted (starts and ends with double quotes)
    if (path.startsWith('"') && path.endsWith('"')) {
      // Remove the surrounding quotes
      let unquoted = path.slice(1, -1);
      
      // Unescape common escape sequences
      unquoted = unquoted
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      
      return unquoted;
    }
    
    return path;
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
      let filePath = line.substring(3).trim();
      
      // Unquote the path (git quotes paths with spaces/special chars)
      filePath = this.unquotePath(filePath);

      // Handle renames (format: "R  old -> new" or "old" -> "new" if quoted)
      let actualPath = filePath;
      let oldPath = null;
      if (filePath.includes(' -> ')) {
        const parts = filePath.split(' -> ');
        oldPath = this.unquotePath(parts[0]);
        actualPath = this.unquotePath(parts[1]);
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

    // Get last commit timestamp for chronological sorting
    let lastCommitTimestamp = null;
    try {
      const { stdout: logOutput } = await this.execGit(projectPath, 
        ['log', '-1', '--format=%at'], { timeout: 5000 });
      const timestamp = parseInt(logOutput.trim(), 10);
      if (!isNaN(timestamp)) {
        lastCommitTimestamp = timestamp * 1000; // Convert to milliseconds
      }
    } catch {
      // Ignore errors - repo might have no commits
    }

    return {
      branch,
      ahead,
      behind,
      staged,
      unstaged,
      untracked,
      lastCommitTimestamp
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
   * Get diff for a specific file in a specific commit
   * @param {string} projectPath - Project directory
   * @param {string} commitHash - The commit hash
   * @param {string} file - File path to get diff for
   * @param {number} [maxLines=2000] - Maximum number of lines to return
   */
  async getCommitDiff(projectPath, commitHash, file, maxLines = 2000) {
    if (!commitHash) throw new Error('Commit hash is required');
    // Use `git diff <parent>..<commit> -- <file>` for the diff
    // For root commits (no parent), use `git diff --root <commit> -- <file>`
    // Simplest approach: `git show <commit> -- <file>` gives the diff
    const args = ['show', '--format=', commitHash, '--', file];
    const { stdout } = await this.execGit(projectPath, args, { timeout: 10000 });

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
   * Get recent commits with graph data (parents + refs)
   * @param {string} projectPath - Project directory
   * @param {number} [limit=10] - Number of commits to retrieve
   * @param {number} [skip=0] - Number of commits to skip (for pagination)
   */
  async getLog(projectPath, limit = 10, skip = 0) {
    // Use NUL byte as record separator to handle subjects containing '|'
    const args = [
      'log',
      `--max-count=${limit}`,
      '--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s%x00%P%x00%D'
    ];
    if (skip > 0) {
      args.push(`--skip=${skip}`);
    }
    const { stdout } = await this.execGit(projectPath, args);

    const commits = [];
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      const parts = line.split('\x00');
      if (parts.length < 6) continue;
      const [hash, shortHash, authorName, authorEmail, timestampStr, subject, parentsStr, refsStr] = parts;
      const parents = parentsStr ? parentsStr.trim().split(' ').filter(Boolean) : [];
      const refs = refsStr ? refsStr.trim().split(', ').filter(Boolean) : [];
      commits.push({
        hash,
        shortHash,
        author: { name: authorName, email: authorEmail },
        timestamp: parseInt(timestampStr, 10) * 1000,
        subject,
        parents,
        refs
      });
    }

    return commits;
  }

  /**
   * Get detailed info for a single commit
   * @param {string} projectPath - Project directory
   * @param {string} hash - Commit hash
   * @returns {Promise<object>} - Commit detail with full body and changed files
   */
  async getCommitDetail(projectPath, hash) {
    if (!hash) throw new Error('Commit hash is required');

    // Get commit metadata with full body
    const { stdout: metaOut } = await this.execGit(projectPath, [
      'log', '-1', hash,
      '--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s%x00%P%x00%D%x00%b'
    ]);

    const parts = metaOut.trim().split('\x00');
    if (parts.length < 8) throw new Error('Failed to parse commit');
    const [commitHash, shortHash, authorName, authorEmail, timestampStr, subject, parentsStr, refsStr, ...bodyParts] = parts;
    const body = bodyParts.join('\x00').trim();
    const parents = parentsStr ? parentsStr.trim().split(' ').filter(Boolean) : [];
    const refs = refsStr ? refsStr.trim().split(', ').filter(Boolean) : [];

    // Get changed files with stats
    const { stdout: statOut } = await this.execGit(projectPath, [
      'diff-tree', '--no-commit-id', '-r', '--numstat', '--find-renames', hash
    ]);

    // Get file status letters
    const { stdout: nameStatusOut } = await this.execGit(projectPath, [
      'diff-tree', '--no-commit-id', '-r', '--name-status', '--find-renames', hash
    ]);

    // Parse name-status into a map
    const statusMap = {};
    for (const line of nameStatusOut.split('\n')) {
      if (!line) continue;
      const statusMatch = line.match(/^([AMDRC]\d*)\t(.+?)(?:\t(.+))?$/);
      if (statusMatch) {
        const statusCode = statusMatch[1][0]; // first char only
        const filePath = statusMatch[3] || statusMatch[2]; // renamed: new path, else: path
        const oldPath = statusMatch[3] ? statusMatch[2] : null;
        const statusNames = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied' };
        statusMap[filePath] = { status: statusNames[statusCode] || 'modified', oldPath };
      }
    }

    const files = [];
    for (const line of statOut.split('\n')) {
      if (!line) continue;
      const numstatMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+?)(?:\t(.+))?$/);
      if (numstatMatch) {
        const additions = numstatMatch[1] === '-' ? 0 : parseInt(numstatMatch[1], 10);
        const deletions = numstatMatch[2] === '-' ? 0 : parseInt(numstatMatch[2], 10);
        // For renames the format is: additions deletions oldpath\tnewpath
        const filePath = numstatMatch[4] || numstatMatch[3];
        const info = statusMap[filePath] || { status: 'modified', oldPath: null };
        files.push({
          path: filePath,
          additions,
          deletions,
          status: info.status,
          oldPath: info.oldPath
        });
      }
    }

    return {
      hash: commitHash,
      shortHash,
      author: { name: authorName, email: authorEmail },
      timestamp: parseInt(timestampStr, 10) * 1000,
      subject,
      body,
      parents,
      refs,
      files
    };
  }

  /**
   * Checkout a commit in detached HEAD mode
   * @param {string} projectPath - Project directory
   * @param {string} hash - Commit hash to checkout
   */
  async checkoutCommit(projectPath, hash) {
    if (!hash) throw new Error('Commit hash is required');
    const { stdout, stderr } = await this.execGit(projectPath, ['checkout', hash]);
    return { success: true, output: stdout || stderr };
  }

  /**
   * Cherry-pick a commit onto the current branch
   * @param {string} projectPath - Project directory
   * @param {string} hash - Commit hash to cherry-pick
   */
  async cherryPick(projectPath, hash) {
    if (!hash) throw new Error('Commit hash is required');
    const { stdout, stderr } = await this.execGit(projectPath, ['cherry-pick', hash]);
    return { success: true, output: stdout || stderr };
  }

  /**
   * Revert a commit (creates a new revert commit)
   * @param {string} projectPath - Project directory
   * @param {string} hash - Commit hash to revert
   */
  async revertCommit(projectPath, hash) {
    if (!hash) throw new Error('Commit hash is required');
    const { stdout, stderr } = await this.execGit(projectPath, ['revert', '--no-edit', hash]);
    return { success: true, output: stdout || stderr };
  }

  /**
   * Create a tag
   * @param {string} projectPath - Project directory
   * @param {string} name - Tag name
   * @param {string} [hash] - Commit hash to tag (defaults to HEAD)
   * @param {string} [message] - Optional tag message (creates annotated tag)
   */
  async createTag(projectPath, name, hash = null, message = null) {
    if (!name) throw new Error('Tag name is required');
    const args = ['tag'];
    if (message) {
      args.push('-a', name, '-m', message);
    } else {
      args.push(name);
    }
    if (hash) {
      args.push(hash);
    }
    const { stdout, stderr } = await this.execGit(projectPath, args);
    return { success: true, output: stdout || stderr };
  }

  /**
   * Reset to a commit
   * @param {string} projectPath - Project directory
   * @param {string} hash - Commit hash to reset to
   * @param {string} [mode='mixed'] - Reset mode: 'soft', 'mixed', or 'hard'
   */
  async resetToCommit(projectPath, hash, mode = 'mixed') {
    if (!hash) throw new Error('Commit hash is required');
    const validModes = ['soft', 'mixed', 'hard'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid reset mode: ${mode}. Must be one of: ${validModes.join(', ')}`);
    }
    const { stdout, stderr } = await this.execGit(projectPath, ['reset', `--${mode}`, hash]);
    return { success: true, output: stdout || stderr };
  }

  /**
   * Create a branch from a specific commit
   * @param {string} projectPath - Project directory
   * @param {string} name - New branch name
   * @param {string} startPoint - Commit hash or ref to start from
   * @param {boolean} [checkout=true] - Whether to checkout the new branch
   */
  async createBranchFrom(projectPath, name, startPoint, checkout = true) {
    if (!name) throw new Error('Branch name is required');
    if (!startPoint) throw new Error('Start point is required');

    if (checkout) {
      await this.execGit(projectPath, ['checkout', '-b', name, startPoint]);
    } else {
      await this.execGit(projectPath, ['branch', name, startPoint]);
    }
    return { success: true, branch: name };
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

  /**
   * Delete untracked files (undo adding new files)
   * @param {string} projectPath - Project directory
   * @param {string[]} files - Files to delete
   */
  async cleanFiles(projectPath, files) {
    if (!files || files.length === 0) {
      throw new Error('No files specified to clean');
    }
    
    // Use git clean to remove untracked files
    // -f = force (required), --  = path separator
    // We clean each file individually for better control
    for (const file of files) {
      await this.execGit(projectPath, ['clean', '-f', '--', file]);
    }
    
    return { success: true };
  }

  /**
   * Scan a project directory for all git repositories (including sub-repos)
   * @param {string} projectPath - Root project directory to scan
   * @param {object} options - Scan options
   * @param {number} options.maxDepth - Maximum directory depth to scan (default: 5)
   * @param {string[]} options.excludeDirs - Directories to exclude (default: node_modules, vendor, Pods, .git)
   * @returns {Promise<Array<{path: string, name: string}>>} - Array of repository info
   */
  async scanForRepositories(projectPath, options = {}) {
    const maxDepth = options.maxDepth || 5;
    const excludeDirs = new Set(options.excludeDirs || [
      'node_modules',
      'vendor',
      'Pods',
      '.git',
      'build',
      'dist',
      '.build',
      'DerivedData'
    ]);

    const repositories = [];

    // Check if the root is a git repo
    const rootGitPath = path.join(projectPath, '.git');
    try {
      const rootGitStat = await stat(rootGitPath);
      if (rootGitStat.isDirectory()) {
        repositories.push({
          path: '.',
          name: path.basename(projectPath)
        });
      }
    } catch {
      // Root is not a git repo, that's fine
    }

    // Recursive scan function
    const scanDirectory = async (dirPath, depth) => {
      if (depth > maxDepth) return;

      try {
        const entries = await readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          
          const entryName = entry.name;
          
          // Skip excluded directories
          if (excludeDirs.has(entryName)) continue;
          
          // Skip hidden directories (except we need to check for .git)
          if (entryName.startsWith('.') && entryName !== '.git') continue;

          const fullPath = path.join(dirPath, entryName);

          // Check if this directory contains a .git folder
          const gitPath = path.join(fullPath, '.git');
          try {
            const gitStat = await stat(gitPath);
            if (gitStat.isDirectory()) {
              // Found a sub-repository
              const relativePath = path.relative(projectPath, fullPath);
              repositories.push({
                path: relativePath,
                name: entryName
              });
              // Don't scan inside git repos for more repos (they manage their own)
              continue;
            }
          } catch {
            // No .git folder, continue scanning
          }

          // Recursively scan subdirectory
          await scanDirectory(fullPath, depth + 1);
        }
      } catch (error) {
        // Permission denied or other errors, skip this directory
        console.warn(`[GitManager] Could not scan directory ${dirPath}:`, error.message);
      }
    };

    // Start scanning from root (depth 0)
    await scanDirectory(projectPath, 0);

    // Sort: root first, then alphabetically by path
    repositories.sort((a, b) => {
      if (a.path === '.') return -1;
      if (b.path === '.') return 1;
      return a.path.localeCompare(b.path);
    });

    return repositories;
  }
}
