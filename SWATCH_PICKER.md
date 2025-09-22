# Swatch Color Picker System

## Overview

A smart color picker system that provides a clean grid-based color selection UI for Chrome/Edge desktop users while maintaining native color pickers on Safari and mobile devices.

## What's Implemented

### Components Created
- **`/src/components/SwatchPicker.tsx`** - Core swatch grid component with 24 curated colors
- **`/src/components/ColorField.tsx`** - Smart wrapper that switches between swatch grid and native picker
- **`/src/hooks/useChromiumDesktopSwatch.ts`** - Browser detection logic
- **CSS in `/src/index.css`** - Styling to hide disclosure triangles

### Smart Behavior
- **Chrome/Edge Desktop**: Shows beautiful 8×3 color swatch grid
- **Safari macOS + iOS**: Uses native picker (already has nice grid UI)
- **Android**: Uses native picker (platform consistency)

### Color Palette
The swatch picker includes colors specifically relevant to your app:
- **App defaults**: `#1d4ed8` (Deep Work), `#fb923c` (Admin), `#22c55e` (Break)
- **Extended palette**: 24 total colors organized by hue (reds, oranges, greens, blues, purples, grays)

## How to Activate

### Option 1: Replace All Color Pickers
In `/src/App.tsx`, make these changes:

1. **Add import:**
```tsx
import ColorField from "./components/ColorField";
```

2. **Replace objective editing color picker:**
```tsx
// Replace this:
<input type="color" onClick={(e) => e.stopPropagation()} title="Pick color"
  value={o.color} onChange={(e) => updateObjectiveColor(o.id, e.target.value)}
  className="h-6 w-6 p-0 border rounded absolute right-2" />

// With this:
<ColorField
  value={o.color}
  onChange={(c) => updateObjectiveColor(o.id, c)}
  className="h-6 w-6 p-0 border rounded absolute right-2"
  stopPropagation
/>
```

3. **Replace new objective color picker:**
```tsx
// Replace this:
<input type="color" title="New objective color" value={newObjColor}
  onChange={(e) => setNewObjColor(e.target.value)} className="h-6 w-6 p-0 border rounded" />

// With this:
<ColorField
  value={newObjColor}
  onChange={setNewObjColor}
  className="h-6 w-6 p-0 border rounded"
/>
```

4. **Replace settings completion hatch color picker:**
```tsx
// Replace this:
<input
  aria-label="Completion hatch color"
  type="color"
  value={dataService.userPreferences?.tick_color || '#16a34a'}
  onChange={(e) => dataService.updateUserPreferences({ tick_color: e.target.value })}
  className="h-8 w-12 p-0 border rounded"
/>

// With this:
<ColorField
  value={dataService.userPreferences?.tick_color || '#16a34a'}
  onChange={(c) => dataService.updateUserPreferences({ tick_color: c })}
  className="h-8 w-12 p-0 border rounded"
/>
```

### Option 2: Test Individual Components
You can test individual SwatchPicker components:

```tsx
import SwatchPicker from "./components/SwatchPicker";

<SwatchPicker
  value={currentColor}
  onChange={setCurrentColor}
  showCustom={true} // Optional: adds "Custom..." native picker inside
/>
```

## Features

### User Experience
- **Fast selection**: One-click color choice from curated palette
- **Reduced cognitive load**: Grid instead of overwhelming spectrum picker
- **Platform appropriate**: Native pickers where they're already good
- **Keyboard accessible**: Tab navigation, Enter to select, Esc to close

### Technical Features
- **Smart browser detection**: Only activates on Chrome/Edge desktop
- **Clean styling**: Matches existing design with subtle dropdown indicator
- **Proper event handling**: Escape key closes picker, click outside closes
- **No breaking changes**: Drop-in replacement for native `<input type="color">`

## Customization

### Color Palette
Edit `/src/components/SwatchPicker.tsx` to modify the `DEFAULT_PALETTE` array:

```tsx
const DEFAULT_PALETTE = [
  "#your-color-1", "#your-color-2", // ... up to 24 colors
];
```

### Grid Layout
Change the `columns` prop (default 8):
```tsx
<SwatchPicker columns={6} /> // 6x4 grid instead of 8x3
```

### Custom Picker Option
Add a "Custom..." native picker inside the swatch grid:
```tsx
<SwatchPicker showCustom={true} />
```

## Browser Support
- **Chrome/Edge**: Full swatch grid functionality
- **Safari**: Native picker (already good UX)
- **Firefox**: Native picker (fallback)
- **Mobile browsers**: Native picker (platform appropriate)

## Status
- ✅ **Components built and tested**
- ✅ **Colors curated for your app**
- ✅ **Browser detection working**
- ⏸️  **Currently deactivated** (using native pickers)
- 🔄 **Ready for activation** (see instructions above)

## Notes
- All components are production-ready
- No performance impact when deactivated
- Easy to activate/deactivate by swapping components
- Maintains full backward compatibility