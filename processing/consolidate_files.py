"""
Script to consolidate map files:
1. Create single bounds.json per city/year (replaces 48 individual bounds geojson files)
2. Consolidate ground truth station files
3. Delete PNG files (keep WebP only)
4. Delete old bounds.geojson files
"""

import os
import json
import glob
import shutil
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).parent.parent
PREDICTED_DIR = BASE_DIR / "map" / "predicted"
STATIONS_DIR = BASE_DIR / "map" / "ground_truth_stations" / "geojson"


def consolidate_bounds_files():
    """Create single bounds.json per city/year from individual bounds geojson files."""
    print("\n=== Consolidating bounds files ===")
    
    # Find all city/year directories
    cities = ["Bologna", "Frascati", "Milano"]
    years = ["2024", "2025"]
    
    for city in cities:
        for year in years:
            city_year_dir = PREDICTED_DIR / city / year
            if not city_year_dir.exists():
                print(f"  Skipping {city}/{year} - directory not found")
                continue
            
            print(f"  Processing {city}/{year}...")
            
            # Find first bounds file to get coordinates
            bounds_files = list(city_year_dir.glob("*_bounds.geojson"))
            if not bounds_files:
                print(f"    No bounds files found in {city_year_dir}")
                continue
            
            # Read first bounds file to get coordinates
            with open(bounds_files[0], 'r') as f:
                first_bounds = json.load(f)
            
            coords = first_bounds['features'][0]['geometry']['coordinates'][0]
            
            # Extract pollutant info from all bounds files
            pollutants = {}
            for bounds_file in bounds_files:
                with open(bounds_file, 'r') as f:
                    data = json.load(f)
                props = data['features'][0]['properties']
                pollutant = props['pollutant']
                if pollutant not in pollutants:
                    pollutants[pollutant] = {
                        "vmin": props['vmin'],
                        "vmax": props['vmax'],
                        "colormap": props.get('colormap', 'inferno')
                    }
            
            # Create consolidated bounds.json
            consolidated = {
                "city": city,
                "year": year,
                "coordinates": [
                    [coords[0][0], coords[0][1]],  # SW corner (min lon, max lat)
                    [coords[1][0], coords[1][1]],  # SE corner (max lon, max lat)
                    [coords[2][0], coords[2][1]],  # NE corner (max lon, min lat)
                    [coords[3][0], coords[3][1]]   # NW corner (min lon, min lat)
                ],
                "pollutants": pollutants
            }
            
            # Write consolidated bounds.json
            output_path = city_year_dir / "bounds.json"
            with open(output_path, 'w') as f:
                json.dump(consolidated, f, indent=2)
            
            print(f"    Created {output_path}")
            print(f"    Pollutants: {list(pollutants.keys())}")
    
    print("  Done consolidating bounds files.")


def delete_old_bounds_files():
    """Delete individual bounds.geojson files after consolidation."""
    print("\n=== Deleting old bounds files ===")
    
    cities = ["Bologna", "Frascati", "Milano"]
    years = ["2024", "2025"]
    deleted_count = 0
    
    for city in cities:
        for year in years:
            city_year_dir = PREDICTED_DIR / city / year
            if not city_year_dir.exists():
                continue
            
            # Only delete if bounds.json exists
            if not (city_year_dir / "bounds.json").exists():
                print(f"  Skipping {city}/{year} - no bounds.json found")
                continue
            
            bounds_files = list(city_year_dir.glob("*_bounds.geojson"))
            for f in bounds_files:
                f.unlink()
                deleted_count += 1
            
            print(f"  Deleted {len(bounds_files)} bounds files from {city}/{year}")
    
    print(f"  Total deleted: {deleted_count} files")


