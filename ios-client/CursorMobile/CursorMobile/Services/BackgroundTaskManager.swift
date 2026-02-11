import Foundation
import BackgroundTasks
import UIKit

/// Manages background tasks for polling the server for pending notifications
/// when the app is suspended or killed.
///
/// Uses two mechanisms:
/// 1. UIApplication.beginBackgroundTask — extends execution ~30s after backgrounding
/// 2. BGAppRefreshTask — iOS periodically wakes the app to poll the server
@MainActor
class BackgroundTaskManager: ObservableObject {
    static let shared = BackgroundTaskManager()

    static let backgroundTaskIdentifier = "com.lovelesslabstx.napptrapp.notification-check"

    private var backgroundTaskId: UIBackgroundTaskIdentifier = .invalid
    private var pollingTimer: Timer?

    private init() {}

    // MARK: - BGAppRefreshTask Registration

    /// Call once at app launch to register the background task handler
    func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backgroundTaskIdentifier,
            using: nil
        ) { task in
            Task { @MainActor in
                await self.handleBackgroundRefresh(task: task as! BGAppRefreshTask)
            }
        }
        print("[BackgroundTaskManager] Registered background task: \(Self.backgroundTaskIdentifier)")
    }

    /// Schedule the next background refresh
    func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        // Request earliest: 1 minute from now (iOS will decide the actual time)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60)

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BackgroundTaskManager] Scheduled background refresh (earliest: 60s from now)")
        } catch {
            print("[BackgroundTaskManager] Failed to schedule background refresh: \(error)")
        }
    }

    /// Handle a background refresh task — poll the server for pending notifications
    private func handleBackgroundRefresh(task: BGAppRefreshTask) async {
        print("[BackgroundTaskManager] Background refresh task started")

        // Schedule the next one immediately
        scheduleBackgroundRefresh()

        // Set up expiration handler
        task.expirationHandler = {
            print("[BackgroundTaskManager] Background task expired")
            task.setTaskCompleted(success: false)
        }

        // Poll the server
        let success = await pollServerForNotifications()
        task.setTaskCompleted(success: success)
        print("[BackgroundTaskManager] Background refresh completed, success=\(success)")
    }

    // MARK: - Background Execution Extension

    /// Call when app enters background to extend execution time
    func beginBackgroundProcessing() {
        guard backgroundTaskId == .invalid else {
            print("[BackgroundTaskManager] Background task already active")
            return
        }

        backgroundTaskId = UIApplication.shared.beginBackgroundTask(withName: "NotificationPoll") { [weak self] in
            // Expiration handler — clean up
            print("[BackgroundTaskManager] Background execution time expired")
            self?.endBackgroundProcessing()
        }

        if backgroundTaskId == .invalid {
            print("[BackgroundTaskManager] Failed to begin background task")
            return
        }

        let remaining = UIApplication.shared.backgroundTimeRemaining
        print("[BackgroundTaskManager] Background task started, remaining time: \(remaining)s")

        // Start polling every 5 seconds while in background
        pollingTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.pollServerForNotifications()
            }
        }
    }

    /// Call when app returns to foreground
    func endBackgroundProcessing() {
        pollingTimer?.invalidate()
        pollingTimer = nil

        if backgroundTaskId != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskId)
            backgroundTaskId = .invalid
            print("[BackgroundTaskManager] Background task ended")
        }
    }

    // MARK: - Server Polling

    /// Poll the server's pending notifications endpoint and schedule local notifications
    @discardableResult
    private func pollServerForNotifications() async -> Bool {
        guard let serverUrl = UserDefaults.standard.string(forKey: "serverUrl"),
              let token = UserDefaults.standard.string(forKey: "authToken") else {
            print("[BackgroundTaskManager] No server credentials stored, skipping poll")
            return false
        }

        let urlString = "\(serverUrl)/api/conversations/notifications/pending"
        guard let url = URL(string: urlString) else {
            print("[BackgroundTaskManager] Invalid URL: \(urlString)")
            return false
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
                print("[BackgroundTaskManager] Server returned status \(statusCode)")
                return false
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let notifications = json["notifications"] as? [[String: Any]] else {
                print("[BackgroundTaskManager] Failed to parse response")
                return false
            }

            if notifications.isEmpty {
                print("[BackgroundTaskManager] No pending notifications")
                return true
            }

            print("[BackgroundTaskManager] Received \(notifications.count) pending notification(s)")

            // Schedule a local notification only for turn-complete events
            for notif in notifications {
                guard let conversationId = notif["conversationId"] as? String else { continue }
                let isTurnComplete = notif["isTurnComplete"] as? Bool ?? false
                let topic = notif["topic"] as? String

                guard isTurnComplete else {
                    print("[BackgroundTaskManager] Skipping non-turn-complete notification for \(conversationId)")
                    continue
                }

                print("[BackgroundTaskManager] Scheduling notification for \(conversationId), topic=\(topic ?? "nil")")
                NotificationManager.shared.scheduleNotification(
                    conversationId: conversationId,
                    topic: topic
                )
            }

            return true
        } catch {
            print("[BackgroundTaskManager] Poll failed: \(error)")
            return false
        }
    }
}
