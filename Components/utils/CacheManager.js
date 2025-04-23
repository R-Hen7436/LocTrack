import AsyncStorage from '@react-native-async-storage/async-storage';

// Default TTL (time-to-live) for cache in milliseconds (30 minutes)
const DEFAULT_TTL = 30 * 60 * 1000;

// Cache prefix to identify entries managed by this utility
const CACHE_PREFIX = 'cache:';

class CacheManager {
  // Store data in cache with a TTL
  static async set(key, data, ttl = DEFAULT_TTL) {
    try {
      if (!key || key.trim() === '') {
        console.warn('Invalid cache key provided');
        return false;
      }
      
      const prefixedKey = this.ensurePrefix(key);
      const cacheData = {
        data,
        timestamp: Date.now(),
        expiry: Date.now() + ttl
      };
      
      await AsyncStorage.setItem(prefixedKey, JSON.stringify(cacheData));
      return true;
    } catch (error) {
      console.error('Error setting cache:', error);
      return false;
    }
  }
  
  // Get data from cache, returns null if expired or not found
  static async get(key) {
    try {
      if (!key) return null;
      
      const prefixedKey = this.ensurePrefix(key);
      const cachedData = await AsyncStorage.getItem(prefixedKey);
      
      if (!cachedData) {
        return null;
      }
      
      try {
        const { data, expiry } = JSON.parse(cachedData);
        
        // Check if cache has expired
        if (Date.now() > expiry) {
          // Remove expired cache silently
          this.remove(key).catch(() => {});
          return null;
        }
        
        return data;
      } catch (parseError) {
        // Handle corrupt cache data
        console.warn(`Corrupt cache for key ${key}, removing`, parseError);
        this.remove(key).catch(() => {});
        return null;
      }
    } catch (error) {
      console.error('Error getting cache:', error);
      return null;
    }
  }
  
  // Remove specific cache item
  static async remove(key) {
    try {
      if (!key) return false;
      
      const prefixedKey = this.ensurePrefix(key);
      await AsyncStorage.removeItem(prefixedKey);
      return true;
    } catch (error) {
      console.error('Error removing cache:', error);
      return false;
    }
  }
  
  // Clear all cached data
  static async clear() {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter(key => key.startsWith(CACHE_PREFIX));
      
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
      
      return true;
    } catch (error) {
      console.error('Error clearing cache:', error);
      return false;
    }
  }
  
  // Get all cache keys
  static async getKeys() {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter(key => key.startsWith(CACHE_PREFIX));
      // Return without the prefix for easier use
      return cacheKeys.map(key => key.substring(CACHE_PREFIX.length));
    } catch (error) {
      console.error('Error getting cache keys:', error);
      return [];
    }
  }
  
  // Check if cache exists and is valid
  static async exists(key) {
    try {
      if (!key) return false;
      
      const prefixedKey = this.ensurePrefix(key);
      const cachedData = await AsyncStorage.getItem(prefixedKey);
      
      if (!cachedData) {
        return false;
      }
      
      try {
        const { expiry } = JSON.parse(cachedData);
        return Date.now() <= expiry;
      } catch (parseError) {
        // Handle corrupt cache data
        this.remove(key).catch(() => {});
        return false;
      }
    } catch (error) {
      console.error('Error checking cache existence:', error);
      return false;
    }
  }
  
  // Get data with auto-refresh functionality
  static async getWithAutoRefresh(key, fetchFunction, ttl = DEFAULT_TTL) {
    if (!key || !fetchFunction || typeof fetchFunction !== 'function') {
      console.error('Invalid parameters for getWithAutoRefresh');
      return null;
    }
    
    // Try to get from cache first
    const cachedData = await this.get(key);
    
    // If we have valid cached data, return it
    if (cachedData) {
      // Refresh in background if needed
      this.refreshIfNeeded(key, fetchFunction, cachedData, ttl);
      return cachedData;
    }
    
    // If no valid cache, fetch fresh data
    try {
      const freshData = await fetchFunction();
      
      // Only cache if we got valid data
      if (freshData !== undefined && freshData !== null) {
        await this.set(key, freshData, ttl);
      }
      
      return freshData;
    } catch (error) {
      console.error('Error fetching fresh data:', error);
      return null;
    }
  }
  
  // Refresh cache in background if it's getting stale (over 75% of TTL used)
  static async refreshIfNeeded(key, fetchFunction, currentData, ttl) {
    try {
      if (!key) return;
      
      const prefixedKey = this.ensurePrefix(key);
      const cachedData = await AsyncStorage.getItem(prefixedKey);
      
      if (!cachedData) return;
      
      let timestamp, expiry;
      try {
        ({ timestamp, expiry } = JSON.parse(cachedData));
      } catch (parseError) {
        return;
      }
      
      const ttlUsed = Date.now() - timestamp;
      const totalTtl = expiry - timestamp;
      
      // If over 75% of TTL used, refresh in background
      if (ttlUsed > (totalTtl * 0.75)) {
        // Use setTimeout to ensure this happens asynchronously
        setTimeout(() => {
          fetchFunction()
            .then(freshData => {
              // Only update cache if we got valid data
              if (freshData !== undefined && freshData !== null) {
                this.set(key, freshData, ttl);
              }
            })
            .catch(() => {});
        }, 0);
      }
    } catch (error) {
      // Just log but don't propagate errors from background refresh
      console.error('Error checking if refresh needed:', error);
    }
  }
  
  // Clean up expired cache entries
  static async cleanupExpired() {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter(key => key.startsWith(CACHE_PREFIX));
      
      for (const key of cacheKeys) {
        try {
          const cachedData = await AsyncStorage.getItem(key);
          if (!cachedData) continue;
          
          const { expiry } = JSON.parse(cachedData);
          
          if (Date.now() > expiry) {
            await AsyncStorage.removeItem(key);
          }
        } catch (error) {
          // If we can't parse the data, it's likely corrupt, so remove it
          await AsyncStorage.removeItem(key);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error cleaning up expired cache:', error);
      return false;
    }
  }
  
  // Helper to ensure keys have the cache prefix
  static ensurePrefix(key) {
    if (!key.startsWith(CACHE_PREFIX)) {
      return `${CACHE_PREFIX}${key}`;
    }
    return key;
  }
  
  // Helper to remove prefix from keys
  static removePrefix(key) {
    if (key.startsWith(CACHE_PREFIX)) {
      return key.substring(CACHE_PREFIX.length);
    }
    return key;
  }
}

// Run cache cleanup on import (asynchronously)
CacheManager.cleanupExpired().catch(() => {});

export default CacheManager; 