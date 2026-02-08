import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    
    @State private var selectedTab = 0
    @State private var selectedProject: Project?
    @State private var isDrawerOpen = false
    
    // Track when terminal view is active (to hide tab bar)
    @State private var isTerminalViewActive = false

    // Track when chat session is active (to hide tab bar)
    @State private var isChatSessionActive = false

    // ChatManager for managing chat state
    @StateObject private var chatManager = ChatManager()
    
    // Track if we've attempted to restore the last project
    @State private var hasAttemptedProjectRestore = false
    
    // Settings sheet
    @State private var showSettings = false
    
    // Drawer width
    private let drawerWidth: CGFloat = 280
    
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                // Main content
                VStack(spacing: 0) {
                    // WebSocket status indicator at the top
                    webSocketStatusBar

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
        .simultaneousGesture(
            DragGesture()
                .onEnded { value in
                    // Swipe right to open drawer (only from left edge)
                    if value.translation.width > 50 && value.startLocation.x < 30 {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            isDrawerOpen = true
                        }
                    }
                    // Swipe left to close drawer (only when drawer is open)
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

                // Configure chat manager
                chatManager.configure(
                    apiService: authManager.createAPIService(),
                    webSocketManager: webSocketManager
                )

                // Restore last project if we haven't already
                if !hasAttemptedProjectRestore && selectedProject == nil {
                    restoreLastProject()
                }
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
                
                // Save this project as the last opened for this server
                if let serverUrl = authManager.serverUrl {
                    SavedHostsManager.shared.saveLastProject(projectId: project.id, for: serverUrl)
                }
            }
        }
        .onChange(of: selectedTab) { _, newTab in
            // Reset terminal view active state when switching away from terminals tab
            if newTab != 2 {
                isTerminalViewActive = false
            }
            // Reset chat session active state when switching away from chat tab
            if newTab != 3 {
                isChatSessionActive = false
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
        ZStack(alignment: .bottom) {
            // Tab content
            Group {
                switch selectedTab {
                case 0:
                    filesTab(project: project)
                case 1:
                    gitTab(project: project)
                case 2:
                    terminalsTab(project: project)
                case 3:
                    chatTab(project: project)
                default:
                    filesTab(project: project)
                }
            }
            
            // Floating tab bar - hide when in terminal or chat session view
            if !isTerminalViewActive && !isChatSessionActive {
                FloatingTabBar(selectedTab: $selectedTab)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 16)
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") {
                                showSettings = false
                            }
                        }
                    }
            }
        }
    }
    
    // MARK: - Tab Views
    
    private func filesTab(project: Project) -> some View {
        NavigationStack {
            ProjectFilesView(project: project)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        drawerToggleButton
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    // Space for floating tab bar
                    Color.clear.frame(height: 80)
                }
        }
    }
    
    private func gitTab(project: Project) -> some View {
        NavigationStack {
            GitView(project: project)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        drawerToggleButton
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    Color.clear.frame(height: 80)
                }
        }
    }
    
    private func terminalsTab(project: Project) -> some View {
        NavigationStack {
            TerminalListView(project: project, isTerminalViewActive: $isTerminalViewActive)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        drawerToggleButton
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    // Only add bottom spacing when tab bar is visible
                    if !isTerminalViewActive {
                        Color.clear.frame(height: 80)
                    }
                }
        }
    }

    private func chatTab(project: Project) -> some View {
        NavigationStack {
            ChatTabView(project: project, isChatSessionActive: $isChatSessionActive)
                .environmentObject(chatManager)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        drawerToggleButton
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    // Only add bottom spacing when tab bar is visible
                    if !isChatSessionActive {
                        Color.clear.frame(height: 80)
                    }
                }
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
            .navigationTitle("Napp Trapp")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    drawerToggleButton
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
                        .truncationMode(.middle)
                        .frame(maxWidth: 180, alignment: .leading)
                }
            }
        }
    }

    private var webSocketStatusBar: some View {
        HStack(spacing: 6) {
            Image(systemName: webSocketManager.isConnected ? "wifi" : "wifi.slash")
                .font(.caption2)
                .foregroundColor(webSocketManager.isConnected ? .green : .red)

            Circle()
                .fill(webSocketManager.isConnected ? Color.green : Color.red)
                .frame(width: 6, height: 6)

            Text(webSocketManager.isConnected ? "Connected" : "Disconnected")
                .font(.caption2)
                .foregroundColor(.secondary)

            Spacer()
            
            Image(systemName: "chevron.right")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(.systemGroupedBackground))
        .contentShape(Rectangle())
        .onTapGesture {
            showSettings = true
        }
    }

    // MARK: - Project Restoration
    
    private func restoreLastProject() {
        guard let serverUrl = authManager.serverUrl,
              let lastProjectId = SavedHostsManager.shared.getLastProjectId(for: serverUrl) else {
            hasAttemptedProjectRestore = true
            return
        }
        
        hasAttemptedProjectRestore = true
        
        Task {
            guard let api = authManager.createAPIService() else { return }
            
            do {
                // Fetch projects list
                let projects = try await api.getProjects()
                
                // Find the last project by ID
                if let lastProject = projects.first(where: { $0.id == lastProjectId }) {
                    await MainActor.run {
                        selectedProject = lastProject
                        print("[MainTabView] Restored last project: \(lastProject.name)")
                    }
                } else {
                    print("[MainTabView] Last project ID \(lastProjectId) not found in projects list")
                }
            } catch {
                print("[MainTabView] Failed to restore last project: \(error.localizedDescription)")
            }
        }
    }
    
}

