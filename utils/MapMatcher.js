/**
 * Map matching to snap GPS points to known roads/paths
 * Optimized for small-scale movement testing
 */
export default class MapMatcher {
  constructor() {
    // Cache of known roads/paths
    this.roadCache = {};
    
    // Road segments loaded status
    this.isLoaded = false;
    
    // Cache radius and grid size
    this.cacheRadiusMeters = 500; // 500m around user (reduced from 1km)
    this.gridSize = 0.005; // Approximately 500m grid (reduced from 0.01)
    
    // Last matched point
    this.lastMatchedPoint = null;
    
    // Matching parameters - adjusted for small-scale testing
    this.maxMatchingDistanceMeters = 3; // Reduced from 30m to 3m for better small-scale precision
    this.weightDecayRate = 0.2; // How fast weight decays with distance (increased from 0.1 for tighter matching)
  }
  
  // Load road data around a location
  async loadRoadsAroundLocation(location) {
    // Check if already loaded in this grid cell
    const gridX = Math.floor(location.latitude / this.gridSize);
    const gridY = Math.floor(location.longitude / this.gridSize);
    const gridKey = `${gridX},${gridY}`;
    
    if (this.roadCache[gridKey]) {
      return this.roadCache[gridKey];
    }
    
    try {
      // In a real implementation, this would call an external API
      // like OpenStreetMap or Google Maps Roads API
      
      // For demo purposes, we'll simulate road data
      const mockRoadData = this.generateMockRoadData(location);
      
      // Cache the result
      this.roadCache[gridKey] = mockRoadData;
      this.isLoaded = true;
      
      return mockRoadData;
    } catch (error) {
      console.error('Error loading road data:', error);
      return [];
    }
  }
  
  // Generate mock road data for demo purposes
  // Modified to create a denser grid of roads for small-scale testing
  generateMockRoadData(location) {
    const roads = [];
    
    // Create a grid of roads around the location with tighter spacing
    const latMin = location.latitude - 0.005; // 500m grid instead of 1km
    const latMax = location.latitude + 0.005;
    const lonMin = location.longitude - 0.005;
    const lonMax = location.longitude + 0.005;
    
    // Create east-west roads with tighter spacing
    for (let lat = latMin; lat <= latMax; lat += 0.0005) { // Increased density for testing
      const road = {
        id: `ew-${lat.toFixed(6)}`,
        type: 'road',
        name: `EW Road ${Math.floor(Math.random() * 100)}`,
        points: []
      };
      
      for (let lon = lonMin; lon <= lonMax; lon += 0.0001) { // Higher point density
        road.points.push({ latitude: lat, longitude: lon });
      }
      
      roads.push(road);
    }
    
    // Create north-south roads with tighter spacing
    for (let lon = lonMin; lon <= lonMax; lon += 0.0005) { // Increased density for testing
      const road = {
        id: `ns-${lon.toFixed(6)}`,
        type: 'road',
        name: `NS Road ${Math.floor(Math.random() * 100)}`,
        points: []
      };
      
      for (let lat = latMin; lat <= latMax; lat += 0.0001) { // Higher point density
        road.points.push({ latitude: lat, longitude: lon });
      }
      
      roads.push(road);
    }
    
    return roads;
  }
  
  // Find closest road segment to a point
  findClosestRoadSegment(point, roads) {
    if (!roads || roads.length === 0) return null;
    
    let closestSegment = null;
    let minDistance = Number.MAX_VALUE;
    let closestPoint = null;
    
    // Check each road
    roads.forEach(road => {
      // Check each segment of the road
      for (let i = 0; i < road.points.length - 1; i++) {
        const start = road.points[i];
        const end = road.points[i + 1];
        
        // Calculate distance to segment
        const segmentInfo = this.distanceToSegment(point, start, end);
        
        if (segmentInfo.distance < minDistance) {
          minDistance = segmentInfo.distance;
          closestSegment = {
            road: road,
            segmentIndex: i,
            start: start,
            end: end
          };
          closestPoint = segmentInfo.closestPoint;
        }
      }
    });
    
    if (closestSegment && minDistance <= this.maxMatchingDistanceMeters) {
      return {
        ...closestSegment,
        distance: minDistance,
        matchedPoint: closestPoint,
        confidence: Math.exp(-this.weightDecayRate * minDistance)
      };
    }
    
    return null;
  }
  
  // Calculate distance from point to a road segment
  distanceToSegment(point, segmentStart, segmentEnd) {
    // Calculate vector representations
    const v = {
      x: segmentEnd.longitude - segmentStart.longitude,
      y: segmentEnd.latitude - segmentStart.latitude
    };
    
    const w = {
      x: point.longitude - segmentStart.longitude,
      y: point.latitude - segmentStart.latitude
    };
    
    // Calculate dot products
    const c1 = w.x * v.x + w.y * v.y;
    const c2 = v.x * v.x + v.y * v.y;
    
    let t = c1 / c2;
    
    // Clamp t to segment bounds
    t = Math.max(0, Math.min(1, t));
    
    // Find projection point
    const projection = {
      latitude: segmentStart.latitude + t * v.y,
      longitude: segmentStart.longitude + t * v.x
    };
    
    // Calculate distance using Haversine formula
    const distance = this.calculateDistance(point, projection);
    
    return {
      distance,
      closestPoint: projection,
      t
    };
  }
  
  // Calculate distance between two points (Haversine formula)
  calculateDistance(point1, point2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = point1.latitude * Math.PI / 180;
    const φ2 = point2.latitude * Math.PI / 180;
    const Δφ = (point2.latitude - point1.latitude) * Math.PI / 180;
    const Δλ = (point2.longitude - point1.longitude) * Math.PI / 180;
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c; // Distance in meters
  }
  
  // Match a point to the nearest road
  async matchPointToRoad(point, gpsAccuracy) {
    // Load roads if necessary
    const roads = await this.loadRoadsAroundLocation(point);
    
    // Skip matching if roads couldn't be loaded
    if (!roads || roads.length === 0) {
      return point;
    }
    
    // Adjust max matching distance based on GPS accuracy
    // For small testing areas, we'll keep it small regardless of GPS accuracy
    const adjustedMaxDistance = Math.min(
      this.maxMatchingDistanceMeters,
      gpsAccuracy * 0.5 // Reduced from 1.5 to 0.5 for tighter matching
    );
    
    // Find closest road segment
    const matchInfo = this.findClosestRoadSegment(point, roads);
    
    // If no match found or too far, return original point
    if (!matchInfo || matchInfo.distance > adjustedMaxDistance) {
      return point;
    }
    
    // Use matched point, preserving original altitude if present
    const matchedPoint = {
      ...matchInfo.matchedPoint,
      altitude: point.altitude
    };
    
    // Store last matched point for continuity
    this.lastMatchedPoint = {
      ...matchedPoint,
      roadId: matchInfo.road.id,
      roadName: matchInfo.road.name,
      segmentIndex: matchInfo.segmentIndex,
      confidence: matchInfo.confidence
    };
    
    return matchedPoint;
  }
  
  // Match a trace of points to roads (for trajectory matching)
  async matchTraceToRoads(points) {
    if (!points || points.length === 0) return [];
    
    // Load roads around first point
    await this.loadRoadsAroundLocation(points[0]);
    
    // Match each point
    const matchedPoints = [];
    
    for (const point of points) {
      const matched = await this.matchPointToRoad(point);
      matchedPoints.push(matched);
    }
    
    return matchedPoints;
  }
} 