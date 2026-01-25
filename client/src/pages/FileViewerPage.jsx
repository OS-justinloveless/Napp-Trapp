import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './FileViewerPage.module.css';

const languageMap = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  md: 'markdown',
  sql: 'sql',
  graphql: 'graphql',
  dockerfile: 'docker',
  makefile: 'makefile'
};

export default function FileViewerPage() {
  const [searchParams] = useSearchParams();
  const filePath = searchParams.get('path');
  
  const [content, setContent] = useState('');
  const [fileInfo, setFileInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  const { apiRequest } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (filePath) {
      loadFile();
    }
  }, [filePath]);

  async function loadFile() {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await apiRequest(`/api/files/read?filePath=${encodeURIComponent(filePath)}`);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load file');
      }
      
      const data = await response.json();
      setContent(data.content);
      setEditContent(data.content);
      setFileInfo({
        path: data.path,
        size: data.size,
        modified: data.modified,
        extension: data.extension
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveFile() {
    try {
      setIsSaving(true);
      
      const response = await apiRequest('/api/files/write', {
        method: 'POST',
        body: JSON.stringify({
          filePath,
          content: editContent
        })
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save file');
      }
      
      setContent(editContent);
      setIsEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  function getLanguage() {
    if (!fileInfo?.extension) return 'text';
    return languageMap[fileInfo.extension.toLowerCase()] || 'text';
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileName() {
    if (!filePath) return '';
    return filePath.split('/').pop();
  }

  function getParentPath() {
    if (!filePath) return '';
    const parts = filePath.split('/');
    parts.pop();
    return parts.join('/');
  }

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading file...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        <p>{error}</p>
        <button onClick={() => navigate(-1)}>Go Back</button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button 
          className={styles.backButton} 
          onClick={() => navigate(`/files?path=${encodeURIComponent(getParentPath())}`)}
        >
          ← Back
        </button>
        <div className={styles.fileInfo}>
          <h2 className={styles.fileName}>{getFileName()}</h2>
          <p className={styles.fileMeta}>
            {fileInfo?.extension?.toUpperCase() || 'FILE'}
            {' • '}
            {formatSize(fileInfo?.size || 0)}
          </p>
        </div>
      </div>
      
      <div className={styles.actions}>
        {isEditing ? (
          <>
            <button 
              className={styles.cancelButton}
              onClick={() => {
                setEditContent(content);
                setIsEditing(false);
              }}
            >
              Cancel
            </button>
            <button 
              className={styles.saveButton}
              onClick={saveFile}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button 
              className={styles.editButton}
              onClick={() => setIsEditing(true)}
            >
              ✏️ Edit
            </button>
            <button 
              className={styles.refreshButton}
              onClick={loadFile}
            >
              🔄 Refresh
            </button>
          </>
        )}
      </div>
      
      <div className={styles.codeContainer}>
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className={styles.editor}
            spellCheck={false}
          />
        ) : (
          <div className={styles.codeWrapper}>
            <SyntaxHighlighter
              language={getLanguage()}
              style={vscDarkPlus}
              showLineNumbers
              wrapLines
              customStyle={{
                margin: 0,
                padding: '16px',
                background: 'var(--bg-primary)',
                fontSize: '13px',
                lineHeight: '1.6'
              }}
            >
              {content}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  );
}
