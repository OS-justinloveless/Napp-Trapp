import SwiftUI

/// Main container view for the Chat tab - lists conversations and handles navigation
struct ChatTabView: View {
    let project: Project
    @Binding var isChatSessionActive: Bool

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
            }
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
            isChatSessionActive: .constant(false)
        )
        .environmentObject(AuthManager())
        .environmentObject(WebSocketManager())
        .environmentObject(ChatManager())
    }
}