def delete_png_files():
    """Delete PNG files, keeping only WebP versions."""
    print("\n=== Deleting PNG files (keeping WebP) ===")
    
    cities = ["Bologna", "Frascati", "Milano"]
    years = ["2024", "2025"]
    deleted_count = 0
    
    for city in cities:
        for year in years:
            city_year_dir = PREDICTED_DIR / city / year
            if not city_year_dir.exists():
                continue
            
            png_files = list(city_year_dir.glob("*.png"))
            
            # Only delete PNGs if corresponding WebP exists
            for png_file in png_files:
                webp_file = png_file.with_suffix('.webp')
                if webp_file.exists():
                    png_file.unlink()
                    deleted_count += 1
                else:
                    print(f"    Keeping {png_file.name} - no WebP equivalent")
            
            if png_files:
                print(f"  Deleted {len(png_files)} PNG files from {city}/{year}")
    
    print(f"  Total deleted: {deleted_count} files")


def consolidate_station_files():
    """Consolidate ground truth station files into single file per pollutant."""
    print("\n=== Consolidating ground truth station files ===")
    
    if not STATIONS_DIR.exists():
        print(f"  Stations directory not found: {STATIONS_DIR}")
        return
    
    # Group files by pollutant
    pollutants = {}
    station_files = list(STATIONS_DIR.glob("stations_*.geojson"))
    
    for f in station_files:
        # Parse filename: stations_NO2_2024_01.geojson or stations_PM2.5_2024_01.geojson
        name = f.stem  # e.g., "stations_NO2_2024_01"
        parts = name.split('_')
        
        # Handle PM2.5 which has a dot
        if 'PM2.5' in name or 'PM2_5' in name:
            pollutant = 'PM2.5'
        else:
            pollutant = parts[1]  # NO2, O3, PM10
        
        if pollutant not in pollutants:
            pollutants[pollutant] = []
        pollutants[pollutant].append(f)
    
    print(f"  Found pollutants: {list(pollutants.keys())}")
    
    # Create consolidated files
    output_dir = STATIONS_DIR.parent  # map/ground_truth_stations/
    
    for pollutant, files in pollutants.items():
        print(f"  Processing {pollutant} ({len(files)} files)...")
        
        all_features = []
        for station_file in files:
            with open(station_file, 'r') as f:
                data = json.load(f)
            all_features.extend(data.get('features', []))
        
        # Create consolidated geojson
        consolidated = {
            "type": "FeatureCollection",
            "features": all_features
        }
        
        # Write consolidated file
        output_path = output_dir / f"stations_{pollutant}.geojson"
        with open(output_path, 'w') as f:
            json.dump(consolidated, f)
        
        print(f"    Created {output_path.name} with {len(all_features)} features")
    
    print("  Done consolidating station files.")


def delete_old_station_files():
    """Delete individual station files after consolidation."""
    print("\n=== Deleting old station files ===")
    
    parent_dir = STATIONS_DIR.parent
    
    # Check that consolidated files exist
    consolidated_files = list(parent_dir.glob("stations_*.geojson"))
    if not consolidated_files:
        print("  No consolidated files found - skipping deletion")
        return
    
    # Delete individual files in geojson/ subdirectory
    old_files = list(STATIONS_DIR.glob("stations_*.geojson"))
    deleted_count = 0
    
    for f in old_files:
        f.unlink()
        deleted_count += 1
    
    print(f"  Deleted {deleted_count} files from {STATIONS_DIR}")
    
    # Remove empty geojson directory
    if STATIONS_DIR.exists() and not any(STATIONS_DIR.iterdir()):
        STATIONS_DIR.rmdir()
        print(f"  Removed empty directory: {STATIONS_DIR}")


def main():
    print("=" * 60)
    print("File Consolidation Script")
    print("=" * 60)
    
    # Step 1: Consolidate bounds files
    consolidate_bounds_files()
    
    # Step 2: Delete old bounds files
    delete_old_bounds_files()
    
    # Step 3: Delete PNG files
    delete_png_files()
    
    # Step 4: Consolidate station files
    consolidate_station_files()
    
    # Step 5: Delete old station files
    delete_old_station_files()
    
    print("\n" + "=" * 60)
    print("Consolidation complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()

