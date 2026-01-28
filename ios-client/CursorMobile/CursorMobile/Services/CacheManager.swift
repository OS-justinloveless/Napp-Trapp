import Foundation

/// Manages local caching of API responses for faster UI loading
class CacheManager {
    static let shared = CacheManager()
    
    private let fileManager = FileManager.default
    private let cacheDirectory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    
    // Cache expiration time (in seconds) - data older than this will be considered stale
    // but will still be shown while fresh data is being fetched
    private let cacheExpirationTime: TimeInterval = 3600 // 1 hour
    
    private init() {
        // Use Caches directory which is appropriate for data that can be re-downloaded
        let cachesDir = fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        cacheDirectory = cachesDir.appendingPathComponent("CursorMobileCache", isDirectory: true)
        
        // Create cache directory if it doesn't exist
        try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        
        print("[CacheManager] Cache directory: \(cacheDirectory.path)")
    }
    
    // MARK: - Generic Cache Methods
    
    /// Save data to cache with a given key
    func save<T: Codable>(_ data: T, forKey key: String) {
        let wrapper = CacheWrapper(data: data, timestamp: Date())
        
        do {
            let encoded = try encoder.encode(wrapper)
            let fileURL = cacheDirectory.appendingPathComponent("\(key).json")
            try encoded.write(to: fileURL)
            print("[CacheManager] Saved cache for key: \(key)")
        } catch {
            print("[CacheManager] Failed to save cache for key \(key): \(error)")
        }
    }
    
    /// Load data from cache for a given key
    /// Returns nil if cache doesn't exist or cannot be decoded
    func load<T: Codable>(forKey key: String, as type: T.Type) -> CachedData<T>? {
        let fileURL = cacheDirectory.appendingPathComponent("\(key).json")
        
        guard fileManager.fileExists(atPath: fileURL.path) else {
            print("[CacheManager] No cache found for key: \(key)")
            return nil
        }
        
        do {
            let data = try Data(contentsOf: fileURL)
            let wrapper = try decoder.decode(CacheWrapper<T>.self, from: data)
            
            // Check if cache is stale
            let age = Date().timeIntervalSince(wrapper.timestamp)
            let isStale = age > cacheExpirationTime
            
            print("[CacheManager] Loaded cache for key: \(key), age: \(Int(age))s, stale: \(isStale)")
            
            return CachedData(data: wrapper.data, timestamp: wrapper.timestamp, isStale: isStale)
        } catch {
            print("[CacheManager] Failed to load cache for key \(key): \(error)")
            return nil
        }
    }
    
    /// Remove cached data for a specific key
    func remove(forKey key: String) {
        let fileURL = cacheDirectory.appendingPathComponent("\(key).json")
        try? fileManager.removeItem(at: fileURL)
        print("[CacheManager] Removed cache for key: \(key)")
    }
    
    /// Clear all cached data
    func clearAll() {
        do {
            let files = try fileManager.contentsOfDirectory(at: cacheDirectory, includingPropertiesForKeys: nil)
            for file in files {
                try fileManager.removeItem(at: file)
            }
            print("[CacheManager] Cleared all cache")
        } catch {
            print("[CacheManager] Failed to clear cache: \(error)")
        }
    }
    
    // MARK: - Convenience Methods for Specific Data Types
    
    /// Cache key for projects list
    private var projectsKey: String { "projects_list" }
    
    /// Save projects list to cache
    func saveProjects(_ projects: [Project]) {
        save(projects, forKey: projectsKey)
    }
    
    /// Load projects list from cache
    func loadProjects() -> CachedData<[Project]>? {
        load(forKey: projectsKey, as: [Project].self)
    }
    
    /// Cache key for project conversations
    private func projectConversationsKey(projectId: String) -> String {
        "project_\(projectId)_conversations"
    }
    
    /// Save project conversations to cache
    func saveProjectConversations(_ conversations: [Conversation], projectId: String) {
        save(conversations, forKey: projectConversationsKey(projectId: projectId))
    }
    
    /// Load project conversations from cache
    func loadProjectConversations(projectId: String) -> CachedData<[Conversation]>? {
        load(forKey: projectConversationsKey(projectId: projectId), as: [Conversation].self)
    }
    
    /// Cache key for global conversations
    private var conversationsKey: String { "conversations_list" }
    
    /// Save global conversations to cache
    func saveConversations(_ conversations: [Conversation]) {
        save(conversations, forKey: conversationsKey)
    }
    
    /// Load global conversations from cache
    func loadConversations() -> CachedData<[Conversation]>? {
        load(forKey: conversationsKey, as: [Conversation].self)
    }
    
    /// Cache key for file items in a directory
    private func directoryKey(path: String) -> String {
        // Convert path to safe filename by base64 encoding
        let pathData = path.data(using: .utf8) ?? Data()
        return "dir_\(pathData.base64EncodedString())"
    }
    
    /// Save directory listing to cache
    func saveDirectory(_ items: [FileItem], path: String) {
        save(items, forKey: directoryKey(path: path))
    }
    
    /// Load directory listing from cache
    func loadDirectory(path: String) -> CachedData<[FileItem]>? {
        load(forKey: directoryKey(path: path), as: [FileItem].self)
    }
    
    /// Cache key for project tree
    private func projectTreeKey(projectId: String) -> String {
        "project_\(projectId)_tree"
    }
    
    /// Save project tree to cache
    func saveProjectTree(_ tree: [FileTreeItem], projectId: String) {
        save(tree, forKey: projectTreeKey(projectId: projectId))
    }
    
    /// Load project tree from cache
    func loadProjectTree(projectId: String) -> CachedData<[FileTreeItem]>? {
        load(forKey: projectTreeKey(projectId: projectId), as: [FileTreeItem].self)
    }
    
    /// Cache key for git repositories in a project
    private func gitRepositoriesKey(projectId: String) -> String {
        "project_\(projectId)_git_repos"
    }
    
    /// Save discovered git repositories to cache
    /// Uses a longer expiration since repos rarely change
    func saveGitRepositories(_ repos: [GitRepository], projectId: String) {
        save(repos, forKey: gitRepositoriesKey(projectId: projectId))
    }
    
    /// Load cached git repositories for a project
    func loadGitRepositories(projectId: String) -> CachedData<[GitRepository]>? {
        // Repos are cached for 24 hours since they rarely change
        let cached = load(forKey: gitRepositoriesKey(projectId: projectId), as: [GitRepository].self)
        if let cached = cached {
            // Override stale check - repos are valid for 24 hours
            let reposCacheExpiration: TimeInterval = 86400 // 24 hours
            let isStale = cached.age > reposCacheExpiration
            return CachedData(data: cached.data, timestamp: cached.timestamp, isStale: isStale)
        }
        return nil
    }
    
    /// Clear cached git repositories for a project (e.g., after a rescan)
    func clearGitRepositories(projectId: String) {
        remove(forKey: gitRepositoriesKey(projectId: projectId))
    }
}

// MARK: - Supporting Types

/// Wrapper for cached data with timestamp
private struct CacheWrapper<T: Codable>: Codable {
    let data: T
    let timestamp: Date
}

/// Cached data with metadata
struct CachedData<T> {
    let data: T
    let timestamp: Date
    let isStale: Bool
    
    /// Age of cached data in seconds
    var age: TimeInterval {
        Date().timeIntervalSince(timestamp)
    }
}
