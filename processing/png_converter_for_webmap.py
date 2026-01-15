"""
Batch convert GeoTIFF predictions to PNG with bounds GeoJSON for web map display.
Converts interpolated TIF files to inferno-colored PNG images (lossless quality).
Clips rasters to city/municipality boundaries.

Usage:
    python processing/png_converter_for_webmap.py                           # Convert all cities
    python processing/png_converter_for_webmap.py --city Frascati           # Convert specific city
    python processing/png_converter_for_webmap.py --city Frascati --year 2024  # Specific city and year
    python processing/png_converter_for_webmap.py --skip-existing           # Skip already converted files
"""

import os
import sys
import json
import argparse
import re
import yaml
from pathlib import Path

# Add processing folder to path for imports
script_dir = Path(__file__).parent
project_root = script_dir.parent

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Load configuration from YAML file
def load_config(config_path=None):
    """Load simple configuration from YAML file - only clip_to_boundary option."""
    if config_path is None:
        config_path = script_dir / 'configs' / 'png_converter_config.yml'
    
    config_path = Path(config_path)
    
    # Default: clipping enabled
    clip_to_boundary = True
    
    if config_path.exists():
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f) or {}
                clip_to_boundary = config.get('clip_to_boundary', True)
        except Exception as e:
            print(f"Warning: Could not load config file: {e}, using defaults")
    
    return clip_to_boundary

# Load config - simple boolean for clipping
CLIP_TO_BOUNDARY = load_config()

# Pollutant color scales (hardcoded defaults)
POLLUTANT_SCALES = {
    'NO2': {'vmin': 0, 'vmax': 50},
    'O3': {'vmin': 20, 'vmax': 80},
    'SO2': {'vmin': 0, 'vmax': 10},
    'PM2_5': {'vmin': 0, 'vmax': 35},
    'PM10': {'vmin': 0, 'vmax': 50},
}


def parse_tif_filename(filename):
    """
    Parse TIF filename to extract year, month, pollutant.
    Pattern: YYYY_MM_POLLUTANT_interpolated.tif
    Example: 2024_01_NO2_interpolated.tif -> (2024, 01, NO2)
    """
    pattern = r'^(\d{4})_(\d{2})_([A-Za-z0-9_]+)_interpolated\.tif$'
    match = re.match(pattern, filename)
    if match:
        year = match.group(1)
        month = match.group(2)
        pollutant = match.group(3)
        return year, month, pollutant
    return None, None, None


def utm_to_wgs84(easting, northing, zone, northern=True):
    """
    Convert UTM coordinates to WGS84 (latitude/longitude).
    Manual implementation to avoid PROJ database issues.
    """
    import math
    
    k0 = 0.9996  # UTM scale factor
    a = 6378137.0  # WGS84 semi-major axis
    e2 = 0.00669438  # WGS84 first eccentricity squared
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    
    # Central meridian for the zone (in radians)
    lon0_deg = (zone - 1) * 6 - 180 + 3  # Center of UTM zone in degrees
    lon0 = math.radians(lon0_deg)
    
    # Remove false easting and northing
    x = easting - 500000.0
    y = northing if northern else northing - 10000000.0
    
    # Footprint latitude
    M = y / k0
    mu = M / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256))
    
    e1_2 = e1**2
    e1_3 = e1**3
    e1_4 = e1**4
    
    phi1 = mu + (3*e1/2 - 27*e1_3/32) * math.sin(2*mu) \
         + (21*e1_2/16 - 55*e1_4/32) * math.sin(4*mu) \
         + (151*e1_3/96) * math.sin(6*mu) \
         + (1097*e1_4/512) * math.sin(8*mu)
    
    sin_phi1 = math.sin(phi1)
    cos_phi1 = math.cos(phi1)
    tan_phi1 = math.tan(phi1)
    
    N1 = a / math.sqrt(1 - e2 * sin_phi1**2)
    T1 = tan_phi1**2
    C1 = (e2/(1-e2)) * cos_phi1**2
    R1 = a * (1 - e2) / ((1 - e2 * sin_phi1**2)**1.5)
    D = x / (N1 * k0)
    
    lat = phi1 - (N1 * tan_phi1 / R1) * (D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*(e2/(1-e2))) * D**4/24 \
        + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*(e2/(1-e2)) - 3*C1**2) * D**6/720)
    
    lon = lon0 + (D - (1 + 2*T1 + C1) * D**3/6 \
        + (5 - 2*C1 + 28*T1 - 3*C1**2 + 8*(e2/(1-e2)) + 24*T1**2) * D**5/120) / cos_phi1
    
    return math.degrees(lon), math.degrees(lat)


