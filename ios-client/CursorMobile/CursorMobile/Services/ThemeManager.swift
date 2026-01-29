import SwiftUI

// MARK: - App Theme Definition

enum AppTheme: String, CaseIterable, Identifiable {
    case night = "night"
    case light = "light"
    case forest = "forest"
    case desert = "desert"
    case mono = "mono"
    
    var id: String { rawValue }
    
    var displayName: String {
        switch self {
        case .night: return "Night"
        case .light: return "Light"
        case .forest: return "Forest"
        case .desert: return "Desert"
        case .mono: return "Mono"
        }
    }
    
    var description: String {
        switch self {
        case .night: return "Dark theme with cyan accents"
        case .light: return "Light theme for bright environments"
        case .forest: return "Deep green theme with mint accents"
        case .desert: return "Warm golden theme with magenta accents"
        case .mono: return "Monochrome grayscale theme"
        }
    }
    
    // MARK: - Color Definitions
    
    /// The primary accent color for the theme
    var accentColor: Color {
        switch self {
        case .night:
            return Color(red: 0.49, green: 0.83, blue: 0.88) // Cyan #7dd3e0
        case .light:
            return Color(red: 0.03, green: 0.57, blue: 0.70) // Teal #0891b2
        case .forest:
            return Color(red: 0.55, green: 0.85, blue: 0.66) // Mint #8cd9a8
        case .desert:
            return Color(red: 0.91, green: 0.26, blue: 0.58) // Magenta #e84393
        case .mono:
            return Color(red: 0.60, green: 0.60, blue: 0.60) // Gray #999999
        }
    }
    
    /// Secondary accent color (lighter variant)
    var accentColorLight: Color {
        switch self {
        case .night:
            return Color(red: 0.65, green: 0.90, blue: 0.93) // Light cyan
        case .light:
            return Color(red: 0.02, green: 0.71, blue: 0.83) // Light teal
        case .forest:
            return Color(red: 0.66, green: 0.91, blue: 0.75) // Light mint
        case .desert:
            return Color(red: 0.94, green: 0.37, blue: 0.66) // Light magenta
        case .mono:
            return Color(red: 0.75, green: 0.75, blue: 0.75) // Light gray
        }
    }
    
    /// Primary background color
    var backgroundColor: Color {
        switch self {
        case .night:
            return Color(red: 0.05, green: 0.06, blue: 0.10) // Dark navy #0d0f1a
        case .light:
            return Color(red: 0.96, green: 0.97, blue: 0.98) // Light gray #f5f7fa
        case .forest:
            return Color(red: 0.05, green: 0.16, blue: 0.09) // Dark green #0d2818
        case .desert:
            return Color(red: 0.96, green: 0.65, blue: 0.14) // Golden #f5a623
        case .mono:
            return Color(red: 0.12, green: 0.12, blue: 0.12) // Dark gray #1e1e1e
        }
    }
    
    /// Secondary background color
    var secondaryBackgroundColor: Color {
        switch self {
        case .night:
            return Color(red: 0.08, green: 0.09, blue: 0.15) // #151827
        case .light:
            return Color(red: 1.0, green: 1.0, blue: 1.0) // White
        case .forest:
            return Color(red: 0.08, green: 0.24, blue: 0.14) // #143d24
        case .desert:
            return Color(red: 0.91, green: 0.60, blue: 0.11) // #e89a1c
        case .mono:
            return Color(red: 0.15, green: 0.15, blue: 0.15) // #252526
        }
    }
    
    /// The preferred color scheme (light/dark mode)
    var colorScheme: ColorScheme? {
        switch self {
        case .night, .forest, .mono:
            return .dark
        case .light:
            return .light
        case .desert:
            return .light // Desert uses light color scheme for contrast
        }
    }
    
    /// Maps to the corresponding app icon
    var appIconName: String? {
        switch self {
        case .night: return "AppIconNight"
        case .light: return nil // Default icon (no alternate)
        case .forest: return "AppIconForest"
        case .desert: return "AppIconDesert"
        case .mono: return "AppIconMono"
        }
    }
    
    /// Creates theme from app icon option
    static func from(appIcon: String?) -> AppTheme {
        guard let iconName = appIcon else { return .forest }
        
        switch iconName {
        case "AppIconNight": return .night
        case "AppIconForest": return .forest
        case "AppIconDesert": return .desert
        case "AppIconMono": return .mono
        default: return .forest
        }
    }
}

// MARK: - Theme Manager

@MainActor
class ThemeManager: ObservableObject {
    static let shared = ThemeManager()
    
    private let themeKey = "selectedTheme"
    
    @Published var currentTheme: AppTheme {
        didSet {
            UserDefaults.standard.set(currentTheme.rawValue, forKey: themeKey)
            updateAppIcon()
        }
    }
    
    private init() {
        // Load saved theme or default to forest (matches default app icon)
        if let savedTheme = UserDefaults.standard.string(forKey: themeKey),
           let theme = AppTheme(rawValue: savedTheme) {
            self.currentTheme = theme
        } else {
            // Detect from current app icon
            if let iconName = UIApplication.shared.alternateIconName {
                self.currentTheme = AppTheme.from(appIcon: iconName)
            } else {
                self.currentTheme = .forest
            }
        }
    }
    
    /// Updates the app icon to match the current theme
    private func updateAppIcon() {
        guard UIApplication.shared.supportsAlternateIcons else { return }
        
        let iconName = currentTheme.appIconName
        
        // Only update if different from current
        if UIApplication.shared.alternateIconName != iconName {
            UIApplication.shared.setAlternateIconName(iconName) { error in
                if let error = error {
                    print("Error changing app icon: \(error.localizedDescription)")
                }
            }
        }
    }
    
    /// Convenience accessor for the current accent color
    var accentColor: Color {
        currentTheme.accentColor
    }
    
    /// Convenience accessor for the current color scheme
    var colorScheme: ColorScheme? {
        currentTheme.colorScheme
    }
}

// MARK: - View Extensions

extension View {
    /// Applies the current theme's accent color and color scheme
    func applyTheme(_ theme: AppTheme) -> some View {
        self
            .tint(theme.accentColor)
            .preferredColorScheme(theme.colorScheme)
    }
    
    /// Applies theming from the ThemeManager
    func withThemeManager(_ themeManager: ThemeManager) -> some View {
        self
            .tint(themeManager.currentTheme.accentColor)
            .preferredColorScheme(themeManager.currentTheme.colorScheme)
    }
}
