package com.cursormobile.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.cursormobile.app.ui.navigation.AppNavigation
import com.cursormobile.app.ui.theme.CursorMobileTheme
import com.cursormobile.app.ui.theme.ThemeManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    
    private val app: CursorMobileApplication
        get() = application as CursorMobileApplication
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        
        // Handle deep links
        intent?.data?.let { uri ->
            handleDeepLink(uri)
        }
        
        setContent {
            CursorMobileTheme(theme = ThemeManager.currentTheme) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val isAuthenticated by app.authManager.isAuthenticated.collectAsState()
                    val isLoading by app.authManager.isLoading.collectAsState()
                    
                    AppNavigation(
                        isAuthenticated = isAuthenticated,
                        isLoading = isLoading,
                        authManager = app.authManager,
                        savedHostsManager = app.savedHostsManager,
                        webSocketManager = app.webSocketManager
                    )
                }
            }
        }
    }
    
    private fun handleDeepLink(uri: android.net.Uri) {
        // Handle napp-trapp:// URLs
        // Format: napp-trapp://connect?server=IP&token=TOKEN
        
        val token = uri.getQueryParameter("token")
        val server = uri.getQueryParameter("server")
        
        if (token != null && server != null) {
            val serverUrl = "http://$server:3847"
            GlobalScope.launch(Dispatchers.IO) {
                app.authManager.login(serverUrl, token)
            }
        }
    }
}