def extract_utm_zone(crs_str):
    """Extract UTM zone number from CRS string or EPSG code."""
    crs_str = str(crs_str)
    
    # Try EPSG code format (EPSG:326XX for northern, EPSG:327XX for southern)
    epsg_match = re.search(r'EPSG:32([67])(\d{2})', crs_str, re.IGNORECASE)
    if epsg_match:
        hemisphere = epsg_match.group(1)  # 6 = northern, 7 = southern
        zone = int(epsg_match.group(2))
        northern = (hemisphere == '6')
        return zone, northern
    
    # Try UTM zone format (UTM zone 33N)
    match = re.search(r'UTM zone (\d+)([NS])', crs_str, re.IGNORECASE)
    if match:
        zone = int(match.group(1))
        northern = match.group(2).upper() == 'N'
        return zone, northern
    
    return None, None


def wgs84_to_utm(lon, lat, zone, northern=True):
    """
    Convert WGS84 coordinates to UTM.
    Manual implementation to avoid PROJ database issues.
    """
    import math
    
    k0 = 0.9996  # UTM scale factor
    a = 6378137.0  # WGS84 semi-major axis
    e2 = 0.00669438  # WGS84 first eccentricity squared
    
    # Central meridian for the zone
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    
    sin_lat = math.sin(lat_rad)
    cos_lat = math.cos(lat_rad)
    tan_lat = math.tan(lat_rad)
    
    N = a / math.sqrt(1 - e2 * sin_lat**2)
    T = tan_lat**2
    C = (e2 / (1 - e2)) * cos_lat**2
    A = (lon_rad - lon0) * cos_lat
    
    M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * lat_rad
            - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * math.sin(2*lat_rad)
            + (15*e2**2/256 + 45*e2**3/1024) * math.sin(4*lat_rad)
            - (35*e2**3/3072) * math.sin(6*lat_rad))
    
    easting = k0 * N * (A + (1 - T + C) * A**3/6 
                        + (5 - 18*T + T**2 + 72*C - 58*(e2/(1-e2))) * A**5/120) + 500000.0
    
    northing = k0 * (M + N * tan_lat * (A**2/2 
                     + (5 - T + 9*C + 4*C**2) * A**4/24
                     + (61 - 58*T + T**2 + 600*C - 330*(e2/(1-e2))) * A**6/720))
    
    if not northern:
        northing += 10000000.0
    
    return easting, northing


def transform_geojson_to_utm(geojson_geometry, zone, northern=True):
    """
    Transform a GeoJSON geometry from WGS84 to UTM coordinates.
    """
    geom_type = geojson_geometry['type']
    
    def transform_coord(coord):
        lon, lat = coord[0], coord[1]
        easting, northing = wgs84_to_utm(lon, lat, zone, northern)
        return [easting, northing]
    
    def transform_ring(ring):
        return [transform_coord(coord) for coord in ring]
    
    def transform_polygon(polygon):
        return [transform_ring(ring) for ring in polygon]
    
    if geom_type == 'Polygon':
        new_coords = transform_polygon(geojson_geometry['coordinates'])
        return {'type': 'Polygon', 'coordinates': new_coords}
    elif geom_type == 'MultiPolygon':
        new_coords = [transform_polygon(poly) for poly in geojson_geometry['coordinates']]
        return {'type': 'MultiPolygon', 'coordinates': new_coords}
    else:
        raise ValueError(f"Unsupported geometry type: {geom_type}")


