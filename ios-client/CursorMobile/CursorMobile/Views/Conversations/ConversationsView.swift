import SwiftUI

struct ConversationsView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var conversations: [Conversation] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var selectedConversation: Conversation?
    
    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading conversations...")
                } else if let error = error {
                    ErrorView(message: error) {
                        loadConversations()
                    }
                } else if conversations.isEmpty {
                    EmptyStateView(
                        icon: "bubble.left.and.bubble.right",
                        title: "No Conversations",
                        message: "Your Cursor AI chat sessions will appear here"
                    )
                } else {
                    conversationsList
                }
            }
            .navigationTitle("Conversations")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        loadConversations()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .navigationDestination(item: $selectedConversation) { conversation in
                ConversationDetailView(conversation: conversation)
            }
        }
        .onAppear {
            if conversations.isEmpty {
                loadConversations()
            }
        }
    }
    
    private var conversationsList: some View {
        List {
            ForEach(conversations) { conversation in
                ConversationRow(conversation: conversation) {
                    selectedConversation = conversation
                }
            }
        }
        .refreshable {
            await refreshConversations()
        }
    }
    
    private func loadConversations() {
        // Try to load from cache first
        if let cached = CacheManager.shared.loadConversations() {
            conversations = cached.data
            isLoading = false
            error = nil
            print("[ConversationsView] Loaded \(conversations.count) conversations from cache")
        } else {
            isLoading = true
        }
        
        error = nil
        
        // Fetch fresh data in the background
        Task {
            await refreshConversations()
            isLoading = false
        }
    }
    
    private func refreshConversations() async {
        guard let api = authManager.createAPIService() else {
            error = "Not authenticated"
            return
        }
        
        do {
            let freshConversations = try await api.getConversations()
            conversations = freshConversations
            error = nil
            
            // Save to cache
            CacheManager.shared.saveConversations(freshConversations)
            print("[ConversationsView] Fetched and cached \(freshConversations.count) conversations")
        } catch {
            // Only show error if we don't have cached data
            if conversations.isEmpty {
                self.error = error.localizedDescription
            } else {
                print("[ConversationsView] Failed to refresh conversations, using cached data: \(error)")
            }
        }
    }
}

struct ConversationRow: View {
    let conversation: Conversation
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Conversation icon with read-only badge overlay
                ZStack(alignment: .bottomTrailing) {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .font(.title2)
                        .foregroundColor(conversation.isReadOnlyConversation ? .secondary : .accentColor)
                        .frame(width: 40)
                    
                    // Lock badge for read-only conversations
                    if conversation.isReadOnlyConversation {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 10))
                            .foregroundColor(.white)
                            .padding(3)
                            .background(Color.orange)
                            .clipShape(Circle())
                            .offset(x: 4, y: 4)
                    }
                }
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(conversation.title)
                        .font(.headline)
                        .foregroundColor(conversation.isReadOnlyConversation ? .secondary : .primary)
                        .lineLimit(2)
                    
                    HStack(spacing: 4) {
                        // Type badge
                        Text(conversation.type == "composer" ? "Composer" : "Chat")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(conversation.type == "composer" ? Color.purple.opacity(0.2) : Color.blue.opacity(0.2))
                            .foregroundColor(conversation.type == "composer" ? .purple : .blue)
                            .cornerRadius(4)
                        
                        // Read-only badge for Cursor IDE conversations
                        if conversation.isReadOnlyConversation {
                            Text("Read-only")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.orange.opacity(0.2))
                                .foregroundColor(.orange)
                                .cornerRadius(4)
                        }
                        
                        // Mobile badge for chats created from mobile
                        if conversation.source == "mobile" {
                            Text("Mobile")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.green.opacity(0.2))
                                .foregroundColor(.green)
                                .cornerRadius(4)
                        }
                        
                        if let projectName = conversation.projectName {
                            Text(projectName)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        } else {
                            Text("Global")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    
                    HStack {
                        Text("\(conversation.messageCount) messages")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        
                        Spacer()
                        
                        Text(formatDate(conversation.lastModified))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }
    
    private func formatDate(_ date: Date) -> String {
        let now = Date()
        let diff = now.timeIntervalSince(date)
        
        if diff < 60 {
            return "Just now"
        } else if diff < 3600 {
            return "\(Int(diff / 60))m ago"
        } else if diff < 86400 {
            return "\(Int(diff / 3600))h ago"
        } else if diff < 604800 {
            return "\(Int(diff / 86400))d ago"
        } else {
            let formatter = DateFormatter()
            formatter.dateStyle = .short
            return formatter.string(from: date)
        }
    }
}

