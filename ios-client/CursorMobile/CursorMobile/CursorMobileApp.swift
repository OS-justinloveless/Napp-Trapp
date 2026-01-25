import SwiftUI

@main
struct CursorMobileApp: App {
    @StateObject private var authManager = AuthManager()
    @StateObject private var webSocketManager = WebSocketManager()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authManager)
                .environmentObject(webSocketManager)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
    }
    
    private func handleDeepLink(_ url: URL) {
        // Handle cursor-mobile:// URLs or universal links
        // URL format: cursor-mobile://connect?server=IP&token=TOKEN
        // Or: https://your-server:3847/?token=TOKEN
        
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true) else {
            return
        }
        
        var serverUrl: String?
        var token: String?
        
        // Extract token from query parameters
        if let tokenParam = components.queryItems?.first(where: { $0.name == "token" })?.value {
            token = tokenParam
        }
        
        // Determine server URL
        if url.scheme == "cursor-mobile" {
            // Custom URL scheme: cursor-mobile://connect?server=IP&token=TOKEN
            if let serverParam = components.queryItems?.first(where: { $0.name == "server" })?.value {
                serverUrl = "http://\(serverParam):3847"
            }
        } else if url.scheme == "http" || url.scheme == "https" {
            // Universal link: http(s)://server:3847/?token=TOKEN
            if let host = components.host, let port = components.port {
                serverUrl = "\(url.scheme ?? "http")://\(host):\(port)"
            } else if let host = components.host {
                serverUrl = "\(url.scheme ?? "http")://\(host):3847"
            }
        }
        
        // If we have both server and token, attempt to connect
        if let server = serverUrl, let authToken = token {
            Task {
                await authManager.login(serverUrl: server, token: authToken)
            }
        }
    }
}
