import SwiftUI

// MARK: - Graph Layout Helpers

/// Represents a single commit's position in the graph
struct GraphLane {
    let column: Int
    let connections: [GraphConnection]
}

/// A connection line in the graph
struct GraphConnection: Hashable {
    let fromColumn: Int
    let toColumn: Int
    let type: ConnectionType
    
    enum ConnectionType: Hashable {
        case straight    // Vertical line continuing in same column
        case mergeIn     // Line merging from another column into this one
        case branchOut   // Line branching out from this column to another
        case pass        // A line that passes through this row in its own column
    }
}

/// Colors for graph lanes
private let laneColors: [Color] = [
    .blue, .green, .orange, .purple, .pink, .cyan, .mint, .indigo, .teal, .yellow
]

/// Computes graph layout for a list of commits
struct GraphLayoutEngine {
    /// Compute graph lane assignments for commits
    static func computeLayout(for commits: [GitCommit]) -> [String: GraphLane] {
        var result: [String: GraphLane] = [:]
        // Active lanes: each lane tracks the hash of the commit it's waiting for
        var activeLanes: [String?] = []
        
        for commit in commits {
            let hash = commit.hash
            let parents = commit.parents ?? []
            var connections: [GraphConnection] = []
            
            // Find which lane this commit occupies
            var myColumn = activeLanes.firstIndex(of: hash)
            if myColumn == nil {
                // New lane - find first empty slot or append
                if let emptySlot = activeLanes.firstIndex(of: nil) {
                    myColumn = emptySlot
                    activeLanes[emptySlot] = hash
                } else {
                    myColumn = activeLanes.count
                    activeLanes.append(hash)
                }
            }
            
            let col = myColumn!
            
            // Mark pass-through lines for other active lanes
            for (laneIdx, laneHash) in activeLanes.enumerated() {
                if laneIdx != col && laneHash != nil {
                    connections.append(GraphConnection(fromColumn: laneIdx, toColumn: laneIdx, type: .pass))
                }
            }
            
            // Clear current lane
            activeLanes[col] = nil
            
            if parents.isEmpty {
                // Root commit - no further connections
            } else {
                // First parent continues in the same column
                let firstParent = parents[0]
                if let existingLane = activeLanes.firstIndex(of: firstParent) {
                    // First parent already has a lane - merge into it
                    connections.append(GraphConnection(fromColumn: col, toColumn: existingLane, type: .mergeIn))
                } else {
                    // Continue first parent in this column
                    activeLanes[col] = firstParent
                    connections.append(GraphConnection(fromColumn: col, toColumn: col, type: .straight))
                }
                
                // Additional parents (merge commits)
                for parentHash in parents.dropFirst() {
                    if let existingLane = activeLanes.firstIndex(of: parentHash) {
                        // Parent already tracked - merge line
                        connections.append(GraphConnection(fromColumn: col, toColumn: existingLane, type: .mergeIn))
                    } else {
                        // Branch out to new lane for this parent
                        if let emptySlot = activeLanes.firstIndex(of: nil) {
                            activeLanes[emptySlot] = parentHash
                            connections.append(GraphConnection(fromColumn: col, toColumn: emptySlot, type: .branchOut))
                        } else {
                            let newCol = activeLanes.count
                            activeLanes.append(parentHash)
                            connections.append(GraphConnection(fromColumn: col, toColumn: newCol, type: .branchOut))
                        }
                    }
                }
            }
            
            // Trim trailing nil lanes
            while activeLanes.last == nil && !activeLanes.isEmpty {
                activeLanes.removeLast()
            }
            
            result[hash] = GraphLane(column: col, connections: connections)
        }
        
        return result
    }
    
    /// Maximum number of active columns in the layout
    static func maxColumns(in layout: [String: GraphLane]) -> Int {
        var maxCol = 0
        for lane in layout.values {
            maxCol = max(maxCol, lane.column)
            for conn in lane.connections {
                maxCol = max(maxCol, conn.fromColumn, conn.toColumn)
            }
        }
        return maxCol + 1
    }
}

// MARK: - Graph Rail View

/// Draws the graph rail (lines + dot) for a single commit row
struct GraphRailView: View {
    let lane: GraphLane
    let maxColumns: Int
    let isSelected: Bool
    let isHEAD: Bool
    let isMerge: Bool
    
    private let columnWidth: CGFloat = 16
    private let dotRadius: CGFloat = 5
    private let lineWidth: CGFloat = 2
    
    private func colorForColumn(_ col: Int) -> Color {
        laneColors[col % laneColors.count]
    }
    
    var body: some View {
        Canvas { context, size in
            let rowHeight = size.height
            let midY = rowHeight / 2
            
            func xForColumn(_ col: Int) -> CGFloat {
                CGFloat(col) * columnWidth + columnWidth / 2
            }
            
            // Draw connections
            for conn in lane.connections {
                let color = colorForColumn(conn.fromColumn)
                
                switch conn.type {
                case .straight:
                    // Vertical line through the row
                    var path = Path()
                    let x = xForColumn(conn.fromColumn)
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: rowHeight))
                    context.stroke(path, with: .color(color), lineWidth: lineWidth)
                    
                case .pass:
                    // Pass-through line for other lanes
                    var path = Path()
                    let x = xForColumn(conn.fromColumn)
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: rowHeight))
                    context.stroke(path, with: .color(colorForColumn(conn.fromColumn)), lineWidth: lineWidth)
                    
