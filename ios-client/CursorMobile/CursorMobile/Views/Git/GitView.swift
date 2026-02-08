import SwiftUI

// MARK: - Conditional View Modifier

extension View {
    /// Conditionally apply a modifier
    @ViewBuilder
    func `if`<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition {
            transform(self)
        } else {
            self
        }
    }
}

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
    @State private var repositoriesWithStatus: [GitRepositoryWithStatus] = []
    @State private var isScanning = false
    @State private var isLoadingStatus = false
    @State private var hasLoadedFromCache = false
    @State private var errorMessage: String?
    
    // Expansion state for each repository (keyed by repo path)
    @State private var expandedRepos: Set<String> = []
    
    // Search, filter, and sort state
    @State private var searchText = ""
    @State private var filterSettings = GitFilterSettings()
    @State private var showFilterSheet = false
    @State private var showSortMenu = false
    
    // Sheet state - lifted to parent to survive child view recreation
    @State private var activeSheet: GitSheetType?
    
    // Toast state - centralized for single toast display
    @State private var toastData: ToastData?
    
    // Refresh trigger - changed after commit to tell GitRepoSection to reload
    @State private var repoRefreshTrigger = UUID()
    
    /// Whether to show search/filter/sort controls (only for multiple repos)
    private var showControls: Bool {
        repositories.count > 1
    }
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    /// Repositories filtered by search query and filter settings, then sorted
    private var displayedRepositories: [GitRepositoryWithStatus] {
        var result = repositoriesWithStatus
        
        // Apply search filter
        if !searchText.isEmpty {
            result = result.filter { $0.matchesSearch(searchText) }
        }
        
        // Apply visibility filters
        result = result.filter { filterSettings.shouldShow($0) }
        
        // Apply sorting
        result = filterSettings.sorted(result)
        
        return result
    }
    
    /// Number of repositories hidden by filters
    private var hiddenCount: Int {
        let afterSearch = searchText.isEmpty 
            ? repositoriesWithStatus 
            : repositoriesWithStatus.filter { $0.matchesSearch(searchText) }
        let afterFilters = afterSearch.filter { filterSettings.shouldShow($0) }
        return afterSearch.count - afterFilters.count
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
                // Display repositories with search/filter controls
                repositoriesListView
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 12) {
                    // Sort/Filter/Search menu - only show for multiple repos
                    if showControls {
                        Menu {
                            // Sort options
                            Section("Sort By") {
                                ForEach(GitFilterSettings.SortOption.allCases, id: \.self) { option in
                                    Button {
                                        filterSettings.sortOption = option
                                    } label: {
                                        HStack {
                                            Label(option.displayName, systemImage: option.icon)
                                            if filterSettings.sortOption == option {
                                                Spacer()
                                                Image(systemName: "checkmark")
                                            }
                                        }
                                    }
                                }
                            }
                            
                            // Quick filters
                            Section("Filters") {
                                Toggle("Hide clean repos", isOn: $filterSettings.hideCleanRepos)
                                Toggle("Hide synced repos", isOn: $filterSettings.hideSyncedRepos)
                            }
                            
                            // More options
                            Section {
                                Button {
                                    showFilterSheet = true
                                } label: {
                                    Label("Excluded Paths...", systemImage: "folder.badge.minus")
                                }
                                
                                if filterSettings.hasActiveFilters {
                                    Button(role: .destructive) {
                                        withAnimation {
                                            filterSettings.reset()
                                        }
                                    } label: {
                                        Label("Reset All", systemImage: "arrow.counterclockwise")
                                    }
                                }
                            }
                        } label: {
                            ZStack(alignment: .topTrailing) {
                                Image(systemName: filterSettings.hasActiveFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                                
                                // Badge for active filter count
                                if filterSettings.activeFilterCount > 0 {
                                    Text("\(filterSettings.activeFilterCount)")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(.white)
                                        .padding(3)
                                        .background(Color.red)
                                        .clipShape(Circle())
                                        .offset(x: 6, y: -6)
                                }
                            }
                        }
                    }
                    
                    // Refresh button
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
        }
        .if(showControls) { view in
            view.searchable(text: $searchText, prompt: "Search repos, files...")
        }
        .refreshable {
            await scanForRepositories()
        }
        .task {
            await loadRepositories()
            loadFilterSettings()
        }
        .onChange(of: project.id) { _, _ in
            // Reset state when project changes
            repositories = []
            repositoriesWithStatus = []
            hasLoadedFromCache = false
            expandedRepos = []
            errorMessage = nil
            searchText = ""
            Task {
                await loadRepositories()
            }
        }
        .onChange(of: filterSettings) { _, newSettings in
            saveFilterSettings(newSettings)
        }
        .sheet(isPresented: $showFilterSheet) {
            GitFilterSheet(settings: $filterSettings)
        }
        .sheet(item: $activeSheet) { sheet in
            sheetContent(for: sheet)
        }
        .toast($toastData)
    }
    
    // MARK: - Sheet Content
    
    @ViewBuilder
    private func sheetContent(for sheet: GitSheetType) -> some View {
        switch sheet {
        case .commit(let stagedFiles, let repoPath):
            GitCommitSheet(project: project, stagedFiles: stagedFiles, repoPath: repoPath) {
                Task {
                    // Refresh the specific repo's status after commit
                    if let rp = repoPath, let repo = repositories.first(where: { $0.path == rp }) {
                        await refreshRepositoryStatus(repo)
                    } else if let rootRepo = repositories.first(where: { $0.isRoot }) {
                        await refreshRepositoryStatus(rootRepo)
                    }
                    // Signal GitRepoSection to reload its local status
                    repoRefreshTrigger = UUID()
                }
            }
        case .branch(let currentBranch, let repoPath):
            GitBranchSheet(project: project, currentBranch: currentBranch, repoPath: repoPath) {
                Task {
                    // Refresh the specific repo's status after branch change
                    if let rp = repoPath, let repo = repositories.first(where: { $0.path == rp }) {
                        await refreshRepositoryStatus(repo)
                    } else if let rootRepo = repositories.first(where: { $0.isRoot }) {
                        await refreshRepositoryStatus(rootRepo)
                    }
                }
            }
        case .diffTracked(let file, let staged, let repoPath):
            GitDiffSheet(project: project, file: file, staged: staged, repoPath: repoPath)
        case .diffUntracked(let path, let repoPath):
            GitDiffSheet(project: project, untrackedFilePath: path, repoPath: repoPath)
        case .commitDetail(let commit, let repoPath):
            GitCommitDetailSheet(project: project, commit: commit, repoPath: repoPath) {
                Task {
                    // Refresh after commit operations (checkout, reset, revert, etc.)
                    if let rp = repoPath, let repo = repositories.first(where: { $0.path == rp }) {
                        await refreshRepositoryStatus(repo)
                    } else if let rootRepo = repositories.first(where: { $0.isRoot }) {
                        await refreshRepositoryStatus(rootRepo)
                    }
                    repoRefreshTrigger = UUID()
                }
            }
        case .graph(let repoPath):
            GitGraphSheet(project: project, repoPath: repoPath) {
                Task {
                    if let rp = repoPath, let repo = repositories.first(where: { $0.path == rp }) {
                        await refreshRepositoryStatus(repo)
                    } else if let rootRepo = repositories.first(where: { $0.isRoot }) {
                        await refreshRepositoryStatus(rootRepo)
                    }
                    repoRefreshTrigger = UUID()
                }
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
            // Info section - only show for multiple repos when there are filters/hidden items
            if showControls && (hiddenCount > 0 || isLoadingStatus) {
                Section {
                    HStack {
                        if isLoadingStatus {
                            ProgressView()
                                .scaleEffect(0.7)
                                .padding(.trailing, 4)
                            Text("Loading status...")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        } else {
                            Image(systemName: "info.circle")
                                .foregroundStyle(.blue)
                            Text("\(displayedRepositories.count) shown, \(hiddenCount) hidden")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        
                        Spacer()
                        
                        if hiddenCount > 0 {
                            Button("Show All") {
                                withAnimation {
                                    filterSettings.hideCleanRepos = false
                                    filterSettings.hideSyncedRepos = false
                                    searchText = ""
                                }
                            }
                            .font(.subheadline)
                        }
                    }
                }
            }
            
            // Empty state when filters hide all repos
            if displayedRepositories.isEmpty && !repositoriesWithStatus.isEmpty {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                        Text("All repositories are hidden by current filters")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Clear Filters") {
                            withAnimation {
                                filterSettings.hideCleanRepos = false
                                filterSettings.hideSyncedRepos = false
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical)
                }
            }
            
            // Repository sections
            ForEach(displayedRepositories) { repoWithStatus in
                GitRepoSection(
                    project: project,
                    repository: repoWithStatus.repository,
                    isExpanded: Binding(
                        get: { expandedRepos.contains(repoWithStatus.repository.path) },
                        set: { expanded in
                            if expanded {
                                expandedRepos.insert(repoWithStatus.repository.path)
                            } else {
                                expandedRepos.remove(repoWithStatus.repository.path)
                            }
                        }
                    ),
                    onStatusChanged: {
                        Task { await refreshRepositoryStatus(repoWithStatus.repository) }
                    },
                    onShowSheet: { sheet in
                        activeSheet = sheet
                    },
                    onShowToast: { toast in
                        toastData = toast
                    },
                    refreshTrigger: repoRefreshTrigger
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
            repositoriesWithStatus = cached.data.map { GitRepositoryWithStatus(repository: $0, status: nil) }
            hasLoadedFromCache = true
            
            // Expand the first repo by default if it's the only one
            if cached.data.count == 1, let first = cached.data.first {
                expandedRepos.insert(first.path)
            }
            
            // Load status for all repositories
            await loadAllRepositoryStatuses()
            
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
            repositoriesWithStatus = repos.map { GitRepositoryWithStatus(repository: $0, status: nil) }
            
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
            
            // Load status for all repositories
            await loadAllRepositoryStatuses()
        } catch {
            print("[GitView] scanForRepositories error: \(error)")
            errorMessage = error.localizedDescription
        }
        
        isScanning = false
    }
    
    /// Load status for all repositories to enable filtering and sorting
    private func loadAllRepositoryStatuses() async {
        guard let api = api else { return }
        
        isLoadingStatus = true
        
        // Load status for each repository concurrently
        await withTaskGroup(of: (String, GitStatus?).self) { group in
            for repo in repositories {
                group.addTask {
                    let repoPath = repo.isRoot ? nil : repo.path
                    do {
                        let status = try await api.getGitStatus(projectId: project.id, repoPath: repoPath)
                        return (repo.path, status)
                    } catch {
                        print("[GitView] Failed to load status for \(repo.path): \(error)")
                        return (repo.path, nil)
                    }
                }
            }
            
            // Collect results and update repositoriesWithStatus
            for await (repoPath, status) in group {
                if let index = repositoriesWithStatus.firstIndex(where: { $0.repository.path == repoPath }) {
                    repositoriesWithStatus[index].status = status
                }
            }
        }
        
        isLoadingStatus = false
    }
    
    /// Refresh status for a single repository
    private func refreshRepositoryStatus(_ repo: GitRepository) async {
        guard let api = api else { return }
        
        let repoPath = repo.isRoot ? nil : repo.path
        do {
            let status = try await api.getGitStatus(projectId: project.id, repoPath: repoPath)
            if let index = repositoriesWithStatus.firstIndex(where: { $0.repository.path == repo.path }) {
                repositoriesWithStatus[index].status = status
            }
        } catch {
            print("[GitView] Failed to refresh status for \(repo.path): \(error)")
        }
    }
    
    // MARK: - Filter Settings Persistence
    
    private func loadFilterSettings() {
        if let settings = CacheManager.shared.loadGitFilterSettings() {
            filterSettings = settings
        }
    }
    
    private func saveFilterSettings(_ settings: GitFilterSettings) {
        CacheManager.shared.saveGitFilterSettings(settings)
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