struct ConversationDetailView: View {
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss
    
    let conversation: Conversation
    
    // Number of recent messages to load initially (increased for better UX)
    private let initialMessageLimit = 200
    
    @State private var messages: [ConversationMessage] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var messageInput = ""
    @State private var isSending = false
    @State private var streamingMessage: ConversationMessage?
    @State private var hasScrolledToBottom = false
    @State private var totalMessageCount = 0
    @State private var isLoadingMore = false
    @State private var isForking = false
    @State private var forkedConversation: Conversation?
    @State private var showForkSuccess = false
    @FocusState private var isInputFocused: Bool
    @State private var selectedImages: [SelectedImage] = []
    
    var body: some View {
        VStack(spacing: 0) {
            // Read-only banner
            if conversation.isReadOnlyConversation {
                readOnlyBanner
            }
            
            // Messages content
            Group {
                if isLoading {
                    Spacer()
                    ProgressView("Loading messages...")
                    Spacer()
                } else if let error = error {
                    Spacer()
                    ErrorView(message: error) {
                        loadMessages()
                    }
                    Spacer()
                } else if messages.isEmpty && streamingMessage == nil {
                    Spacer()
                    EmptyStateView(
                        icon: "bubble.left",
                        title: "No Messages",
                        message: "Conversation messages could not be loaded"
                    )
                    Spacer()
                } else {
                    messagesList
                }
            }
            
            // Message input area (disabled for read-only)
            if conversation.isReadOnlyConversation {
                readOnlyInputPlaceholder
            } else {
                messageInputView
            }
        }
        .navigationTitle("Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            loadMessages()
        }
        .navigationDestination(item: $forkedConversation) { forkedConv in
            ConversationDetailView(conversation: forkedConv)
        }
        .alert("Conversation Forked", isPresented: $showForkSuccess) {
            Button("Open Fork") {
                // forkedConversation is already set, navigation will happen automatically
            }
            Button("Stay Here", role: .cancel) {
                forkedConversation = nil
            }
        } message: {
            Text("Created an editable copy of this conversation. Would you like to open it?")
        }
    }
    
    // MARK: - Read-Only UI Components
    
