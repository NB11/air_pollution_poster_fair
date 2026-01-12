/**
 * Script to consolidate map files:
 * 1. Create single bounds.json per city/year (replaces 48 individual bounds geojson files)
 * 2. Consolidate ground truth station files
 * 3. Delete PNG files (keep WebP only)
 * 4. Delete old bounds.geojson files
 */

const fs = require('fs');
const path = require('path');

// Base paths
const BASE_DIR = path.join(__dirname, '..');
const PREDICTED_DIR = path.join(BASE_DIR, 'map', 'predicted');
const STATIONS_DIR = path.join(BASE_DIR, 'map', 'ground_truth_stations', 'geojson');
const STATIONS_PARENT_DIR = path.join(BASE_DIR, 'map', 'ground_truth_stations');

function consolidateBoundsFiles() {
    console.log('\n=== Consolidating bounds files ===');
    
    const cities = ['Bologna', 'Frascati', 'Milano'];
    const years = ['2024', '2025'];
    
    for (const city of cities) {
        for (const year of years) {
            const cityYearDir = path.join(PREDICTED_DIR, city, year);
            
            if (!fs.existsSync(cityYearDir)) {
                console.log(`  Skipping ${city}/${year} - directory not found`);
                continue;
            }
            
            console.log(`  Processing ${city}/${year}...`);
            
            // Find bounds files
            const files = fs.readdirSync(cityYearDir);
            const boundsFiles = files.filter(f => f.endsWith('_bounds.geojson'));
            
            if (boundsFiles.length === 0) {
                console.log(`    No bounds files found`);
                continue;
            }
            
            // Read first bounds file to get coordinates
            const firstBoundsPath = path.join(cityYearDir, boundsFiles[0]);
            const firstBounds = JSON.parse(fs.readFileSync(firstBoundsPath, 'utf8'));
            const coords = firstBounds.features[0].geometry.coordinates[0];
            
            // Extract pollutant info from all bounds files
            const pollutants = {};
            for (const boundsFile of boundsFiles) {
                const filePath = path.join(cityYearDir, boundsFile);
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const props = data.features[0].properties;
                const pollutant = props.pollutant;
                
                if (!pollutants[pollutant]) {
                    pollutants[pollutant] = {
                        vmin: props.vmin,
                        vmax: props.vmax,
                        colormap: props.colormap || 'inferno'
                    };
                }
            }
            
            // Create consolidated bounds.json
            const consolidated = {
                city: city,
                year: year,
                coordinates: [
                    [coords[0][0], coords[0][1]],  // SW corner
                    [coords[1][0], coords[1][1]],  // SE corner
                    [coords[2][0], coords[2][1]],  // NE corner
                    [coords[3][0], coords[3][1]]   // NW corner
                ],
                pollutants: pollutants
            };
            
            // Write consolidated bounds.json
            const outputPath = path.join(cityYearDir, 'bounds.json');
            fs.writeFileSync(outputPath, JSON.stringify(consolidated, null, 2));
            
            console.log(`    Created bounds.json`);
            console.log(`    Pollutants: ${Object.keys(pollutants).join(', ')}`);
        }
    }
    
    console.log('  Done consolidating bounds files.');
}

function deleteOldBoundsFiles() {
    console.log('\n=== Deleting old bounds files ===');
    
    const cities = ['Bologna', 'Frascati', 'Milano'];
    const years = ['2024', '2025'];
    let deletedCount = 0;
    
    for (const city of cities) {
        for (const year of years) {
            const cityYearDir = path.join(PREDICTED_DIR, city, year);
            
            if (!fs.existsSync(cityYearDir)) continue;
            
            // Only delete if bounds.json exists
            if (!fs.existsSync(path.join(cityYearDir, 'bounds.json'))) {
                console.log(`  Skipping ${city}/${year} - no bounds.json found`);
                continue;
            }
            
            const files = fs.readdirSync(cityYearDir);
            const boundsFiles = files.filter(f => f.endsWith('_bounds.geojson'));
            
            for (const f of boundsFiles) {
                fs.unlinkSync(path.join(cityYearDir, f));
                deletedCount++;
            }
            
            if (boundsFiles.length > 0) {
                console.log(`  Deleted ${boundsFiles.length} bounds files from ${city}/${year}`);
            }
        }
    }
    
    console.log(`  Total deleted: ${deletedCount} files`);
}

