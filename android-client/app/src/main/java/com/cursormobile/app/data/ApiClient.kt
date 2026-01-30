package com.cursormobile.app.data

import com.google.gson.GsonBuilder
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    
    private var retrofit: Retrofit? = null
    private var apiService: ApiService? = null
    private var currentServerUrl: String? = null
    private var currentToken: String? = null
    
    fun initialize(serverUrl: String, token: String): ApiService {
        if (retrofit != null && currentServerUrl == serverUrl && currentToken == token) {
            return apiService!!
        }
        
        currentServerUrl = serverUrl
        currentToken = token
        
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        
        val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val original = chain.request()
                val request = original.newBuilder()
                    .header("Authorization", "Bearer $token")
                    .header("Content-Type", "application/json")
                    .method(original.method, original.body)
                    .build()
                chain.proceed(request)
            }
            .addInterceptor(loggingInterceptor)
            .build()
        
        val gson = GsonBuilder()
            .setLenient()
            .create()
        
        val baseUrl = if (serverUrl.endsWith("/")) serverUrl else "$serverUrl/"
        
        retrofit = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
        
        apiService = retrofit!!.create(ApiService::class.java)
        return apiService!!
    }
    
    fun getApiService(): ApiService? = apiService
    
    fun clear() {
        retrofit = null
        apiService = null
        currentServerUrl = null
        currentToken = null
    }
}
