/**
 * Simple script to verify SQLite database setup
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '.napp-trapp-data');
const dbPath = path.join(dataDir, 'chat-persistence.db');

console.log('Database path:', dbPath);
console.log('Data directory:', dataDir);

// Create data directory if needed
if (!existsSync(dataDir)) {
  console.log('Creating data directory...');
  mkdirSync(dataDir, { recursive: true });
}

// Open database
console.log('\nOpening database...');
const db = new Database(dbPath);

// Enable WAL mode
db.pragma('journal_mode = WAL');

// Create tables
console.log('Creating tables...');
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    topic TEXT NOT NULL,
    model TEXT,
    mode TEXT NOT NULL,
    projectPath TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    sessionId TEXT,
    lastActivity INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversationId TEXT NOT NULL,
    type TEXT NOT NULL,
    role TEXT,
    content TEXT,
    timestamp INTEGER NOT NULL,
    isPartial INTEGER DEFAULT 0,
    toolId TEXT,
    toolName TEXT,
    isError INTEGER DEFAULT 0,
    metadata TEXT,
    FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversationId ON messages(conversationId);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(conversationId, timestamp);
  CREATE INDEX IF NOT EXISTS idx_conversations_projectPath ON conversations(projectPath);
  CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
  CREATE INDEX IF NOT EXISTS idx_conversations_lastActivity ON conversations(lastActivity);
`);

console.log('✓ Tables created successfully');

// Check counts
const convCount = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages').get();

console.log(`\n✓ Database initialized:`);
console.log(`  - Conversations: ${convCount.count}`);
console.log(`  - Messages: ${msgCount.count}`);

// Close database
db.close();
console.log('\n✓ Database closed');
console.log('\nDatabase is ready to use!');
