import SwiftUI

struct ProjectsView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var projects: [Project] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showCreateSheet = false
    @State private var selectedProject: Project?
    
    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading projects...")
                } else if let error = error {
                    ErrorView(message: error) {
                        loadProjects()
                    }
                } else if projects.isEmpty {
                    EmptyStateView(
                        icon: "folder",
                        title: "No Projects",
                        message: "Recent Cursor projects will appear here",
                        actionTitle: "Create New Project",
                        action: { showCreateSheet = true }
                    )
                } else {
                    projectsList
                }
            }
            .navigationTitle("Projects")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showCreateSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
                
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        loadProjects()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $showCreateSheet) {
                CreateProjectSheet { name, template in
                    await createProject(name: name, template: template)
                }
            }
            .navigationDestination(item: $selectedProject) { project in
                ProjectDetailView(project: project)
            }
        }
        .onAppear {
            if projects.isEmpty {
                loadProjects()
            }
        }
    }
    
    private var projectsList: some View {
        List {
            ForEach(projects) { project in
                ProjectRow(project: project) {
                    selectedProject = project
                } onOpen: {
                    openProject(project)
                }
            }
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
    
    private func openProject(_ project: Project) {
        Task {
            guard let api = authManager.createAPIService() else { return }
            do {
                try await api.openProject(id: project.id)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
    
    private func createProject(name: String, template: String?) async {
        guard let api = authManager.createAPIService() else { return }
        
        do {
            _ = try await api.createProject(name: name, template: template)
            await refreshProjects()
            showCreateSheet = false
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ProjectRow: View {
    let project: Project
    let onSelect: () -> Void
    let onOpen: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                Image(systemName: "folder.fill")
                    .font(.title2)
                    .foregroundColor(.accentColor)
                    .frame(width: 40)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.name)
                        .font(.headline)
                        .foregroundColor(.primary)
                    
                    Text(project.path)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                    
                    if let lastOpened = project.lastOpened {
                        Text(formatDate(lastOpened))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                
                Spacer()
                
                Button {
                    onOpen()
                } label: {
                    Text("Open")
                        .font(.caption)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
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

struct CreateProjectSheet: View {
    @Environment(\.dismiss) var dismiss
    @State private var name = ""
    @State private var template = ""
    @State private var isCreating = false
    
    let onCreate: (String, String?) async -> Void
    
    private let templates = [
        ("None", ""),
        ("Node.js", "node"),
        ("Python", "python"),
        ("React", "react")
    ]
    
    var body: some View {
        NavigationView {
            Form {
                Section {
                    TextField("Project Name", text: $name)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                } header: {
                    Text("Name")
                }
                
                Section {
                    Picker("Template", selection: $template) {
                        ForEach(templates, id: \.1) { template in
                            Text(template.0).tag(template.1)
                        }
                    }
                } header: {
                    Text("Template (Optional)")
                }
            }
            .navigationTitle("New Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        createProject()
                    } label: {
                        if isCreating {
                            ProgressView()
                        } else {
                            Text("Create")
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
                }
            }
        }
    }
    
    private func createProject() {
        isCreating = true
        Task {
            await onCreate(name, template.isEmpty ? nil : template)
            isCreating = false
            dismiss()
        }
    }
}

#Preview {
    ProjectsView()
        .environmentObject(AuthManager())
}
