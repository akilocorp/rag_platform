// src/api/apiClient.js

import axios from 'axios';

// Create a new axios instance with a base URL
const apiClient = axios.create({

  baseURL: (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL : '/api',
  xsrfCookieName: 'csrftoken',
  xsrfHeaderName: 'X-CSRFToken',
});

// --- Request Interceptor ---
// This runs before every request is sent
apiClient.interceptors.request.use(
  (config) => {
    // Get the access token from local storage
    const token = localStorage.getItem('jwtToken');
    if (token) {
      // If the token exists, add it to the Authorization header
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    // Handle request errors
    return Promise.reject(error);
  }
);

// --- Response Interceptor ---
// This runs after a response is received
apiClient.interceptors.response.use(
  (response) => {
    // If the response is successful, just return it
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Skip 401 handling for login/register - let the component show the error
    const url = originalRequest?.url || '';
    const isAuthRequest = url.includes('auth/login') || url.includes('auth/register');
    if (isAuthRequest) {
      return Promise.reject(error);
    }

    // Check if the error is a 401 (Unauthorized) and we haven't already retried
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true; // Mark this request as retried
      
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
            console.error("No refresh token available.");
            window.location.href = '/login'; // Redirect to login
            return Promise.reject(error);
        }

        // Make a request to your /refresh endpoint, using configured API URL
        const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL : '/api';
        const response = await axios.post(`${base}/auth/refresh`, {}, {
          headers: { 'Authorization': `Bearer ${refreshToken}` }
        });

        // Get the new access token from the response
        const newAccessToken = response.data.access_token;
        
        // Save the new token to local storage
        localStorage.setItem('jwtToken', newAccessToken);

        // Update the header for the original request
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;
        originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;

        console.log("Token refreshed successfully. Retrying original request.");
        
        // Retry the original request with the new token
        return apiClient(originalRequest);

      } catch (refreshError) {
        // If the refresh token is also invalid, the session is over
        console.error("Refresh token failed. Logging out.", refreshError);
        
        // Clear stored tokens and redirect to login
        localStorage.removeItem('jwtToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login'; // Use window.location for redirection outside of React components

        return Promise.reject(refreshError);
      }
    }

    // For any other errors, just return the error
    return Promise.reject(error);
  }
);

export default apiClient;
