import SwiftUI

/// A chat view that uses WebSocket-based CLI sessions with parsed content blocks
struct ChatSessionView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    @Environment(\.dismiss) private var dismiss
    
    let conversation: Conversation
    let workspaceId: String?
    let initialMessage: String?
    
    @State private var messages: [ParsedMessage] = []
    @State private var messageInput = ""
    @State private var isConnecting = true
    @State private var isConnected = false
    @State private var error: String?
    @State private var isSending = false
    @State private var currentAssistantMessage: ParsedMessage?
    @State private var sessionSuspended = false
    @State private var hasSentInitialMessage = false
    @FocusState private var isInputFocused: Bool
    
    init(conversation: Conversation, workspaceId: String? = nil, initialMessage: String? = nil) {
        self.conversation = conversation
        self.workspaceId = workspaceId
        self.initialMessage = initialMessage
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Session status bar
            if sessionSuspended {
                sessionSuspendedBanner
            }
            
            // Messages
            if isConnecting {
                Spacer()
                ProgressView("Connecting to CLI session...")
                Spacer()
            } else if let error = error {
                Spacer()
                errorView(error)
                Spacer()
            } else {
                messagesList
            }
            
            // Input bar
            inputBar
        }
        .navigationTitle(conversation.title.isEmpty ? "Chat" : conversation.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                toolMenu
            }
        }
        .onAppear {
            connectToSession()
        }
        .onDisappear {
            disconnectFromSession()
        }
    }
    
    // MARK: - Session Status Banner
    
    private var sessionSuspendedBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "pause.circle.fill")
                .foregroundColor(.orange)
            
            Text("Session suspended. Send a message to resume.")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color.orange.opacity(0.1))
    }
    
    // MARK: - Messages List
    
    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(messages) { message in
                        MessageBubbleView(
                            message: message,
                            onApproval: { blockId, approved in
                                sendApproval(blockId: blockId, approved: approved)
                            },
                            onInput: { blockId, input in
                                sendInput(input)
                            }
                        )
                        .id(message.id)
                    }
                    
                    // Current streaming message
                    if let current = currentAssistantMessage {
                        MessageBubbleView(
                            message: current,
                            onApproval: { blockId, approved in
                                sendApproval(blockId: blockId, approved: approved)
                            },
                            onInput: { blockId, input in
                                sendInput(input)
                            }
                        )
                        .id("streaming")
                    }
                }
                .padding()
            }
            .onChange(of: messages.count) { _, _ in
                withAnimation {
                    proxy.scrollTo("streaming", anchor: .bottom)
                }
            }
            .onChange(of: currentAssistantMessage?.blocks.count) { _, _ in
                withAnimation {
                    proxy.scrollTo("streaming", anchor: .bottom)
                }
            }
        }
    }
    
    // MARK: - Input Bar
    
    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider()
            
            HStack(alignment: .bottom, spacing: 12) {
                // Text input
                TextField("Message...", text: $messageInput, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .focused($isInputFocused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.systemGray6))
                    .cornerRadius(20)
                
                // Send button
                Button {
                    sendMessage()
                } label: {
                    Image(systemName: isSending ? "stop.circle.fill" : "arrow.up.circle.fill")
                        .font(.title)
                        .foregroundColor(messageInput.isEmpty && !isSending ? .gray : .accentColor)
                }
                .disabled(messageInput.isEmpty && !isSending)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color(.systemBackground))
        }
    }
    
    // MARK: - Tool Menu
    
    private var toolMenu: some View {
        Menu {
            if let tool = conversation.tool {
                Label(tool.displayName, systemImage: tool.icon)
            }
            
            Divider()
            
            Button {
                webSocketManager.cancelChat(conversation.id)
            } label: {
                Label("Cancel", systemImage: "xmark.circle")
            }
        } label: {
            if let tool = conversation.tool {
                Image(systemName: tool.icon)
                    .foregroundColor(tool.color)
            } else {
                Image(systemName: "ellipsis.circle")
            }
        }
    }
    
    // MARK: - Error View
    
    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(.orange)
            
            Text("Connection Error")
                .font(.headline)
            
            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            
            Button("Retry") {
                error = nil
                connectToSession()
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
    
    // MARK: - Session Management
    
    private func connectToSession() {
        isConnecting = true
        error = nil
        sessionSuspended = false
        
        webSocketManager.attachChat(
            conversation.id,
            workspaceId: workspaceId,
            onContentBlocks: { blocks in
                handleContentBlocks(blocks)
            },
            onRawData: { data in
                // Could use this for terminal fallback display
                print("[ChatSessionView] Raw data: \(data.prefix(100))...")
            },
            onSessionEvent: { event in
                handleSessionEvent(event)
            },
            onError: { message in
                handleError(message)
            }
        )
    }
    
    private func disconnectFromSession() {
        webSocketManager.detachChat(conversation.id)
    }
    
    // MARK: - Message Handling
    
    private func handleContentBlocks(_ blocks: [ChatContentBlock]) {
        // If we don't have a current assistant message, start one
        if currentAssistantMessage == nil && !blocks.isEmpty {
            currentAssistantMessage = ParsedMessage(
                id: UUID().uuidString,
                role: .assistant,
                blocks: [],
                timestamp: Date(),
                isStreaming: true
            )
        }
        
        // Append blocks to current message
        currentAssistantMessage?.blocks.append(contentsOf: blocks)
        
        // Check for session end blocks
        if blocks.contains(where: { $0.type == .sessionEnd }) {
            finalizeCurrentMessage()
        }
    }
    
    private func handleSessionEvent(_ event: ChatSessionEvent) {
        switch event.type {
        case "chatAttached":
            isConnecting = false
            isConnected = true
            sessionSuspended = false
            
            // Send initial message if we have one and haven't sent it yet
            if let initial = initialMessage, !initial.isEmpty, !hasSentInitialMessage {
                hasSentInitialMessage = true
                messageInput = initial
                sendMessage()
            }
            
        case "chatMessageSent":
            isSending = false
            
        case "chatSessionSuspended":
            sessionSuspended = true
            finalizeCurrentMessage()
            
        case "chatSessionEnded":
            finalizeCurrentMessage()
            
        case "chatCancelled":
            isSending = false
            finalizeCurrentMessage()
            
        default:
            break
        }
    }
    
    private func handleError(_ message: String) {
        isConnecting = false
        if !isConnected {
            error = message
        } else {
            // Show inline error
            let errorBlock = ChatContentBlock(
                id: UUID().uuidString,
                type: .error,
                timestamp: Date().timeIntervalSince1970 * 1000,
                message: message
            )
            handleContentBlocks([errorBlock])
        }
    }
    
    private func finalizeCurrentMessage() {
        if var message = currentAssistantMessage {
            message.isStreaming = false
            messages.append(message)
            currentAssistantMessage = nil
        }
    }
    
    // MARK: - Send Actions
    
    private func sendMessage() {
        let text = messageInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        
        // Add user message to list
        let userMessage = ParsedMessage(
            id: UUID().uuidString,
            role: .user,
            blocks: [ChatContentBlock(
                id: UUID().uuidString,
                type: .text,
                timestamp: Date().timeIntervalSince1970 * 1000,
                content: text
            )],
            timestamp: Date(),
            isStreaming: false
        )
        messages.append(userMessage)
        
        // Clear input
        messageInput = ""
        isSending = true
        sessionSuspended = false
        
        // Send via WebSocket
        webSocketManager.sendChatMessage(conversation.id, content: text, workspaceId: workspaceId)
    }
    
    private func sendApproval(blockId: String, approved: Bool) {
        webSocketManager.sendChatApproval(conversation.id, blockId: blockId, approved: approved)
    }
    
    private func sendInput(_ input: String) {
        webSocketManager.sendChatInput(conversation.id, input: input)
    }
}

