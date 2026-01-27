import Foundation

struct SystemInfo: Codable {
    let hostname: String
    let platform: String
    let arch: String
    let cpus: Int
    let memory: MemoryInfo
    let uptime: Double
    let homeDir: String
    let username: String
    
    struct MemoryInfo: Codable {
        let total: Int64
        let free: Int64
        let used: Int64
        
        var formattedTotal: String {
            ByteCountFormatter.string(fromByteCount: total, countStyle: .memory)
        }
        
        var formattedFree: String {
            ByteCountFormatter.string(fromByteCount: free, countStyle: .memory)
        }
        
        var formattedUsed: String {
            ByteCountFormatter.string(fromByteCount: used, countStyle: .memory)
        }
        
        var usagePercentage: Double {
            guard total > 0 else { return 0 }
            return Double(used) / Double(total) * 100
        }
    }
    
    var formattedUptime: String {
        let hours = Int(uptime) / 3600
        let minutes = (Int(uptime) % 3600) / 60
        
        if hours > 24 {
            let days = hours / 24
            return "\(days)d \(hours % 24)h"
        } else if hours > 0 {
            return "\(hours)h \(minutes)m"
        } else {
            return "\(minutes)m"
        }
    }
    
    var platformName: String {
        switch platform {
        case "darwin":
            return "macOS"
        case "win32":
            return "Windows"
        case "linux":
            return "Linux"
        default:
            return platform.capitalized
        }
    }
}

struct NetworkInterface: Codable, Identifiable {
    let name: String
    let address: String
    let netmask: String
    
    var id: String { "\(name)-\(address)" }
}

struct NetworkResponse: Codable {
    let addresses: [NetworkInterface]
}

struct CursorStatus: Codable {
    let isRunning: Bool
    let version: String?
    let platform: String
}

struct ExecRequest: Codable {
    let command: String
    let cwd: String?
}

struct ExecResponse: Codable {
    let success: Bool
    let stdout: String?
    let stderr: String?
    let error: String?
}

struct OpenCursorRequest: Codable {
    let path: String
}

struct OpenCursorResponse: Codable {
    let success: Bool
    let message: String?
}

// MARK: - iOS Build Models

struct iOSBuildRequest: Codable {
    let configuration: String
    let deviceName: String
    let deviceId: String?
    let isPhysicalDevice: Bool
    let clean: Bool
}

struct iOSBuildResponse: Codable {
    let success: Bool
    let message: String?
    let error: String?
    let details: String?
    let step: String?
    let configuration: String?
    let deviceName: String?
    let isPhysicalDevice: Bool?
}

struct iOSDevice: Codable, Identifiable {
    let name: String
    let udid: String
    let state: String
    let iosVersion: String
    let isBooted: Bool
    let isPhysicalDevice: Bool
    let deviceType: String
    let connectionType: String?
    
    var id: String { udid }
    
    var displayName: String {
        if isPhysicalDevice {
            return "\(name) (Device)"
        } else {
            return name
        }
    }
    
    var statusText: String {
        if isPhysicalDevice {
            return connectionType ?? "Connected"
        } else {
            return isBooted ? "Booted" : state
        }
    }
}

struct iOSDevicesResponse: Codable {
    let success: Bool
    let devices: [iOSDevice]
}

// Legacy model for backward compatibility
struct iOSSimulator: Codable, Identifiable {
    let name: String
    let udid: String
    let state: String
    let iosVersion: String
    let isBooted: Bool
    
    var id: String { udid }
}

struct iOSSimulatorsResponse: Codable {
    let success: Bool
    let simulators: [iOSSimulator]
}
