import SwiftUI

/// Individual chat session UI with messages, input, and real-time updates
struct ChatSessionView: View {
    let chat: ChatWindow
    let project: Project
    @Binding var isActive: Bool

    @EnvironmentObject var webSocketManager: WebSocketManager
    @EnvironmentObject var chatManager: ChatManager

    // Message state
    @State private var messages: [ParsedMessage] = []
    @State private var currentAssistantMessage: ParsedMessage?
    @State private var rawOutputBuffer: String = ""
    @State private var isStreaming = false
    @State private var isAttached = false

    // Input state
    @State private var inputText = ""
    @State private var selectedMode: ChatMode = .agent
    @State private var selectedModel: AIModel?

    // UI state
    @State private var error: String?
    @State private var scrollToBottom = false
    @State private var isEditingTopic = false
    @State private var editedTopic = ""
    @State private var chatTopic: String

    // Approval state - tracks which approval blocks have been responded to
    @State private var respondedApprovalIds: Set<String> = []

    // Deduplication - tracks block IDs already loaded from persisted history
    @State private var loadedHistoryBlockIds: Set<String> = []

    init(chat: ChatWindow, project: Project, isActive: Binding<Bool>) {
        self.chat = chat
        self.project = project
        self._isActive = isActive
        self._chatTopic = State(initialValue: chat.topic ?? "")
    }