    private var readOnlyBanner: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "lock.fill")
                    .foregroundColor(.orange)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text("Read-Only Conversation")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    
                    Text(conversation.readOnlyReason ?? "This conversation was created in Cursor IDE and cannot be edited from mobile.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                
                Spacer()
            }
            
            // Fork button
            if conversation.canForkConversation {
                Button {
                    forkConversation()
                } label: {
                    HStack {
                        if isForking {
                            ProgressView()
                                .scaleEffect(0.8)
                                .padding(.trailing, 4)
                        } else {
                            Image(systemName: "doc.on.doc")
                        }
                        Text(isForking ? "Creating Copy..." : "Fork to Edit")
                    }
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.accentColor)
                    .cornerRadius(8)
                }
                .disabled(isForking)
            }
        }
        .padding()
        .background(Color.orange.opacity(0.1))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(Color.orange.opacity(0.3)),
            alignment: .bottom
        )
    }
    
    private var readOnlyInputPlaceholder: some View {
        VStack(spacing: 0) {
            Divider()
            
            HStack {
                Image(systemName: "lock.fill")
                    .foregroundColor(.secondary)
                Text("This conversation is read-only")
                    .foregroundColor(.secondary)
                    .font(.subheadline)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Color(.secondarySystemBackground))
        }
    }
    
    private func forkConversation() {
        isForking = true
        error = nil
        
        Task {
            guard let api = authManager.createAPIService() else {
                await MainActor.run {
                    error = "Not authenticated"
                    isForking = false
                }
                return
            }
            
            do {
                let response = try await api.forkConversation(
                    id: conversation.id,
                    workspaceId: conversation.workspaceId
                )
                
                await MainActor.run {
                    forkedConversation = response.conversation
                    showForkSuccess = true
                    isForking = false
                }
            } catch {
                await MainActor.run {
                    self.error = "Failed to fork: \(error.localizedDescription)"
                    isForking = false
                }
            }
        }
    }
    
    private var filteredMessages: [ConversationMessage] {
        messages.filter { !$0.isEmpty }
    }
    
    private var messagesList: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                // Message count header
                if totalMessageCount > 0 {
                    HStack {
                        Text("Showing \(filteredMessages.count) of \(totalMessageCount) messages")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        Spacer()
                        
                        if messages.count < totalMessageCount {
                            Button {
                                loadMoreMessages()
                            } label: {
                                HStack(spacing: 4) {
                                    if isLoadingMore {
                                        ProgressView()
                                            .scaleEffect(0.7)
                                    } else {
                                        Image(systemName: "arrow.up.circle")
                                    }
                                    Text("Load More")
                                }
                                .font(.caption)
                            }
                            .disabled(isLoadingMore)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .background(Color(.secondarySystemBackground))
                }
                
                ScrollView {
                    LazyVStack(spacing: 16) {
                        // Top anchor
                        Color.clear
                            .frame(height: 1)
                            .id("top")
                        
                        // Load more indicator (if scrolled to top)
                        if messages.count < totalMessageCount {
                            Button {
                                loadMoreMessages()
                            } label: {
                                HStack {
                                    if isLoadingMore {
                                        ProgressView()
                                            .padding(.trailing, 4)
                                    }
                                    Text(isLoadingMore ? "Loading..." : "Load \(min(initialMessageLimit, totalMessageCount - messages.count)) earlier messages")
                                        .font(.subheadline)
                                }
                                .foregroundColor(.accentColor)
                                .padding(.vertical, 12)
                                .frame(maxWidth: .infinity)
                                .background(Color(.tertiarySystemBackground))
                                .cornerRadius(8)
                            }
                            .disabled(isLoadingMore)
                        }
                        
                        ForEach(filteredMessages, id: \.messageId) { message in
                            MessageBubble(message: message)
                                .id(message.messageId)
                        }
                        
                        // Streaming message
                        if let streaming = streamingMessage {
                            MessageBubble(message: streaming, isStreaming: true)
                                .id("streaming")
                        }
                        
                        // Invisible anchor at the very bottom
                        Color.clear
                            .frame(height: 1)
                            .id("bottom")
                    }
                    .padding()
                }
            }
            .onAppear {
                // Scroll to bottom immediately when messages load
                if !hasScrolledToBottom && !messages.isEmpty {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        proxy.scrollTo("bottom", anchor: .bottom)
                        hasScrolledToBottom = true
                    }
                }
            }
            .onChange(of: messages.count) { newCount in
                // Only auto-scroll if we're adding new messages (not loading older ones)
                if hasScrolledToBottom && !isLoadingMore {
                    scrollToBottom(proxy: proxy)
                }
            }
            .onChange(of: streamingMessage?.text) { _ in
                scrollToBottom(proxy: proxy)
            }
        }
    }
    
    private func scrollToBottom(proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }
    
    private var messageInputView: some View {
        VStack(spacing: 0) {
            Divider()
            
            // Image attachments preview
            if !selectedImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(selectedImages) { selectedImage in
                            ZStack(alignment: .topTrailing) {
                                Image(uiImage: selectedImage.image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 60, height: 60)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                
                                Button {
                                    removeImage(selectedImage)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 20))
                                        .foregroundColor(.white)
                                        .background(Circle().fill(Color.black.opacity(0.5)))
                                }
                                .offset(x: 5, y: -5)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .padding(.top, 8)
            }
            
            HStack(alignment: .bottom, spacing: 12) {
                // Text input
                TextField("Type a message...", text: $messageInput, axis: .vertical)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(20)
                    .lineLimit(1...5)
                    .focused($isInputFocused)
                    .disabled(isSending)
                    .onSubmit {
                        sendMessage()
                    }
                
                // Image picker
                ImagePickerButton(selectedImages: $selectedImages, maxImages: 5)
                    .disabled(isSending)
                
                // Send button
                Button {
                    sendMessage()
                } label: {
                    Image(systemName: isSending ? "hourglass" : "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundColor(canSend ? .accentColor : .gray)
                }
                .disabled(!canSend)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(.systemBackground))
        }
    }
    
    private func removeImage(_ image: SelectedImage) {
        selectedImages.removeAll { $0.id == image.id }
    }
    
    private var canSend: Bool {
        let hasText = !messageInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasAttachments = !selectedImages.isEmpty
        return (hasText || hasAttachments) && !isSending
    }
    
    private func loadMessages() {
        isLoading = true
        error = nil
        hasScrolledToBottom = false
        
        Task {
            guard let api = authManager.createAPIService() else {
                await MainActor.run {
                    error = "Not authenticated"
                    isLoading = false
                }
                return
            }
            
            do {
                // Load recent messages with pagination (last N messages)
                let loadedMessages = try await api.getConversationMessages(
                    id: conversation.id,
                    limit: initialMessageLimit,
                    offset: 0
                )
                
                await MainActor.run {
                    messages = loadedMessages
                    // Use the conversation's messageCount as the total
                    totalMessageCount = conversation.messageCount
                    error = nil
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }
    
    private func loadMoreMessages() {
        guard !isLoadingMore else { return }
        isLoadingMore = true
        
        Task {
            guard let api = authManager.createAPIService() else {
                await MainActor.run {
                    isLoadingMore = false
                }
                return
            }
            
            do {
                // Load older messages (offset by current count)
                let olderMessages = try await api.getConversationMessages(
                    id: conversation.id,
                    limit: initialMessageLimit,
                    offset: messages.count
                )
                
                await MainActor.run {
                    // Prepend older messages
                    messages = olderMessages + messages
                    isLoadingMore = false
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    isLoadingMore = false
                }
            }
        }
    }
    
    private func sendMessage() {
        let trimmedMessage = messageInput.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasText = !trimmedMessage.isEmpty
        let hasImages = !selectedImages.isEmpty
        
        guard (hasText || hasImages), !isSending else { return }
        
        let userMessage = trimmedMessage
        let imagesToSend = selectedImages
        
        // Clear input
        messageInput = ""
        selectedImages = []
        isSending = true
        error = nil
        isInputFocused = false
        
        // Convert images to attachments
        var attachments: [MessageAttachment] = []
        for selectedImage in imagesToSend {
            if let base64 = selectedImage.toBase64(),
               let thumbnailData = selectedImage.thumbnail().jpegData(compressionQuality: 0.5)?.base64EncodedString() {
                let attachment = MessageAttachment(
                    id: UUID().uuidString,
                    type: .image,
                    filename: "image-\(Date().timeIntervalSince1970).jpg",
                    mimeType: "image/jpeg",
                    size: selectedImage.estimatedSize,
                    data: base64,
                    url: nil,
                    thumbnailData: thumbnailData
                )
                attachments.append(attachment)
            }
        }
        
        // Add user message to UI immediately
        let newUserMessage = ConversationMessage(
            id: "temp-\(Date().timeIntervalSince1970)",
            type: "user",
            text: hasText ? userMessage : nil,
            timestamp: Date().timeIntervalSince1970 * 1000,
            modelType: nil,
            codeBlocks: nil,
            selections: nil,
            relevantFiles: nil,
            attachments: attachments.isEmpty ? nil : attachments
        )
        messages.append(newUserMessage)
        
        // Create empty streaming message for assistant response
        var streamingToolCalls: [ToolCall] = []
        streamingMessage = ConversationMessage(
            id: "streaming",
            type: "assistant",
            text: "",
            timestamp: Date().timeIntervalSince1970 * 1000,
            modelType: nil,
            codeBlocks: nil,
            selections: nil,
            relevantFiles: nil,
            toolCalls: []
        )
        
        // Capture conversation ID and workspace ID as values, not conversation object
        let conversationId = conversation.id
        let workspaceId = conversation.workspaceId
        
        // Use a regular Task instead of detached to maintain proper actor context
        // Capture only what we need as weak references
        Task { [weak authManager] in
            guard let authManager = authManager,
                  let api = authManager.createAPIService() else {
                await MainActor.run {
                    error = "Not authenticated"
                    isSending = false
                    streamingMessage = nil
                }
                return
            }
            
            // Use actor-isolated state for accumulating text
            var assistantText = ""
            
            do {
                // Use the callback-based API that keeps the connection alive
                try await api.sendMessage(
                    conversationId: conversationId,
                    message: userMessage,
                    workspaceId: workspaceId,
                    attachments: attachments
                ) { [weak authManager] event in
                    // Only process if authManager still exists (view likely still active)
                    guard authManager != nil else { return }
                    
                    // Handle each event on the main thread
                    Task { @MainActor in
                        switch event {
                        case .connected:
                            print("Connected to cursor-agent")
                        case .text(let text):
                            assistantText += text
                            streamingMessage = ConversationMessage(
                                id: "streaming",
                                type: "assistant",
                                text: assistantText,
                                timestamp: Date().timeIntervalSince1970 * 1000,
                                modelType: nil,
                                codeBlocks: nil,
                                selections: nil,
                                relevantFiles: nil,
                                toolCalls: streamingToolCalls
                            )
                        case .toolCall(let toolCall):
                            // Add or update tool call
                            if let existingIndex = streamingToolCalls.firstIndex(where: { $0.id == toolCall.id }) {
                                streamingToolCalls[existingIndex] = toolCall
                            } else {
                                streamingToolCalls.append(toolCall)
                            }
                            streamingMessage = ConversationMessage(
                                id: "streaming",
                                type: "assistant",
                                text: assistantText,
                                timestamp: Date().timeIntervalSince1970 * 1000,
                                modelType: nil,
                                codeBlocks: nil,
                                selections: nil,
                                relevantFiles: nil,
                                toolCalls: streamingToolCalls
                            )
                        case .toolResult(let toolId, let content, let isError):
                            // Update tool call status
                            if let index = streamingToolCalls.firstIndex(where: { $0.id == toolId }) {
                                streamingToolCalls[index].status = isError ? .error : .complete
                                streamingToolCalls[index].result = content
                                streamingMessage = ConversationMessage(
                                    id: "streaming",
                                    type: "assistant",
                                    text: assistantText,
                                    timestamp: Date().timeIntervalSince1970 * 1000,
                                    modelType: nil,
                                    codeBlocks: nil,
                                    selections: nil,
                                    relevantFiles: nil,
                                    toolCalls: streamingToolCalls
                                )
                            }
                        case .complete(let success):
                            if success {
                                // Mark any remaining running tools as complete
                                let finalToolCalls = streamingToolCalls.map { tc -> ToolCall in
                                    var updated = tc
                                    if updated.status == .running {
                                        updated.status = .complete
                                    }
                                    return updated
                                }
                                // Add final message
                                var finalMessage = ConversationMessage(
                                    id: "response-\(Date().timeIntervalSince1970)",
                                    type: "assistant",
                                    text: assistantText,
                                    timestamp: Date().timeIntervalSince1970 * 1000,
                                    modelType: nil,
                                    codeBlocks: nil,
                                    selections: nil,
                                    relevantFiles: nil,
                                    toolCalls: finalToolCalls.isEmpty ? nil : finalToolCalls
                                )
                                messages.append(finalMessage)
                            } else if assistantText.isEmpty && streamingToolCalls.isEmpty {
                                error = "No response received from assistant"
                            }
                            streamingMessage = nil
                            isSending = false
                        case .error(let errorMessage):
                            error = errorMessage
                            streamingMessage = nil
                            isSending = false
                        }
                    }
                }
                
                // Stream completed - finalize if needed
                await MainActor.run {
                    if isSending {
                        if !assistantText.isEmpty || !streamingToolCalls.isEmpty {
                            let finalToolCalls = streamingToolCalls.map { tc -> ToolCall in
                                var updated = tc
                                if updated.status == .running {
                                    updated.status = .complete
                                }
                                return updated
                            }
                            var finalMessage = ConversationMessage(
                                id: "response-\(Date().timeIntervalSince1970)",
                                type: "assistant",
                                text: assistantText,
                                timestamp: Date().timeIntervalSince1970 * 1000,
                                modelType: nil,
                                codeBlocks: nil,
                                selections: nil,
                                relevantFiles: nil,
                                toolCalls: finalToolCalls.isEmpty ? nil : finalToolCalls
                            )
                            messages.append(finalMessage)
                        }
                        streamingMessage = nil
                        isSending = false
                    }
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    streamingMessage = nil
                    isSending = false
                }
            }
        }
    }
}

struct MessageBubble: View {
    let message: ConversationMessage
    let isStreaming: Bool
    
    init(message: ConversationMessage, isStreaming: Bool = false) {
        self.message = message
        self.isStreaming = isStreaming
    }
    
    private var isUser: Bool {
        !message.isAssistant
    }
    
    var body: some View {
        HStack {
            // User messages on the right, assistant on the left
            if isUser {
                Spacer(minLength: 40)
            }
            
            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                // Role label with streaming indicator
                HStack(spacing: 4) {
                    Text(message.role?.capitalized ?? "Unknown")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    if isStreaming {
                        ProgressView()
                            .scaleEffect(0.5)
                    }
                }
                
                VStack(alignment: .leading, spacing: 8) {
                    // Tool calls (if any)
                    if let toolCalls = message.toolCalls, !toolCalls.isEmpty {
                        ToolCallsView(toolCalls: toolCalls)
                    }
                    
                    // Attachments (if any)
                    if let attachments = message.attachments, !attachments.isEmpty {
                        AttachmentsView(attachments: attachments, isUserMessage: isUser)
                    }
                    
                    // Message content with markdown
                    if let content = message.content, !content.isEmpty {
                        MarkdownTextView(content: content, isUserMessage: isUser)
                    }
                }
            }
            
            if !isUser {
                Spacer(minLength: 40)
            }
        }
    }
}

// MARK: - Markdown Text View

struct MarkdownTextView: View {
    let content: String
    let isUserMessage: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Parse content into blocks (text, code blocks)
            ForEach(parseContent(), id: \.id) { block in
                switch block.type {
                case .text:
                    // Render markdown text
                    if let attributedString = try? AttributedString(markdown: block.content, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
                        Text(attributedString)
                            .font(.body)
                            .padding(12)
                            .background(isUserMessage ? Color.accentColor : Color(.secondarySystemBackground))
                            .foregroundColor(isUserMessage ? .white : .primary)
                            .cornerRadius(16)
                            .textSelection(.enabled)
                    } else {
                        // Fallback for invalid markdown
                        Text(block.content)
                            .font(.body)
                            .padding(12)
                            .background(isUserMessage ? Color.accentColor : Color(.secondarySystemBackground))
                            .foregroundColor(isUserMessage ? .white : .primary)
                            .cornerRadius(16)
                            .textSelection(.enabled)
                    }
                    
                case .codeBlock:
                    CodeBlockView(language: block.language ?? "code", code: block.content)
                }
            }
        }
    }
    
    private func parseContent() -> [ContentBlock] {
        var blocks: [ContentBlock] = []
        let pattern = "```(\\w*)\\n([\\s\\S]*?)```"
        
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            // Return entire content as text if regex fails
            if !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                blocks.append(ContentBlock(type: .text, content: content, language: nil))
            }
            return blocks
        }
        
        let nsContent = content as NSString
        let matches = regex.matches(in: content, options: [], range: NSRange(location: 0, length: nsContent.length))
        
        var lastEnd = 0
        
        for match in matches {
            // Add text before code block
            if match.range.location > lastEnd {
                let textRange = NSRange(location: lastEnd, length: match.range.location - lastEnd)
                let text = nsContent.substring(with: textRange).trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty {
                    blocks.append(ContentBlock(type: .text, content: text, language: nil))
                }
            }
            
            // Add code block
            let languageRange = match.range(at: 1)
            let codeRange = match.range(at: 2)
            
            let language = languageRange.location != NSNotFound ? nsContent.substring(with: languageRange) : nil
            let code = codeRange.location != NSNotFound ? nsContent.substring(with: codeRange) : ""
            
            if !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                blocks.append(ContentBlock(type: .codeBlock, content: code, language: language?.isEmpty == true ? nil : language))
            }
            
            lastEnd = match.range.location + match.range.length
        }
        
        // Add remaining text after last code block
        if lastEnd < nsContent.length {
            let text = nsContent.substring(from: lastEnd).trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                blocks.append(ContentBlock(type: .text, content: text, language: nil))
            }
        }
        
        // If no blocks were created, add the entire content as text
        if blocks.isEmpty && !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            blocks.append(ContentBlock(type: .text, content: content, language: nil))
        }
        
        return blocks
    }
}

