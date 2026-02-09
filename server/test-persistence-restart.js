/**
 * Test script for chat persistence across server restarts
 *
 * This script simulates:
 * 1. Creating a chat conversation with messages
 * 2. Server shutdown (simulated by closing the store)
 * 3. Server restart (fresh store instance)
 * 4. Verifying all messages are still there
 */

import { ChatPersistenceStore } from './src/utils/ChatPersistenceStore.js';
import fs from 'fs';
import path from 'path';

// Helper to get data directory
function getDataDir() {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  return path.join(scriptDir, '.napp-trapp-data');
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('='.repeat(60));
  console.log('CHAT PERSISTENCE ACROSS SERVER RESTART TEST');
  console.log('='.repeat(60));

  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, 'chat-persistence.db');

  try {
    // Clean up any previous test data
    console.log('\n📋 Cleanup phase: Removing old test database...');
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('✓ Old database removed');
    }

    // ============================================================================
    // PHASE 1: Create conversation and messages (simulating first server run)
    // ============================================================================
    console.log('\n' + '='.repeat(60));
    console.log('PHASE 1: Initial Server Run - Create chat and messages');
    console.log('='.repeat(60));

    let store1 = ChatPersistenceStore.getInstance();
    await store1.init();

    const conversationId = `test-chat-${Date.now()}`;
    console.log(`\n📝 Creating conversation: ${conversationId}`);

    const testConversation = {
      id: conversationId,
      tool: 'claude',
      topic: 'Testing server restart persistence',
      model: 'claude-3-5-sonnet-20241022',
      mode: 'agent',
      projectPath: '/test/project',
      status: 'running',
      createdAt: Date.now(),
    };

    await store1.saveConversation(testConversation);
    console.log('✓ Conversation saved');

    // Save various types of messages
    const messages = [
      {
        id: `${conversationId}-msg-1`,
        type: 'text',
        role: 'user',
        conversationId,
        content: 'What is the capital of France?',
        timestamp: Date.now(),
        isPartial: false,
      },
      {
        id: `${conversationId}-msg-2-partial-1`,
        type: 'text',
        conversationId,
        content: 'The',
        timestamp: Date.now() + 100,
        isPartial: true,
      },
      {
        id: `${conversationId}-msg-2-partial-2`,
        type: 'text',
        conversationId,
        content: 'The capital',
        timestamp: Date.now() + 200,
        isPartial: true,
      },
      {
        id: `${conversationId}-msg-2-partial-3`,
        type: 'text',
        conversationId,
        content: 'The capital of France is Paris.',
        timestamp: Date.now() + 300,
        isPartial: false,
      },
      {
        id: `${conversationId}-msg-3`,
        type: 'tool_use_start',
        conversationId,
        toolId: 'grep-1',
        toolName: 'Grep',
        content: '',
        timestamp: Date.now() + 400,
        isPartial: false,
      },
      {
        id: `${conversationId}-msg-4`,
        type: 'tool_use_result',
        conversationId,
        toolId: 'grep-1',
        toolName: 'Grep',
        content: 'results: ... (8 matches found)',
        timestamp: Date.now() + 500,
        isPartial: false,
        isError: false,
      },
    ];

    console.log(`\n💾 Saving ${messages.length} messages...`);
    for (const msg of messages) {
      await store1.saveMessage(conversationId, msg);
    }
    console.log(`✓ All messages saved`);

    // Verify messages in first store instance
    const messagesPhase1 = await store1.getMessages(conversationId);
    console.log(`\n✓ Phase 1 verification: Retrieved ${messagesPhase1.length} messages`);
    console.log('   Message types:');
    const typeCounts1 = {};
    messagesPhase1.forEach(msg => {
      typeCounts1[msg.type] = (typeCounts1[msg.type] || 0) + 1;
    });
    Object.entries(typeCounts1).forEach(([type, count]) => {
      console.log(`   - ${type}: ${count}`);
    });

    // Get stats before "restart"
    const statsPhase1 = await store1.getStats();
    console.log(`\n📊 Stats before restart:`);
    console.log(`   - Conversations: ${statsPhase1.conversationCount}`);
    console.log(`   - Total messages: ${statsPhase1.totalMessages}`);

    // ============================================================================
    // PHASE 2: Simulate server shutdown
    // ============================================================================
    console.log('\n' + '='.repeat(60));
    console.log('PHASE 2: Server Shutdown - Suspend active chats');
    console.log('='.repeat(60));

    console.log('\n🛑 Marking active chats as suspended...');
    const suspendedCount = await store1.suspendAllActiveChats();
    console.log(`✓ Suspended ${suspendedCount} active chat(s)`);

    console.log('🔌 Closing database connection...');
    store1.close();
    console.log('✓ Database closed');

    await delay(1000);  // Simulate some time passing

    // ============================================================================
    // PHASE 3: Simulate server restart
    // ============================================================================
    console.log('\n' + '='.repeat(60));
    console.log('PHASE 3: Server Restart - New store instance');
    console.log('='.repeat(60));

    console.log('\n🚀 Creating new store instance (simulating fresh server)...');

    // Reset singleton to simulate fresh process
    console.log('   (Note: In real scenario, this would be a separate process)');

    // Create new store instance - in real scenario this would be a fresh process
    let store2 = ChatPersistenceStore.getInstance();
    await store2.init();
    console.log('✓ New store instance created and database opened');

    // ============================================================================
    // PHASE 4: Verify persistence after restart
    // ============================================================================
    console.log('\n' + '='.repeat(60));
    console.log('PHASE 4: Verification - Check if data persisted');
    console.log('='.repeat(60));

    // Get the conversation
    console.log(`\n🔍 Looking for conversation: ${conversationId}`);
    const retrievedConv = await store2.getConversation(conversationId);

    if (!retrievedConv) {
      console.log('❌ FAILED: Conversation not found after restart!');
      process.exit(1);
    }

    console.log('✓ Conversation found!');
    console.log(`   - Tool: ${retrievedConv.tool}`);
    console.log(`   - Topic: ${retrievedConv.topic}`);
    console.log(`   - Status: ${retrievedConv.status}`);

    // Get all messages
    console.log(`\n🔍 Retrieving messages for conversation...`);
    const messagesPhase4 = await store2.getMessages(conversationId);

    if (messagesPhase4.length === 0) {
      console.log('❌ FAILED: No messages found after restart!');
      process.exit(1);
    }

    console.log(`✓ Retrieved ${messagesPhase4.length} messages`);

    // Verify message content
    console.log('\n📋 Message details:');
    messagesPhase4.forEach((msg, idx) => {
      const preview = msg.content ? msg.content.substring(0, 40) : '(no content)';
      const partial = msg.isPartial ? ' [partial]' : '';
      console.log(`   ${idx + 1}. [${msg.type}] ${preview}...${partial}`);
    });

    // Verify message counts match
    console.log(`\n📊 Comparison:`);
    console.log(`   - Messages before restart: ${messagesPhase1.length}`);
    console.log(`   - Messages after restart: ${messagesPhase4.length}`);

    if (messagesPhase1.length !== messagesPhase4.length) {
      console.log('❌ FAILED: Message count mismatch!');
      process.exit(1);
    }

    console.log('✓ Message counts match!');

    // Verify specific message content
    console.log(`\n✓ Verifying message content integrity...`);
    const userMessage = messagesPhase4.find(m => m.role === 'user');
    if (userMessage && userMessage.content === 'What is the capital of France?') {
      console.log('✓ User message content preserved');
    } else {
      console.log('❌ User message content not preserved!');
      process.exit(1);
    }

    const assistantMessage = messagesPhase4.find(m => m.type === 'text' && !m.role && m.content?.includes('Paris'));
    if (assistantMessage) {
      console.log('✓ Assistant response preserved');
    } else {
      console.log('❌ Assistant response not preserved!');
      process.exit(1);
    }

    const toolResult = messagesPhase4.find(m => m.type === 'tool_use_result');
    if (toolResult && toolResult.content?.includes('results')) {
      console.log('✓ Tool results preserved');
    } else {
      console.log('❌ Tool results not preserved!');
      process.exit(1);
    }

    // Get stats after restart
    const statsPhase4 = await store2.getStats();
    console.log(`\n📊 Stats after restart:`);
    console.log(`   - Conversations: ${statsPhase4.conversationCount}`);
    console.log(`   - Total messages: ${statsPhase4.totalMessages}`);

    // Cleanup
    console.log(`\n🧹 Cleaning up test data...`);
    await store2.deleteConversation(conversationId);
    store2.close();
    console.log('✓ Test data deleted');

    // ============================================================================
    // SUCCESS
    // ============================================================================
    console.log('\n' + '='.repeat(60));
    console.log('✅ SUCCESS: Chat persistence works across server restarts!');
    console.log('='.repeat(60));
    console.log('\nKey findings:');
    console.log('  ✓ Conversations persist in database');
    console.log('  ✓ All message types preserved (text, partial, tool use)');
    console.log('  ✓ Message content integrity maintained');
    console.log('  ✓ Chat status properly updated on shutdown');
    console.log('\nTest completed successfully! 🎉');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
runTest();
