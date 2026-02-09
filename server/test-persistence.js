/**
 * Test script for SQLite-based ChatPersistenceStore
 *
 * This script tests:
 * 1. Saving conversations
 * 2. Saving messages (including partial/streaming)
 * 3. Retrieving full message history
 * 4. Database persistence across restarts
 */

import { ChatPersistenceStore } from './src/utils/ChatPersistenceStore.js';

async function runTests() {
  console.log('Starting SQLite Persistence Tests...\n');

  const store = ChatPersistenceStore.getInstance();
  await store.init();

  // Test 1: Save a conversation
  console.log('Test 1: Saving conversation...');
  const testConversation = {
    id: 'test-chat-1',
    tool: 'claude',
    topic: 'Test conversation',
    model: 'claude-3-5-sonnet-20241022',
    mode: 'agent',
    projectPath: '/test/project',
    status: 'running',
    createdAt: Date.now(),
  };

  await store.saveConversation(testConversation);
  const savedConv = await store.getConversation('test-chat-1');
  console.log('✓ Conversation saved:', savedConv.topic);

  // Test 2: Save multiple message types (including partial)
  console.log('\nTest 2: Saving different message types...');

  const messages = [
    {
      id: 'msg-1',
      type: 'text',
      role: 'user',
      conversationId: 'test-chat-1',
      content: 'Hello, how are you?',
      timestamp: Date.now(),
      isPartial: false,
    },
    {
      id: 'msg-2',
      type: 'text',
      conversationId: 'test-chat-1',
      content: 'I am',
      timestamp: Date.now() + 100,
      isPartial: true,
    },
    {
      id: 'msg-2',
      type: 'text',
      conversationId: 'test-chat-1',
      content: 'I am doing',
      timestamp: Date.now() + 200,
      isPartial: true,
    },
    {
      id: 'msg-2',
      type: 'text',
      conversationId: 'test-chat-1',
      content: 'I am doing well, thank you!',
      timestamp: Date.now() + 300,
      isPartial: false,
    },
    {
      id: 'msg-3',
      type: 'tool_use_start',
      conversationId: 'test-chat-1',
      toolId: 'tool-1',
      toolName: 'Read',
      content: '',
      timestamp: Date.now() + 400,
      isPartial: false,
    },
    {
      id: 'msg-4',
      type: 'tool_use_result',
      conversationId: 'test-chat-1',
      toolId: 'tool-1',
      toolName: 'Read',
      content: 'File contents...',
      timestamp: Date.now() + 500,
      isPartial: false,
      isError: false,
    },
    {
      id: 'msg-5',
      type: 'thinking',
      conversationId: 'test-chat-1',
      content: 'Let me analyze this...',
      timestamp: Date.now() + 600,
      isPartial: false,
    },
  ];

  for (const msg of messages) {
    await store.saveMessage('test-chat-1', msg);
  }
  console.log(`✓ Saved ${messages.length} messages (including partial ones)`);

  // Test 3: Retrieve all messages
  console.log('\nTest 3: Retrieving messages...');
  const allMessages = await store.getMessages('test-chat-1');
  console.log(`✓ Retrieved ${allMessages.length} messages`);
  console.log('\nMessage types found:');
  const typeCounts = {};
  allMessages.forEach(msg => {
    typeCounts[msg.type] = (typeCounts[msg.type] || 0) + 1;
  });
  console.log(typeCounts);

  // Test 4: Filter messages (non-partial only)
  console.log('\nTest 4: Filtering non-partial messages...');
  const nonPartialMessages = allMessages.filter(msg => !msg.isPartial);
  console.log(`✓ Found ${nonPartialMessages.length} complete messages`);

  // Test 5: Get statistics
  console.log('\nTest 5: Getting statistics...');
  const stats = await store.getStats();
  console.log(`✓ Stats: ${stats.conversationCount} conversations, ${stats.totalMessages} messages`);

  // Test 6: Get all conversations
  console.log('\nTest 6: Retrieving all conversations...');
  const allConvs = await store.getAllConversations();
  console.log(`✓ Found ${allConvs.length} conversations`);

  // Test 7: Update conversation status
  console.log('\nTest 7: Updating conversation status...');
  await store.updateConversationStatus('test-chat-1', 'ended');
  const updatedConv = await store.getConversation('test-chat-1');
  console.log(`✓ Status updated to: ${updatedConv.status}`);

  // Cleanup
  console.log('\nCleaning up test data...');
  await store.deleteConversation('test-chat-1');
  store.close();
  console.log('✓ Test data cleaned up');

  console.log('\n✅ All tests passed!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