// MARK: - Message Bubble View

struct MessageBubbleView: View {
    let message: ParsedMessage
    var onApproval: ((String, Bool) -> Void)?
    var onInput: ((String, String) -> Void)?
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if message.role == .assistant {
                // Assistant icon
                Image(systemName: "sparkles")
                    .font(.title3)
                    .foregroundColor(.purple)
                    .frame(width: 28, height: 28)
                    .background(Color.purple.opacity(0.1))
                    .clipShape(Circle())
            }
            
            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
                ForEach(message.blocks) { block in
                    ChatContentBlockView(
                        block: block,
                        onApproval: onApproval,
                        onInput: onInput
                    )
                }
                
                if message.isStreaming {
                    HStack(spacing: 4) {
                        ProgressView()
                            .scaleEffect(0.6)
                        Text("Responding...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
            
            if message.role == .user {
                // User icon
                Image(systemName: "person.fill")
                    .font(.caption)
                    .foregroundColor(.white)
                    .frame(width: 28, height: 28)
                    .background(Color.accentColor)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, message.role == .user ? 0 : 4)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        ChatSessionView(
            conversation: Conversation(
                id: "test-123",
                type: "chat",
                title: "Test Chat",
                timestamp: Date().timeIntervalSince1970 * 1000,
                messageCount: 0,
                workspaceId: "global",
                source: "mobile",
                projectName: nil,
                workspaceFolder: nil,
                isProjectChat: false,
                tool: .claude,
                isReadOnly: false,
                readOnlyReason: nil,
                canFork: false
            )
        )
        .environmentObject(AuthManager())
        .environmentObject(WebSocketManager())
    }
}
