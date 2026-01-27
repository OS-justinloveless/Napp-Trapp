# Testing Guide: Mobile Chat Feature

## Quick Test Steps

### 1. Prerequisites Check

```bash
# Verify cursor-agent is installed
which cursor-agent

# Verify you're authenticated
cursor-agent status

# If not authenticated, login
cursor-agent login
```

### 2. Access the App

1. Open your mobile browser or desktop browser
2. Navigate to `http://localhost:3847` (or your server's address)
3. Login with your auth token

### 3. Navigate to a Conversation

1. Tap/click "Conversations" in the navigation
2. Select any existing conversation (chat or composer)
3. You should see the conversation history

### 4. Send a Message

1. Scroll to the bottom of the conversation
2. You should see a text input field and send button (📤)
3. Type a message like: "What files are in this project?"
4. Press Enter or tap the send button

### 5. Watch the Response Stream

1. Your message appears immediately
2. A typing indicator (three bouncing dots) appears
3. The AI response streams in real-time character by character
4. When complete, the message is added to the conversation

### 6. Verify Sync with Cursor

1. Open Cursor IDE on your laptop
2. Find the same conversation in Cursor's chat panel
3. Your message and the AI's response should appear there
4. Messages are automatically synced to Cursor's database

## What to Test

### Basic Functionality
- ✅ Message input field is visible and responsive
- ✅ Send button is disabled when input is empty
- ✅ Send button is disabled while sending
- ✅ Messages appear in the chat immediately
- ✅ AI responses stream in real-time
- ✅ Auto-scroll to bottom as messages arrive
- ✅ Enter key sends message
- ✅ Shift+Enter adds new line

### Error Handling
- ✅ Graceful handling if cursor-agent is not installed
- ✅ Error message if not authenticated
- ✅ Timeout handling for long responses
- ✅ Network error recovery

### Visual Feedback
- ✅ Typing indicator animation while AI is responding
- ✅ Streaming message has pulse animation
- ✅ Button shows loading state (⏳) while sending
- ✅ Input is disabled while sending

### Mobile Experience
- ✅ Input field is properly sized for mobile
- ✅ Keyboard doesn't obscure the input
- ✅ Touch targets are large enough
- ✅ Smooth scrolling on mobile

## Troubleshooting

### "cursor-agent: command not found"

Install cursor-agent:
```bash
curl https://cursor.com/install -fsS | bash
```

### "Authentication required"

Login to cursor-agent:
```bash
cursor-agent login
```

### Messages don't stream

Check server logs:
```bash
# Server should show:
Starting cursor-agent with args: [ '--resume', 'chatId', '--workspace', '/path', '-p', '--output-format', 'stream-json', 'message' ]
```

### Messages don't sync to Cursor

- Ensure you're using the correct chat ID
- Check that the workspace path is correct
- Verify cursor-agent has write permissions

## API Testing

You can also test the API directly:

```bash
# Create a new conversation
curl -X POST http://localhost:3847/api/conversations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"global"}'

# Send a message (will stream response)
curl -X POST http://localhost:3847/api/conversations/CHAT_ID/messages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello from API","workspaceId":"global"}'
```

## Expected Behavior

**On success:**
1. User message appears instantly
2. Typing indicator shows for 1-3 seconds
3. AI response streams in word by word
4. Response completes with "complete" event
5. Message is saved to Cursor's database

**On error:**
- Error message displays in red
- User can retry by sending another message
- Previous messages remain visible

## Performance Notes

- First message may take 2-3 seconds (cursor-agent startup)
- Subsequent messages in same session are faster
- Long responses may take 10-30 seconds depending on complexity
- Network latency affects streaming smoothness