struct ContentBlock: Identifiable {
    enum BlockType {
        case text
        case codeBlock
    }
    
    let id = UUID()
    let type: BlockType
    let content: String
    let language: String?
}

// MARK: - Code Block View

struct CodeBlockView: View {
    let language: String
    let code: String
    @State private var isExpanded = false
    
    private var lines: [String] {
        code.components(separatedBy: "\n")
    }
    
    private var shouldCollapse: Bool {
        lines.count > 15
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text(language.uppercased())
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .foregroundColor(.accentColor)
                
                Spacer()
                
                if shouldCollapse {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            isExpanded.toggle()
                        }
                    } label: {
                        Text(isExpanded ? "Collapse" : "Expand (\(lines.count) lines)")
                            .font(.caption2)
                    }
                }
                
                Button {
                    UIPasteboard.general.string = code
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.black.opacity(0.3))
            
            // Code content
            ScrollView(.horizontal, showsIndicators: true) {
                Text(code)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundColor(Color(UIColor.lightGray))
                    .padding(12)
            }
            .frame(maxHeight: shouldCollapse && !isExpanded ? 200 : nil)
            .clipped()
        }
        .background(Color(red: 0.12, green: 0.12, blue: 0.18))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(.separator), lineWidth: 0.5)
        )
    }
}

