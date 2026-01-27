import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    
    @State private var selectedTab = 0
    @State private var selectedProject: Project?
    @State private var isDrawerOpen = false
    
    // Drawer width
    private let drawerWidth: CGFloat = 280
    
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                // Main content
                VStack(spacing: 0) {
                    mainContent
                }
                .frame(width: geometry.size.width)
                .offset(x: isDrawerOpen ? drawerWidth : 0)
                .disabled(isDrawerOpen)
                
                // Overlay when drawer is open
                if isDrawerOpen {
                    Color.black.opacity(0.3)
                        .ignoresSafeArea()
                        .offset(x: drawerWidth)
                        .onTapGesture {
                            withAnimation(.easeInOut(duration: 0.25)) {
                                isDrawerOpen = false
                            }
                        }
                }
                
                // Drawer
                HStack(spacing: 0) {
                    ProjectSelectionDrawer(
                        selectedProject: $selectedProject,
                        isOpen: $isDrawerOpen
                    )
                    .frame(width: drawerWidth)
                    .background(Color(.systemGroupedBackground))
                    
                    Spacer()
                }
                .offset(x: isDrawerOpen ? 0 : -drawerWidth)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: isDrawerOpen)
        .gesture(
            DragGesture()
                .onEnded { value in
                    // Swipe right to open drawer
                    if value.translation.width > 50 && value.startLocation.x < 50 {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            isDrawerOpen = true
                        }
                    }
                    // Swipe left to close drawer
                    if value.translation.width < -50 && isDrawerOpen {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            isDrawerOpen = false
                        }
                    }
                }
        )
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
        .onChange(of: selectedProject) { _, newProject in
            if let project = newProject {
                webSocketManager.watchPath(project.path)
            }
        }
    }
    
    @ViewBuilder
    private var mainContent: some View {
        if let project = selectedProject {
            // Project selected - show tabs
            projectTabView(project: project)
        } else {
            // No project selected - show prompt
            noProjectSelectedView
        }
    }
    
    private func projectTabView(project: Project) -> some View {
        TabView(selection: $selectedTab) {
            // Files Tab
            NavigationStack {
                ProjectFilesView(project: project)
                    .navigationTitle("Files")
                    .toolbar {
                        ToolbarItem(placement: .navigationBarLeading) {
                            drawerToggleButton
                        }
                    }
            }
            .tabItem {
                Label("Files", systemImage: "folder.fill")
            }
            .tag(0)
            
            // Terminals Tab
            NavigationStack {
                TerminalListView(project: project)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarLeading) {
                            drawerToggleButton
                        }
                    }
            }
            .tabItem {
                Label("Terminals", systemImage: "terminal.fill")
            }
            .tag(1)
            
            // Git Tab
            NavigationStack {
                GitView(project: project)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarLeading) {
                            drawerToggleButton
                        }
                    }
            }
            .tabItem {
                Label("Git", systemImage: "arrow.triangle.branch")
            }
            .tag(2)
            
            // Chat Tab
            NavigationStack {
                ProjectConversationsView(project: project)
                    .navigationTitle("Chat")
                    .toolbar {
                        ToolbarItem(placement: .navigationBarLeading) {
                            drawerToggleButton
                        }
                    }
            }
            .tabItem {
                Label("Chat", systemImage: "bubble.left.and.bubble.right.fill")
            }
            .tag(3)
            
            // Settings Tab
            NavigationStack {
                SettingsView()
                    .toolbar {
                        ToolbarItem(placement: .navigationBarLeading) {
                            drawerToggleButton
                        }
                    }
            }
            .tabItem {
                Label("Settings", systemImage: "gear")
            }
            .tag(4)
        }
    }
    
    private var noProjectSelectedView: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                
                Image(systemName: "folder.badge.questionmark")
                    .font(.system(size: 64))
                    .foregroundStyle(.secondary)
                
                Text("No Project Selected")
                    .font(.title2)
                    .fontWeight(.semibold)
                
                Text("Open the project drawer to select a project")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        isDrawerOpen = true
                    }
                } label: {
                    HStack {
                        Image(systemName: "sidebar.left")
                        Text("Open Projects")
                    }
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(Color.accentColor)
                    .cornerRadius(12)
                }
                
                Spacer()
            }
            .padding()
            .navigationTitle("Cursor Mobile")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    drawerToggleButton
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gear")
                    }
                }
            }
        }
    }
    
    private var drawerToggleButton: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.25)) {
                isDrawerOpen.toggle()
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "sidebar.left")
                if let project = selectedProject {
                    Text(project.name)
                        .font(.subheadline)
                        .lineLimit(1)
                }
            }
        }
    }
}

#Preview {
    MainTabView()
        .environmentObject(AuthManager())
        .environmentObject(WebSocketManager())
}