def load_city_boundary(city_name, bounds_dir):
    """
    Load the city boundary from GeoJSON file.
    
    Args:
        city_name: Name of the city (e.g., 'Frascati')
        bounds_dir: Directory containing boundary GeoJSON files
        
    Returns:
        GeoJSON feature collection with the city boundary, or None if not found
    """
    bounds_dir = Path(bounds_dir)
    
    # Determine boundary file based on city name
    if city_name == 'Frascati':
        boundary_filename = 'ita_comuni.geojson'
    else:
        boundary_filename = 'usa_counties.geojson'
    
    boundary_path = bounds_dir / boundary_filename
    
    if not boundary_path.exists():
        print(f"Boundary file not found: {boundary_path}")
        return None
    
    # Load GeoJSON
    with open(boundary_path, 'r', encoding='utf-8') as f:
        geojson_data = json.load(f)
    
    # Find the specific city/municipality feature
    city_feature = None
    for feature in geojson_data.get('features', []):
        name = feature.get('properties', {}).get('name') or feature.get('properties', {}).get('NAME', '')
        if name.lower() == city_name.lower():
            city_feature = feature
            break
    
    if not city_feature:
        print(f"Warning: City '{city_name}' not found in boundary file")
        return None
    
    print(f"Found boundary for {city_name}")
    
    # Return FeatureCollection with just the city feature
    return {
        'type': 'FeatureCollection',
        'features': [city_feature]
    }


