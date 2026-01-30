package com.cursormobile.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

// Forest Theme Colors (Default)
val ForestPrimary = Color(0xFF2E7D32)
val ForestSecondary = Color(0xFF81C784)
val ForestBackground = Color(0xFF1A1A1A)
val ForestSurface = Color(0xFF242424)
val ForestOnBackground = Color(0xFFE0E0E0)

// Desert Theme Colors
val DesertPrimary = Color(0xFFE65100)
val DesertSecondary = Color(0xFFFFB74D)
val DesertBackground = Color(0xFF1F1A17)
val DesertSurface = Color(0xFF2A2320)
val DesertOnBackground = Color(0xFFE0D6CF)

// Mono Theme Colors
val MonoPrimary = Color(0xFF9E9E9E)
val MonoSecondary = Color(0xFFBDBDBD)
val MonoBackground = Color(0xFF121212)
val MonoSurface = Color(0xFF1E1E1E)
val MonoOnBackground = Color(0xFFE0E0E0)

// Night Theme Colors
val NightPrimary = Color(0xFF5C6BC0)
val NightSecondary = Color(0xFF9FA8DA)
val NightBackground = Color(0xFF0D1117)
val NightSurface = Color(0xFF161B22)
val NightOnBackground = Color(0xFFC9D1D9)

enum class AppTheme {
    FOREST, DESERT, MONO, NIGHT;
    
    val displayName: String
        get() = name.lowercase().replaceFirstChar { it.uppercase() }
}

object ThemeManager {
    var currentTheme by mutableStateOf(AppTheme.FOREST)
    
    fun getColorScheme(theme: AppTheme) = when (theme) {
        AppTheme.FOREST -> darkColorScheme(
            primary = ForestPrimary,
            secondary = ForestSecondary,
            background = ForestBackground,
            surface = ForestSurface,
            onBackground = ForestOnBackground,
            onSurface = ForestOnBackground
        )
        AppTheme.DESERT -> darkColorScheme(
            primary = DesertPrimary,
            secondary = DesertSecondary,
            background = DesertBackground,
            surface = DesertSurface,
            onBackground = DesertOnBackground,
            onSurface = DesertOnBackground
        )
        AppTheme.MONO -> darkColorScheme(
            primary = MonoPrimary,
            secondary = MonoSecondary,
            background = MonoBackground,
            surface = MonoSurface,
            onBackground = MonoOnBackground,
            onSurface = MonoOnBackground
        )
        AppTheme.NIGHT -> darkColorScheme(
            primary = NightPrimary,
            secondary = NightSecondary,
            background = NightBackground,
            surface = NightSurface,
            onBackground = NightOnBackground,
            onSurface = NightOnBackground
        )
    }
}

@Composable
fun CursorMobileTheme(
    theme: AppTheme = ThemeManager.currentTheme,
    content: @Composable () -> Unit
) {
    val colorScheme = ThemeManager.getColorScheme(theme)
    val view = LocalView.current
    
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }
    
    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