// MARK: - Previews

#Preview("No Project Selected") {
    MainTabView()
        .environmentObject(AuthManager())
        .environmentObject(WebSocketManager())
}

#Preview("With Project Selected") {
    MainTabViewPreview()
        .environmentObject(AuthManager())
        .environmentObject(WebSocketManager())
}

/// Preview wrapper that shows MainTabView with a project already selected
private struct MainTabViewPreview: View {
    @State private var selectedProject: Project? = Project(
        id: "preview-project",
        name: "CursorMobile",
        path: "/Users/developer/Projects/CursorMobile",
        lastOpened: Date()
    )
    
    var body: some View {
        MainTabViewWithProject(selectedProject: $selectedProject)
    }
}

/// Internal view for preview that accepts a binding for selectedProject
private struct MainTabViewWithProject: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    
    @Binding var selectedProject: Project?
    @State private var selectedTab = 0
    @State private var isDrawerOpen = false
    
    private let drawerWidth: CGFloat = 280
    
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                VStack(spacing: 0) {
                    if let project = selectedProject {
                        projectTabView(project: project)
                    }
                }
                .frame(width: geometry.size.width)
                .offset(x: isDrawerOpen ? drawerWidth : 0)
                .disabled(isDrawerOpen)
                
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
    }
    
    private func projectTabView(project: Project) -> some View {
        ZStack(alignment: .bottom) {
            Group {
                switch selectedTab {
                case 0:
                    filesTab(project: project)
                case 1:
                    gitTab(project: project)
                case 2:
                    terminalsTab(project: project)
                default:
                    filesTab(project: project)
                }
            }
            
            FloatingTabBar(selectedTab: $selectedTab)
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
        }
        .ignoresSafeArea(edges: .bottom)
    }
    
    private func filesTab(project: Project) -> some View {
        NavigationStack {
            // Preview with dummy file data
            PreviewFilesView(project: project)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        drawerToggleButton
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    Color.clear.frame(height: 80)
                }
        }
    }
    
    private func gitTab(project: Project) -> some View {
        NavigationStack {
            GitView(project: project)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        drawerToggleButton
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    Color.clear.frame(height: 80)
                }
        }
    }
    
    private func terminalsTab(project: Project) -> some View {
        NavigationStack {
            TerminalListView(project: project)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        drawerToggleButton
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    Color.clear.frame(height: 80)
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
                        .truncationMode(.middle)
                        .frame(maxWidth: 180, alignment: .leading)
                }
            }
        }
    }
}

/// Preview-only files view with dummy data
private struct PreviewFilesView: View {
    let project: Project
    
    private let dummyFiles: [FileItem] = [
        FileItem(name: "Sources", path: "/Sources", isDirectory: true, size: 0, modified: Date()),
        FileItem(name: "Tests", path: "/Tests", isDirectory: true, size: 0, modified: Date()),
        FileItem(name: "Resources", path: "/Resources", isDirectory: true, size: 0, modified: Date()),
        FileItem(name: "Package.swift", path: "/Package.swift", isDirectory: false, size: 1245, modified: Date()),
        FileItem(name: "README.md", path: "/README.md", isDirectory: false, size: 3420, modified: Date()),
        FileItem(name: ".gitignore", path: "/.gitignore", isDirectory: false, size: 156, modified: Date()),
        FileItem(name: "ContentView.swift", path: "/Sources/ContentView.swift", isDirectory: false, size: 2048, modified: Date()),
        FileItem(name: "App.swift", path: "/Sources/App.swift", isDirectory: false, size: 512, modified: Date()),
        FileItem(name: "Models", path: "/Sources/Models", isDirectory: true, size: 0, modified: Date()),
        FileItem(name: "Views", path: "/Sources/Views", isDirectory: true, size: 0, modified: Date()),
        FileItem(name: "config.json", path: "/config.json", isDirectory: false, size: 890, modified: Date()),
        FileItem(name: "Makefile", path: "/Makefile", isDirectory: false, size: 420, modified: Date()),
    ]
    
    var body: some View {
        List {
            Section {
                ForEach(dummyFiles) { item in
                    PreviewFileItemRow(item: item)
                }
            }
        }
    }
}

/// File item row for preview (uses different name to avoid conflict with FileComponents.FileItemRow)
private struct PreviewFileItemRow: View {
    let item: FileItem
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.icon)
                .font(.title2)
                .foregroundColor(item.isDirectory ? .accentColor : .secondary)
                .frame(width: 28)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name)
                    .font(.body)
                    .lineLimit(1)
                
                if !item.isDirectory {
                    Text(item.formattedSize)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            Spacer()
            
            if item.isDirectory {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}