function deletePngFiles() {
    console.log('\n=== Deleting PNG files (keeping WebP) ===');
    
    const cities = ['Bologna', 'Frascati', 'Milano'];
    const years = ['2024', '2025'];
    let deletedCount = 0;
    
    for (const city of cities) {
        for (const year of years) {
            const cityYearDir = path.join(PREDICTED_DIR, city, year);
            
            if (!fs.existsSync(cityYearDir)) continue;
            
            const files = fs.readdirSync(cityYearDir);
            const pngFiles = files.filter(f => f.endsWith('.png'));
            
            let deletedInDir = 0;
            for (const pngFile of pngFiles) {
                const webpFile = pngFile.replace('.png', '.webp');
                
                // Only delete PNG if WebP exists
                if (fs.existsSync(path.join(cityYearDir, webpFile))) {
                    fs.unlinkSync(path.join(cityYearDir, pngFile));
                    deletedCount++;
                    deletedInDir++;
                } else {
                    console.log(`    Keeping ${pngFile} - no WebP equivalent`);
                }
            }
            
            if (deletedInDir > 0) {
                console.log(`  Deleted ${deletedInDir} PNG files from ${city}/${year}`);
            }
        }
    }
    
    console.log(`  Total deleted: ${deletedCount} files`);
}

function consolidateStationFiles() {
    console.log('\n=== Consolidating ground truth station files ===');
    
    if (!fs.existsSync(STATIONS_DIR)) {
        console.log(`  Stations directory not found: ${STATIONS_DIR}`);
        return;
    }
    
    // Group files by pollutant
    const pollutants = {};
    const stationFiles = fs.readdirSync(STATIONS_DIR).filter(f => f.startsWith('stations_') && f.endsWith('.geojson'));
    
    for (const f of stationFiles) {
        // Parse filename: stations_NO2_2024_01.geojson or stations_PM2.5_2024_01.geojson
        let pollutant;
        if (f.includes('PM2.5') || f.includes('PM2_5')) {
            pollutant = 'PM2.5';
        } else {
            const parts = f.replace('stations_', '').split('_');
            pollutant = parts[0]; // NO2, O3, PM10
        }
        
        if (!pollutants[pollutant]) {
            pollutants[pollutant] = [];
        }
        pollutants[pollutant].push(f);
    }
    
    console.log(`  Found pollutants: ${Object.keys(pollutants).join(', ')}`);
    
    // Create consolidated files
    for (const [pollutant, files] of Object.entries(pollutants)) {
        console.log(`  Processing ${pollutant} (${files.length} files)...`);
        
        const allFeatures = [];
        for (const stationFile of files) {
            const filePath = path.join(STATIONS_DIR, stationFile);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data.features) {
                allFeatures.push(...data.features);
            }
        }
        
        // Create consolidated geojson
        const consolidated = {
            type: 'FeatureCollection',
            features: allFeatures
        };
        
        // Write consolidated file
        const outputPath = path.join(STATIONS_PARENT_DIR, `stations_${pollutant}.geojson`);
        fs.writeFileSync(outputPath, JSON.stringify(consolidated));
        
        console.log(`    Created stations_${pollutant}.geojson with ${allFeatures.length} features`);
    }
    
    console.log('  Done consolidating station files.');
}

function deleteOldStationFiles() {
    console.log('\n=== Deleting old station files ===');
    
    // Check that consolidated files exist
    const consolidatedFiles = fs.readdirSync(STATIONS_PARENT_DIR).filter(f => f.startsWith('stations_') && f.endsWith('.geojson'));
    
    if (consolidatedFiles.length === 0) {
        console.log('  No consolidated files found - skipping deletion');
        return;
    }
    
    if (!fs.existsSync(STATIONS_DIR)) {
        console.log('  Individual station directory not found');
        return;
    }
    
    // Delete individual files
    const oldFiles = fs.readdirSync(STATIONS_DIR).filter(f => f.startsWith('stations_') && f.endsWith('.geojson'));
    let deletedCount = 0;
    
    for (const f of oldFiles) {
        fs.unlinkSync(path.join(STATIONS_DIR, f));
        deletedCount++;
    }
    
    console.log(`  Deleted ${deletedCount} files from geojson/`);
    
    // Remove empty geojson directory
    const remaining = fs.readdirSync(STATIONS_DIR);
    if (remaining.length === 0) {
        fs.rmdirSync(STATIONS_DIR);
        console.log(`  Removed empty directory: geojson/`);
    }
}

function main() {
    console.log('='.repeat(60));
    console.log('File Consolidation Script');
    console.log('='.repeat(60));
    
    // Step 1: Consolidate bounds files
    consolidateBoundsFiles();
    
    // Step 2: Delete old bounds files
    deleteOldBoundsFiles();
    
    // Step 3: Delete PNG files
    deletePngFiles();
    
    // Step 4: Consolidate station files
    consolidateStationFiles();
    
    // Step 5: Delete old station files
    deleteOldStationFiles();
    
    console.log('\n' + '='.repeat(60));
    console.log('Consolidation complete!');
    console.log('='.repeat(60));
}

main();

