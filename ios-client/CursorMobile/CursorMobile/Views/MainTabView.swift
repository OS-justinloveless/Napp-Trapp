import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    @State private var selectedTab = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            ProjectsView()
                .tabItem {
                    Label("Projects", systemImage: "folder.fill")
                }
                .tag(0)
            
            FileBrowserView()
                .tabItem {
                    Label("Files", systemImage: "doc.fill")
                }
                .tag(1)
            
            ConversationsView()
                .tabItem {
                    Label("Chat", systemImage: "bubble.left.and.bubble.right.fill")
                }
                .tag(2)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(3)
        }
        .onAppear {
            // Connect WebSocket when authenticated
            if authManager.isAuthenticated {
                webSocketManager.connect(
                    serverUrl: authManager.serverUrl ?? "",
                    token: authManager.token ?? ""
                )
            }
        }
        .onChange(of: authManager.isAuthenticated) { _, isAuthenticated in
            if !isAuthenticated {
                webSocketManager.disconnect()
            }
        }
    }
}

#Preview {
    MainTabView()
        .environmentObject(AuthManager())
        .environmentObject(WebSocketManager())
}
