import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './ProjectsPage.module.css';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  const { apiRequest } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      setIsLoading(true);
      setError(null);
      const response = await apiRequest('/api/projects');
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function openProject(projectId) {
    try {
      await apiRequest(`/api/projects/${projectId}/open`, {
        method: 'POST'
      });
    } catch (err) {
      console.error('Failed to open project:', err);
    }
  }

  function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    
    return date.toLocaleDateString();
  }

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading projects...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.actions}>
        <button 
          className={styles.refreshButton}
          onClick={loadProjects}
        >
          🔄 Refresh
        </button>
        <button 
          className={styles.createButton}
          onClick={() => setShowCreateModal(true)}
        >
          ➕ New Project
        </button>
      </div>

      {error && (
        <div className={styles.error}>
          {error}
          <button onClick={loadProjects}>Retry</button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>📂</span>
          <h3>No projects found</h3>
          <p>Recent Cursor projects will appear here</p>
        </div>
      ) : (
        <div className={styles.projectList}>
          {projects.map((project) => (
            <div 
              key={project.id} 
              className={styles.projectCard}
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <div className={styles.projectInfo}>
                <span className={styles.projectIcon}>📁</span>
                <div className={styles.projectDetails}>
                  <h3 className={styles.projectName}>{project.name}</h3>
                  <p className={styles.projectPath}>{project.path}</p>
                  <span className={styles.projectDate}>
                    {formatDate(project.lastOpened)}
                  </span>
                </div>
              </div>
              <div className={styles.projectActions}>
                <button 
                  className={styles.openButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    openProject(project.id);
                  }}
                >
                  Open in Cursor
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateProjectModal 
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            loadProjects();
          }}
        />
      )}
    </div>
  );
}

function CreateProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  
  const { apiRequest } = useAuth();

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    
    setIsCreating(true);
    setError('');
    
    try {
      const response = await apiRequest('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, template: template || undefined })
      });
      
      if (response.ok) {
        onCreated();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to create project');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2>Create New Project</h2>
        
        <form onSubmit={handleCreate}>
          <div className={styles.field}>
            <label>Project Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-project"
              autoFocus
            />
          </div>
          
          <div className={styles.field}>
            <label>Template (optional)</label>
            <select 
              value={template} 
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="">None</option>
              <option value="node">Node.js</option>
              <option value="python">Python</option>
              <option value="react">React</option>
            </select>
          </div>
          
          {error && <div className={styles.modalError}>{error}</div>}
          
          <div className={styles.modalActions}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!name.trim() || isCreating}>
              {isCreating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