// MARK: - Tool Calls View

struct ToolCallsView: View {
    let toolCalls: [ToolCall]
    
    var body: some View {
        VStack(spacing: 6) {
            ForEach(toolCalls) { toolCall in
                ToolCallRow(toolCall: toolCall)
            }
        }
    }
}

struct ToolCallRow: View {
    let toolCall: ToolCall
    @State private var isExpanded = false
    
    private var statusColor: Color {
        switch toolCall.status {
        case .running:
            return .accentColor
        case .complete:
            return .green
        case .error:
            return .red
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header - always visible
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 10) {
                    // Status indicator
                    Rectangle()
                        .fill(statusColor)
                        .frame(width: 3)
                    
                    // Icon
                    Text(toolCall.displayInfo.icon)
                        .font(.system(size: 16))
                    
                    // Info
                    VStack(alignment: .leading, spacing: 2) {
                        Text(toolCall.displayInfo.displayName)
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)
                            .textCase(.uppercase)
                        
                        Text(toolCall.displayInfo.description)
                            .font(.subheadline)
                            .foregroundColor(.primary)
                            .lineLimit(1)
                    }
                    
                    Spacer()
                    
                    // Status icon
                    Group {
                        switch toolCall.status {
                        case .running:
                            ProgressView()
                                .scaleEffect(0.6)
                        case .complete:
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                        case .error:
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.red)
                        }
                    }
                    .frame(width: 20)
                    
