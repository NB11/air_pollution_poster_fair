let map;

// Initialize map
function initMap() {
    map = new maplibregl.Map({
        container: 'map-view',
        style: {
            version: 8,
            sources: {
                'osm-tiles': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors'
                },
                'satellite-tiles': {
                    type: 'raster',
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256,
                    attribution: '© Esri'
                }
            },
            layers: [
                {
                    id: 'satellite-layer',
                    type: 'raster',
                    source: 'satellite-tiles',
                    minzoom: 0,
                    maxzoom: 19
                }
            ]
        },
        center: [-111.85, 40.62], // Center on predicted area (Salt Lake City region)
        zoom: 10, // Zoomed out to show the entire predicted area
        minZoom: 6, // Minimum zoom level - allows zooming out to see context
        maxZoom: 16.4, // MAXIMUM ZOOM LIMIT - Change this value to adjust how far users can zoom in (higher = more zoom)
        antialias: false // Disable antialiasing to preserve raw pixels
    });

    // Add custom base map switcher control first (will be on top)
    addBaseMapSwitcher();
    
    // Add navigation controls (will be below switcher)
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'top-right');

    // Wait for map to load before adding data
    map.on('load', () => {
        loadSaharaGeoJSON();
        setupEventHandlers();
        // Load predicted raster layer with pollutant, year, and month selector
        initCompositeLayer();
        // Initialize mobile tab switcher
        initMobileTabSwitcher();
        initMobileInfoCarousel();
        // Optional: Load small tile (comment out if not needed)
        // loadPNGRasterLayer('map/s2/SALT_LAKE_CITY_2023_large_2023_01_S2_tile_x0_y0.png', 
        //                   'map/s2/SALT_LAKE_CITY_2023_large_2023_01_S2_tile_x0_y0_bounds.json');
    });
    
    // Initialize carousel when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initExplanationCarousel);
    } else {
        initExplanationCarousel();
    }
}

// Calculate polygon area to determine winding order
function calculatePolygonArea(ring) {
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i][0] * ring[i + 1][1];
        area -= ring[i + 1][0] * ring[i][1];
    }
    return area / 2;
}

// Ensure ring is counter-clockwise (positive area)
function ensureCounterClockwise(ring) {
    const area = calculatePolygonArea(ring);
    return area > 0 ? ring : ring.reverse();
}

// Ensure ring is clockwise (negative area) - for holes
function ensureClockwise(ring) {
    const area = calculatePolygonArea(ring);
    return area < 0 ? ring : ring.reverse();
}

// Create inverse polygon (world minus Sahara) for masking
function createInversePolygon(saharaGeoJSON) {
    // Create a world polygon covering the entire globe (counter-clockwise)
    const worldPolygon = [
        [-180, -90],
        [-180, 90],
        [180, 90],
        [180, -90],
        [-180, -90]
    ];
    
    // Extract Sahara polygons as holes (must be clockwise)
    const holes = [];
    saharaGeoJSON.features.forEach(feature => {
        if (feature.geometry.type === 'MultiPolygon') {
            feature.geometry.coordinates.forEach(polygon => {
                // First ring of each polygon is the outer boundary
                polygon.forEach((ring, index) => {
                    if (index === 0) {
                        // Ensure clockwise for hole
                        const holeRing = ensureClockwise([...ring]);
                        holes.push(holeRing);
                    }
                });
            });
        } else if (feature.geometry.type === 'Polygon') {
            // First ring is outer boundary - make it clockwise for hole
            const holeRing = ensureClockwise([...feature.geometry.coordinates[0]]);
            holes.push(holeRing);
        }
    });
    
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [worldPolygon, ...holes]
            },
            properties: {}
        }]
    };
}

// Load Sahara GeoJSON data
async function loadSaharaGeoJSON() {
    try {
        const response = await fetch('Sahara desert.geojson');
        const geoJsonData = await response.json();
        
        // Transform coordinates from EPSG:3857 to WGS84 if needed
        const transformedGeoJSON = transformGeoJSON(geoJsonData);
        
        // Remove existing sources/layers if present
        if (map.getLayer('world-mask')) {
            map.removeLayer('world-mask');
        }
        if (map.getSource('sahara-source')) {
            map.removeSource('sahara-source');
        }
        if (map.getSource('world-mask-source')) {
            map.removeSource('world-mask-source');
        }
        
        // Add Sahara source (for interactions only)
        map.addSource('sahara-source', {
            type: 'geojson',
            data: transformedGeoJSON
        });
        
        // Calculate bounds and set as maxBounds to restrict panning
        const bounds = new maplibregl.LngLatBounds();
        transformedGeoJSON.features.forEach(feature => {
            if (feature.geometry.type === 'MultiPolygon') {
                feature.geometry.coordinates.forEach(polygon => {
                    polygon.forEach(ring => {
                        ring.forEach(coord => {
                            bounds.extend(coord);
                        });
                    });
                });
            } else if (feature.geometry.type === 'Polygon') {
                feature.geometry.coordinates.forEach(ring => {
                    ring.forEach(coord => {
                        bounds.extend(coord);
                    });
                });
            }
        });
        
        // Expand bounds by approximately 1000km (about 9 degrees)
        const expandedBounds = new maplibregl.LngLatBounds(
            [bounds.getWest() - 9, bounds.getSouth() - 9],
            [bounds.getEast() + 9, bounds.getNorth() + 9]
        );
        
        // Remove maxBounds restriction - allow free panning
        // map.setMaxBounds(expandedBounds);
        
        // Don't fit bounds to Sahara - keep Salt Lake City view
        // fitSaharaBounds(transformedGeoJSON);
        
        // Load ALOS PALSAR raster layer if available
        loadALOSRaster();
        
    } catch (error) {
        console.error('Error loading Sahara GeoJSON:', error);
        alert('Error loading Sahara desert data. Please check the console for details.');
    }
}

// Composite layer management
let currentCompositeYear = '2023';
let currentCompositeMonth = '01'; // Default to January
let currentPollutant = 'NO2'; // Default pollutant

// Available pollutants
const pollutants = ['NO2', 'O3', 'SO2', 'PM2.5', 'PM10', 'CTRL'];

// Pollutant color bar info (vmin, vmax)
const pollutantInfo = {
    'NO2': { vmin: 0, vmax: 50 },
    'O3': { vmin: 20, vmax: 80 },
    'SO2': { vmin: 0, vmax: 10 },
    'PM2.5': { vmin: 0, vmax: 35 },
    'PM10': { vmin: 0, vmax: 50 },
    'CTRL': { vmin: 0, vmax: 0 }
};

// Update color bar legend (shows min and max)
function updateColorBar(pollutant) {
    const info = pollutantInfo[pollutant] || pollutantInfo['NO2'];
    
    const minEl = document.getElementById('colorbar-min');
    const maxEl = document.getElementById('colorbar-max');
    
    if (minEl) minEl.textContent = info.vmin;
    if (maxEl) maxEl.textContent = info.vmax;
    
    // Hide color bar if N/A selected
    const colorbar = document.getElementById('mobile-colorbar');
    if (colorbar) {
        colorbar.style.display = (pollutant === 'CTRL') ? 'none' : 'flex';
    }
}

