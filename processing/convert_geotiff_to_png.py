"""
Convert GeoTIFF to PNG with bounds JSON for web map display
This script reads a GeoTIFF file, converts it to PNG, and creates a bounds JSON file
"""

import rasterio
from rasterio.warp import transform, calculate_default_transform, reproject, Resampling
from rasterio.enums import Resampling as RasterioResampling
import numpy as np
from PIL import Image
import json
import os
import sys

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def convert_geotiff_to_png(geotiff_path, output_png_path=None, output_bounds_path=None, target_crs='EPSG:4326', band_indices=None):
    """
    Convert GeoTIFF to PNG with bounds JSON
    
    Parameters:
    -----------
    geotiff_path : str
        Path to input GeoTIFF file
    output_png_path : str, optional
        Path to output PNG file (default: same name as input with .png extension)
    output_bounds_path : str, optional
        Path to output bounds JSON file (default: same name as input with _bounds.json)
    target_crs : str
        Target coordinate reference system (default: EPSG:4326 for WGS84)
    """
    
    print(f"[INFO] Reading GeoTIFF: {geotiff_path}")
    
    # Open the GeoTIFF
    with rasterio.open(geotiff_path) as src:
        # Get source CRS
        src_crs = src.crs
        print(f"[INFO] Source CRS: {src_crs}")
        print(f"[INFO] Target CRS: {target_crs}")
        
        # Get bounds in source CRS
        bounds = src.bounds
        print(f"[INFO] Source bounds: {bounds}")
        
        # Get number of bands
        num_bands = src.count
        print(f"[INFO] Number of bands: {num_bands}")
        print(f"[INFO] Dimensions: {src.width} x {src.height}")
        
        # Read all bands (need at least 4 for Sentinel-2 B4, B3, B2)
        print("[INFO] Reading raster data...")
        bands = []
        # Read at least 4 bands for Sentinel-2 RGB (B4, B3, B2)
        bands_to_read = max(4, min(num_bands, 12))  # Read at least 4, up to 12
        for i in range(1, bands_to_read + 1):
            band = src.read(i)
            bands.append(band)
            if i <= 4:  # Only print first 4 bands for logging
                print(f"  Band {i}: min={band.min():.2f}, max={band.max():.2f}, dtype={band.dtype}")
        
        # For Sentinel-2: B4 (Red), B3 (Green), B2 (Blue) = indices 3, 2, 1 (0-indexed)
        # Default: assume Sentinel-2 order and use B4, B3, B2 for true color RGB
        if band_indices and len(band_indices) == 3:
            # Use specified band indices (0-indexed)
            r_band = bands[band_indices[0]]
            g_band = bands[band_indices[1]]
            b_band = bands[band_indices[2]]
            print(f"[INFO] Using bands {band_indices[0]+1}, {band_indices[1]+1}, {band_indices[2]+1} (indices {band_indices[0]}, {band_indices[1]}, {band_indices[2]}) for RGB")
        elif len(bands) >= 4:
            # Sentinel-2: Use B4 (index 3), B3 (index 2), B2 (index 1) for true color RGB
            r_band = bands[3]  # B4 - Red
            g_band = bands[2]  # B3 - Green
            b_band = bands[1]  # B2 - Blue
            print("[INFO] Using Sentinel-2 bands: B4 (index 3), B3 (index 2), B2 (index 1) for true color RGB")
        elif len(bands) >= 3:
            # If only 3 bands, assume they're already RGB ordered
            r_band = bands[0]
            g_band = bands[1]
            b_band = bands[2]
            print("[INFO] Using bands 1, 2, 3 for RGB")
        elif len(bands) == 1:
            # Single band - use grayscale
            r_band = g_band = b_band = bands[0]
            print("[INFO] Single band - converting to grayscale")
        else:
            print("[WARNING] Unexpected number of bands, using first band as grayscale")
            r_band = g_band = b_band = bands[0]
        
        # Normalize bands to 0-255 range with brightness enhancement
        print("🔄 Normalizing bands with brightness enhancement...")
        def normalize_band(band, percentile_low=2, percentile_high=98, gamma=1.0):
            # Use percentile-based normalization to avoid outliers affecting brightness
            band_min = np.percentile(band, percentile_low)
            band_max = np.percentile(band, percentile_high)
            
            if band_max == band_min:
                return np.zeros_like(band, dtype=np.uint8)
            
            # Normalize to 0-1 range
            normalized = np.clip((band - band_min) / (band_max - band_min), 0, 1)
            
            # Apply gamma correction for brightness (gamma < 1 makes brighter)
            if gamma != 1.0:
                normalized = np.power(normalized, gamma)
            
            # Scale to 0-255 and enhance brightness by stretching to full range
            normalized = (normalized * 255).astype(np.uint8)
            
            # Additional brightness boost: stretch the histogram
            # This helps if the image is still too dark
            if normalized.max() > 0:
                # Stretch to use full dynamic range
                normalized = ((normalized.astype(np.float32) / normalized.max()) * 255).astype(np.uint8)
            
            return normalized
        
        # Use gamma < 1 to brighten (0.7-0.8 is good for dark Sentinel-2 images)
        r_norm = normalize_band(r_band, gamma=0.75)
        g_norm = normalize_band(g_band, gamma=0.75)
        b_norm = normalize_band(b_band, gamma=0.75)
        
        # Create RGB image
        print("[INFO] Creating RGB image...")
        rgb_array = np.dstack([r_norm, g_norm, b_norm])
        
        # Convert to PIL Image and save as PNG
        img = Image.fromarray(rgb_array, 'RGB')
        
        # Set output paths
        if output_png_path is None:
            base_name = os.path.splitext(geotiff_path)[0]
            output_png_path = base_name + '.png'
        
        print(f"[INFO] Saving PNG: {output_png_path}")
        img.save(output_png_path, 'PNG', optimize=True)
        print(f"[SUCCESS] PNG saved successfully")
        
        # Convert bounds to target CRS if needed
        # Use the actual transform matrix to get precise corner coordinates
        bounds_coords = None
        
        if src_crs and src_crs.to_string() != target_crs:
            print(f"[INFO] Reprojecting bounds to {target_crs}...")
            # Get transform matrix for precise pixel-to-coordinate conversion
            transform_matrix = src.transform
            print(f"[INFO] Transform matrix: {transform_matrix}")
            
            # Try using rasterio's transform_bounds first (simpler and more reliable)
            try:
                from rasterio.warp import transform_bounds
                from rasterio.crs import CRS
                target_crs_obj = CRS.from_string(target_crs)
                
                # Transform the bounding box directly
                min_lng, min_lat, max_lng, max_lat = transform_bounds(
                    src_crs, target_crs_obj, bounds.left, bounds.bottom, bounds.right, bounds.top
                )
                
                # Create corner coordinates in correct order
                bounds_coords = [
                    [min_lng, max_lat],  # top-left [lng, lat]
                    [max_lng, max_lat],  # top-right [lng, lat]
                    [max_lng, min_lat],  # bottom-right [lng, lat]
                    [min_lng, min_lat]   # bottom-left [lng, lat]
                ]
                
                print(f"[INFO] Transformed bounds (using transform_bounds): min_lng={min_lng:.6f}, min_lat={min_lat:.6f}, max_lng={max_lng:.6f}, max_lat={max_lat:.6f}")
                print(f"[INFO] Corner coordinates:")
                corner_names = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
                for i, coord in enumerate(bounds_coords):
                    print(f"  {corner_names[i]}: ({coord[0]:.6f}, {coord[1]:.6f})")
            except Exception as e:
                print(f"[WARNING] transform_bounds failed: {e}")
                # Fall back to corner-by-corner transformation
                # Calculate exact corner coordinates using transform matrix
                # Corners in pixel coordinates: (0,0), (width,0), (width,height), (0,height)
                corners_pixel = [
                    (0, 0),                    # top-left
                    (src.width, 0),            # top-right
                    (src.width, src.height),   # bottom-right
                    (0, src.height)             # bottom-left
                ]
                
                # Convert pixel coordinates to geographic coordinates using transform
                corners_src_x = []
                corners_src_y = []
                for px, py in corners_pixel:
                    # Transform pixel to geographic coordinates
                    x, y = transform_matrix * (px, py)
                    corners_src_x.append(x)
                    corners_src_y.append(y)
                
                print(f"[INFO] Source corner coordinates (in source CRS):")
                for i, (x, y) in enumerate(zip(corners_src_x, corners_src_y)):
                    corner_names = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
                    print(f"  {corner_names[i]}: ({x:.2f}, {y:.2f})")
                
                # Try to transform using rasterio with CRS object
                try:
                    # Use CRS object directly - rasterio should handle it
                    corners_dst = transform(src_crs, target_crs, corners_src_x, corners_src_y)
                    
                    # Create bounds from transformed corners (preserve exact corner order)
                    lngs, lats = corners_dst
                    
                    # Map corners in order: top-left, top-right, bottom-right, bottom-left
                    bounds_coords = [
                        [lngs[0], lats[0]],  # top-left [lng, lat]
                        [lngs[1], lats[1]],  # top-right [lng, lat]
                        [lngs[2], lats[2]],  # bottom-right [lng, lat]
                        [lngs[3], lats[3]]   # bottom-left [lng, lat]
                    ]
                    
                    min_lng, max_lng = min(lngs), max(lngs)
                    min_lat, max_lat = min(lats), max(lats)
                    print(f"[INFO] Transformed bounds: min_lng={min_lng:.6f}, min_lat={min_lat:.6f}, max_lng={max_lng:.6f}, max_lat={max_lat:.6f}")
                    print(f"[INFO] Corner coordinates:")
                    corner_names = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
                    for i, coord in enumerate(bounds_coords):
                        print(f"  {corner_names[i]}: ({coord[0]:.6f}, {coord[1]:.6f})")
                except Exception as e2:
                    print(f"[WARNING] Rasterio transform failed: {e2}")
                # Try pyproj as fallback
                try:
                    from pyproj import Transformer
                    # Try to get EPSG code from CRS, or use UTM Zone 12N (EPSG:32612) as fallback
                    src_crs_str = None
                    if hasattr(src_crs, 'to_epsg') and src_crs.to_epsg():
                        src_crs_str = f"EPSG:{src_crs.to_epsg()}"
                    elif 'UTM zone 12N' in str(src_crs) or '32612' in str(src_crs):
                        src_crs_str = "EPSG:32612"
                    else:
                        src_crs_str = src_crs.to_string() if hasattr(src_crs, 'to_string') else str(src_crs)
                    
                    print(f"[INFO] Attempting pyproj transform from {src_crs_str} to {target_crs}")
                    transformer = Transformer.from_crs(src_crs_str, target_crs, always_xy=True)
                    lngs, lats = transformer.transform(corners_src_x, corners_src_y)
                    
                    # Map corners in order: top-left, top-right, bottom-right, bottom-left
                    bounds_coords = [
                        [lngs[0], lats[0]],  # top-left [lng, lat]
                        [lngs[1], lats[1]],  # top-right [lng, lat]
                        [lngs[2], lats[2]],  # bottom-right [lng, lat]
                        [lngs[3], lats[3]]   # bottom-left [lng, lat]
                    ]
                    
                    min_lng, max_lng = min(lngs), max(lngs)
                    min_lat, max_lat = min(lats), max(lats)
                    print(f"[INFO] Transformed bounds (using pyproj): min_lng={min_lng:.6f}, min_lat={min_lat:.6f}, max_lng={max_lng:.6f}, max_lat={max_lat:.6f}")
                    print(f"[INFO] Corner coordinates:")
                    corner_names = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
                    for i, coord in enumerate(bounds_coords):
                        print(f"  {corner_names[i]}: ({coord[0]:.6f}, {coord[1]:.6f})")
                except Exception as e2:
                    print(f"[ERROR] Pyproj transform also failed: {e2}")
                    print(f"[WARNING] Using transform matrix coordinates directly - may need manual verification!")
                    # Use the transform matrix coordinates directly (assuming they're in the correct CRS)
                    # This should work if the CRS is already WGS84 or if we can't transform
                    bounds_coords = [
                        [corners_src_x[0], corners_src_y[0]],  # top-left
                        [corners_src_x[1], corners_src_y[1]],  # top-right
                        [corners_src_x[2], corners_src_y[2]],  # bottom-right
                        [corners_src_x[3], corners_src_y[3]]   # bottom-left
                    ]
                    print(f"[INFO] Using transform matrix coordinates (may need CRS verification)")
        
        if bounds_coords is None:
            # Already in target CRS - use transform matrix for precise corners
            transform_matrix = src.transform
            corners_pixel = [
                (0, 0),                    # top-left
                (src.width, 0),            # top-right
                (src.width, src.height),   # bottom-right
                (0, src.height)            # bottom-left
            ]
            
            bounds_coords = []
            for px, py in corners_pixel:
                x, y = transform_matrix * (px, py)
                bounds_coords.append([x, y])  # [lng, lat] format
            
            print(f"[INFO] Bounds (already in {target_crs}):")
            for i, coord in enumerate(bounds_coords):
                corner_names = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
                print(f"  {corner_names[i]}: ({coord[0]:.6f}, {coord[1]:.6f})")
        
        # Create bounds JSON structure
        bounds_geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [bounds_coords + [bounds_coords[0]]]  # Close polygon
                },
                "properties": {
                    "source_crs": src_crs.to_string(),
                    "target_crs": target_crs,
                    "width": src.width,
                    "height": src.height,
                    "num_bands": num_bands
                }
            }]
        }
        
        # Save bounds JSON
        if output_bounds_path is None:
            base_name = os.path.splitext(geotiff_path)[0]
            output_bounds_path = base_name + '_bounds.json'
        
        print(f"[INFO] Saving bounds JSON: {output_bounds_path}")
        with open(output_bounds_path, 'w') as f:
            json.dump(bounds_geojson, f, indent=2)
        print(f"[SUCCESS] Bounds JSON saved successfully")
        
        print("\n[SUCCESS] Conversion complete!")
        print(f"   PNG: {output_png_path}")
        print(f"   Bounds: {output_bounds_path}")
        
        return output_png_path, output_bounds_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python convert_geotiff_to_png.py <geotiff_path> [output_png_path] [output_bounds_path] [r_band] [g_band] [b_band]")
        print("\nExample:")
        print("  python convert_geotiff_to_png.py map/s2/SALT_LAKE_CITY_2023_large_2023_01_S2_tile_x0_y0.geotiff")
        print("  # For Sentinel-2 true color RGB (B4, B3, B2):")
        print("  python convert_geotiff_to_png.py map/s2/file.geotiff None None 3 2 1")
        sys.exit(1)
    
    geotiff_path = sys.argv[1]
    output_png = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != 'None' else None
    output_bounds = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != 'None' else None
    
    # Optional band indices for RGB (0-indexed)
    band_indices = None
    if len(sys.argv) >= 6:
        try:
            band_indices = [int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])]
            print(f"[INFO] Using custom band indices for RGB: {band_indices}")
        except ValueError:
            print("[WARNING] Invalid band indices, using defaults")
    
    try:
        convert_geotiff_to_png(geotiff_path, output_png, output_bounds, band_indices=band_indices)
    except Exception as e:
        print(f"[ERROR] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