def convert_single_tif(tif_path, output_dir, skip_existing=False, city_name=None):
    """
    Convert a single TIF to PNG with bounds GeoJSON, clipped to city boundary.
    
    Args:
        tif_path: Path to input TIF file
        output_dir: Output directory for PNG and bounds files
        skip_existing: If True, skip if output already exists
        city_name: Name of the city for boundary clipping (e.g., 'Frascati')
        
    Returns:
        Tuple of (success, message)
    """
    try:
        import rasterio
        from rasterio import mask as rio_mask
        import numpy as np
        from PIL import Image
        from shapely.geometry import shape, mapping
        import matplotlib
        
        tif_path = Path(tif_path)
        output_dir = Path(output_dir)
        
        # Parse filename
        year, month, pollutant = parse_tif_filename(tif_path.name)
        if not all([year, month, pollutant]):
            return False, f"Could not parse filename: {tif_path.name}"
        
        # Get pollutant scale
        scale = POLLUTANT_SCALES.get(pollutant, {'vmin': 0, 'vmax': 50})
        vmin, vmax = scale['vmin'], scale['vmax']
        
        # Output paths (PNG for lossless quality)
        png_filename = f"{pollutant}_month{month}_inferno.png"
        bounds_filename = f"{pollutant}_month{month}_bounds.geojson"
        png_path = output_dir / png_filename
        bounds_path = output_dir / bounds_filename
        
        # Skip if already exists
        if skip_existing and png_path.exists() and bounds_path.exists():
            return True, f"Skipped (exists): {png_filename}"
        
        # Create output directory
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Load city boundary if clipping is enabled and city_name is provided
        city_boundary = None
        if CLIP_TO_BOUNDARY and city_name:
            bounds_dir = project_root / 'raw_maps' / city_name / 'bounds'
            city_boundary = load_city_boundary(city_name, bounds_dir)
        
        # Read and clip TIF
        with rasterio.open(tif_path) as src:
            src_crs = src.crs
            
            # Clip to city boundary if available and clipping enabled
            if CLIP_TO_BOUNDARY and city_boundary:
                # Convert GeoJSON geometries to Shapely shapes
                shapes = []
                zone, northern = extract_utm_zone(str(src_crs))
                
                for feature in city_boundary.get('features', []):
                    geom_dict = feature['geometry']
                    # Transform geometry to match raster CRS (UTM) using manual conversion
                    if zone:
                        try:
                            geom_dict = transform_geojson_to_utm(geom_dict, zone, northern)
                        except Exception as e:
                            print(f"Warning: Could not transform geometry: {e}")
                    geom = shape(geom_dict)
                    shapes.append(geom)
                
                # Clip raster to boundary
                try:
                    clipped_data, clipped_transform = rio_mask.mask(src, shapes, crop=True, nodata=np.nan)
                    data = clipped_data[0]  # Single band
                    clipped_bounds = rasterio.transform.array_bounds(
                        clipped_data.shape[1], clipped_data.shape[2], clipped_transform
                    )
                    bounds = rasterio.coords.BoundingBox(*clipped_bounds)
                except Exception as e:
                    print(f"Warning: Could not clip to boundary ({e}), using full raster")
                    data = src.read(1)
                    bounds = src.bounds
            else:
                # No clipping, use full raster
                data = src.read(1)
                bounds = src.bounds
            
            # Extract UTM zone from CRS
            zone, northern = extract_utm_zone(str(src_crs))
            
            if zone:
                # Use manual UTM to WGS84 conversion
                min_lng, min_lat = utm_to_wgs84(bounds.left, bounds.bottom, zone, northern)
                max_lng, max_lat = utm_to_wgs84(bounds.right, bounds.top, zone, northern)
            else:
                # Assume already in WGS84
                min_lng, min_lat = bounds.left, bounds.bottom
                max_lng, max_lat = bounds.right, bounds.top
        
        # Handle NaN/NoData values
        nodata_mask = np.isnan(data) | (data < -1e10) | (data > 1e10)
        
        # Normalize data to 0-1 range using pollutant-specific scale
        normalized = np.clip((data - vmin) / (vmax - vmin), 0, 1)
        
        # Apply inferno colormap
        cmap = matplotlib.colormaps.get_cmap('inferno')
        rgba = cmap(normalized)
        
        # Set alpha to 0 for nodata pixels (outside boundary or invalid)
        rgba[nodata_mask, 3] = 0
        
        # Convert to 8-bit RGBA
        rgba_uint8 = (rgba * 255).astype(np.uint8)
        
        # Save as PNG (lossless quality)
        img = Image.fromarray(rgba_uint8, 'RGBA')
        img.save(png_path, 'PNG', optimize=True)
        
        # Create bounds GeoJSON (matching existing format)
        bounds_geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [min_lng, max_lat],  # top-left
                        [max_lng, max_lat],  # top-right
                        [max_lng, min_lat],  # bottom-right
                        [min_lng, min_lat],  # bottom-left
                        [min_lng, max_lat]   # close polygon
                    ]]
                },
                "properties": {
                    "pollutant": pollutant,
                    "month": month,
                    "image_file": png_filename,
                    "vmin": vmin,
                    "vmax": vmax,
                    "colormap": "inferno",
                    "clipped_to": city_name if (CLIP_TO_BOUNDARY and city_name) else "full"
                }
            }]
        }
        
        # Save bounds JSON
        with open(bounds_path, 'w') as f:
            json.dump(bounds_geojson, f, indent=2)
        
        clip_status = f" (clipped to {city_name})" if (CLIP_TO_BOUNDARY and city_name) else ""
        return True, f"Converted: {png_filename}{clip_status}"
        
    except Exception as e:
        import traceback
        return False, f"Error converting {tif_path}: {str(e)}\n{traceback.format_exc()}"


