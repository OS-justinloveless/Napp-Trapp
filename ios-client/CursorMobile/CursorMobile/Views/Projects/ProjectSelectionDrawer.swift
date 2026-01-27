import SwiftUI

struct ProjectSelectionDrawer: View {
    @EnvironmentObject var authManager: AuthManager
    @Binding var selectedProject: Project?
    @Binding var isOpen: Bool
    
    @State private var projects: [Project] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var openingProject: String?
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Projects")
                    .font(.title2)
                    .fontWeight(.bold)
                
                Spacer()
                
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
                }
                .padding()
                Spacer()
            } else {
                projectsList
            }
        }
        .frame(maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .onAppear {
            if projects.isEmpty {
                loadProjects()
            }
        }
    }
    
    private var projectsList: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(projects) { project in
                    ProjectDrawerRow(
                        project: project,
                        isSelected: selectedProject?.id == project.id,
                        isOpening: openingProject == project.id
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
        openingProject = project.id
        
        Task {
            guard let api = authManager.createAPIService() else {
                openingProject = nil
                return
            }
            
            do {
                // Open project on server
                try await api.openProject(id: project.id)
                
                await MainActor.run {
                    selectedProject = project
                    openingProject = nil
                    // Close drawer after selection
                    withAnimation(.easeInOut(duration: 0.25)) {
                        isOpen = false
                    }
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    openingProject = nil
                }
            }
        }
    }
}

struct ProjectDrawerRow: View {
    let project: Project
    let isSelected: Bool
    let isOpening: Bool
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
                
                if isOpening {
                    ProgressView()
                        .scaleEffect(0.7)
                } else if isSelected {
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
        .disabled(isOpening)
    }
}

#Preview {
    ProjectSelectionDrawer(
        selectedProject: .constant(nil),
        isOpen: .constant(true)
    )
    .environmentObject(AuthManager())
}
