import SwiftUI

/// Main container view for the Chat tab - lists conversations and handles navigation
struct ChatTabView: View {
    let project: Project
    @Binding var isChatSessionActive: Bool
    @Binding var pendingConversationId: String?

    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    @EnvironmentObject var chatManager: ChatManager

    @State private var selectedChat: ChatWindow?
    @State private var showNewChatSheet = false

    var body: some View {
        ChatListView(
            project: project,
            selectedChat: $selectedChat,
            showNewChatSheet: $showNewChatSheet
        )
        .navigationTitle("Chat")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showNewChatSheet = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .navigationDestination(item: $selectedChat) { chat in
            ChatSessionView(
                chat: chat,
                project: project,
                isActive: $isChatSessionActive
            )
            .environmentObject(chatManager)
            .environmentObject(webSocketManager)
            .onAppear {
                // Notify WebSocketManager that this conversation is visible
                // Use effectiveTerminalId to match the conversationId the server sends in WebSocket events
                webSocketManager.setVisibleConversation(chat.effectiveTerminalId)
                isChatSessionActive = true
            }
            .onDisappear {
                // Notify WebSocketManager that this conversation is no longer visible
                webSocketManager.setVisibleConversation(nil)
                isChatSessionActive = false
            }
        }
        .sheet(isPresented: $showNewChatSheet) {
            NewChatSheet(project: project) { newChat, initialPrompt in
                if let prompt = initialPrompt, !prompt.isEmpty {
                    chatManager.setPendingInitialMessage(prompt, for: newChat.effectiveTerminalId)
                }
                selectedChat = newChat
            }
            .environmentObject(chatManager)
        }
        .onAppear {
            // Configure chat manager if not already configured
            chatManager.configure(
                apiService: authManager.createAPIService(),
                webSocketManager: webSocketManager
            )

            // Fetch initial data
            Task {
                await chatManager.fetchAgents()
                await chatManager.fetchModels()
                await chatManager.fetchChats(projectPath: project.path)

                // After chats are loaded, check if we have a pending deep link to navigate to
                navigateToPendingConversation()
            }
        }
        .onChange(of: pendingConversationId) { _, newId in
            // If a new pending conversation comes in while we're already visible, navigate immediately
            if newId != nil {
                navigateToPendingConversation()
            }
        }
    }
    /// Navigate to a chat matching the pending conversation ID (from notification deep link)
    private func navigateToPendingConversation() {
        guard let conversationId = pendingConversationId else { return }

        // Find the chat whose effectiveTerminalId matches the notification's conversationId
        if let chat = chatManager.chats.first(where: { $0.effectiveTerminalId == conversationId }) {
            print("[ChatTabView] Deep linking to chat: \(conversationId) (topic: \(chat.topic ?? "nil"))")
            selectedChat = chat
            pendingConversationId = nil
        } else {
            print("[ChatTabView] Chat not found for conversationId: \(conversationId) (have \(chatManager.chats.count) chats)")
            // Don't clear pendingConversationId yet — chats might still be loading
        }
    }
}

#Preview {
    NavigationStack {
        ChatTabView(
            project: Project(
                id: "test",
                name: "Test Project",
                path: "/test/path",
                lastOpened: Date()
            ),
            isChatSessionActive: .constant(false),
            pendingConversationId: .constant(nil)
        )
        .environmentObject(AuthManager())
        .environmentObject(WebSocketManager())
        .environmentObject(ChatManager())
    }
}
