package com.cursormobile.app.data

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class StoredCredentials(
    val token: String,
    val serverUrl: String,
    val hostname: String? = null
)

class AuthManager(
    private val context: Context,
    private val savedHostsManager: SavedHostsManager
) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val gson = Gson()
    
    private val _token = MutableStateFlow<String?>(null)
    val token: StateFlow<String?> = _token.asStateFlow()
    
    private val _serverUrl = MutableStateFlow<String?>(null)
    val serverUrl: StateFlow<String?> = _serverUrl.asStateFlow()
    
    private val _hostname = MutableStateFlow<String?>(null)
    val hostname: StateFlow<String?> = _hostname.asStateFlow()
    
    private val _isAuthenticated = MutableStateFlow(false)
    val isAuthenticated: StateFlow<Boolean> = _isAuthenticated.asStateFlow()
    
    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    
    init {
        loadStoredCredentials()
    }
    
    private fun loadStoredCredentials() {
        val json = prefs.getString(KEY_CREDENTIALS, null)
        if (json != null) {
            try {
                val credentials = gson.fromJson(json, StoredCredentials::class.java)
                _token.value = credentials.token
                _serverUrl.value = credentials.serverUrl
                _hostname.value = credentials.hostname
                
                // Validate stored credentials
                validateToken(credentials.serverUrl, credentials.token)
            } catch (e: Exception) {
                _isLoading.value = false
            }
        } else {
            _isLoading.value = false
        }
    }
    
    private fun validateToken(serverUrl: String, token: String) {
        GlobalScope.launch(Dispatchers.IO) {
            try {
                val api = ApiClient.initialize(serverUrl, token)
                api.getSystemInfo()
                withContext(Dispatchers.Main) {
                    _isAuthenticated.value = true
                    _isLoading.value = false
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    logout()
                    _isLoading.value = false
                }
            }
        }
    }
    
    suspend fun login(serverUrl: String, token: String): Boolean {
        _error.value = null
        
        var normalizedUrl = serverUrl.trimEnd('/')
        if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
            normalizedUrl = "http://$normalizedUrl"
        }
        
        return try {
            val api = ApiClient.initialize(normalizedUrl, token)
            val systemInfo = api.getSystemInfo()
            
            _token.value = token
            _serverUrl.value = normalizedUrl
            _hostname.value = systemInfo.hostname
            _isAuthenticated.value = true
            
            saveCredentials(token, normalizedUrl, systemInfo.hostname)
            savedHostsManager.saveHost(systemInfo.hostname, normalizedUrl, token)
            
            true
        } catch (e: retrofit2.HttpException) {
            _error.value = when (e.code()) {
                401 -> "Invalid authentication token"
                404 -> "Server not found"
                else -> "Server error (HTTP ${e.code()})"
            }
            false
        } catch (e: Exception) {
            _error.value = "Connection failed: ${e.message}"
            false
        }
    }
    
    fun logout() {
        _token.value = null
        _serverUrl.value = null
        _hostname.value = null
        _isAuthenticated.value = false
        _error.value = null
        
        prefs.edit().remove(KEY_CREDENTIALS).apply()
        ApiClient.clear()
    }
    
    private fun saveCredentials(token: String, serverUrl: String, hostname: String?) {
        val credentials = StoredCredentials(token, serverUrl, hostname)
        val json = gson.toJson(credentials)
        prefs.edit().putString(KEY_CREDENTIALS, json).apply()
    }
    
    fun clearError() {
        _error.value = null
    }
    
    fun getApiService(): ApiService? {
        val url = _serverUrl.value ?: return null
        val tok = _token.value ?: return null
        return ApiClient.initialize(url, tok)
    }
    
    companion object {
        private const val PREFS_NAME = "napp_trapp_auth"
        private const val KEY_CREDENTIALS = "credentials"
    }
}
