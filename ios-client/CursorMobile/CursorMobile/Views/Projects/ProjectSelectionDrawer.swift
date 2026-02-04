import SwiftUI

struct ProjectSelectionDrawer: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    @Binding var selectedProject: Project?
    @Binding var isOpen: Bool
    
    @State private var projects: [Project] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showSettings = false
    @State private var showCreateProject = false
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Projects")
                    .font(.title2)
                    .fontWeight(.bold)
                
                Spacer()
                
                Button {
                    showCreateProject = true
                } label: {
                    Image(systemName: "plus")
                        .font(.body)
                }
                
                Button {
                    loadProjects()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.body)
                }
                .disabled(isLoading)
            }
            .padding()
            .background(Color(.systemBackground))
            
            Divider()
            
            // Content
            if isLoading && projects.isEmpty {
                Spacer()
                ProgressView("Loading projects...")
                Spacer()
            } else if let error = error, projects.isEmpty {
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Retry") {
                        loadProjects()
                    }
                    .buttonStyle(.bordered)
                }
                .padding()
                Spacer()
            } else if projects.isEmpty {
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "folder")
                        .font(.system(size: 48))
                        .foregroundColor(.secondary)
                    Text("No Projects")
                        .font(.headline)
                    Text("Recent Cursor projects will appear here")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                    Button {
                        showCreateProject = true
                    } label: {
                        Label("Create New Project", systemImage: "plus")
                    }
                    .buttonStyle(.bordered)
                    .padding(.top, 8)
                }
                .padding()
                Spacer()
            } else {
                projectsList
            }
            
            // Fixed bottom section with Settings and Sign Out
            drawerBottomButtons
        }
        .frame(maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .onAppear {
            if projects.isEmpty {
                loadProjects()
            }
        }
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
        .sheet(isPresented: $showCreateProject) {
            CreateProjectSheet { name, path, template, createGitRepo in
                await createProject(name: name, path: path, template: template, createGitRepo: createGitRepo)
            }
        }
    }
    
    private func createProject(name: String, path: String?, template: String?, createGitRepo: Bool) async {
        guard let api = authManager.createAPIService() else { return }
        
        do {
            let response = try await api.createProject(name: name, path: path, template: template, createGitRepo: createGitRepo)
            if response.success {
                showCreateProject = false
                await refreshProjects()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
    
    private var drawerBottomButtons: some View {
        VStack(spacing: 0) {
            Divider()
            
            HStack(spacing: 16) {
                // Disconnect button
                Button {
                    webSocketManager.disconnect()
                    authManager.logout()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.body)
                        Text("Disconnect")
                            .font(.subheadline)
                    }
                    .foregroundColor(.red)
                }
                
                Spacer()
                
                // Settings button
                Button {
                    showSettings = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "gear")
                            .font(.body)
                        Text("Settings")
                            .font(.subheadline)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color(.systemBackground))
        }
    }
    
    private var projectsList: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(projects) { project in
                    ProjectDrawerRow(
                        project: project,
                        isSelected: selectedProject?.id == project.id
                    ) {
                        selectProject(project)
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .refreshable {
            await refreshProjects()
        }
    }
    
    private func loadProjects() {
        isLoading = true
        error = nil
        
        Task {
            await refreshProjects()
            isLoading = false
        }
    }
    
    private func refreshProjects() async {
        guard let api = authManager.createAPIService() else {
            error = "Not authenticated"
            return
        }
        
        do {
            projects = try await api.getProjects()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
    
    private func selectProject(_ project: Project) {
        selectedProject = project
        // Close drawer after selection
        withAnimation(.easeInOut(duration: 0.25)) {
            isOpen = false
        }
    }
}

struct ProjectDrawerRow: View {
    let project: Project
    let isSelected: Bool
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "folder.fill" : "folder")
                    .font(.title3)
                    .foregroundColor(isSelected ? .accentColor : .secondary)
                    .frame(width: 28)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(project.name)
                        .font(.subheadline)
                        .fontWeight(isSelected ? .semibold : .regular)
                        .foregroundColor(.primary)
                    
                    Text(project.path)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                
                Spacer()
                
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.accentColor)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(isSelected ? Color.accentColor.opacity(0.1) : Color.clear)
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ProjectSelectionDrawer(
        selectedProject: .constant(nil),
        isOpen: .constant(true)
    )
    .environmentObject(AuthManager())
    .environmentObject(WebSocketManager())
}
