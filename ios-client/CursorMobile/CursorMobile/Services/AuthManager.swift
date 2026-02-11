import Foundation
import SwiftUI

@MainActor
class AuthManager: ObservableObject {
    @Published var token: String?
    @Published var serverUrl: String?
    @Published var hostname: String?  // Current connected host's name
    @Published var isAuthenticated = false
    @Published var isLoading = true
    @Published var error: String?
    
    private let storageKey = "napp-trapp-auth"
    private let savedHostsManager = SavedHostsManager.shared
    
    init() {
        loadStoredCredentials()
    }
    
    private func loadStoredCredentials() {
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let credentials = try? JSONDecoder().decode(StoredCredentials.self, from: data) {
            self.token = credentials.token
            self.serverUrl = credentials.serverUrl
            self.hostname = credentials.hostname
            
            // Validate stored credentials
            Task {
                await validateToken()
            }
        } else {
            isLoading = false
        }
    }
    
    private func validateToken() async {
        guard let serverUrl = serverUrl, let token = token else {
            isLoading = false
            return
        }
        
        do {
            let apiService = APIService(serverUrl: serverUrl, token: token)
            _ = try await apiService.getSystemInfo()
            isAuthenticated = true
        } catch {
            // Token validation failed - clear credentials
            logout()
        }
        
        isLoading = false
    }
    
    func login(serverUrl: String, token: String) async {
        self.error = nil
        
        // Normalize URL
        var normalizedUrl = serverUrl
        if normalizedUrl.hasSuffix("/") {
            normalizedUrl = String(normalizedUrl.dropLast())
        }
        
        // Ensure URL has protocol
        if !normalizedUrl.hasPrefix("http://") && !normalizedUrl.hasPrefix("https://") {
            normalizedUrl = "http://\(normalizedUrl)"
        }
        
        do {
            let apiService = APIService(serverUrl: normalizedUrl, token: token)
            let systemInfo = try await apiService.getSystemInfo()
            
            // Success - save credentials
            self.token = token
            self.serverUrl = normalizedUrl
            self.hostname = systemInfo.hostname
            self.isAuthenticated = true
            
            saveCredentials()
            
            // Save to saved hosts for reconnection
            savedHostsManager.saveHost(
                name: systemInfo.hostname,
                serverUrl: normalizedUrl,
                token: token
            )
        } catch let error as APIError {
            self.error = error.localizedDescription
        } catch {
            self.error = "Connection failed: \(error.localizedDescription)"
        }
    }
    
    func logout() {
        token = nil
        serverUrl = nil
        hostname = nil
        isAuthenticated = false
        error = nil
        
        UserDefaults.standard.removeObject(forKey: storageKey)
        UserDefaults.standard.removeObject(forKey: "serverUrl")
        UserDefaults.standard.removeObject(forKey: "authToken")
        
        // Clear cached data on logout
        CacheManager.shared.clearAll()
    }
    
    private func saveCredentials() {
        guard let token = token, let serverUrl = serverUrl else { return }
        
        let credentials = StoredCredentials(token: token, serverUrl: serverUrl, hostname: hostname)
        if let data = try? JSONEncoder().encode(credentials) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }

        // Also store raw values for background task access (BackgroundTaskManager
        // can't reference AuthManager since it runs when the app is suspended)
        UserDefaults.standard.set(serverUrl, forKey: "serverUrl")
        UserDefaults.standard.set(token, forKey: "authToken")
    }
    
    func createAPIService() -> APIService? {
        guard let serverUrl = serverUrl, let token = token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
}

private struct StoredCredentials: Codable {
    let token: String
    let serverUrl: String
    let hostname: String?  // Optional for backward compatibility
}
