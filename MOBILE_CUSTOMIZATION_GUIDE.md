# Mobile Customization Guide

## Current Setup
- **Breakpoint**: `@media (max-width: 768px)` - applies to screens 768px and smaller
- **Current mobile changes**: Mostly size adjustments and stacking

## Ways to Make Mobile Drastically Different

### 1. **Different Layout Structure**

#### Option A: Bottom Sheet Design (Mobile-First)
```css
@media (max-width: 768px) {
    /* Hide desktop widgets */
    .explanation-widget,
    .references-widget,
    .time-selector-widget {
        display: none;
    }
    
    /* Create bottom sheet */
    .mobile-bottom-sheet {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: #000000;
        border-radius: 20px 20px 0 0;
        max-height: 80vh;
        transform: translateY(calc(100% - 60px)); /* Show handle */
        transition: transform 0.3s ease;
    }
    
    .mobile-bottom-sheet.expanded {
        transform: translateY(0);
    }
}
```

#### Option B: Tab Navigation
```css
@media (max-width: 768px) {
    .mobile-tabs {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        display: flex;
        background: #000000;
        border-top: 1px solid rgba(255,255,255,0.2);
    }
    
    .mobile-tab {
        flex: 1;
        padding: 1rem;
        text-align: center;
        color: white;
    }
}
```

### 2. **Hide/Show Different Elements**

```css
@media (max-width: 768px) {
    /* Hide desktop-specific elements */
    .title-widget,
    .explanation-widget {
        display: none;
    }
    
    /* Show mobile-specific elements */
    .mobile-header {
        display: block;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: #000000;
        padding: 1rem;
        z-index: 2000;
    }
    
    .mobile-menu-btn {
        display: block;
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 2001;
    }
}
```

### 3. **Different Visual Style**

```css
@media (max-width: 768px) {
    /* Completely different color scheme */
    body {
        background: #1a1a1a;
    }
    
    .floating-widget {
        background: rgba(0, 0, 0, 0.95);
        backdrop-filter: blur(20px);
        border: 2px solid rgba(255, 255, 255, 0.1);
    }
    
    /* Different typography */
    h1 {
        font-size: 1.5rem;
        font-weight: 800;
        letter-spacing: -0.02em;
    }
}
```

### 4. **Different Interaction Patterns**

#### Swipe Gestures
```javascript
// In script.js - add mobile-specific handlers
if (window.innerWidth <= 768) {
    // Enable swipe gestures
    let touchStartX = 0;
    let touchEndX = 0;
    
    document.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    });
    
    document.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });
    
    function handleSwipe() {
        if (touchEndX < touchStartX - 50) {
            // Swipe left - next month
        }
        if (touchEndX > touchStartX + 50) {
            // Swipe right - previous month
        }
    }
}
```

### 5. **Mobile-Specific Components**

```html
<!-- Add to index.html -->
<div class="mobile-only">
    <div class="mobile-header">
        <h1>Air Pollution</h1>
        <button class="mobile-menu-btn">☰</button>
    </div>
    
    <div class="mobile-bottom-nav">
        <button class="nav-btn active">Map</button>
        <button class="nav-btn">Info</button>
        <button class="nav-btn">Data</button>
    </div>
</div>
```

```css
/* Hide on desktop */
.mobile-only {
    display: none;
}

@media (max-width: 768px) {
    .mobile-only {
        display: block;
    }
    
    /* Hide desktop elements */
    .desktop-only {
        display: none !important;
    }
}
```

### 6. **Different Map Controls**

```css
@media (max-width: 768px) {
    /* Move controls to different positions */
    .maplibregl-ctrl-top-right {
        top: 60px !important; /* Below mobile header */
        right: 10px !important;
    }
    
    /* Make controls larger for touch */
    .maplibregl-ctrl button {
        width: 44px;
        height: 44px;
        font-size: 20px;
    }
    
    /* Hide scale bar on mobile */
    .maplibregl-ctrl-scale {
        display: none;
    }
}
```

### 7. **Full-Screen Mobile Experience**

```css
@media (max-width: 768px) {
    /* Make map full screen */
    .map-container {
        height: 100vh;
        height: 100dvh; /* Dynamic viewport height for mobile */
    }
    
    /* Floating action button */
    .mobile-fab {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #000000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        z-index: 1000;
    }
}
```

## Implementation Strategy

### Step 1: Add Mobile Detection
```javascript
// In script.js
const isMobile = () => window.innerWidth <= 768;

// Use throughout your code
if (isMobile()) {
    // Mobile-specific behavior
}
```

### Step 2: Create Mobile-Specific HTML Structure
Add mobile-only elements in `index.html` with class `mobile-only`

### Step 3: Style Mobile Completely Differently
Use `@media (max-width: 768px)` to override desktop styles

### Step 4: Add Mobile-Specific JavaScript
Create functions that only run on mobile devices

## Example: Complete Mobile Redesign

```css
@media (max-width: 768px) {
    /* 1. Hide all desktop widgets */
    .title-widget,
    .explanation-widget,
    .references-widget {
        display: none;
    }
    
    /* 2. Create mobile header */
    .mobile-header {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(180deg, #000000 0%, transparent 100%);
        padding: 1rem;
        z-index: 2000;
    }
    
    /* 3. Bottom navigation */
    .mobile-bottom-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: #000000;
        display: flex;
        padding: 0.5rem;
        border-top: 1px solid rgba(255,255,255,0.1);
    }
    
    /* 4. Time selector as floating button */
    .time-selector-widget {
        position: fixed;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        width: 90%;
        max-width: 400px;
    }
    
    /* 5. Full-screen map */
    .map-container {
        padding-top: 60px;
        padding-bottom: 60px;
    }
}
```

## Testing Mobile View

1. **Browser DevTools**: Press F12 → Toggle device toolbar (Ctrl+Shift+M)
2. **Real Device**: Test on actual phones
3. **Responsive Breakpoints**: Test at 375px (iPhone), 768px (tablet), etc.

## Best Practices

1. **Touch Targets**: Minimum 44x44px for buttons
2. **Font Sizes**: Minimum 16px to prevent zoom on iOS
3. **Performance**: Optimize images and reduce animations on mobile
4. **Accessibility**: Ensure mobile UI is accessible with screen readers

