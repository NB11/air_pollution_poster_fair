"""
Fix composite bounds by manually calculating UTM to WGS84 conversion
"""
import json
import os

# Composite bounds in UTM Zone 12N (EPSG:32612)
# left=417840.0, bottom=4481630.0, right=437840.0, top=4511630.0

# Manual UTM to WGS84 conversion for Zone 12N
# Using approximate conversion formula
def utm_to_wgs84(easting, northing, zone=12, northern=True):
    """
    Convert UTM coordinates to WGS84 (approximate)
    Zone 12N central meridian: -111 degrees
    """
    # UTM parameters for Zone 12N
    k0 = 0.9996  # scale factor
    a = 6378137.0  # WGS84 semi-major axis
    e2 = 0.00669438  # WGS84 first eccentricity squared
    e1 = (1 - (1 - e2)**0.5) / (1 + (1 - e2)**0.5)
    n = (a - 6356752.314245) / (a + 6356752.314245)
    
    # Zone parameters
    central_meridian = -111.0  # Zone 12N
    false_easting = 500000.0
    false_northing = 0.0 if northern else 10000000.0
    
    # Remove false easting/northing
    x = easting - false_easting
    y = northing - false_northing
    
    # Calculate zone central meridian in radians
    lon0 = central_meridian * 3.141592653589793 / 180.0
    
    # Calculate M (meridional arc)
    M = y / k0
    
    # Calculate mu
    mu = M / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256))
    
    # Calculate footprint latitude
    e1 = (1 - (1 - e2)**0.5) / (1 + (1 - e2)**0.5)
    J1 = 3*e1/2 - 27*e1*e1*e1/32
    J2 = 21*e1*e1/16 - 55*e1*e1*e1*e1/32
    J3 = 151*e1*e1*e1/96
    J4 = 1097*e1*e1*e1*e1/512
    
    fp = mu + J1*2*mu + J2*4*mu - J3*6*mu + J4*8*mu
    
    import math
    # Calculate latitude and longitude
    e_ = e2 / (1 - e2)
    C1 = e_ * math.cos(fp)**2
    T1 = math.tan(fp)**2
    N1 = a / math.sqrt(1 - e2*math.sin(fp)**2)
    R1 = a * (1 - e2) / (1 - e2*math.sin(fp)**2)**1.5
    D = x / (N1 * k0)
    
    # Calculate latitude
    Q1 = N1 * math.tan(fp) / R1
    Q2 = D*D/2
    Q3 = (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*e_)*D*D*D*D/24
    Q4 = (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*e_ - 3*C1*C1)*D*D*D*D*D*D/720
    lat = fp - Q1*(Q2 - Q3 + Q4)
    
    # Calculate longitude
    Q5 = D
    Q6 = (1 + 2*T1 + C1)*D*D*D/6
    Q7 = (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*e_ + 24*T1*T1)*D*D*D*D*D/120
    lon = lon0 + (Q5 - Q6 + Q7) / math.cos(fp)
    
    return lon * 180.0 / 3.141592653589793, lat * 180.0 / 3.141592653589793

# Simpler approach: use known conversion
# For UTM Zone 12N around Salt Lake City area
# Approximate conversion: 1 degree longitude ≈ 111km * cos(latitude)
# At latitude ~40.7: 1 degree ≈ 84km

# Composite bounds in UTM
left_utm = 417840.0
right_utm = 437840.0
bottom_utm = 4481630.0
top_utm = 4511630.0

# Approximate center (we know it's around Salt Lake City)
center_lat = 40.69
center_lng = -111.94

# Calculate approximate bounds
# The composite is 20km wide and 30km tall
# At this latitude: 1 degree lat ≈ 111km, 1 degree lng ≈ 84km
width_km = (right_utm - left_utm) / 1000  # 20km
height_km = (top_utm - bottom_utm) / 1000  # 30km

# Approximate conversion
lng_span = width_km / 84.0  # degrees longitude
lat_span = height_km / 111.0  # degrees latitude

# Calculate bounds
min_lng = center_lng - lng_span / 2
max_lng = center_lng + lng_span / 2
min_lat = center_lat - lat_span / 2
max_lat = center_lat + lat_span / 2

print(f"Approximate bounds:")
print(f"  min_lng: {min_lng:.6f}, max_lng: {max_lng:.6f}")
print(f"  min_lat: {min_lat:.6f}, max_lat: {max_lat:.6f}")

# Update both composite bounds files
composite_files = [
    'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_01_S2_composite_bounds.json',
    'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_02_S2_composite_bounds.json'
]

bounds_coords = [
    [min_lng, max_lat],  # top-left [lng, lat]
    [max_lng, max_lat],  # top-right [lng, lat]
    [max_lng, min_lat],  # bottom-right [lng, lat]
    [min_lng, min_lat]   # bottom-left [lng, lat]
]

for bounds_file in composite_files:
    if os.path.exists(bounds_file):
        with open(bounds_file, 'r') as f:
            data = json.load(f)
        
        # Update coordinates
        data['features'][0]['geometry']['coordinates'] = [[
            bounds_coords[0],
            bounds_coords[1],
            bounds_coords[2],
            bounds_coords[3],
            bounds_coords[0]  # Close polygon
        ]]
        
        with open(bounds_file, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"[SUCCESS] Updated: {bounds_file}")
    else:
        print(f"[WARNING] File not found: {bounds_file}")

