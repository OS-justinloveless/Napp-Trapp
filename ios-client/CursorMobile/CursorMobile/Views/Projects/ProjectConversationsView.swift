import SwiftUI

struct ProjectConversationsView: View {
    @EnvironmentObject var authManager: AuthManager
    
    let project: Project
    
    @State private var conversations: [Conversation] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var selectedConversation: Conversation?
    @State private var isCreatingChat = false
    @State private var newChatId: String?
    
    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading conversations...")
            } else if let error = error {
                ErrorView(message: error) {
                    loadConversations()
                }
            } else if conversations.isEmpty {
                emptyStateWithNewChat
            } else {
                conversationsList
            }
        }
        .navigationDestination(item: $selectedConversation) { conversation in
            ConversationDetailView(conversation: conversation)
        }
        .navigationDestination(item: $newChatId) { chatId in
            // Navigate to the new chat using a temporary Conversation object
            // New chats from mobile are editable (not read-only)
            ConversationDetailView(conversation: Conversation(
                id: chatId,
                type: "chat",
                title: "New Chat",
                timestamp: Date().timeIntervalSince1970 * 1000,
                messageCount: 0,
                workspaceId: project.id,
                source: "mobile",
                projectName: project.name,
                workspaceFolder: project.path,
                isProjectChat: true,
                isReadOnly: false,
                readOnlyReason: nil,
                canFork: false
            ))
        }
        .onAppear {
            if conversations.isEmpty {
                loadConversations()
            }
        }
        .onChange(of: project.id) { _, _ in
            // Reset state when project changes
            conversations = []
            selectedConversation = nil
            newChatId = nil
            isLoading = true
            error = nil
            loadConversations()
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 12) {
                    Button {
                        createNewChat()
                    } label: {
                        if isCreatingChat {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle())
                        } else {
                            Image(systemName: "plus.bubble")
                        }
                    }
                    .disabled(isCreatingChat)
                    
                    Button {
                        loadConversations()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
    }
    
    private var emptyStateWithNewChat: some View {
        VStack(spacing: 20) {
            EmptyStateView(
                icon: "bubble.left.and.bubble.right",
                title: "No Conversations",
                message: "Start a new AI chat session for this project"
            )
            
            Button {
                createNewChat()
            } label: {
                HStack {
                    if isCreatingChat {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle())
                            .tint(.white)
                    } else {
                        Image(systemName: "plus.bubble.fill")
                    }
                    Text("New Chat")
                }
                .font(.headline)
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(Color.accentColor)
                .cornerRadius(12)
            }
            .disabled(isCreatingChat)
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
        if let cached = CacheManager.shared.loadProjectConversations(projectId: project.id) {
            conversations = cached.data
            isLoading = false
            error = nil
            print("[ProjectConversationsView] Loaded \(conversations.count) conversations from cache")
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
            let freshConversations = try await api.getProjectConversations(projectId: project.id)
            conversations = freshConversations
            error = nil
            
            // Save to cache
            CacheManager.shared.saveProjectConversations(freshConversations, projectId: project.id)
            print("[ProjectConversationsView] Fetched and cached \(freshConversations.count) conversations")
        } catch {
            // Only show error if we don't have cached data
            if conversations.isEmpty {
                self.error = error.localizedDescription
            } else {
                print("[ProjectConversationsView] Failed to refresh conversations, using cached data: \(error)")
            }
        }
    }
    
    private func createNewChat() {
        isCreatingChat = true
        error = nil
        
        Task {
            guard let api = authManager.createAPIService() else {
                await MainActor.run {
                    error = "Not authenticated"
                    isCreatingChat = false
                }
                return
            }
            
            do {
                let chatId = try await api.createConversation(workspaceId: project.id)
                await MainActor.run {
                    isCreatingChat = false
                    // Navigate to the new chat
                    newChatId = chatId
                }
            } catch {
                await MainActor.run {
                    self.error = "Failed to create chat: \(error.localizedDescription)"
                    isCreatingChat = false
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        ProjectConversationsView(project: Project(id: "test", name: "Test Project", path: "/path/to/project"))
    }
    .environmentObject(AuthManager())
}