                case .mergeIn:
                    // Line from this commit merging into another column
                    var path = Path()
                    let fromX = xForColumn(conn.fromColumn)
                    let toX = xForColumn(conn.toColumn)
                    path.move(to: CGPoint(x: fromX, y: midY))
                    path.addCurve(
                        to: CGPoint(x: toX, y: rowHeight),
                        control1: CGPoint(x: fromX, y: midY + (rowHeight - midY) * 0.5),
                        control2: CGPoint(x: toX, y: midY + (rowHeight - midY) * 0.5)
                    )
                    context.stroke(path, with: .color(color), lineWidth: lineWidth)
                    // Also draw the continuation line below
                    var contPath = Path()
                    contPath.move(to: CGPoint(x: toX, y: rowHeight))
                    contPath.addLine(to: CGPoint(x: toX, y: rowHeight))
                    context.stroke(contPath, with: .color(colorForColumn(conn.toColumn)), lineWidth: lineWidth)
                    
                case .branchOut:
                    // Line branching from this commit to a new column
                    var path = Path()
                    let fromX = xForColumn(conn.fromColumn)
                    let toX = xForColumn(conn.toColumn)
                    path.move(to: CGPoint(x: fromX, y: midY))
                    path.addCurve(
                        to: CGPoint(x: toX, y: rowHeight),
                        control1: CGPoint(x: fromX, y: midY + (rowHeight - midY) * 0.5),
                        control2: CGPoint(x: toX, y: midY + (rowHeight - midY) * 0.5)
                    )
                    context.stroke(path, with: .color(colorForColumn(conn.toColumn)), lineWidth: lineWidth)
                }
            }
            
            // Draw the commit dot
            let dotX = xForColumn(lane.column)
            let dotColor = colorForColumn(lane.column)
            
            if isMerge {
                // Diamond shape for merge commits
                let size: CGFloat = dotRadius * 1.5
                var diamond = Path()
                diamond.move(to: CGPoint(x: dotX, y: midY - size))
                diamond.addLine(to: CGPoint(x: dotX + size, y: midY))
                diamond.addLine(to: CGPoint(x: dotX, y: midY + size))
                diamond.addLine(to: CGPoint(x: dotX - size, y: midY))
                diamond.closeSubpath()
                context.fill(diamond, with: .color(dotColor))
                if isSelected || isHEAD {
                    context.stroke(diamond, with: .color(.white), lineWidth: 2)
                }
            } else {
                // Circle for regular commits
                let rect = CGRect(x: dotX - dotRadius, y: midY - dotRadius, width: dotRadius * 2, height: dotRadius * 2)
                let circle = Path(ellipseIn: rect)
                context.fill(circle, with: .color(dotColor))
                if isSelected || isHEAD {
                    context.stroke(circle, with: .color(.white), lineWidth: 2)
                }
            }
        }
        .frame(width: CGFloat(max(maxColumns, 1)) * columnWidth + 4)
    }
}

// MARK: - Ref Badge

struct RefBadge: View {
    let name: String
    let type: RefType
    
    enum RefType {
        case branch
        case tag
        case head
    }
    
    var backgroundColor: Color {
        switch type {
        case .branch: return .blue
        case .tag: return .orange
        case .head: return .green
        }
    }
    