// Available years
const availableYears = ['2023'];

// All years to display (2018-2025)
const allYears = ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];

// Available months per year (all 12 months for 2023)
const availableMonths = {
    '2023': ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'] // All months
};

// Initialize composite layer with year/month slider
function initCompositeLayer() {
    // Load default month (January) with default pollutant
    loadPredictedLayer('2023', '01', 'NO2');
    
    // Store references to all dropdowns for closing
    let allDropdowns = [];
    // Store original slider labels to restore later
    const monthLabels = document.querySelector('.month-slider-labels');
    const mobileMonthLabels = document.querySelector('.mobile-month-slider-labels');
    const originalMonthLabelsHTML = monthLabels ? monthLabels.innerHTML : null;
    const originalMobileMonthLabelsHTML = mobileMonthLabels ? mobileMonthLabels.innerHTML : null;
    
    // Function to close all dropdowns
    function closeAllDropdowns() {
        allDropdowns.forEach(dropdown => {
            if (dropdown && dropdown.style) {
                dropdown.style.display = 'none';
            }
        });
    }
    
    // Set up pollutant selector button (desktop)
    const pollutantSelector = document.getElementById('pollutant-selector');
    if (pollutantSelector) {
        // Create pollutant dropdown menu
        const pollutantDropdown = document.createElement('div');
        pollutantDropdown.className = 'year-dropdown';
        pollutantDropdown.style.display = 'none';
        pollutantDropdown.innerHTML = pollutants.map(p => 
            `<div class="year-option" data-pollutant="${p}">${p}</div>`
        ).join('');
        document.body.appendChild(pollutantDropdown);
        allDropdowns.push(pollutantDropdown);
        
        pollutantSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = pollutantDropdown.style.display === 'block';
            
            // Close all other dropdowns first
            closeAllDropdowns();
            
            // Toggle this dropdown
            pollutantDropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Position dropdown - open upwards if more space above than below
                const rect = pollutantSelector.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                
                pollutantDropdown.style.position = 'fixed';
                pollutantDropdown.style.left = `${rect.left}px`;
                pollutantDropdown.style.width = `${rect.width}px`;
                pollutantDropdown.style.zIndex = '10000';
                
                // Estimate dropdown height (number of options * ~35px per option + padding)
                const estimatedHeight = pollutants.length * 35 + 10;
                
                if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
                    // Open upwards
                    pollutantDropdown.style.bottom = `${window.innerHeight - rect.top + 5}px`;
                    pollutantDropdown.style.top = 'auto';
                } else {
                    // Open downwards
                    pollutantDropdown.style.top = `${rect.bottom + 5}px`;
                    pollutantDropdown.style.bottom = 'auto';
                }
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!pollutantSelector.contains(e.target) && !pollutantDropdown.contains(e.target)) {
                closeAllDropdowns();
            }
        });
        
        // Handle pollutant selection
        pollutantDropdown.addEventListener('click', (e) => {
            if (e.target.classList.contains('year-option')) {
                const pollutant = e.target.getAttribute('data-pollutant');
                currentPollutant = pollutant;
                pollutantSelector.textContent = pollutant;
                pollutantDropdown.style.display = 'none';
                updateColorBar(pollutant);
                
                // Reload layer with new pollutant
                loadPredictedLayer(currentCompositeYear, currentCompositeMonth, pollutant, {
                    originalMonthLabelsHTML,
                    originalMobileMonthLabelsHTML
                });
            }
        });
    }
    
    // Set up mobile pollutant button
    const mobilePollutantBtn = document.getElementById('mobile-pollutant-btn');
    if (mobilePollutantBtn) {
        // Create mobile pollutant dropdown
        const mobilePollutantDropdown = document.createElement('div');
        mobilePollutantDropdown.className = 'year-dropdown';
        mobilePollutantDropdown.style.display = 'none';
        mobilePollutantDropdown.innerHTML = pollutants.map(p => 
            `<div class="year-option" data-pollutant="${p}">${p}</div>`
        ).join('');
        document.body.appendChild(mobilePollutantDropdown);
        allDropdowns.push(mobilePollutantDropdown);
        
        mobilePollutantBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = mobilePollutantDropdown.style.display === 'block';
            
            // Close all other dropdowns first
            closeAllDropdowns();
            
            // Toggle this dropdown
            mobilePollutantDropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Position dropdown - open upwards if more space above than below
                const rect = mobilePollutantBtn.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                
                mobilePollutantDropdown.style.position = 'fixed';
                mobilePollutantDropdown.style.left = `${rect.left}px`;
                mobilePollutantDropdown.style.width = `${rect.width}px`;
                mobilePollutantDropdown.style.zIndex = '10000';
                
                // Estimate dropdown height (number of options * ~35px per option + padding)
                const estimatedHeight = pollutants.length * 35 + 10;
                
                if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
                    // Open upwards
                    mobilePollutantDropdown.style.bottom = `${window.innerHeight - rect.top + 5}px`;
                    mobilePollutantDropdown.style.top = 'auto';
                } else {
                    // Open downwards
                    mobilePollutantDropdown.style.top = `${rect.bottom + 5}px`;
                    mobilePollutantDropdown.style.bottom = 'auto';
                }
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!mobilePollutantBtn.contains(e.target) && !mobilePollutantDropdown.contains(e.target)) {
                closeAllDropdowns();
            }
        });
        
        // Handle pollutant selection
        mobilePollutantDropdown.addEventListener('click', (e) => {
            if (e.target.classList.contains('year-option')) {
                const pollutant = e.target.getAttribute('data-pollutant');
                currentPollutant = pollutant;
                mobilePollutantBtn.textContent = pollutant;
                mobilePollutantDropdown.style.display = 'none';
                updateColorBar(pollutant);
                
                // Update desktop selector if it exists
                if (pollutantSelector) {
                    pollutantSelector.textContent = pollutant;
                }
                
                // Reload layer with new pollutant
                loadPredictedLayer(currentCompositeYear, currentCompositeMonth, pollutant, {
                    originalMonthLabelsHTML,
                    originalMobileMonthLabelsHTML
                });
            }
        });
    }
    
    // Set up mobile year button
    const mobileYearBtn = document.getElementById('mobile-year-btn');
    if (mobileYearBtn) {
        // Create mobile year dropdown
        const mobileYearDropdown = document.createElement('div');
        mobileYearDropdown.className = 'year-dropdown';
        mobileYearDropdown.style.display = 'none';
        // Generate year options with strikethrough for unavailable years
        mobileYearDropdown.innerHTML = allYears.map(year => {
            const isAvailable = availableYears.includes(year);
            const disabledClass = isAvailable ? '' : ' disabled';
            const disabledAttr = isAvailable ? '' : ' data-disabled="true"';
            return '<div class="year-option' + disabledClass + '" data-year="' + year + '"' + disabledAttr + '>' + year + '</div>';
        }).join('');
        document.body.appendChild(mobileYearDropdown);
        allDropdowns.push(mobileYearDropdown);
        
        mobileYearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = mobileYearDropdown.style.display === 'block';
            
            // Close all other dropdowns first
            closeAllDropdowns();
            
            // Toggle this dropdown
            mobileYearDropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Position dropdown - open upwards if more space above than below
                const rect = mobileYearBtn.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                
                mobileYearDropdown.style.position = 'fixed';
                mobileYearDropdown.style.left = `${rect.left}px`;
                mobileYearDropdown.style.width = `${rect.width}px`;
                mobileYearDropdown.style.zIndex = '10000';
                
                // Estimate dropdown height (8 options * ~30px + padding)
                const estimatedHeight = 250;
                
                if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
                    // Open upwards
                    mobileYearDropdown.style.bottom = `${window.innerHeight - rect.top + 5}px`;
                    mobileYearDropdown.style.top = 'auto';
                } else {
                    // Open downwards
                    mobileYearDropdown.style.top = `${rect.bottom + 5}px`;
                    mobileYearDropdown.style.bottom = 'auto';
                }
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!mobileYearBtn.contains(e.target) && !mobileYearDropdown.contains(e.target)) {
                closeAllDropdowns();
            }
        });
        
        // Handle year selection
        mobileYearDropdown.addEventListener('click', (e) => {
            if (e.target.classList.contains('year-option') && !e.target.classList.contains('disabled')) {
                const year = e.target.getAttribute('data-year');
                if (availableYears.includes(year)) {
                    currentCompositeYear = year;
                    mobileYearBtn.textContent = year;
                    mobileYearDropdown.style.display = 'none';
                    
                    // Update desktop year selector if it exists
                    const yearSelector = document.getElementById('year-selector');
                    if (yearSelector) {
                        yearSelector.textContent = year;
                    }
                    
                    // Reload layer with new year
                    loadPredictedLayer(year, currentCompositeMonth, currentPollutant);
                }
            }
        });
    }
    
    // Set up year selector button
    const yearSelector = document.getElementById('year-selector');
    if (yearSelector) {
        // Create year dropdown menu
        const yearDropdown = document.createElement('div');
        yearDropdown.className = 'year-dropdown';
        yearDropdown.style.display = 'none';
        // Generate year options with strikethrough for unavailable years
        yearDropdown.innerHTML = allYears.map(year => {
            const isAvailable = availableYears.includes(year);
            const disabledClass = isAvailable ? '' : ' disabled';
            const disabledAttr = isAvailable ? '' : ' data-disabled="true"';
            return '<div class="year-option' + disabledClass + '" data-year="' + year + '"' + disabledAttr + '>' + year + '</div>';
        }).join('');
        document.body.appendChild(yearDropdown);
        allDropdowns.push(yearDropdown);
        
        yearSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = yearDropdown.style.display === 'block';
            
            // Close all other dropdowns first
            closeAllDropdowns();
            
            // Toggle this dropdown
            yearDropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Position dropdown - open upwards if more space above than below
                const rect = yearSelector.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                
                yearDropdown.style.position = 'fixed';
                yearDropdown.style.left = `${rect.left}px`;
                yearDropdown.style.width = `${rect.width}px`;
                yearDropdown.style.zIndex = '10000';
                
                // Estimate dropdown height (8 options * ~30px + padding)
                const estimatedHeight = 250;
                
                if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
                    // Open upwards
                    yearDropdown.style.bottom = `${window.innerHeight - rect.top + 5}px`;
                    yearDropdown.style.top = 'auto';
                } else {
                    // Open downwards
                    yearDropdown.style.top = `${rect.bottom + 5}px`;
                    yearDropdown.style.bottom = 'auto';
                }
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!yearSelector.contains(e.target) && !yearDropdown.contains(e.target)) {
                closeAllDropdowns();
            }
        });
        
        // Handle year selection
        yearDropdown.addEventListener('click', (e) => {
            if (e.target.classList.contains('year-option') && !e.target.classList.contains('disabled')) {
                const year = e.target.getAttribute('data-year');
                if (availableYears.includes(year)) {
                    currentCompositeYear = year;
                    yearSelector.textContent = year;
                    yearDropdown.style.display = 'none';
                    
                    // Update mobile year button if it exists
                    const mobileYearBtn = document.getElementById('mobile-year-btn');
                    if (mobileYearBtn) {
                        mobileYearBtn.textContent = year;
                    }
                    
                    // Update sliders - keep max at 12 (all months)
                    const monthSlider = document.getElementById('month-slider');
                    const mobileMonthSlider = document.getElementById('mobile-month-slider');
                    
                    // If current month is not available, reset to first available
                    if (availableMonths[year] && !availableMonths[year].includes(currentCompositeMonth)) {
                        currentCompositeMonth = availableMonths[year][0];
                        const firstMonthNum = parseInt(currentCompositeMonth);
                        
                        if (monthSlider) {
                            monthSlider.value = firstMonthNum;
                        }
                        if (mobileMonthSlider) {
                            mobileMonthSlider.value = firstMonthNum;
                        }
                    } else {
                        // Sync both sliders with current month
                        const currentMonthNum = parseInt(currentCompositeMonth);
                        if (monthSlider) {
                            monthSlider.value = currentMonthNum;
                        }
                        if (mobileMonthSlider) {
                            mobileMonthSlider.value = currentMonthNum;
                        }
                    }
                    
                    // Reload current month with new year
                    loadPredictedLayer(year, currentCompositeMonth, currentPollutant);
                }
            }
        });
    }
    
    // Set up month slider (desktop)
    const monthSlider = document.getElementById('month-slider');
    const monthDisplay = document.getElementById('month-display');
    
    // Set up mobile month slider
    const mobileMonthSlider = document.getElementById('mobile-month-slider');
    
    // Function to handle month change
    function handleMonthChange(monthNum, sourceSlider) {
        // CTRL mode: slider controls opacity 0-100%
        if (currentPollutant === 'CTRL') {
            const opacity = Math.max(0, Math.min(100, monthNum));
            // Sync both sliders
            if (monthSlider && sourceSlider !== monthSlider) {
                monthSlider.value = opacity;
            }
            if (mobileMonthSlider && sourceSlider !== mobileMonthSlider) {
                mobileMonthSlider.value = opacity;
            }
            setCurrentLayerOpacity(opacity / 100);
            return;
        }

        // Normal mode: month selection
        const monthStr = String(monthNum).padStart(2, '0');
        
        // Sync both sliders
        if (monthSlider && sourceSlider !== monthSlider) {
            monthSlider.value = monthNum;
        }
        if (mobileMonthSlider && sourceSlider !== mobileMonthSlider) {
            mobileMonthSlider.value = monthNum;
        }
        
        // If layers are already preloaded for this pollutant, just switch visibility (instant)
        if (loadedPollutant === currentPollutant && loadedYear === currentCompositeYear) {
            showMonth(monthNum);
        } else {
            // Otherwise load the predicted layer (will preload all months)
            loadPredictedLayer(currentCompositeYear, monthStr, currentPollutant);
        }
    }
    
    if (monthSlider) {
        // Set max to 12 (all months) - slider can slide through all months
        monthSlider.max = 12;
        monthSlider.min = 1;
        monthSlider.step = 1;
        
        // Update when slider changes
        monthSlider.addEventListener('input', (e) => {
            const monthNum = parseInt(e.target.value);
            handleMonthChange(monthNum, monthSlider);
        });
    }
    
    if (mobileMonthSlider) {
        // Set max to 12 (all months) - slider can slide through all months
        mobileMonthSlider.max = 12;
        mobileMonthSlider.min = 1;
        mobileMonthSlider.step = 1;
        
        // Sync initial value with desktop slider
        if (monthSlider) {
            mobileMonthSlider.value = monthSlider.value;
        }
        
        // Update when slider changes
        mobileMonthSlider.addEventListener('input', (e) => {
            const monthNum = parseInt(e.target.value);
            handleMonthChange(monthNum, mobileMonthSlider);
        });
    }
}

