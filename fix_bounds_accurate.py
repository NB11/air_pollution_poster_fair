"""
Accurately convert GeoTIFF bounds to WGS84 using the transform matrix
This reads the GeoTIFF directly and calculates exact corner coordinates
"""

import rasterio
import json
import os
import sys

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def get_geotiff_corners_wgs84(geotiff_path):
    """
    Get exact corner coordinates in WGS84 from GeoTIFF transform matrix
    """
    with rasterio.open(geotiff_path) as src:
        # Get transform matrix
        transform = src.transform
        width = src.width
        height = src.height
        
        # Calculate corner coordinates in source CRS using transform matrix
        # Corners in pixel coordinates: (0,0), (width,0), (width,height), (0,height)
        corners_pixel = [
            (0, 0),                    # top-left
            (width, 0),                # top-right
            (width, height),           # bottom-right
            (0, height)                # bottom-left
        ]
        
        # Convert pixel to geographic coordinates using transform
        corners_utm = []
        for px, py in corners_pixel:
            x, y = transform * (px, py)
            corners_utm.append((x, y))
        
        print("UTM corner coordinates:")
        for i, (x, y) in enumerate(corners_utm):
            corner_names = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
            print(f"  {corner_names[i]}: ({x:.2f}, {y:.2f})")
        
        # Convert UTM Zone 12N to WGS84 manually (more accurate formula)
        def utm_to_wgs84_accurate(easting, northing, zone=12):
            """More accurate UTM to WGS84 conversion"""
            import math
            
            # UTM parameters
            k0 = 0.9996
            a = 6378137.0  # WGS84 semi-major axis
            e2 = 0.00669438  # WGS84 first eccentricity squared
            e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
            
            # Central meridian for zone 12
            lon0 = -111.0
            
            # Remove false easting
            x = easting - 500000.0
            y = northing
            
            # Calculate M (meridional arc)
            M = y / k0
            
            # Calculate mu (footprint latitude)
            mu = M / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
            
            # Calculate footprint latitude using series expansion
            e1_2 = e1**2
            e1_3 = e1**3
            e1_4 = e1**4
            
            J1 = (3 * e1 / 2) - (27 * e1_3 / 32)
            J2 = (21 * e1_2 / 16) - (55 * e1_4 / 32)
            J3 = (151 * e1_3 / 96)
            J4 = (1097 * e1_4 / 512)
            
            fp = mu + J1 * math.sin(2 * mu) + J2 * math.sin(4 * mu) + J3 * math.sin(6 * mu) + J4 * math.sin(8 * mu)
            
            # Calculate intermediate values
            e_2 = e2 / (1 - e2)
            C1 = e_2 * math.cos(fp)**2
            T1 = math.tan(fp)**2
            N1 = a / math.sqrt(1 - e2 * math.sin(fp)**2)
            R1 = a * (1 - e2) / (1 - e2 * math.sin(fp)**2)**1.5
            D = x / (N1 * k0)
            
            # Calculate latitude
            lat_rad = fp - (N1 * math.tan(fp) / R1) * (
                D**2 / 2 - 
                (5 + 3 * T1 + 10 * C1 - 4 * C1**2 - 9 * e_2) * D**4 / 24 + 
                (61 + 90 * T1 + 298 * C1 + 45 * T1**2 - 252 * e_2 - 3 * C1**2) * D**6 / 720
            )
            
            # Calculate longitude (corrected formula)
            lon_rad = math.radians(lon0) + (D - (1 + 2 * T1 + C1) * D**3 / 6 + 
                             (5 - 2 * C1 + 28 * T1 - 3 * C1**2 + 8 * e_2 + 24 * T1**2) * D**5 / 120) / math.cos(fp)
            
            # Convert to degrees
            lat = math.degrees(lat_rad)
            lon = math.degrees(lon_rad)
            
            return lon, lat
        
        # Convert all corners
        corners_wgs84 = []
        for easting, northing in corners_utm:
            lon, lat = utm_to_wgs84_accurate(easting, northing, zone=12)
            corners_wgs84.append([lon, lat])
            print(f"WGS84: ({lon:.6f}, {lat:.6f})")
        
        return corners_wgs84

# Get script directory
script_dir = os.path.dirname(os.path.abspath(__file__))

# Process both composite files
composite_files = [
    (os.path.join(script_dir, 'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_01_S2_composite.tif'),
     os.path.join(script_dir, 'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_01_S2_composite_bounds.json')),
    (os.path.join(script_dir, 'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_02_S2_composite.tif'),
     os.path.join(script_dir, 'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_02_S2_composite_bounds.json'))
]

for geotiff_path, bounds_path in composite_files:
    if not os.path.exists(geotiff_path):
        print(f"GeoTIFF not found: {geotiff_path}")
        continue
    
    print(f"\nProcessing: {geotiff_path}")
    corners_wgs84 = get_geotiff_corners_wgs84(geotiff_path)
    
    # Close the polygon
    bounds_coords = corners_wgs84 + [corners_wgs84[0]]
    
    # Read existing JSON to preserve structure
    if os.path.exists(bounds_path):
        with open(bounds_path, 'r') as f:
            data = json.load(f)
    else:
        data = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": []
                },
                "properties": {}
            }]
        }
    
    # Update coordinates
    data['features'][0]['geometry']['coordinates'] = [bounds_coords]
    data['features'][0]['properties']['target_crs'] = 'EPSG:4326'
    
    # Write updated JSON
    with open(bounds_path, 'w') as f:
        json.dump(data, f, indent=2)
    
    print(f"Updated: {bounds_path}")
    print(f"Bounds: min_lng={min(c[0] for c in corners_wgs84):.6f}, max_lng={max(c[0] for c in corners_wgs84):.6f}")
    print(f"        min_lat={min(c[1] for c in corners_wgs84):.6f}, max_lat={max(c[1] for c in corners_wgs84):.6f}")

print("\n[SUCCESS] All bounds updated!")