                    // Chevron
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .padding(.vertical, 10)
                .padding(.horizontal, 12)
            }
            .buttonStyle(.plain)
            
            // Details - shown when expanded
            if isExpanded {
                Divider()
                    .padding(.leading, 12)
                
                VStack(alignment: .leading, spacing: 12) {
                    // Input
                    if let input = toolCall.input, !input.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("INPUT")
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(.secondary)
                            
                            ScrollView(.horizontal, showsIndicators: true) {
                                Text(formatInput(input))
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundColor(.primary)
                            }
                            .frame(maxHeight: 150)
                            .padding(8)
                            .background(Color(.tertiarySystemBackground))
                            .cornerRadius(6)
                        }
                    }
                    
                    // Result
                    if let result = toolCall.result, !result.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("RESULT")
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(.secondary)
                            
                            ScrollView {
                                Text(result.prefix(2000) + (result.count > 2000 ? "\n...(truncated)" : ""))
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundColor(.primary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(maxHeight: 200)
                            .padding(8)
                            .background(Color(.tertiarySystemBackground))
                            .cornerRadius(6)
                        }
                    }
                }
                .padding(12)
            }
        }
        .background(Color(.secondarySystemBackground))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(.separator), lineWidth: 0.5)
        )
    }
    
    private func formatInput(_ input: [String: AnyCodableValue]) -> String {
        // Convert to a readable string
        var lines: [String] = []
        for (key, value) in input.sorted(by: { $0.key < $1.key }) {
            lines.append("\(key): \(formatValue(value))")
        }
        return lines.joined(separator: "\n")
    }
    
    private func formatValue(_ value: AnyCodableValue) -> String {
        switch value {
        case .string(let s):
            return s.count > 100 ? String(s.prefix(100)) + "..." : s
        case .int(let i):
            return String(i)
        case .double(let d):
            return String(d)
        case .bool(let b):
            return String(b)
        case .array(let arr):
            return "[\(arr.count) items]"
        case .dictionary(let dict):
            return "{\(dict.count) keys}"
        case .null:
            return "null"
        }
    }
}

