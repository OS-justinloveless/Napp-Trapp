import SwiftUI
import BackgroundTasks

@main
struct CursorMobileApp: App {
    @StateObject private var authManager = AuthManager()
    @StateObject private var webSocketManager = WebSocketManager()
    @StateObject private var themeManager = ThemeManager.shared
    @StateObject private var notificationManager = NotificationManager.shared
    @StateObject private var backgroundTaskManager = BackgroundTaskManager.shared

    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Register background tasks at launch (must be done before app finishes launching)
        BackgroundTaskManager.shared.registerBackgroundTasks()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authManager)
                .environmentObject(webSocketManager)
                .environmentObject(themeManager)
                .environmentObject(notificationManager)
                .tint(themeManager.currentTheme.accentColor)
                .preferredColorScheme(themeManager.currentTheme.colorScheme)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
                .task {
                    await notificationManager.requestPermission()
                    await notificationManager.checkCurrentPermissionStatus()
                }
        }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background:
                print("[CursorMobileApp] App entering background")
                // Extend execution to keep WebSocket alive as long as possible
                backgroundTaskManager.beginBackgroundProcessing()
                // Schedule periodic background refresh for when execution time expires
                backgroundTaskManager.scheduleBackgroundRefresh()
            case .active:
                print("[CursorMobileApp] App becoming active")
                backgroundTaskManager.endBackgroundProcessing()
            case .inactive:
                break
            @unknown default:
                break
            }
        }
    }
    
    private func handleDeepLink(_ url: URL) {
        // Handle napp-trapp:// URLs or universal links
        // URL formats:
        // - napp-trapp://connect?server=IP&token=TOKEN (authentication)
        // - napp-trapp://chat/conversationId (chat notification tap)
        // - https://your-server:3847/?token=TOKEN (universal link)

        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true) else {
            return
        }

        // Check if this is a chat deep link (napp-trapp://chat/conversationId)
        if url.scheme == "napp-trapp" && url.host == "chat" {
            let conversationId = url.lastPathComponent
            print("[CursorMobileApp] Opening chat from notification: \(conversationId)")
            // The ChatSessionView will be navigated to via NavigationStack
            // We'll handle this by posting a notification that ChatTabView can observe
            NotificationCenter.default.post(
                name: NSNotification.Name("OpenChatConversation"),
                object: nil,
                userInfo: ["conversationId": conversationId]
            )
            return
        }

        var serverUrl: String?
        var token: String?

        // Extract token from query parameters
        if let tokenParam = components.queryItems?.first(where: { $0.name == "token" })?.value {
            token = tokenParam
        }

        // Determine server URL
        if url.scheme == "napp-trapp" {
            // Custom URL scheme: napp-trapp://connect?server=IP&token=TOKEN
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