// Track which pollutant's layers are currently loaded
let loadedPollutant = null;
let loadedYear = null;
// Track current opacity (shared across modes) - default 90%
let ctrlOpacity = 0.9;

// Preload all 12 months for a pollutant (makes month switching instant)
async function preloadPollutantLayers(year, pollutant) {
    // If we're in CTRL mode, do not preload
    if (pollutant === 'CTRL') return;

    // If already loaded for this pollutant and year, skip
    if (loadedPollutant === pollutant && loadedYear === year) {
        console.log(`📦 Layers already preloaded for ${pollutant} ${year}`);
        return;
    }
    
    // Remove all existing predicted layers
    for (let m = 1; m <= 12; m++) {
        const monthStr = String(m).padStart(2, '0');
        const layerId = `predicted-layer-${monthStr}`;
        const sourceId = `predicted-source-${monthStr}`;
        
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
        }
    }
    
    // If pollutant is N/A, don't load any layers
    if (pollutant === 'N/A') {
        console.log(`📅 No pollutant layer - showing basemap only`);
        loadedPollutant = pollutant;
        loadedYear = year;
        return;
    }
    
    console.log(`📦 Preloading all 12 months for ${pollutant} ${year}...`);
    
    // Format pollutant name for folder/filename (PM2.5 becomes PM2_5)
    const pollutantFolder = pollutant.replace('.', '_');
    const pollutantFileName = pollutant.replace('.', '_');
    
    // Load bounds once (same for all months)
    const boundsPath = `map/predicted/${year}/${pollutantFileName}_month01_bounds.geojson`;
    let boundsCoords = null;
    
    try {
        const boundsResponse = await fetch(boundsPath);
        if (boundsResponse.ok) {
            const boundsData = await boundsResponse.json();
            const coordinates = boundsData.features[0].geometry.coordinates[0];
            boundsCoords = [
                coordinates[0], // top-left
                coordinates[1], // top-right
                coordinates[2], // bottom-right
                coordinates[3]  // bottom-left
            ];
        }
    } catch (error) {
        console.error('Failed to load bounds:', error);
        return;
    }
    
    if (!boundsCoords) {
        console.error('Could not load bounds for', pollutant);
        return;
    }
    
    // Preload all 12 months
    for (let m = 1; m <= 12; m++) {
        const monthStr = String(m).padStart(2, '0');
        const pngPath = `map/predicted/${year}/${pollutantFileName}_month${monthStr}_inferno.png`;
        const sourceId = `predicted-source-${monthStr}`;
        const layerId = `predicted-layer-${monthStr}`;
        
        try {
            // Add image source
            map.addSource(sourceId, {
                type: 'image',
                url: pngPath,
                coordinates: boundsCoords
            });
            
            // Add layer (hidden by default)
            map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: {
                    'raster-opacity': 0 // Start hidden
                }
            });
            
            console.log(`  ✓ Month ${monthStr} loaded`);
        } catch (error) {
            console.error(`  ✗ Month ${monthStr} failed:`, error);
        }
    }
    
    loadedPollutant = pollutant;
    loadedYear = year;
    console.log(`📦 Preloading complete for ${pollutant} ${year}`);
}

