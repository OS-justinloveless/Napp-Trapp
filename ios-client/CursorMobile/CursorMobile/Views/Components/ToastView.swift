import SwiftUI

/// A toast notification that appears briefly at the top of the screen
struct ToastView: View {
    let message: String
    let type: ToastType
    
    enum ToastType {
        case success
        case info
        case warning
        
        var icon: String {
            switch self {
            case .success: return "checkmark.circle.fill"
            case .info: return "info.circle.fill"
            case .warning: return "exclamationmark.triangle.fill"
            }
        }
        
        var color: Color {
            switch self {
            case .success: return .green
            case .info: return .blue
            case .warning: return .orange
            }
        }
    }
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: type.icon)
                .foregroundStyle(type.color)
                .font(.title3)
            
            Text(message)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
                .lineLimit(2)
            
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(type.color.opacity(0.3), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
        .padding(.horizontal, 16)
    }
}

/// A view modifier that adds toast capability to any view
struct ToastModifier: ViewModifier {
    @Binding var toast: ToastData?
    
    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let toast = toast {
                    ToastView(message: toast.message, type: toast.type)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .onAppear {
                            DispatchQueue.main.asyncAfter(deadline: .now() + toast.duration) {
                                withAnimation(.easeOut(duration: 0.3)) {
                                    self.toast = nil
                                }
                            }
                        }
                        .padding(.top, 8)
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: toast != nil)
    }
}

/// Data model for toast notifications
struct ToastData: Equatable {
    let message: String
    let type: ToastView.ToastType
    var duration: TimeInterval = 2.5
    
    static func success(_ message: String) -> ToastData {
        ToastData(message: message, type: .success)
    }
    
    static func info(_ message: String) -> ToastData {
        ToastData(message: message, type: .info)
    }
    
    static func warning(_ message: String) -> ToastData {
        ToastData(message: message, type: .warning)
    }
}

extension View {
    func toast(_ toast: Binding<ToastData?>) -> some View {
        modifier(ToastModifier(toast: toast))
    }
}

#Preview {
    VStack {
        ToastView(message: "Push successful", type: .success)
        ToastView(message: "Pull complete - 3 files updated", type: .info)
        ToastView(message: "Working tree has uncommitted changes", type: .warning)
    }
    .padding()
}
