import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import multer from 'multer';
import mime from 'mime-types';

const router = Router();

// Helper function to detect if a buffer contains binary content
function isBinaryBuffer(buffer) {
  // Check first 8KB for null bytes (common indicator of binary content)
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

// Known binary extensions (checked before content analysis)
const BINARY_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'tif', 'heic', 'heif',
  // Video
  'mp4', 'mov', 'm4v', 'avi', 'webm', 'mkv', 'wmv', 'flv',
  // Audio
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // Archives
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
  // Executables/Libraries
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a',
  // Other binary
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'sqlite', 'db'
]);

// Configure multer for file uploads
// Files are stored in memory temporarily, then written to the destination
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 10 // Max 10 files per request
  }
});

// Read file content
router.get('/read', async (req, res) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const stats = await fs.stat(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    
    // Read file as buffer first to detect binary content
    const buffer = await fs.readFile(filePath);
    
    // Determine if file is binary (by extension or content analysis)
    const isBinary = BINARY_EXTENSIONS.has(ext) || isBinaryBuffer(buffer);
    
    let content;
    if (isBinary) {
      // Return base64-encoded content for binary files
      content = buffer.toString('base64');
    } else {
      // Return UTF-8 text for text files
      content = buffer.toString('utf-8');
    }
    
    res.json({
      path: filePath,
      content,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      extension: ext,
      isBinary,
      mimeType
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

// Upload files to a directory
router.post('/upload', upload.array('files'), async (req, res) => {
  try {
    const { destinationPath } = req.body;
    
    if (!destinationPath) {
      return res.status(400).json({ error: 'Destination path is required' });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }
    
    // Verify destination directory exists
    try {
      const stats = await fs.stat(destinationPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Destination path is not a directory' });
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        // Create the directory if it doesn't exist
        await fs.mkdir(destinationPath, { recursive: true });
      } else {
        throw e;
      }
    }
    
    const uploadedFiles = [];
    const errors = [];
    
    for (const file of req.files) {
      const filePath = path.join(destinationPath, file.originalname);
      
      try {
        // Check if file already exists
        try {
          await fs.access(filePath);
          // File exists - we'll overwrite it but log a warning
          console.log(`[files/upload] Overwriting existing file: ${filePath}`);
        } catch (e) {
          // File doesn't exist, which is fine
        }
        
        // Write the file
        await fs.writeFile(filePath, file.buffer);
        
        uploadedFiles.push({
          name: file.originalname,
          path: filePath,
          size: file.size,
          mimeType: file.mimetype
        });
        
        console.log(`[files/upload] Uploaded: ${filePath} (${file.size} bytes)`);
      } catch (fileError) {
        console.error(`[files/upload] Failed to upload ${file.originalname}:`, fileError);
        errors.push({
          name: file.originalname,
          error: fileError.message
        });
      }
    }
    
    res.json({
      success: true,
      uploaded: uploadedFiles,
      errors: errors.length > 0 ? errors : undefined,
      totalUploaded: uploadedFiles.length,
      totalFailed: errors.length
    });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

export { router as fileRoutes };