    var body: some View {
        VStack(spacing: 0) {
            // Messages list
            messagesView

            // Input bar with mode and model pickers
            ChatInputBar(
                text: $inputText,
                selectedMode: $selectedMode,
                selectedModel: $selectedModel,
                availableModels: chatManager.models,
                defaultModel: chatManager.defaultModel,
                isStreaming: isStreaming,
                onSend: sendMessage,
                onCancel: cancelChat,
                projectId: project.id
            )
        }
        .navigationTitle(chatTopic.isEmpty ? chat.displayTitle : chatTopic)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                toolbarButtons
            }
        }
        .sheet(isPresented: $isEditingTopic) {
            editTopicSheet
        }
        .onAppear {
            isActive = true

            // Show initial message locally if provided (server sends it to the CLI)
            if let prompt = chatManager.consumePendingInitialMessage(for: chat.effectiveTerminalId) {
                let userMessage = ParsedMessage(
                    id: UUID().uuidString,
                    role: .user,
                    blocks: [
                        ChatContentBlock(
                            id: UUID().uuidString,
                            type: .text,
                            timestamp: Date().timeIntervalSince1970,
                            content: prompt
                        )
                    ],
                    timestamp: Date(),
                    isStreaming: false
                )
                messages.append(userMessage)
                isStreaming = true
                scrollToBottom = true
                attachToChat()
            } else {
                // Load persisted history first, then attach for real-time updates
                loadPersistedHistory()
            }
        }
        .onDisappear {
            isActive = false
            detachFromChat()
        }
        .alert("Error", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: {
            Text(error ?? "")
        }
    }

    private var toolbarButtons: some View {
        HStack(spacing: 12) {
            Button {
                editedTopic = chatTopic
                isEditingTopic = true
            } label: {
                Image(systemName: "pencil")
            }

            if isStreaming {
                Button {
                    cancelChat()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .foregroundColor(.red)
                }
            }
        }
    }

    private var editTopicSheet: some View {
        NavigationView {
            Form {
                Section(header: Text("Chat Topic")) {
                    TextField("Enter topic name", text: $editedTopic)
                        .textInputAutocapitalization(.sentences)
                }
            }
            .navigationTitle("Edit Topic")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        isEditingTopic = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saveTopicChange()
                    }
                    .disabled(editedTopic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    // MARK: - Messages View

    private var messagesView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(allMessages) { message in
                        ChatMessageView(
                            message: message,
                            allConversationBlocks: allConversationBlocks,
                            projectPath: project.path,
                            respondedApprovalIds: respondedApprovalIds,
                            onApproval: { blockId, approved in
                                sendApproval(blockId: blockId, approved: approved)
                            },
                            onInput: { blockId, input in
                                sendInput(input: input)
                            },
                            onFileReference: { path, line in
                                // TODO: Open file viewer
                            }
                        )
                        .id(message.id)
                    }

                    // Thinking indicator — shown while waiting for the AI to start responding
                    if isStreaming && currentAssistantMessage == nil {
                        ThinkingIndicatorView()
                            .id("thinking-indicator")
                            .transition(.opacity)
                    }

                    // Anchor for scrolling to bottom
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: scrollToBottom) { _, shouldScroll in
                if shouldScroll {
                    withAnimation {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                    scrollToBottom = false
                }
            }
            .onChange(of: messages.count) { _, _ in
                scrollToBottom = true
            }
            .onChange(of: currentAssistantMessage?.blocks.count) { _, _ in
                scrollToBottom = true
            }
        }
    }

    /// All messages including current streaming message
    private var allMessages: [ParsedMessage] {
        var result = messages
        if let current = currentAssistantMessage {
            result.append(current)
        }
        return result
    }

    /// All content blocks across all messages (for tool result matching)
    private var allConversationBlocks: [ChatContentBlock] {
        allMessages.flatMap { $0.blocks }
    }

    // MARK: - History Loading

    /// Load persisted message history from the REST API, then attach for real-time updates
    private func loadPersistedHistory() {
        Task {
            let history = await chatManager.fetchChatHistory(conversationId: chat.effectiveTerminalId)
            if !history.isEmpty {
                print("[ChatSessionView] Loaded \(history.count) persisted messages for \(chat.effectiveTerminalId)")
                messages = history
                // Track all block IDs we loaded so we can deduplicate WebSocket history
                for msg in history {
                    for block in msg.blocks {
                        loadedHistoryBlockIds.insert(block.id)
                    }
                }
                scrollToBottom = true
            }
            // After loading history, attach via WebSocket for real-time updates
            attachToChat()
        }
    }

    // MARK: - WebSocket Operations

    private func attachToChat() {
        print("[ChatSessionView] Attaching to chat: \(chat.effectiveTerminalId)")
        chatManager.attachChat(
            chat.effectiveTerminalId,
            workspaceId: project.id,
            onContentBlocks: { blocks in
                print("[ChatSessionView] Received \(blocks.count) content blocks")
                handleContentBlocks(blocks)
            },
            onRawData: { data in
                print("[ChatSessionView] Received raw data: \(data.count) chars")
                handleRawData(data)
            },
            onSessionEvent: { event in
                print("[ChatSessionView] Session event: \(event.type)")
                handleSessionEvent(event)
            },
            onError: { errorMsg in
                print("[ChatSessionView] Error: \(errorMsg)")
                // Only show error popup if we don't already have persisted messages loaded
                // (if we have history, the user can still see it despite the attach error)
                if messages.isEmpty {
                    self.error = errorMsg
                } else {
                    print("[ChatSessionView] Suppressing error popup since persisted history is loaded")
                }
            }
        )
        isAttached = true
    }

    private func detachFromChat() {
        if isAttached {
            chatManager.detachChat(chat.effectiveTerminalId)
            isAttached = false
        }
    }

    private func handleContentBlocks(_ blocks: [ChatContentBlock]) {
        for block in blocks {
            // Skip blocks already loaded from persisted history (deduplication)
            if loadedHistoryBlockIds.contains(block.id) {
                continue
            }

            // Handle session end - finalize current message
            if block.type == .sessionEnd {
                print("[ChatSessionView] session_end received, currentAssistantMessage has \(currentAssistantMessage?.blocks.count ?? 0) blocks")

                // Check if there are pending approval requests that haven't been answered
                let hasPendingApprovals = currentAssistantMessage?.blocks.contains { b in
                    b.type == .approvalRequest && !respondedApprovalIds.contains(b.id)
                } ?? false

                if hasPendingApprovals {
                    // Don't finalize -- the CLI is waiting for user approval
                    print("[ChatSessionView] session_end received but pending approvals exist, keeping streaming state")
                    continue
                }

                if var current = currentAssistantMessage {
                    current.isStreaming = false
                    // Mark all tool blocks as completed
                    for i in current.blocks.indices {
                        if current.blocks[i].type == .toolUseStart {
                            print("[ChatSessionView] Marking tool block \(current.blocks[i].id) as completed")
                            current.blocks[i] = current.blocks[i].withCompleted(true)
                            print("[ChatSessionView] After marking: isPartial = \(String(describing: current.blocks[i].isPartial))")
                        }
                    }
                    messages.append(current)
                    print("[ChatSessionView] Appended message with \(current.blocks.count) blocks to messages array (total: \(messages.count))")
                    currentAssistantMessage = nil
                }
                rawOutputBuffer = ""
                isStreaming = false
                continue
            }

            // Handle user messages (from history)
            if let role = block.role, role == "user" {
                let userMessage = ParsedMessage(
                    id: block.id,
                    role: .user,
                    blocks: [block],
                    timestamp: Date(timeIntervalSince1970: block.timestamp / 1000),
                    isStreaming: false
                )
                messages.append(userMessage)
                continue
            }

            // Ensure we have an assistant message to add blocks to
            if currentAssistantMessage == nil {
                currentAssistantMessage = ParsedMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    blocks: [],
                    timestamp: Date(),
                    isStreaming: true
                )
            }

            // Check if we already have a block with this ID to update
            let blockCount = currentAssistantMessage?.blocks.count ?? 0
            let existingIds = currentAssistantMessage?.blocks.map { $0.id } ?? []
            print("[ChatSessionView] Processing block id=\(block.id), type=\(block.type), existingCount=\(blockCount), existingIds=\(existingIds)")

            if let existingIndex = currentAssistantMessage?.blocks.firstIndex(where: { $0.id == block.id }) {
                // Update existing block - accumulate content for partial blocks
                let existingBlock = currentAssistantMessage!.blocks[existingIndex]
                print("[ChatSessionView] Found existing block at index \(existingIndex), updating...")

                if block.isPartial == true {
                    // Accumulate content for partial updates
                    let existingContent = existingBlock.content ?? ""
                    let newContent = existingContent + (block.content ?? "")
                    print("[ChatSessionView] Accumulating: '\(existingContent)' + '\(block.content ?? "")' = '\(newContent)'")

                    // Merge input dictionaries - new values override existing
                    var mergedInput = existingBlock.input ?? [:]
                    if let newInput = block.input {
                        for (key, value) in newInput {
                            mergedInput[key] = value
                        }
                    }

                    currentAssistantMessage?.blocks[existingIndex] = ChatContentBlock(
                        id: existingBlock.id,
                        type: existingBlock.type,
                        timestamp: block.timestamp,
                        content: newContent,
                        isPartial: block.isPartial,
                        toolId: block.toolId ?? existingBlock.toolId,
                        toolName: block.toolName ?? existingBlock.toolName,
                        input: mergedInput.isEmpty ? nil : mergedInput,
                        path: block.path ?? existingBlock.path,
                        command: block.command ?? existingBlock.command
                    )
                } else {
                    // Replace with complete block
                    currentAssistantMessage?.blocks[existingIndex] = block
                }
            } else {
                // New block - add it
                print("[ChatSessionView] No existing block found, appending new block")
                currentAssistantMessage?.blocks.append(block)
            }
        }

        isStreaming = currentAssistantMessage != nil
    }

    private func handleRawData(_ data: String) {
        // Accumulate raw output
        rawOutputBuffer += data

        // Create or update assistant message with the raw text
        if currentAssistantMessage == nil {
            // Start new assistant message with text block
            let textBlock = ChatContentBlock(
                id: UUID().uuidString,
                type: .text,
                timestamp: Date().timeIntervalSince1970,
                content: rawOutputBuffer
            )
            currentAssistantMessage = ParsedMessage(
                id: UUID().uuidString,
                role: .assistant,
                blocks: [textBlock],
                timestamp: Date(),
                isStreaming: true
            )
        } else {
            // Update the content of the existing text block
            if var blocks = currentAssistantMessage?.blocks,
               let lastIndex = blocks.indices.last,
               blocks[lastIndex].type == .text {
                // Create updated block with new content
                var updatedBlock = blocks[lastIndex]
                updatedBlock = ChatContentBlock(
                    id: updatedBlock.id,
                    type: .text,
                    timestamp: updatedBlock.timestamp,
                    content: rawOutputBuffer
                )
                currentAssistantMessage?.blocks[lastIndex] = updatedBlock
            } else {
                // Add a new text block
                let textBlock = ChatContentBlock(
                    id: UUID().uuidString,
                    type: .text,
                    timestamp: Date().timeIntervalSince1970,
                    content: rawOutputBuffer
                )
                currentAssistantMessage?.blocks.append(textBlock)
            }
        }

        isStreaming = true
    }

    private func handleSessionEvent(_ event: ChatSessionEvent) {
        switch event.type {
        case "chatAttached":
            print("[ChatSessionView] Attached to chat")

        case "chatMessageSent":
            print("[ChatSessionView] Message sent")
            // Clear the raw output buffer for the next response
            rawOutputBuffer = ""
            // Start expecting a response (create empty assistant message)
            isStreaming = true

        case "chatSessionSuspended", "chatSessionEnded":
            // Finalize current message
            if var current = currentAssistantMessage {
                current.isStreaming = false
                messages.append(current)
                currentAssistantMessage = nil
            }
            rawOutputBuffer = ""
            isStreaming = false

        case "chatCancelled":
            // Finalize current message as cancelled
            if var current = currentAssistantMessage {
                current.isStreaming = false
                messages.append(current)
                currentAssistantMessage = nil
            }
            rawOutputBuffer = ""
            isStreaming = false

        default:
            break
        }
    }

    // MARK: - User Actions

    private func sendMessage() {
        let content = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        print("[ChatSessionView] Sending message to \(chat.effectiveTerminalId): \(content.prefix(50))...")

        // Add user message to list
        let userMessage = ParsedMessage(
            id: UUID().uuidString,
            role: .user,
            blocks: [
                ChatContentBlock(
                    id: UUID().uuidString,
                    type: .text,
                    timestamp: Date().timeIntervalSince1970,
                    content: content
                )
            ],
            timestamp: Date(),
            isStreaming: false
        )
        messages.append(userMessage)

        // Clear input
        inputText = ""

        // Build message with optional model flag
        var messageContent = content
        if let model = selectedModel, !model.isDefault {
            messageContent = "--model \(model.id) \(content)"
        }

        // Send via WebSocket with mode
        chatManager.sendMessage(
            chat.effectiveTerminalId,
            content: messageContent,
            workspaceId: project.id,
            mode: selectedMode.rawValue
        )

        scrollToBottom = true
    }

    private func cancelChat() {
        chatManager.cancelChat(chat.effectiveTerminalId)
    }

    private func sendApproval(blockId: String, approved: Bool) {
        // Track that this approval has been responded to (prevents double-tap)
        respondedApprovalIds.insert(blockId)
        chatManager.sendApproval(chat.effectiveTerminalId, blockId: blockId, approved: approved)
        print("[ChatSessionView] Sent approval (\(approved)) for block \(blockId)")
    }

    private func sendInput(input: String) {
        chatManager.sendInput(chat.effectiveTerminalId, input: input)
    }

    private func saveTopicChange() {
        let newTopic = editedTopic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !newTopic.isEmpty else { return }

        print("[ChatSessionView] saveTopicChange called")
        print("[ChatSessionView] chat.id: \(chat.id)")
        print("[ChatSessionView] chat.effectiveTerminalId: \(chat.effectiveTerminalId)")
        print("[ChatSessionView] chat.topic: \(chat.topic ?? "nil")")
        print("[ChatSessionView] newTopic: \(newTopic)")

        Task {
            do {
                print("[ChatSessionView] Calling chatManager.updateChatTopic")
                try await chatManager.updateChatTopic(conversationId: chat.effectiveTerminalId, topic: newTopic)
                print("[ChatSessionView] Topic update succeeded")
                await MainActor.run {
                    chatTopic = newTopic
                    isEditingTopic = false
                }
            } catch {
                print("[ChatSessionView] Topic update failed: \(error)")
                await MainActor.run {
                    self.error = "Failed to update topic: \(error.localizedDescription)"
                }
            }
        }
    }
}

