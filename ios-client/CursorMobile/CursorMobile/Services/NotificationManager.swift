import Foundation
import UserNotifications
import UIKit

class NotificationManager: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    @MainActor
    static let shared = NotificationManager()

    @Published var notificationPermissionGranted = false
    @Published var authorizationStatus: String = "unknown"

    nonisolated override init() {
        super.init()
        print("[NotificationManager] init called")
        DispatchQueue.main.async {
            UNUserNotificationCenter.current().delegate = self
            print("[NotificationManager] Delegate set on UNUserNotificationCenter")
        }
    }

    /// Request user permission for local notifications
    @MainActor
    func requestPermission() async {
        print("[NotificationManager] requestPermission() called")
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            self.notificationPermissionGranted = granted
            if granted {
                print("[NotificationManager] Notification permission granted")
            } else {
                print("[NotificationManager] Notification permission denied by user")
            }
            // Also refresh the detailed status
            await checkCurrentPermissionStatus()
        } catch {
            print("[NotificationManager] Error requesting notification permission: \(error)")
            self.notificationPermissionGranted = false
        }
    }

    /// Check the current system notification settings (reads actual iOS Settings state)
    @MainActor
    func checkCurrentPermissionStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let status: String
        switch settings.authorizationStatus {
        case .notDetermined:
            status = "notDetermined"
            notificationPermissionGranted = false
        case .denied:
            status = "denied"
            notificationPermissionGranted = false
        case .authorized:
            status = "authorized"
            notificationPermissionGranted = true
        case .provisional:
            status = "provisional"
            notificationPermissionGranted = true
        case .ephemeral:
            status = "ephemeral"
            notificationPermissionGranted = true
        @unknown default:
            status = "unknown(\(settings.authorizationStatus.rawValue))"
            notificationPermissionGranted = false
        }
        self.authorizationStatus = status
        print("[NotificationManager] Current authorization status: \(status)")
        print("[NotificationManager]   alertSetting: \(settingString(settings.alertSetting))")
        print("[NotificationManager]   soundSetting: \(settingString(settings.soundSetting))")
        print("[NotificationManager]   badgeSetting: \(settingString(settings.badgeSetting))")
        print("[NotificationManager]   lockScreenSetting: \(settingString(settings.lockScreenSetting))")
        print("[NotificationManager]   notificationCenterSetting: \(settingString(settings.notificationCenterSetting))")
        print("[NotificationManager]   alertStyle: \(alertStyleString(settings.alertStyle))")
    }

    /// Helper to convert UNNotificationSetting to readable string
    private func settingString(_ setting: UNNotificationSetting) -> String {
        switch setting {
        case .notSupported: return "notSupported"
        case .disabled: return "disabled"
        case .enabled: return "enabled"
        @unknown default: return "unknown(\(setting.rawValue))"
        }
    }

    /// Helper to convert UNAlertStyle to readable string
    private func alertStyleString(_ style: UNAlertStyle) -> String {
        switch style {
        case .none: return "none"
        case .banner: return "banner"
        case .alert: return "alert"
        @unknown default: return "unknown(\(style.rawValue))"
        }
    }

    /// Schedule a local notification for a completed chat turn
    /// - Parameters:
    ///   - conversationId: The ID of the conversation
    ///   - topic: The chat topic/title to display
    ///   - delay: Number of seconds before notification fires (default 1 second)
    @MainActor
    func scheduleNotification(conversationId: String, topic: String?, delay: TimeInterval = 1.0) {
        print("[NotificationManager] ──────────────────────────────────────")
        print("[NotificationManager] scheduleNotification called")
        print("[NotificationManager]   conversationId: \(conversationId)")
        print("[NotificationManager]   topic: \(topic ?? "nil")")
        print("[NotificationManager]   delay: \(delay)s")
        print("[NotificationManager]   permissionGranted (cached): \(notificationPermissionGranted)")
        print("[NotificationManager]   authorizationStatus (cached): \(authorizationStatus)")

        guard notificationPermissionGranted else {
            print("[NotificationManager] WARNING: Permission not granted, skipping notification.")
            print("[NotificationManager]   Hint: Check iOS Settings > Notifications > CursorMobile")
            print("[NotificationManager]   Hint: Or call requestPermission() / checkCurrentPermissionStatus() first")
            print("[NotificationManager] ──────────────────────────────────────")
            return
        }

        let content = UNMutableNotificationContent()
        content.title = "Chat Response Ready"
        content.body = topic ?? "New message"
        content.sound = .default

        // Increment badge count
        let newBadgeCount = UIApplication.shared.applicationIconBadgeNumber + 1
        content.badge = NSNumber(value: newBadgeCount)
        print("[NotificationManager]   badge count: \(newBadgeCount)")

        // Add deep link URL as userInfo for notification tap handler
        let deepLinkURL = "napp-trapp://chat/\(conversationId)"
        content.userInfo = ["deepLink": deepLinkURL, "conversationId": conversationId]

        // Create trigger for notification (after specified delay)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)

        // Create request with unique identifier based on conversationId
        let identifier = "chat-\(conversationId)"
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)

        print("[NotificationManager]   identifier: \(identifier)")
        print("[NotificationManager]   Adding request to UNUserNotificationCenter...")

        // Schedule the notification
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                print("[NotificationManager] ERROR scheduling notification: \(error)")
                print("[NotificationManager]   error domain: \((error as NSError).domain)")
                print("[NotificationManager]   error code: \((error as NSError).code)")
                print("[NotificationManager]   error userInfo: \((error as NSError).userInfo)")
            } else {
                print("[NotificationManager] SUCCESS: Notification scheduled for: \(conversationId)")
                // Verify by listing pending notifications
                UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
                    print("[NotificationManager]   Total pending notifications: \(requests.count)")
                    for req in requests {
                        print("[NotificationManager]     - \(req.identifier): trigger=\(String(describing: req.trigger))")
                    }
                }
            }
            print("[NotificationManager] ──────────────────────────────────────")
        }
    }

    /// Clear all pending notifications (useful on app open)
    @MainActor
    func clearAllNotifications() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        UIApplication.shared.applicationIconBadgeNumber = 0
        print("[NotificationManager] All notifications cleared")
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Handle notification when app is in foreground - SHOW the notification
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let id = notification.request.identifier
        let title = notification.request.content.title
        let body = notification.request.content.body
        print("[NotificationManager] willPresent called (app in foreground)")
        print("[NotificationManager]   id: \(id), title: \(title), body: \(body)")
        // Show banner, play sound, and update badge even when app is in foreground
        print("[NotificationManager]   Presenting with [.banner, .sound, .badge]")
        completionHandler([.banner, .sound, .badge])
    }

    /// Handle notification tap (called when user interacts with notification)
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        print("[NotificationManager] didReceive called (notification tapped)")
        print("[NotificationManager]   actionIdentifier: \(response.actionIdentifier)")
        print("[NotificationManager]   userInfo: \(userInfo)")

        if let deepLink = userInfo["deepLink"] as? String,
           let url = URL(string: deepLink) {
            print("[NotificationManager] Opening deep link: \(deepLink)")
            // This will trigger the onOpenURL handler in CursorMobileApp
            DispatchQueue.main.async {
                UIApplication.shared.open(url)
            }
        }

        completionHandler()
    }
}
