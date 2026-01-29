import Foundation

// MARK: - SavedHost Model

struct SavedHost: Codable, Identifiable, Equatable {
    let id: UUID
    var name: String  // Hostname from SystemInfo
    var serverUrl: String
    var token: String
    var lastConnected: Date
    
    init(name: String, serverUrl: String, token: String) {
        self.id = UUID()
        self.name = name
        self.serverUrl = serverUrl
        self.token = token
        self.lastConnected = Date()
    }
    
    /// Display name that prefers hostname, falls back to server URL
    var displayName: String {
        if name.isEmpty || name == serverUrl {
            // Extract just the host:port from the URL
            if let url = URL(string: serverUrl),
               let host = url.host {
                let port = url.port ?? 3847
                return "\(host):\(port)"
            }
            return serverUrl
        }
        return name
    }
    
    /// Short description showing the server address
    var serverDescription: String {
        if let url = URL(string: serverUrl),
           let host = url.host {
            let port = url.port ?? 3847
            return "\(host):\(port)"
        }
        return serverUrl
    }
    
    /// Formatted last connected time
    var formattedLastConnected: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: lastConnected, relativeTo: Date())
    }
}

// MARK: - SavedHostsManager

@MainActor
class SavedHostsManager: ObservableObject {
    static let shared = SavedHostsManager()
    
    @Published private(set) var savedHosts: [SavedHost] = []
    
    private let storageKey = "napp-trapp-saved-hosts"
    
    private init() {
        loadHosts()
    }
    
    // MARK: - Public Methods
    
    /// Add or update a saved host
    func saveHost(name: String, serverUrl: String, token: String) {
        // Normalize the server URL for comparison
        let normalizedUrl = normalizeUrl(serverUrl)
        
        // Check if host with same server URL already exists
        if let existingIndex = savedHosts.firstIndex(where: { normalizeUrl($0.serverUrl) == normalizedUrl }) {
            // Update existing host
            savedHosts[existingIndex].name = name
            savedHosts[existingIndex].token = token
            savedHosts[existingIndex].lastConnected = Date()
        } else {
            // Add new host
            let newHost = SavedHost(name: name, serverUrl: normalizedUrl, token: token)
            savedHosts.insert(newHost, at: 0) // Insert at beginning (most recent)
        }
        
        // Sort by last connected (most recent first)
        sortHosts()
        persistHosts()
    }
    
    /// Remove a saved host
    func removeHost(_ host: SavedHost) {
        savedHosts.removeAll { $0.id == host.id }
        persistHosts()
    }
    
    /// Remove host at specific offsets (for swipe to delete)
    func removeHosts(at offsets: IndexSet) {
        savedHosts.remove(atOffsets: offsets)
        persistHosts()
    }
    
    /// Update the last connected time for a host
    func updateLastConnected(for serverUrl: String) {
        let normalizedUrl = normalizeUrl(serverUrl)
        if let index = savedHosts.firstIndex(where: { normalizeUrl($0.serverUrl) == normalizedUrl }) {
            savedHosts[index].lastConnected = Date()
            sortHosts()
            persistHosts()
        }
    }
    
    /// Check if there are any saved hosts
    var hasSavedHosts: Bool {
        !savedHosts.isEmpty
    }
    
    // MARK: - Private Methods
    
    private func loadHosts() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let hosts = try? JSONDecoder().decode([SavedHost].self, from: data) else {
            savedHosts = []
            return
        }
        savedHosts = hosts
        sortHosts()
    }
    
    private func persistHosts() {
        guard let data = try? JSONEncoder().encode(savedHosts) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }
    
    private func sortHosts() {
        savedHosts.sort { $0.lastConnected > $1.lastConnected }
    }
    
    private func normalizeUrl(_ url: String) -> String {
        var normalized = url.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Remove trailing slashes
        while normalized.hasSuffix("/") {
            normalized = String(normalized.dropLast())
        }
        
        // Ensure protocol prefix
        if !normalized.hasPrefix("http://") && !normalized.hasPrefix("https://") {
            normalized = "http://\(normalized)"
        }
        
        return normalized.lowercased()
    }
}