def find_tif_files(raw_maps_dir, city=None, year=None):
    """
    Find all interpolated TIF files in raw_maps directory.
    
    Args:
        raw_maps_dir: Path to raw_maps directory
        city: Optional city filter
        year: Optional year filter
    
    Returns:
        List of (tif_path, city, year) tuples
    """
    raw_maps_dir = Path(raw_maps_dir)
    tif_files = []
    
    # Pattern: raw_maps/{City}/{Year}/predictions/{Year}/month_XX/*.tif
    for city_dir in raw_maps_dir.iterdir():
        if not city_dir.is_dir():
            continue
        city_name = city_dir.name
        
        # Skip non-city directories
        if city_name in ['bounds', '.git', '__pycache__']:
            continue
        
        # Filter by city if specified
        if city and city_name.lower() != city.lower():
            continue
        
        for year_dir in city_dir.iterdir():
            if not year_dir.is_dir():
                continue
            year_name = year_dir.name
            
            # Skip non-year directories
            if not year_name.isdigit():
                continue
            
            # Filter by year if specified
            if year and year_name != str(year):
                continue
            
            # Look for predictions folder
            predictions_dir = year_dir / 'predictions' / year_name
            if not predictions_dir.exists():
                continue
            
            # Find all month folders
            for month_dir in predictions_dir.iterdir():
                if not month_dir.is_dir() or not month_dir.name.startswith('month_'):
                    continue
    
                # Find interpolated TIF files
                for tif_file in month_dir.glob('*_interpolated.tif'):
                    tif_files.append((tif_file, city_name, year_name))
    
    return tif_files


def main():
    parser = argparse.ArgumentParser(
        description='Convert GeoTIFF predictions to PNG for web map display (with boundary clipping)'
    )
    parser.add_argument('--city', type=str, help='Convert specific city only')
    parser.add_argument('--year', type=str, help='Convert specific year only')
    parser.add_argument('--skip-existing', action='store_true', 
                        help='Skip files that already exist')
    parser.add_argument('--config', type=str, default=None,
                        help='Path to config YAML file (default: processing/configs/png_converter_config.yml)')
    args = parser.parse_args()
    
    # Reload config if custom path provided
    global CLIP_TO_BOUNDARY
    if args.config:
        CLIP_TO_BOUNDARY = load_config(args.config)
    
    # Paths
    raw_maps_dir = project_root / 'raw_maps'
    output_base_dir = project_root / 'map' / 'predicted'
    
    print(f"Raw maps directory: {raw_maps_dir}")
    print(f"Output directory: {output_base_dir}")
    
    if not raw_maps_dir.exists():
        print(f"Error: raw_maps directory not found: {raw_maps_dir}")
        sys.exit(1)
    
    # Find all TIF files
    print("\nScanning for TIF files...")
    tif_files = find_tif_files(raw_maps_dir, city=args.city, year=args.year)
    
    if not tif_files:
        print("No interpolated TIF files found.")
        sys.exit(0)
    
    print(f"Found {len(tif_files)} TIF files to convert")
    
    # Group by city/year for progress reporting
    cities_years = set((city, year) for _, city, year in tif_files)
    print(f"Cities/years: {sorted(cities_years)}")
    
    # Convert files
    clipping_status = "with boundary clipping" if CLIP_TO_BOUNDARY else "without clipping"
    print(f"\nConverting files ({clipping_status})...")
    
    success_count = 0
    error_count = 0
    skip_count = 0
    
    # Process files sequentially
    for i, (tif_path, city_name, year_name) in enumerate(tif_files):
        output_dir = output_base_dir / city_name / year_name
        success, message = convert_single_tif(tif_path, output_dir, args.skip_existing, city_name=city_name)
        
        if success:
            if 'Skipped' in message:
                skip_count += 1
            else:
                success_count += 1
                print(f"  {message}")
        else:
            error_count += 1
            print(f"  ERROR: {message}")
        
        # Progress update every 10 files
        if (i + 1) % 10 == 0:
            print(f"  Progress: {i + 1}/{len(tif_files)} files processed...")
    
    print(f"\nConversion complete!")
    print(f"  Converted: {success_count}")
    print(f"  Skipped: {skip_count}")
    print(f"  Errors: {error_count}")
    
    # List output directories
    print("\nOutput directories:")
    for city_name, year_name in sorted(cities_years):
        output_dir = output_base_dir / city_name / year_name
        if output_dir.exists():
            file_count = len(list(output_dir.glob('*.png')))
            print(f"  {output_dir}: {file_count} PNG files")


if __name__ == '__main__':
    main()
