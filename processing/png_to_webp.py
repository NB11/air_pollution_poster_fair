"""
Convert PNG files to WebP format for web map display.
Converts all PNG files in map/predicted directories to WebP format.

Usage:
    python processing/png_to_webp.py                           # Convert all cities
    python processing/png_to_webp.py --city Frascati           # Convert specific city
    python processing/png_to_webp.py --city Frascati --year 2024  # Specific city and year
"""

import os
import sys
import argparse
from pathlib import Path
from PIL import Image

# Add processing folder to path for imports
script_dir = Path(__file__).parent
project_root = script_dir.parent

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


def convert_png_to_webp(png_path, quality=85):
    """
    Convert a single PNG file to WebP format.
    
    Args:
        png_path: Path to input PNG file
        quality: WebP quality (0-100, default 85)
        
    Returns:
        Tuple of (success, message)
    """
    try:
        png_path = Path(png_path)
        webp_path = png_path.with_suffix('.webp')
        
        # Skip if WebP already exists
        if webp_path.exists():
            return True, f"Skipped (exists): {webp_path.name}"
        
        # Open PNG and convert to WebP
        with Image.open(png_path) as img:
            # Preserve transparency if present
            img.save(webp_path, 'WEBP', quality=quality, method=6)
        
        return True, f"Converted: {webp_path.name}"
    except Exception as e:
        return False, f"Error converting {png_path.name}: {str(e)}"


def find_png_files(base_dir, city=None, year=None):
    """
    Find all PNG files in the predicted maps directory.
    
    Args:
        base_dir: Base directory (map/predicted)
        city: Optional city name to filter
        year: Optional year to filter
        
    Returns:
        List of tuples: (png_path, city_name, year_name)
    """
    png_files = []
    base_dir = Path(base_dir)
    
    if not base_dir.exists():
        return png_files
    
    # Iterate through city directories
    for city_dir in base_dir.iterdir():
        if not city_dir.is_dir():
            continue
        
        city_name = city_dir.name
        if city and city_name != city:
            continue
        
        # Iterate through year directories
        for year_dir in city_dir.iterdir():
            if not year_dir.is_dir():
                continue
            
            year_name = year_dir.name
            if year and year_name != year:
                continue
            
            # Find PNG files
            for png_file in year_dir.glob('*.png'):
                png_files.append((png_file, city_name, year_name))
    
    return png_files


def main():
    parser = argparse.ArgumentParser(
        description='Convert PNG files to WebP format for web map display'
    )
    parser.add_argument('--city', type=str, help='Convert specific city only')
    parser.add_argument('--year', type=str, help='Convert specific year only')
    parser.add_argument('--quality', type=int, default=85,
                        help='WebP quality (0-100, default 85)')
    args = parser.parse_args()
    
    # Paths
    output_base_dir = project_root / 'map' / 'predicted'
    
    print(f"Output directory: {output_base_dir}")
    
    if not output_base_dir.exists():
        print(f"Error: predicted directory not found: {output_base_dir}")
        sys.exit(1)
    
    # Find all PNG files
    print("\nScanning for PNG files...")
    png_files = find_png_files(output_base_dir, city=args.city, year=args.year)
    
    if not png_files:
        print("No PNG files found.")
        sys.exit(0)
    
    print(f"Found {len(png_files)} PNG files to convert")
    
    # Group by city/year for progress reporting
    cities_years = set((city, year) for _, city, year in png_files)
    print(f"Cities/years: {sorted(cities_years)}")
    
    # Convert files
    print(f"\nConverting PNG to WebP (quality: {args.quality})...")
    
    success_count = 0
    skip_count = 0
    error_count = 0
    
    for i, (png_path, city_name, year_name) in enumerate(png_files, 1):
        success, message = convert_png_to_webp(png_path, quality=args.quality)
        
        if success:
            if "Skipped" in message:
                skip_count += 1
            else:
                success_count += 1
                print(f"  {message}")
        else:
            error_count += 1
            print(f"  {message}")
        
        if i % 10 == 0:
            print(f"  Progress: {i}/{len(png_files)} files processed...")
    
    print(f"\nConversion complete!")
    print(f"  Converted: {success_count}")
    print(f"  Skipped: {skip_count}")
    print(f"  Errors: {error_count}")


if __name__ == '__main__':
    main()
