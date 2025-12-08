"""
Verify and fix bounds using rasterio to read actual GeoTIFF georeferencing
"""

import rasterio
from rasterio.warp import transform_bounds
from rasterio.crs import CRS
import json
import os
import sys

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def get_geotiff_bounds(geotiff_path):
    """Get accurate bounds from GeoTIFF using rasterio"""
    with rasterio.open(geotiff_path) as src:
        print(f"[INFO] Reading: {geotiff_path}")
        print(f"[INFO] CRS: {src.crs}")
        print(f"[INFO] Transform: {src.transform}")
        print(f"[INFO] Dimensions: {src.width} x {src.height}")
        
        # Get bounds in source CRS
        bounds = src.bounds
        print(f"[INFO] Bounds (source CRS): left={bounds.left:.2f}, bottom={bounds.bottom:.2f}, right={bounds.right:.2f}, top={bounds.top:.2f}")
        
        # Get transform matrix
        transform = src.transform
        
        # Calculate exact corner coordinates using transform matrix
        corners_pixel = [
            (0, 0),                    # top-left
            (src.width, 0),            # top-right
            (src.width, src.height),   # bottom-right
            (0, src.height)            # bottom-left
        ]
        
        # Convert to source CRS coordinates
        corners_src = []
        for px, py in corners_pixel:
            x, y = transform * (px, py)
            corners_src.append((x, y))
            print(f"  Pixel ({px}, {py}) -> ({x:.2f}, {y:.2f})")
        
        # Try to transform to WGS84 (EPSG:4326)
        try:
            # Use transform_bounds for bounding box
            min_lng, min_lat, max_lng, max_lat = transform_bounds(
                src.crs, CRS.from_epsg(4326), bounds.left, bounds.bottom, bounds.right, bounds.top
            )
            
            print(f"[INFO] Transformed bounds (EPSG:4326):")
            print(f"  min_lng={min_lng:.6f}, min_lat={min_lat:.6f}")
            print(f"  max_lng={max_lng:.6f}, max_lat={max_lat:.6f}")
            
            # Create corner coordinates in correct order for MapLibre
            # MapLibre expects: [top-left, top-right, bottom-right, bottom-left]
            bounds_coords = [
                [min_lng, max_lat],  # top-left [lng, lat]
                [max_lng, max_lat],  # top-right [lng, lat]
                [max_lng, min_lat],  # bottom-right [lng, lat]
                [min_lng, min_lat]   # bottom-left [lng, lat]
            ]
            
            return bounds_coords, src.width, src.height
            
        except Exception as e:
            print(f"[ERROR] Transform failed: {e}")
            return None, src.width, src.height

# Process both composite files
composite_files = [
    ('map/s2/composits/SALT_LAKE_CITY_2023_large_2023_01_S2_composite.tif',
     'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_01_S2_composite_bounds.json'),
    ('map/s2/composits/SALT_LAKE_CITY_2023_large_2023_02_S2_composite.tif',
     'map/s2/composits/SALT_LAKE_CITY_2023_large_2023_02_S2_composite_bounds.json')
]

for geotiff_path, bounds_path in composite_files:
    if not os.path.exists(geotiff_path):
        print(f"[WARNING] GeoTIFF not found: {geotiff_path}")
        continue
    
    bounds_coords, width, height = get_geotiff_bounds(geotiff_path)
    
    if bounds_coords:
        # Close the polygon
        bounds_coords_closed = bounds_coords + [bounds_coords[0]]
        
        # Create bounds JSON
        bounds_geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [bounds_coords_closed]
                },
                "properties": {
                    "target_crs": "EPSG:4326",
                    "width": width,
                    "height": height
                }
            }]
        }
        
        # Save bounds JSON
        with open(bounds_path, 'w') as f:
            json.dump(bounds_geojson, f, indent=2)
        
        print(f"[SUCCESS] Updated: {bounds_path}")
        print(f"  Corner coordinates (EPSG:4326):")
        corner_names = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
        for i, coord in enumerate(bounds_coords):
            print(f"    {corner_names[i]}: [{coord[0]:.6f}, {coord[1]:.6f}]")
        print()
    else:
        print(f"[ERROR] Could not transform bounds for {geotiff_path}\n")

print("[SUCCESS] All bounds files updated!")