// Show only the selected month's layer (instant switching)
function showMonth(month) {
    const monthStr = String(month).padStart(2, '0');
    
    // Hide all months, show only the selected one
    for (let m = 1; m <= 12; m++) {
        const mStr = String(m).padStart(2, '0');
        const layerId = `predicted-layer-${mStr}`;
        
        if (map.getLayer(layerId)) {
            const opacity = (mStr === monthStr) ? ctrlOpacity : 0;
            map.setPaintProperty(layerId, 'raster-opacity', opacity);
        }
    }
    
    currentCompositeMonth = monthStr;
    console.log(`📅 Showing month ${monthStr}`);
}

// Set opacity for the currently visible month layer
function setCurrentLayerOpacity(opacity) {
    ctrlOpacity = Math.max(0, Math.min(1, opacity));
    const layerId = `predicted-layer-${currentCompositeMonth}`;
    if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'raster-opacity', ctrlOpacity);
    }
}

// Load authors/acknowledgements content from external HTML
function loadAuthorsContent() {
    fetch('texts/authors.html')
        .then(resp => resp.text())
        .then(html => {
            const desktop = document.getElementById('authors-slide');
            const mobile = document.getElementById('authors-mobile');
            if (desktop) desktop.innerHTML = html;
            if (mobile) mobile.innerHTML = html;
        })
        .catch(err => console.error('Failed to load authors content:', err));
}

// Load per-slide HTML snippets into desktop and mobile carousels
function loadSlideHTML() {
    const sections = [
        { path: 'texts/introduction.html', targets: ['slide-introduction', 'mobile-slide-introduction'] },
        { path: 'texts/data-collection.html', targets: ['slide-data-collection', 'mobile-slide-data-collection'] },
        { path: 'texts/model.html', targets: ['slide-model', 'mobile-slide-model'] },
        { path: 'texts/results.html', targets: ['slide-results', 'mobile-slide-results'] }
    ];

    sections.forEach(section => {
        fetch(section.path)
            .then(resp => resp.text())
            .then(html => {
                section.targets.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.innerHTML = html;
                });
            })
            .catch(err => console.error(`Failed to load ${section.path}:`, err));
    });
}

// Load references content into the info popup
function loadReferencesContent() {
    fetch('texts/references.html')
        .then(resp => resp.text())
        .then(html => {
            const container = document.getElementById('references-content');
            if (container) container.innerHTML = html;
        })
        .catch(err => console.error('Failed to load references content:', err));
}

// Enable collapse/expand for the desktop explanation widget
function initExplanationCollapse() {
    const widget = document.querySelector('.explanation-widget');
    const btn = document.getElementById('explanation-collapse');
    const collapsedButtons = document.querySelectorAll('.collapsed-title-btn');
    if (!widget || !btn) return;
    btn.addEventListener('click', () => {
        widget.classList.toggle('collapsed');
        btn.textContent = widget.classList.contains('collapsed') ? '›' : '‹';
    });

    // Clicking a collapsed title should expand and jump to that slide
    collapsedButtons.forEach((cbtn) => {
        cbtn.addEventListener('click', () => {
            const slideIdx = parseInt(cbtn.getAttribute('data-slide'), 10);
            // expand
            widget.classList.remove('collapsed');
            btn.textContent = '‹';
            // trigger desktop indicator click if exists
            const indicators = document.querySelectorAll('.indicator');
            if (indicators && indicators[slideIdx]) {
                indicators[slideIdx].click();
            }
        });
    });
}