// MARK: - Thinking Indicator View

/// Animated indicator shown while waiting for the AI agent to respond
struct ThinkingIndicatorView: View {
    @State private var dotCount = 0

    private let timer = Timer.publish(every: 0.4, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Assistant avatar
            Image(systemName: "sparkles")
                .font(.title3)
                .foregroundColor(.purple)
                .frame(width: 32, height: 32)
                .background(Color.purple.opacity(0.1))
                .clipShape(Circle())

            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(Color.purple.opacity(index <= dotCount ? 0.8 : 0.25))
                        .frame(width: 8, height: 8)
                        .scaleEffect(index <= dotCount ? 1.0 : 0.7)
                        .animation(.easeInOut(duration: 0.3), value: dotCount)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color(.systemGray6))
            .cornerRadius(16)

            Spacer()
        }
        .onReceive(timer) { _ in
            dotCount = (dotCount + 1) % 3
        }
    }
}

#Preview {
    NavigationStack {
        ChatSessionView(
            chat: ChatWindow(
                id: "test-123",
                windowName: "chat-test",
                tool: "claude",
                sessionName: "test-session",
                windowIndex: 0,
                projectPath: "/test/path",
                active: true,
                terminalId: "test-123",
                topic: "Test Chat",
                title: "Test Chat",
                timestamp: Date().timeIntervalSince1970 * 1000,
                createdAt: nil,
                status: nil
            ),
            project: Project(
                id: "test",
                name: "Test Project",
                path: "/test/path",
                lastOpened: Date()
            ),
            isActive: .constant(true)
        )
        .environmentObject(WebSocketManager())
        .environmentObject(ChatManager())
    }
}