// MARK: - Attachments View

struct AttachmentsView: View {
    let attachments: [MessageAttachment]
    let isUserMessage: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(attachments) { attachment in
                if attachment.isImage {
                    ImageAttachmentView(attachment: attachment, isUserMessage: isUserMessage)
                } else {
                    FileAttachmentView(attachment: attachment, isUserMessage: isUserMessage)
                }
            }
        }
    }
}

struct ImageAttachmentView: View {
    let attachment: MessageAttachment
    let isUserMessage: Bool
    @State private var showFullScreen = false
    
    var body: some View {
        Group {
            if let base64Data = attachment.data,
               let imageData = Data(base64Encoded: base64Data),
               let uiImage = UIImage(data: imageData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 250, maxHeight: 250)
                    .cornerRadius(12)
                    .onTapGesture {
                        showFullScreen = true
                    }
                    .sheet(isPresented: $showFullScreen) {
                        FullScreenImageView(image: uiImage)
                    }
            } else if let thumbnailData = attachment.thumbnailData,
                      let imageData = Data(base64Encoded: thumbnailData),
                      let uiImage = UIImage(data: imageData) {
                // Show thumbnail if full image not available
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 150, maxHeight: 150)
                    .cornerRadius(8)
                    .opacity(0.7)
            }
        }
    }
}

struct FileAttachmentView: View {
    let attachment: MessageAttachment
    let isUserMessage: Bool
    
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .font(.title2)
                .foregroundColor(isUserMessage ? .white : .accentColor)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.displayName)
                    .font(.subheadline)
                    .lineLimit(1)
                
                if let size = attachment.size {
                    Text(formatFileSize(size))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            
            Spacer()
        }
        .padding(12)
        .background(isUserMessage ? Color.white.opacity(0.2) : Color(.tertiarySystemBackground))
        .cornerRadius(8)
    }
    
    private var iconName: String {
        switch attachment.type {
        case .image:
            return "photo"
        case .document:
            return "doc"
        case .file:
            return "paperclip"
        }
    }
    
    private func formatFileSize(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(bytes))
    }
}

struct FullScreenImageView: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    
    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(width: geometry.size.width * scale, height: geometry.size.height * scale)
                        .gesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    let delta = value / lastScale
                                    lastScale = value
                                    scale = min(max(scale * delta, 1.0), 5.0)
                                }
                                .onEnded { _ in
                                    lastScale = 1.0
                                }
                        )
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

#Preview {
    ConversationsView()
        .environmentObject(AuthManager())
}