// Load predicted layer - preloads all months then shows selected
async function loadPredictedLayer(year, month, pollutant, sliderLabelState = {}) {
    currentCompositeYear = year;
    currentCompositeMonth = month;
    currentPollutant = pollutant;
    
    // Update color bar legend
    updateColorBar(pollutant);

    // Helper to switch slider to opacity mode
    function setSliderToOpacityMode() {
        const monthSlider = document.getElementById('month-slider');
        const mobileMonthSlider = document.getElementById('mobile-month-slider');
        const monthLabels = document.querySelector('.month-slider-labels');
        const mobileMonthLabels = document.querySelector('.mobile-month-slider-labels');

        if (monthSlider) {
            monthSlider.min = 0;
            monthSlider.max = 100;
            monthSlider.step = 1;
            monthSlider.value = Math.round(ctrlOpacity * 100);
        }
        if (mobileMonthSlider) {
            mobileMonthSlider.min = 0;
            mobileMonthSlider.max = 100;
            mobileMonthSlider.step = 1;
            mobileMonthSlider.value = Math.round(ctrlOpacity * 100);
        }
        // Replace labels with simple opacity ticks
        if (monthLabels) {
            monthLabels.innerHTML = '<span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>';
        }
        if (mobileMonthLabels) {
            mobileMonthLabels.innerHTML = '<span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>';
        }
    }

    // Helper to switch slider back to month mode
    function setSliderToMonthMode() {
        const monthSlider = document.getElementById('month-slider');
        const mobileMonthSlider = document.getElementById('mobile-month-slider');
        const monthLabels = document.querySelector('.month-slider-labels');
        const mobileMonthLabels = document.querySelector('.mobile-month-slider-labels');

        if (monthSlider) {
            monthSlider.min = 1;
            monthSlider.max = 12;
            monthSlider.step = 1;
            monthSlider.value = parseInt(currentCompositeMonth || '1');
        }
        if (mobileMonthSlider) {
            mobileMonthSlider.min = 1;
            mobileMonthSlider.max = 12;
            mobileMonthSlider.step = 1;
            mobileMonthSlider.value = parseInt(currentCompositeMonth || '1');
        }
        if (sliderLabelState.originalMonthLabelsHTML && monthLabels) {
            monthLabels.innerHTML = sliderLabelState.originalMonthLabelsHTML;
        }
        if (sliderLabelState.originalMobileMonthLabelsHTML && mobileMonthLabels) {
            mobileMonthLabels.innerHTML = sliderLabelState.originalMobileMonthLabelsHTML;
        }
    }

    // CTRL mode: slider becomes opacity control; do not reload layers
    if (pollutant === 'CTRL') {
        setSliderToOpacityMode();
        // Ensure currently visible layer is at 100% opacity initially
        setCurrentLayerOpacity(ctrlOpacity);
        return;
    } else {
        // Restore month slider configuration when leaving CTRL
        setSliderToMonthMode();
        // Re-apply stored opacity when returning to normal mode
        setCurrentLayerOpacity(ctrlOpacity);
    }
    
    // Preload all months for this pollutant (if not already loaded)
    await preloadPollutantLayers(year, pollutant);
    
    // Show the selected month
    showMonth(month);
}

// Legacy function for backward compatibility
async function loadCompositeLayer(year, month) {
    loadPredictedLayer(year, month, currentPollutant);
}

// Load PNG Raster layer with bounds JSON (recommended method)
// This is faster and more reliable than loading GeoTIFF directly
async function loadPNGRasterLayer(pngPath, boundsPath, sourceId = 'png-raster-source', layerId = 'png-raster-layer') {
    try {
        console.log('📖 Loading PNG raster:', pngPath);
        
        // Load bounds JSON file
        const boundsResponse = await fetch(boundsPath);
        if (!boundsResponse.ok) {
            console.log(`⚠️ Bounds file not found at ${boundsPath}, skipping...`);
            return;
        }
        
        const boundsData = await boundsResponse.json();
        const geometry = boundsData.features[0].geometry;
        const coordinates = geometry.coordinates[0];
        
        // Extract corner coordinates [lng, lat]
        // Assuming coordinates are: [top-left, top-right, bottom-right, bottom-left, top-left (closing)]
        const topLeft = coordinates[0];
        const topRight = coordinates[1];
        const bottomRight = coordinates[2];
        const bottomLeft = coordinates[3];
        
        console.log('📍 Bounds coordinates:', {
            topLeft,
            topRight,
            bottomRight,
            bottomLeft,
            crs: boundsData.features[0].properties?.target_crs || 'unknown'
        });
        
        // Log the image center for debugging
        const centerLng = (topLeft[0] + bottomRight[0]) / 2;
        const centerLat = (topLeft[1] + bottomRight[1]) / 2;
        console.log(`📍 Image center: [${centerLng}, ${centerLat}]`);
        console.log(`📍 Image size: ${Math.abs(topRight[0] - topLeft[0])}° longitude x ${Math.abs(topLeft[1] - bottomLeft[1])}° latitude`);
        
        // Remove existing source/layer if present (only if using default IDs)
        if (sourceId === 'png-raster-source' && map.getSource('png-raster-source')) {
            map.removeSource('png-raster-source');
        }
        if (layerId === 'png-raster-layer' && map.getLayer('png-raster-layer')) {
            map.removeLayer('png-raster-layer');
        }
        
        console.log('📤 Adding image source with coordinates:', {
            topLeft,
            topRight,
            bottomRight,
            bottomLeft
        });
        
        // Add image source with 4 corner coordinates
        try {
            map.addSource(sourceId, {
                type: 'image',
                url: pngPath,
                coordinates: [
                    topLeft,     // top-left [lng, lat]
                    topRight,    // top-right [lng, lat]
                    bottomRight, // bottom-right [lng, lat]
                    bottomLeft   // bottom-left [lng, lat]
                ]
            });
            console.log(`✅ Image source added: ${sourceId}`);
        } catch (error) {
            console.error('❌ Error adding image source:', error);
            return;
        }
        
        // Add raster layer with RGB channels - add it ON TOP of everything
        try {
            map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: {
                    'raster-opacity': 1.0, // Full opacity to see the image clearly
                    'raster-resampling': 'nearest' // Use nearest neighbor to preserve raw pixels, no interpolation/blurring
                }
            });
            console.log(`✅ PNG raster layer added to map: ${layerId}`);
            
            // Move layer to top to ensure it's visible
            if (map.getLayer('png-raster-layer')) {
                // Try to move it to the top
                const layers = map.getStyle().layers;
                const topLayer = layers[layers.length - 1].id;
                if (topLayer !== 'png-raster-layer') {
                    map.moveLayer('png-raster-layer');
                    console.log('✅ Moved layer to top');
                }
            }
        } catch (error) {
            console.error('❌ Error adding raster layer:', error);
            return;
        }
        
        console.log('📍 Image bounds:', {
            topLeft: topLeft,
            bottomRight: bottomRight,
            center: [(topLeft[0] + bottomRight[0]) / 2, (topLeft[1] + bottomRight[1]) / 2]
        });
        
        // Verify the layer was added
        if (map.getLayer('png-raster-layer')) {
            console.log('✅ Layer verified in map');
        } else {
            console.error('❌ Layer not found in map after adding!');
        }
        
    } catch (error) {
        console.error('❌ Error loading PNG raster:', error);
        console.log('PNG raster data not available:', error.message);
    }
}

