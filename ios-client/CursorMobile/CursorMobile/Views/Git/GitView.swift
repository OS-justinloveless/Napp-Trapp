import SwiftUI

// MARK: - iOS-style Jiggle Animation Modifier

extension View {
    func jiggle(isJiggling: Bool, seed: Int = 0) -> some View {
        self.modifier(JiggleModifier(isJiggling: isJiggling, seed: seed))
    }
}

struct JiggleModifier: ViewModifier {
    let isJiggling: Bool
    let seed: Int
    
    // Use seed to create slight variations between items
    private var rotationAmount: Double {
        1.8 + Double(abs(seed) % 5) * 0.2  // 1.8 to 2.6 degrees
    }
    
    private var duration: Double {
        0.10 + Double(abs(seed) % 4) * 0.015  // 0.10 to 0.145 seconds
    }
    
    private var phaseOffset: Double {
        Double(abs(seed) % 7) * 0.3  // Offset to desync animations
    }
    
    func body(content: Content) -> some View {
        if isJiggling {
            content
                .modifier(ContinuousJiggleEffect(
                    rotationAmount: rotationAmount,
                    duration: duration,
                    phaseOffset: phaseOffset
                ))
        } else {
            content
        }
    }
}

struct ContinuousJiggleEffect: ViewModifier {
    let rotationAmount: Double
    let duration: Double
    let phaseOffset: Double
    
    @State private var rotation: Double = 0
    @State private var offset: CGFloat = 0
    
    func body(content: Content) -> some View {
        content
            .rotationEffect(.degrees(rotation))
            .offset(x: offset, y: 0)
            .onAppear {
                // Start with a random phase
                rotation = -rotationAmount
                offset = -0.5
                
                // Use a slight delay based on phase offset for desync
                DispatchQueue.main.asyncAfter(deadline: .now() + phaseOffset * 0.05) {
                    withAnimation(
                        .easeInOut(duration: duration)
                        .repeatForever(autoreverses: true)
                    ) {
                        rotation = rotationAmount
                        offset = 0.5
                    }
                }
            }
    }
}

/// Represents a unified file change for display purposes
/// Combines both tracked unstaged changes and untracked files
struct UnifiedFileChange: Identifiable, Hashable {
    let path: String
    let status: String  // "modified", "added", "deleted", "renamed", "copied", "unmerged", "untracked"
    let oldPath: String?
    let isUntracked: Bool
    
    var id: String { path }
    
    /// Human-readable status
    var statusDisplay: String {
        switch status {
        case "modified": return "Modified"
        case "added", "untracked": return "Added"
        case "deleted": return "Deleted"
        case "renamed": return "Renamed"
        case "copied": return "Copied"
        case "unmerged": return "Conflict"
        default: return status.capitalized
        }
    }
    
    /// SF Symbol for this status in unstaged context
    var unstagedIcon: String {
        switch status {
        case "modified": return "pencil"
        case "added", "untracked": return "plus"
        case "deleted": return "minus"
        case "renamed": return "arrow.right"
        case "copied": return "doc.on.doc"
        case "unmerged": return "exclamationmark.triangle"
        default: return "questionmark"
        }
    }
    
    /// SF Symbol for this status in staged context (always checkmark for staged files)
    var stagedIcon: String {
        return "checkmark"
    }
    
    /// Color for this status
    var statusColor: Color {
        switch status {
        case "modified": return .orange
        case "added", "untracked": return .green
        case "deleted": return .red
        case "renamed", "copied": return .blue
        case "unmerged": return .yellow
        default: return .gray
        }
    }
    
    /// Create from a GitFileChange (tracked file)
    init(from change: GitFileChange) {
        self.path = change.path
        self.status = change.status
        self.oldPath = change.oldPath
        self.isUntracked = false
    }
    
    /// Create from an untracked file path
    init(untrackedPath: String) {
        self.path = untrackedPath
        self.status = "untracked"
        self.oldPath = nil
        self.isUntracked = true
    }
}

// MARK: - GitView (Multi-Repository Support)

struct GitView: View {
    let project: Project
    @EnvironmentObject var authManager: AuthManager
    
    // Repository list state
    @State private var repositories: [GitRepository] = []
    @State private var isScanning = false
    @State private var hasLoadedFromCache = false
    @State private var errorMessage: String?
    