    var icon: String {
        switch type {
        case .branch: return "arrow.triangle.branch"
        case .tag: return "tag"
        case .head: return "circlebadge.fill"
        }
    }
    
    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: icon)
                .font(.system(size: 8))
            Text(name)
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .lineLimit(1)
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(backgroundColor.opacity(0.2))
        .foregroundStyle(backgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

// MARK: - Commit Row

struct GitCommitRow: View {
    let commit: GitCommit
    let lane: GraphLane?
    let maxColumns: Int
    let isSelected: Bool
    
    var body: some View {
        HStack(spacing: 8) {
            // Graph rail
            if let lane = lane {
                GraphRailView(
                    lane: lane,
                    maxColumns: maxColumns,
                    isSelected: isSelected,
                    isHEAD: commit.isHEAD,
                    isMerge: commit.isMerge
                )
            }
            
            // Commit info
            VStack(alignment: .leading, spacing: 4) {
                // Subject line
                Text(commit.subject)
                    .font(.subheadline)
                    .fontWeight(commit.isHEAD ? .semibold : .regular)
                    .foregroundStyle(isSelected ? .primary : .primary)
                    .lineLimit(2)
                
                // Ref badges
                let allRefs = buildRefBadges()
                if !allRefs.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 4) {
                            ForEach(allRefs, id: \.name) { badge in
                                RefBadge(name: badge.name, type: badge.type)
                            }
                        }
                    }
                }
                
                // Meta line: hash, author, date
                HStack(spacing: 8) {
                    Text(commit.shortHash)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                    
                    Text(commit.author.name)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    
                    Spacer()
                    
                    Text(commit.relativeDate)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
    
    private func buildRefBadges() -> [(name: String, type: RefBadge.RefType)] {
        var badges: [(name: String, type: RefBadge.RefType)] = []
        
        if commit.isHEAD {
            badges.append((name: "HEAD", type: .head))
        }
        
        for ref in commit.branchRefs {
            // Clean up "HEAD -> main" style refs
            let cleanRef = ref.replacingOccurrences(of: "HEAD -> ", with: "")
            if cleanRef != "HEAD" {
                badges.append((name: cleanRef, type: .branch))
            }
        }
        
        for tag in commit.tagRefs {
            badges.append((name: tag, type: .tag))
        }
        
        return badges
    }
}

// MARK: - GitGraphView

struct GitGraphView: View {
    let project: Project
    let repoPath: String?  // nil for root repo
    let onSelectCommit: (GitCommit) -> Void
    
    @EnvironmentObject var authManager: AuthManager
    
    @State private var commits: [GitCommit] = []
    @State private var graphLayout: [String: GraphLane] = [:]
    @State private var maxColumns: Int = 1
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var selectedCommitHash: String?
    @State private var hasMoreCommits = true
    
    private let pageSize = 30
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    var body: some View {
        Group {
            if isLoading && commits.isEmpty {
                VStack(spacing: 16) {
                    ProgressView()
                        .scaleEffect(1.2)
                    Text("Loading commits...")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = errorMessage, commits.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(.orange)
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Retry") {
                        Task { await loadCommits() }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if commits.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "clock")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("No commits yet")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                commitsList
            }
        }
        .task {
            await loadCommits()
        }
    }
    
    @ViewBuilder
    private var commitsList: some View {
        List {
            ForEach(commits) { commit in
                Button {
                    selectedCommitHash = commit.hash
                    onSelectCommit(commit)
                } label: {
                    GitCommitRow(
                        commit: commit,
                        lane: graphLayout[commit.hash],
                        maxColumns: maxColumns,
                        isSelected: selectedCommitHash == commit.hash
                    )
                }
                .buttonStyle(.plain)
                .listRowBackground(
                    selectedCommitHash == commit.hash
                        ? Color.accentColor.opacity(0.1)
                        : Color.clear
                )
                .onAppear {
                    // Load more when near the end
                    if commit.hash == commits.last?.hash && hasMoreCommits && !isLoadingMore {
                        Task { await loadMoreCommits() }
                    }
                }
            }
            
            if isLoadingMore {
                HStack {
                    Spacer()
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Loading more...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.vertical, 4)
                .listRowBackground(Color.clear)
            }
            
            if !hasMoreCommits && !commits.isEmpty {
                HStack {
                    Spacer()
                    Text("\(commits.count) commits")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Spacer()
                }
                .padding(.vertical, 4)
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
    }
    
    // MARK: - Data Loading
    
    private func loadCommits() async {
        guard let api = api else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            let result = try await api.gitLog(projectId: project.id, limit: pageSize, skip: 0, repoPath: repoPath)
            commits = result
            hasMoreCommits = result.count >= pageSize
            recomputeLayout()
        } catch {
            print("[GitGraphView] loadCommits error: \(error)")
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    private func loadMoreCommits() async {
        guard let api = api, hasMoreCommits else { return }
        
        isLoadingMore = true
        
        do {
            let newCommits = try await api.gitLog(projectId: project.id, limit: pageSize, skip: commits.count, repoPath: repoPath)
            
            if newCommits.isEmpty {
                hasMoreCommits = false
            } else {
                commits.append(contentsOf: newCommits)
                hasMoreCommits = newCommits.count >= pageSize
                recomputeLayout()
            }
        } catch {
            print("[GitGraphView] loadMoreCommits error: \(error)")
        }
        
        isLoadingMore = false
    }
    
    private func recomputeLayout() {
        graphLayout = GraphLayoutEngine.computeLayout(for: commits)
        maxColumns = GraphLayoutEngine.maxColumns(in: graphLayout)
    }
}

// MARK: - GitGraphSheet

/// Sheet wrapper for GitGraphView with NavigationStack and dismiss button
struct GitGraphSheet: View {
    let project: Project
    let repoPath: String?
    let onOperationComplete: () -> Void
    
    @Environment(\.dismiss) private var dismiss
    @State private var selectedCommit: GitCommit?
    
    var body: some View {
        NavigationStack {
            GitGraphView(
                project: project,
                repoPath: repoPath,
                onSelectCommit: { commit in
                    selectedCommit = commit
                }
            )
            .navigationTitle("Commit History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .sheet(item: $selectedCommit) { commit in
            GitCommitDetailSheet(
                project: project,
                commit: commit,
                repoPath: repoPath,
                onOperationComplete: onOperationComplete
            )
        }
    }
}