// Load RGB Raster layer (PNG with bounds JSON)
// To use this:
// 1. Prepare your RGB image (PNG format) with 3 channels (Red, Green, Blue)
// 2. Create a bounds JSON file with corner coordinates
// 3. Place files in data/ folder (e.g., data/rgb_data.png and data/rgb_data_bounds.json)
// 4. Update the file paths below
async function loadRGBRaster() {
    try {
        // Load bounds JSON file - UPDATE THIS PATH
        const boundsResponse = await fetch('data/rgb_data_bounds.json');
        if (!boundsResponse.ok) {
            console.log('RGB raster data not found, skipping...');
            return;
        }
        
        const boundsData = await boundsResponse.json();
        const coordinates = boundsData.geometry.coordinates[0];
        
        // Extract corner coordinates [lng, lat]
        const topLeft = coordinates[0];
        const topRight = coordinates[1];
        const bottomRight = coordinates[2];
        const bottomLeft = coordinates[3];
        
        // Add image source with 4 corner coordinates - UPDATE THIS PATH
        map.addSource('rgb-raster', {
            type: 'image',
            url: 'data/rgb_data.png', // UPDATE: Path to your RGB image
            coordinates: [
                topLeft,     // top-left [lng, lat]
                topRight,    // top-right [lng, lat]
                bottomRight, // bottom-right [lng, lat]
                bottomLeft   // bottom-left [lng, lat]
            ]
        });
        
        // Add raster layer with RGB channels
        map.addLayer({
            id: 'rgb-raster-layer',
            type: 'raster',
            source: 'rgb-raster',
            paint: {
                'raster-opacity': 0.8, // Adjust opacity as needed
                'raster-resampling': 'linear' // Use linear resampling for better quality
            }
        }, 'satellite-layer'); // Add above satellite layer
        
        console.log('✅ RGB raster layer loaded successfully');
        
    } catch (error) {
        console.log('RGB raster data not available:', error.message);
    }
}

// GeoTIFF loading is now handled in geotiff-loader.js

// Load ALOS PALSAR raster layer (PNG with bounds JSON)
// To use this: 
// 1. Run data_processing/export_for_webmap.py to create PNG and bounds JSON
// 2. Place files in data/ folder
// 3. This function will automatically load them
async function loadALOSRaster() {
    try {
        // Load bounds JSON file
        const boundsResponse = await fetch('data/alos_palsar_kufra_basin_bounds.json');
        if (!boundsResponse.ok) {
            console.log('ALOS PALSAR data not found, skipping...');
            return;
        }
        
        const boundsData = await boundsResponse.json();
        const coordinates = boundsData.geometry.coordinates[0];
        
        // Extract corner coordinates [lng, lat]
        const topLeft = coordinates[0];
        const topRight = coordinates[1];
        const bottomRight = coordinates[2];
        const bottomLeft = coordinates[3];
        
        // Add image source with 4 corner coordinates
        map.addSource('alos-palsar', {
            type: 'image',
            url: 'data/alos_palsar_kufra_basin.png',
            coordinates: [
                topLeft,     // top-left [lng, lat]
                topRight,    // top-right [lng, lat]
                bottomRight, // bottom-right [lng, lat]
                bottomLeft   // bottom-left [lng, lat]
            ]
        });
        
        // Add raster layer
        map.addLayer({
            id: 'alos-palsar-layer',
            type: 'raster',
            source: 'alos-palsar',
            paint: {
                'raster-opacity': 0.7
            }
        }); // Add raster layer
        
        console.log('✅ ALOS PALSAR layer loaded successfully');
        
    } catch (error) {
        console.log('ALOS PALSAR data not available:', error.message);
    }
}

// Transform coordinates from Web Mercator (EPSG:3857) to WGS84 (EPSG:4326)
function transformGeoJSON(geoJson) {
    // Check if coordinates are already in WGS84 (between -180 and 180 for longitude)
    const firstCoord = geoJson.features[0].geometry.coordinates[0][0][0];
    
    // If coordinates are in Web Mercator (large numbers), transform them
    if (Math.abs(firstCoord[0]) > 180 || Math.abs(firstCoord[1]) > 90) {
        return transformCoordinates(geoJson);
    }
    
    return geoJson;
}

// Transform Web Mercator to WGS84
function transformCoordinates(geoJson) {
    const transformed = JSON.parse(JSON.stringify(geoJson));
    
    function transformPoint(coord) {
        const x = coord[0];
        const y = coord[1];
        const lng = (x / 20037508.34) * 180;
        let lat = (y / 20037508.34) * 180;
        lat = (Math.atan(Math.exp((lat * Math.PI) / 180)) * 360) / Math.PI - 90;
        return [lng, lat];
    }
    
    function transformCoordinatesRecursive(coords) {
        if (typeof coords[0] === 'number') {
            return transformPoint(coords);
        }
        return coords.map(transformCoordinatesRecursive);
    }
    
    transformed.features.forEach(feature => {
        if (feature.geometry.type === 'MultiPolygon') {
            feature.geometry.coordinates = feature.geometry.coordinates.map(polygon =>
                polygon.map(ring => ring.map(transformCoordinatesRecursive))
            );
        } else if (feature.geometry.type === 'Polygon') {
            feature.geometry.coordinates = feature.geometry.coordinates.map(ring =>
                ring.map(transformCoordinatesRecursive)
            );
        }
    });
    
    return transformed;
}

// Fit map bounds to show the Sahara desert
function fitSaharaBounds(geoJson) {
    const bounds = new maplibregl.LngLatBounds();
    
    geoJson.features.forEach(feature => {
        if (feature.geometry.type === 'MultiPolygon') {
            feature.geometry.coordinates.forEach(polygon => {
                polygon.forEach(ring => {
                    ring.forEach(coord => {
                        bounds.extend(coord);
                    });
                });
            });
        } else if (feature.geometry.type === 'Polygon') {
            feature.geometry.coordinates.forEach(ring => {
                ring.forEach(coord => {
                    bounds.extend(coord);
                });
            });
        }
    });
    
    map.fitBounds(bounds, {
        padding: { top: 50, bottom: 50, left: 360, right: 50 }, // Extra left padding for widgets
        duration: 2000,
        maxZoom: 5
    });
}

// Point in polygon check
function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = ((yi > point[1]) !== (yj > point[1])) &&
            (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Check if point is inside any Sahara polygon
function isPointInSahara(lng, lat, saharaGeoJSON) {
    const point = [lng, lat];
    
    for (const feature of saharaGeoJSON.features) {
        if (feature.geometry.type === 'MultiPolygon') {
            for (const polygon of feature.geometry.coordinates) {
                // Check outer ring (first ring)
                if (polygon.length > 0 && pointInPolygon(point, polygon[0])) {
                    return true;
                }
            }
        } else if (feature.geometry.type === 'Polygon') {
            // Check outer ring (first ring)
            if (feature.geometry.coordinates.length > 0 && 
                pointInPolygon(point, feature.geometry.coordinates[0])) {
                return true;
            }
        }
    }
    return false;
}

// Setup event handlers
function setupEventHandlers() {
    // Click handler for entire map - check if clicking inside Sahara
    map.on('click', (e) => {
        const source = map.getSource('sahara-source');
        if (source && source._data) {
            const isInside = isPointInSahara(e.lngLat.lng, e.lngLat.lat, source._data);
            
            // No action on click - widget removed
        }
    });
    
    
    // References button removed
    
    // Close popup handlers
    const popup = document.getElementById('image-popup');
    const popupClose = popup.querySelector('.popup-close');
    const popupOverlay = popup.querySelector('.popup-overlay');
    
    popupClose.addEventListener('click', () => {
        hideImagePopup();
    });
    
    popupOverlay.addEventListener('click', () => {
        hideImagePopup();
    });
    
    // Close popup on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !popup.classList.contains('hidden')) {
            hideImagePopup();
        }
    });
    
}

