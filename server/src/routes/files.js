import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { createTwoFilesPatch } from 'diff';

const router = Router();

// Read file content
router.get('/read', async (req, res) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const content = await fs.readFile(filePath, 'utf-8');
    const stats = await fs.stat(filePath);
    
    res.json({
      path: filePath,
      content,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      extension: path.extname(filePath).slice(1)
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    console.error('Error reading file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Write file content
router.post('/write', async (req, res) => {
  try {
    const { filePath, content } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    // Get original content for diff
    let originalContent = '';
    try {
      originalContent = await fs.readFile(filePath, 'utf-8');
    } catch (e) {
      // File doesn't exist yet
    }
    
    // Write the file
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    
    // Generate diff
    const diff = createTwoFilesPatch(
      filePath,
      filePath,
      originalContent,
      content,
      'original',
      'modified'
    );
    
    res.json({
      success: true,
      path: filePath,
      diff
    });
  } catch (error) {
    console.error('Error writing file:', error);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// Get file diff between versions
router.get('/diff', async (req, res) => {
  try {
    const { filePath, original, modified } = req.query;
    
    if (!original || !modified) {
      return res.status(400).json({ error: 'Both original and modified content required' });
    }
    
    const diff = createTwoFilesPatch(
      filePath || 'file',
      filePath || 'file',
      original,
      modified,
      'original',
      'modified'
    );
    
    res.json({ diff });
  } catch (error) {
    console.error('Error generating diff:', error);
    res.status(500).json({ error: 'Failed to generate diff' });
  }
});

// List directory contents
router.get('/list', async (req, res) => {
  try {
    const { dirPath } = req.query;
    
    if (!dirPath) {
      return res.status(400).json({ error: 'Directory path is required' });
    }
    
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    const items = await Promise.all(
      entries
        .filter(entry => !entry.name.startsWith('.'))
        .map(async entry => {
          const fullPath = path.join(dirPath, entry.name);
          const stats = await fs.stat(fullPath);
          
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: stats.size,
            modified: stats.mtime.toISOString()
          };
        })
    );
    
    // Sort: directories first, then files
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    
    res.json({ items });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Directory not found' });
    }
    console.error('Error listing directory:', error);
    res.status(500).json({ error: 'Failed to list directory' });
  }
});

// Create new file
router.post('/create', async (req, res) => {
  try {
    const { filePath, content = '' } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    // Check if file already exists
    try {
      await fs.access(filePath);
      return res.status(409).json({ error: 'File already exists' });
    } catch (e) {
      // File doesn't exist, continue
    }
    
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    
    res.json({
      success: true,
      path: filePath
    });
  } catch (error) {
    console.error('Error creating file:', error);
    res.status(500).json({ error: 'Failed to create file' });
  }
});

// Delete file
router.delete('/delete', async (req, res) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    await fs.unlink(filePath);
    
    res.json({
      success: true,
      deleted: filePath
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Rename file or directory
router.post('/rename', async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    
    if (!oldPath || !newName) {
      return res.status(400).json({ error: 'Both oldPath and newName are required' });
    }
    
    // Validate newName doesn't contain path separators
    if (newName.includes('/') || newName.includes('\\')) {
      return res.status(400).json({ error: 'newName should not contain path separators' });
    }
    
    const directory = path.dirname(oldPath);
    const newPath = path.join(directory, newName);
    
    // Check if source exists
    try {
      await fs.access(oldPath);
    } catch (e) {
      return res.status(404).json({ error: 'Source file or directory not found' });
    }
    
    // Check if destination already exists
    try {
      await fs.access(newPath);
      return res.status(409).json({ error: 'A file or directory with that name already exists' });
    } catch (e) {
      // Destination doesn't exist, which is what we want
    }
    
    await fs.rename(oldPath, newPath);
    
    res.json({
      success: true,
      oldPath,
      newPath
    });
  } catch (error) {
    console.error('Error renaming file:', error);
    res.status(500).json({ error: 'Failed to rename file or directory' });
  }
});

// Move file or directory
router.post('/move', async (req, res) => {
  try {
    const { sourcePath, destinationPath } = req.body;
    
    if (!sourcePath || !destinationPath) {
      return res.status(400).json({ error: 'Both sourcePath and destinationPath are required' });
    }
    
    // Check if source exists
    try {
      await fs.access(sourcePath);
    } catch (e) {
      return res.status(404).json({ error: 'Source file or directory not found' });
    }
    
    // Check if destination directory exists
    const destDir = path.dirname(destinationPath);
    try {
      const stats = await fs.stat(destDir);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Destination parent path is not a directory' });
      }
    } catch (e) {
      return res.status(404).json({ error: 'Destination directory not found' });
    }
    
    // Check if destination already exists
    try {
      await fs.access(destinationPath);
      return res.status(409).json({ error: 'A file or directory already exists at the destination' });
    } catch (e) {
      // Destination doesn't exist, which is what we want
    }
    
    await fs.rename(sourcePath, destinationPath);
    
    res.json({
      success: true,
      sourcePath,
      destinationPath
    });
  } catch (error) {
    console.error('Error moving file:', error);
    res.status(500).json({ error: 'Failed to move file or directory' });
  }
});

export { router as fileRoutes };