    // Expansion state for each repository (keyed by repo path)
    @State private var expandedRepos: Set<String> = []
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    var body: some View {
        Group {
            if repositories.isEmpty && !hasLoadedFromCache {
                // Initial loading state
                VStack(spacing: 16) {
                    ProgressView()
                        .scaleEffect(1.2)
                    Text("Loading repositories...")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if repositories.isEmpty {
                // No repositories found - show scan prompt
                noRepositoriesView
            } else {
                // Display repositories
                repositoriesListView
            }
        }
        .navigationTitle("Git")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    Task { await scanForRepositories() }
                } label: {
                    if isScanning {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .disabled(isScanning)
            }
        }
        .refreshable {
            await scanForRepositories()
        }
        .task {
            await loadRepositories()
        }
        .onChange(of: project.id) { _, _ in
            // Reset state when project changes
            repositories = []
            hasLoadedFromCache = false
            expandedRepos = []
            errorMessage = nil
            Task {
                await loadRepositories()
            }
        }
    }
    
    // MARK: - No Repositories View
    
    @ViewBuilder
    private var noRepositoriesView: some View {
        ContentUnavailableView {
            Label("No Repositories Found", systemImage: "arrow.triangle.branch")
        } description: {
            Text("Scan this project to discover git repositories, including sub-repositories.")
        } actions: {
            Button {
                Task { await scanForRepositories() }
            } label: {
                HStack {
                    if isScanning {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: "magnifyingglass")
                    }
                    Text(isScanning ? "Scanning..." : "Scan for Repositories")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isScanning)
        }
    }
    
    // MARK: - Repositories List View
    
    @ViewBuilder
    private var repositoriesListView: some View {
        List {
            // Info section
            if repositories.count > 1 {
                Section {
                    HStack {
                        Image(systemName: "info.circle")
                            .foregroundStyle(.blue)
                        Text("\(repositories.count) repositories detected")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            
            // Repository sections
            ForEach(repositories) { repo in
                GitRepoSection(
                    project: project,
                    repository: repo,
                    isExpanded: Binding(
                        get: { expandedRepos.contains(repo.path) },
                        set: { expanded in
                            if expanded {
                                expandedRepos.insert(repo.path)
                            } else {
                                expandedRepos.remove(repo.path)
                            }
                        }
                    )
                )
            }
        }
        .listStyle(.insetGrouped)
    }
    
    // MARK: - Actions
    
    /// Load repositories from cache, then refresh if stale
    private func loadRepositories() async {
        // Try to load from cache first
        if let cached = CacheManager.shared.loadGitRepositories(projectId: project.id) {
            repositories = cached.data
            hasLoadedFromCache = true
            
            // Expand the first repo by default if it's the only one
            if cached.data.count == 1, let first = cached.data.first {
                expandedRepos.insert(first.path)
            }
            
            // If cache is stale, refresh in background
            if cached.isStale {
                await scanForRepositories()
            }
        } else {
            // No cache - need to scan
            hasLoadedFromCache = true  // Mark as loaded so we show the empty state
            await scanForRepositories()
        }
    }
    
    /// Scan the project for git repositories
    private func scanForRepositories() async {
        guard let api = api else { return }
        
        isScanning = true
        errorMessage = nil
        
        do {
            let repos = try await api.scanGitRepositories(projectId: project.id)
            
            // Cache the results
            CacheManager.shared.saveGitRepositories(repos, projectId: project.id)
            
            repositories = repos
            
            // Expand the first repo by default if it's the only one and nothing is expanded
            if repos.count == 1, let first = repos.first, expandedRepos.isEmpty {
                expandedRepos.insert(first.path)
            }
            
            // If there are multiple repos and nothing is expanded, expand all
            if repos.count > 1 && expandedRepos.isEmpty {
                for repo in repos {
                    expandedRepos.insert(repo.path)
                }
            }
        } catch {
            print("[GitView] scanForRepositories error: \(error)")
            errorMessage = error.localizedDescription
        }
        
        isScanning = false
    }
}

#Preview {
    NavigationStack {
        GitView(project: Project(
            id: "test",
            name: "Test Project",
            path: "/test"
        ))
    }
    .environmentObject(AuthManager())
}