// Mobile Toggle Functionality - Opens Info Popup
function initMobileToggle() {
    const toggleBtn = document.getElementById('mobile-toggle');
    const infoPopup = document.getElementById('info-popup');
    const popupClose = document.querySelector('.info-popup-close');
    const popupOverlay = document.querySelector('.info-popup-overlay');
    
    if (!toggleBtn || !infoPopup) return; // Only run if elements exist
    
    // Open popup when button is clicked
    toggleBtn.addEventListener('click', () => {
        showInfoPopup();
    });
    
    // Close popup handlers
    if (popupClose) {
        popupClose.addEventListener('click', () => {
            hideInfoPopup();
        });
    }
    
    if (popupOverlay) {
        popupOverlay.addEventListener('click', () => {
            hideInfoPopup();
        });
    }
    
    // Close popup on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !infoPopup.classList.contains('hidden')) {
            hideInfoPopup();
        }
    });
}

// Mobile Tab Switcher Functionality
function initMobileTabSwitcher() {
    const tabSwitcher = document.querySelector('.mobile-tab-switcher');
    const infoPanel = document.getElementById('mobile-info-panel');
    if (!tabSwitcher) return; // Only run if element exists
    
    const tabs = document.querySelectorAll('.mobile-tab');
    const indicator = document.querySelector('.mobile-tab-indicator');
    const monthSelector = document.querySelector('.mobile-month-selector');
    const colorbar = document.getElementById('mobile-colorbar');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const tabName = tab.getAttribute('data-tab');
            
            // Update active state
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Move indicator
            if (indicator) {
                const tabIndex = Array.from(tabs).indexOf(tab);
                indicator.style.transform = `translateX(${tabIndex * 100}%)`;
            }
            
            // Toggle info panel and month selector
            if (tabName === 'info') {
                // Show info panel, hide month selector
                if (infoPanel) {
                    infoPanel.classList.add('visible');
                }
                if (monthSelector) {
                    monthSelector.style.display = 'none';
                }
                if (colorbar) {
                    colorbar.style.display = 'none';
                }
                tabSwitcher.classList.add('info-active');
            } else {
                // Hide info panel, show month selector
                if (infoPanel) {
                    infoPanel.classList.remove('visible');
                }
                if (monthSelector) {
                    monthSelector.style.display = 'block';
                }
                if (colorbar) {
                    colorbar.style.display = 'flex';
                }
                tabSwitcher.classList.remove('info-active');
            }
        });
    });
}

// Mobile Info Carousel functionality
function initMobileInfoCarousel() {
    const infoPanel = document.getElementById('mobile-info-panel');
    if (!infoPanel) return;
    
    const content = infoPanel.querySelector('.mobile-info-panel-content');
    const container = infoPanel.querySelector('.mobile-info-carousel-container');
    const indicators = infoPanel.querySelectorAll('.mobile-info-indicator');
    const slides = infoPanel.querySelectorAll('.mobile-info-slide');
    
    if (!content || !container || !indicators.length || !slides.length) return;
    
    let currentSlide = 0;
    const totalSlides = slides.length;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    let isDragging = false;
    let isHorizontalSwipe = null;
    
    // Touch events on the entire content area for better swipe detection
    content.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchEndX = touchStartX;
        touchEndY = touchStartY;
        isDragging = true;
        isHorizontalSwipe = null;
    }, { passive: true });
    
    content.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        
        touchEndX = e.touches[0].clientX;
        touchEndY = e.touches[0].clientY;
        
        // Determine if this is a horizontal or vertical swipe
        if (isHorizontalSwipe === null) {
            const diffX = Math.abs(touchEndX - touchStartX);
            const diffY = Math.abs(touchEndY - touchStartY);
            if (diffX > 10 || diffY > 10) {
                isHorizontalSwipe = diffX > diffY;
            }
        }
    }, { passive: true });
    
    content.addEventListener('touchend', () => {
        if (isDragging && isHorizontalSwipe) {
            handleSwipe();
        }
        isDragging = false;
        isHorizontalSwipe = null;
    });
    
    // Indicator click events
    indicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            goToSlide(index);
        });
    });
    
    function handleSwipe() {
        const swipeThreshold = 40;
        const diff = touchStartX - touchEndX;
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swipe left - next slide
                nextSlide('left');
            } else {
                // Swipe right - previous slide
                prevSlide('right');
            }
        }
    }
    
    function goToSlide(index, direction = null) {
        if (index < 0 || index >= totalSlides) return;
        
        const oldSlide = currentSlide;
        currentSlide = index;
        updateCarousel(direction || (index > oldSlide ? 'left' : 'right'));
    }
    
    function nextSlide(direction = 'left') {
        currentSlide = (currentSlide + 1) % totalSlides;
        updateCarousel(direction);
    }
    
    function prevSlide(direction = 'right') {
        currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
        updateCarousel(direction);
    }
    
    function updateCarousel(direction = null) {
        // Update slides with animation
        slides.forEach((slide, index) => {
            slide.classList.remove('active', 'slide-left', 'slide-right');
            
            if (index === currentSlide) {
                slide.classList.add('active');
                if (direction) {
                    slide.classList.add(direction === 'left' ? 'slide-from-right' : 'slide-from-left');
                    // Remove animation class after animation completes
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            slide.classList.remove('slide-from-right', 'slide-from-left');
                        });
                    });
                }
            }
        });
        
        // Update indicators
        indicators.forEach((indicator, index) => {
            if (index === currentSlide) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        });
    }
    
    // Initialize
    updateCarousel();
}

function showInfoPopup() {
    const infoPopup = document.getElementById('info-popup');
    if (infoPopup) {
        infoPopup.classList.remove('hidden');
        // Prevent body scroll when popup is open
        document.body.style.overflow = 'hidden';
    }
}

function hideInfoPopup() {
    const infoPopup = document.getElementById('info-popup');
    if (infoPopup) {
        infoPopup.classList.add('hidden');
        // Restore body scroll
        document.body.style.overflow = '';
    }
}

// Show image popup
function showImagePopup() {
    const popup = document.getElementById('image-popup');
    popup.classList.remove('hidden');
}

// Hide image popup
function hideImagePopup() {
    const popup = document.getElementById('image-popup');
    popup.classList.add('hidden');
}

