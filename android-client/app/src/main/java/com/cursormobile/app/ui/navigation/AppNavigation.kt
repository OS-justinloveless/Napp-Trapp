package com.cursormobile.app.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.cursormobile.app.data.AuthManager
import com.cursormobile.app.data.SavedHostsManager
import com.cursormobile.app.data.WebSocketManager
import com.cursormobile.app.ui.screens.ChatDetailScreen
import com.cursormobile.app.ui.screens.LoginScreen
import com.cursormobile.app.ui.screens.MainScreen

sealed class Screen(val route: String) {
    object Login : Screen("login")
    object Main : Screen("main")
    object ChatDetail : Screen("chat/{conversationId}") {
        fun createRoute(conversationId: String) = "chat/$conversationId"
    }
}

@Composable
fun AppNavigation(
    isAuthenticated: Boolean,
    isLoading: Boolean,
    authManager: AuthManager,
    savedHostsManager: SavedHostsManager,
    webSocketManager: WebSocketManager
) {
    val navController = rememberNavController()
    
    if (isLoading) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator()
        }
        return
    }
    
    NavHost(
        navController = navController,
        startDestination = if (isAuthenticated) Screen.Main.route else Screen.Login.route
    ) {
        composable(Screen.Login.route) {
            LoginScreen(
                authManager = authManager,
                savedHostsManager = savedHostsManager,
                onLoginSuccess = {
                    navController.navigate(Screen.Main.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
        }
        
        composable(Screen.Main.route) {
            MainScreen(
                authManager = authManager,
                webSocketManager = webSocketManager,
                onNavigateToChat = { conversationId ->
                    navController.navigate(Screen.ChatDetail.createRoute(conversationId))
                },
                onLogout = {
                    authManager.logout()
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Main.route) { inclusive = true }
                    }
                }
            )
        }
        
        composable(
            route = Screen.ChatDetail.route,
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType })
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            ChatDetailScreen(
                conversationId = conversationId,
                authManager = authManager,
                onBack = { navController.popBackStack() }
            )
        }
    }
}
