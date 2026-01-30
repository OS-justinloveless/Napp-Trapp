package com.cursormobile.app

import android.app.Application
import com.cursormobile.app.data.AuthManager
import com.cursormobile.app.data.SavedHostsManager
import com.cursormobile.app.data.WebSocketManager

class CursorMobileApplication : Application() {
    
    lateinit var authManager: AuthManager
        private set
    
    lateinit var webSocketManager: WebSocketManager
        private set
    
    lateinit var savedHostsManager: SavedHostsManager
        private set
    
    override fun onCreate() {
        super.onCreate()
        instance = this
        
        savedHostsManager = SavedHostsManager(this)
        authManager = AuthManager(this, savedHostsManager)
        webSocketManager = WebSocketManager()
    }
    
    companion object {
        lateinit var instance: CursorMobileApplication
            private set
    }
}