// Display feature information in floating widget
function displayFeatureInfo(feature) {
    const infoDiv = document.getElementById('feature-info');
    const contentDiv = document.getElementById('feature-content');
    
    const props = feature.properties;
    let html = '';
    
    if (props.NAME) {
        html += `<p><strong>Name:</strong> ${props.NAME}</p>`;
    }
    if (props.NAME_EN) {
        html += `<p><strong>English Name:</strong> ${props.NAME_EN}</p>`;
    }
    if (props.REGION) {
        html += `<p><strong>Region:</strong> ${props.REGION}</p>`;
    }
    if (props.LABEL) {
        html += `<p><strong>Label:</strong> ${props.LABEL}</p>`;
    }
    if (props.FEATURECLA) {
        html += `<p><strong>Feature Class:</strong> ${props.FEATURECLA}</p>`;
    }
    
    contentDiv.innerHTML = html;
    infoDiv.classList.remove('hidden');
}

// Hide feature information
function hideFeatureInfo() {
    document.getElementById('feature-info').classList.add('hidden');
}

// SVG icons for base map switcher
const satelliteIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.34 6.34l1.41 1.41M16.24 16.24l1.41 1.41M6.34 17.66l1.41-1.41M16.24 7.76l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
</svg>`;

const osmIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="7" height="7" stroke="currentColor" stroke-width="2" fill="none"/>
    <rect x="14" y="3" width="7" height="7" stroke="currentColor" stroke-width="2" fill="none"/>
    <rect x="3" y="14" width="7" height="7" stroke="currentColor" stroke-width="2" fill="none"/>
    <rect x="14" y="14" width="7" height="7" stroke="currentColor" stroke-width="2" fill="none"/>
    <line x1="6.5" y1="3" x2="6.5" y2="10" stroke="currentColor" stroke-width="1.5"/>
    <line x1="3" y1="6.5" x2="10" y2="6.5" stroke="currentColor" stroke-width="1.5"/>
    <line x1="17.5" y1="3" x2="17.5" y2="10" stroke="currentColor" stroke-width="1.5"/>
    <line x1="14" y1="6.5" x2="21" y2="6.5" stroke="currentColor" stroke-width="1.5"/>
    <line x1="6.5" y1="14" x2="6.5" y2="21" stroke="currentColor" stroke-width="1.5"/>
    <line x1="3" y1="17.5" x2="10" y2="17.5" stroke="currentColor" stroke-width="1.5"/>
    <line x1="17.5" y1="14" x2="17.5" y2="21" stroke="currentColor" stroke-width="1.5"/>
    <line x1="14" y1="17.5" x2="21" y2="17.5" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// Custom base map switcher control
function addBaseMapSwitcher() {
    const BaseMapSwitcher = function(options) {
        this.currentMap = 'satellite'; // Default to satellite
    };
    
    BaseMapSwitcher.prototype.onAdd = function(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group base-map-switcher';
        
        const button = document.createElement('button');
        button.className = 'base-map-btn';
        button.innerHTML = satelliteIcon;
        button.setAttribute('aria-label', 'Switch base map');
        button.setAttribute('title', 'Switch base map');
        
        button.addEventListener('click', () => {
            if (this.currentMap === 'satellite') {
                this.currentMap = 'osm';
                button.innerHTML = osmIcon;
                switchBaseMap('osm');
            } else {
                this.currentMap = 'satellite';
                button.innerHTML = satelliteIcon;
                switchBaseMap('satellite');
            }
        });
        
        this._button = button; // Store reference
        this._container.appendChild(button);
        return this._container;
    };
    
    BaseMapSwitcher.prototype.onRemove = function() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    };
    
    map.addControl(new BaseMapSwitcher(), 'top-right');
}

// Switch base map layer
function switchBaseMap(layerType) {
    const isSatellite = layerType === 'satellite';
    
    // Remove existing base layer
    if (map.getLayer('osm-tiles-layer')) {
        map.removeLayer('osm-tiles-layer');
    }
    if (map.getLayer('satellite-layer')) {
        map.removeLayer('satellite-layer');
    }
    
    // Add new base layer
    map.addLayer({
        id: isSatellite ? 'satellite-layer' : 'osm-tiles-layer',
        type: 'raster',
        source: isSatellite ? 'satellite-tiles' : 'osm-tiles',
        minzoom: 0,
        maxzoom: 19
    });
}

// Explanation Carousel functionality
let currentSlide = 0;
let totalSlides = 5; // Introduction, Data Collection, Model, Results, Authors
let touchStartX = 0;
let touchEndX = 0;
let isDragging = false;

function initExplanationCarousel() {
    const carousel = document.querySelector('.explanation-carousel');
    const container = document.querySelector('.carousel-container');
    const indicators = document.querySelectorAll('.indicator');
    const slides = document.querySelectorAll('.carousel-slide');
    
    // Update totalSlides based on actual number of slides
    totalSlides = slides.length;
    
    // Touch events for mobile
    container.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        isDragging = true;
    }, { passive: true });
    
    container.addEventListener('touchmove', (e) => {
        if (isDragging) {
            touchEndX = e.touches[0].clientX;
        }
    }, { passive: true });
    
    container.addEventListener('touchend', () => {
        if (isDragging) {
            handleSwipe();
            isDragging = false;
        }
    });
    
    // Mouse events for desktop
    let mouseStartX = 0;
    let mouseEndX = 0;
    
    container.addEventListener('mousedown', (e) => {
        mouseStartX = e.clientX;
        isDragging = true;
        container.style.cursor = 'grabbing';
    });
    
    container.addEventListener('mousemove', (e) => {
        if (isDragging) {
            mouseEndX = e.clientX;
        }
    });
    
    container.addEventListener('mouseup', () => {
        if (isDragging) {
            touchStartX = mouseStartX;
            touchEndX = mouseEndX;
            handleSwipe();
            isDragging = false;
            container.style.cursor = 'grab';
        }
    });
    
    container.addEventListener('mouseleave', () => {
        if (isDragging) {
            isDragging = false;
            container.style.cursor = 'grab';
        }
    });
    
    container.style.cursor = 'grab';
    
    // Indicator click events
    indicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            goToSlide(index);
        });
    });
    
    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchStartX - touchEndX;
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swipe left - next slide
                nextSlide();
            } else {
                // Swipe right - previous slide
                prevSlide();
            }
        }
    }
    
    function goToSlide(index) {
        if (index < 0 || index >= totalSlides) return;
        
        currentSlide = index;
        updateCarousel();
    }
    
    function nextSlide() {
        currentSlide = (currentSlide + 1) % totalSlides;
        updateCarousel();
    }
    
    function prevSlide() {
        currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
        updateCarousel();
    }
    
    function updateCarousel() {
        // Update slides
        slides.forEach((slide, index) => {
            if (index === currentSlide) {
                slide.classList.add('active');
            } else {
                slide.classList.remove('active');
            }
        });
        
        // Update indicators
        indicators.forEach((indicator, index) => {
            if (index === currentSlide) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        });
    }
    
    // Initialize
    updateCarousel();
}

// Initialize map when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initMap();
        initMobileToggle();
        loadAuthorsContent();
        loadSlideHTML();
        loadReferencesContent();
        initExplanationCollapse();
    });
} else {
    initMap();
    initMobileToggle();
    loadAuthorsContent();
    loadSlideHTML();
    loadReferencesContent();
    initExplanationCollapse();
}

