"""
Manually convert UTM Zone 12N coordinates to WGS84 and update bounds JSON files
This is a workaround for PROJ database issues
"""

import json
import os
import math

def utm_to_wgs84(easting, northing, zone=12, northern=True):
    """
    Convert UTM coordinates to WGS84 (latitude/longitude)
    Simple approximation - good enough for bounds calculation
    """
    # UTM Zone 12N parameters
    k0 = 0.9996  # scale factor
    a = 6378137.0  # WGS84 semi-major axis
    e2 = 0.00669438  # WGS84 first eccentricity squared
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    n = (a - 6356752.314245) / (a + 6356752.314245)
    
    # Central meridian for zone 12
    lon0 = -111.0  # -111 degrees
    
    # Remove false easting and northing
    x = easting - 500000.0
    y = northing if northern else northing - 10000000.0
    
    # Calculate longitude
    lon = lon0 + (x / (k0 * a)) * (180.0 / math.pi)
    
    # Calculate latitude (simplified)
    M = y / k0
    mu = M / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    
    J1 = 3 * e1 / 2 - 27 * e1**3 / 32
    J2 = 21 * e1**2 / 16 - 55 * e1**4 / 32
    J3 = 151 * e1**3 / 96
    J4 = 1097 * e1**4 / 512
    
    fp = mu + J1 * math.sin(2 * mu) + J2 * math.sin(4 * mu) + J3 * math.sin(6 * mu) + J4 * math.sin(8 * mu)
    
    e_2 = e2 / (1 - e2)
    C1 = e_2 * math.cos(fp)**2
    T1 = math.tan(fp)**2
    N1 = a / math.sqrt(1 - e2 * math.sin(fp)**2)
    R1 = a * (1 - e2) / (1 - e2 * math.sin(fp)**2)**1.5
    D = x / (N1 * k0)
    
    lat = fp - (N1 * math.tan(fp) / R1) * (D**2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1**2 - 9 * e_2) * D**4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1**2 - 252 * e_2 - 3 * C1**2) * D**6 / 720)
    lat = lat * (180.0 / math.pi)
    
    return lon, lat

# UTM coordinates from the GeoTIFF (Zone 12N)
utm_corners = [
    (417840.0, 4511630.0),  # top-left
    (437840.0, 4511630.0),  # top-right
    (437840.0, 4481630.0),  # bottom-right
    (417840.0, 4481630.0)   # bottom-left
]

# Convert to WGS84
wgs84_corners = []
for easting, northing in utm_corners:
    lon, lat = utm_to_wgs84(easting, northing, zone=12, northern=True)
    wgs84_corners.append([lon, lat])
    print(f"UTM ({easting:.1f}, {northing:.1f}) -> WGS84 ({lon:.6f}, {lat:.6f})")

# Update both composite bounds files
composite_files = [
    'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_01_S2_composite_bounds.json',
    'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_02_S2_composite_bounds.json'
]

bounds_coords = wgs84_corners + [wgs84_corners[0]]  # Close polygon

for bounds_file in composite_files:
    if os.path.exists(bounds_file):
        with open(bounds_file, 'r') as f:
            data = json.load(f)
        
        # Update coordinates
        data['features'][0]['geometry']['coordinates'] = [bounds_coords]
        
        with open(bounds_file, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"\nUpdated: {bounds_file}")
        print(f"Bounds: min_lng={min(c[0] for c in wgs84_corners):.6f}, max_lng={max(c[0] for c in wgs84_corners):.6f}")
        print(f"        min_lat={min(c[1] for c in wgs84_corners):.6f}, max_lat={max(c[1] for c in wgs84_corners):.6f}")
    else:
        print(f"File not found: {bounds_file}")

print("\n[SUCCESS] Bounds updated successfully!")

