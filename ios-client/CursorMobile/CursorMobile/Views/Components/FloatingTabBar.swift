import SwiftUI

/// A floating tab bar with glass material styling
struct FloatingTabBar: View {
    @Binding var selectedTab: Int
    
    private let tabs: [(icon: String, label: String)] = [
        ("folder.fill", "Files"),
        ("arrow.triangle.branch", "Git"),
        ("terminal.fill", "Terminals"),
        ("bubble.left.and.bubble.right.fill", "Chat")
    ]
    
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                TabButton(
                    icon: tab.icon,
                    label: tab.label,
                    isSelected: selectedTab == index
                ) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        selectedTab = index
                    }
                }
                
                if index < tabs.count - 1 {
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .background(
            Capsule()
                .fill(.ultraThinMaterial)
                .shadow(color: .black.opacity(0.2), radius: 12, x: 0, y: 6)
        )
    }
}

/// Individual tab button within the floating tab bar
private struct TabButton: View {
    let icon: String
    let label: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: isSelected ? .semibold : .regular))
                    .symbolRenderingMode(.hierarchical)
                
                Text(label)
                    .font(.system(size: 10, weight: isSelected ? .semibold : .regular))
            }
            .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
            .frame(minWidth: 60)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ZStack {
        Color(.systemGroupedBackground)
            .ignoresSafeArea()
        
        VStack {
            Spacer()
            
            FloatingTabBar(selectedTab: .constant(0))
                .padding(.horizontal, 24)
                .padding(.bottom, 0)
        }
    }
}
