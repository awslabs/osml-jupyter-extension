# System Patterns: OSML Jupyter Extension

## Architecture Overview
The OSML Jupyter Extension follows a client-server architecture within the JupyterLab ecosystem:

```
JupyterLab Frontend (TypeScript)
    ↓ Comm Channel
Python Kernel (Backend)
    ↓ GDAL/OSML Toolkit
Satellite Image Files
```

## Core Components

### Frontend Architecture
- **Main Plugin (`index.ts`)**: JupyterLab extension entry point with command registration
- **ImageViewerWidget**: Primary UI component managing the Leaflet map and user interactions
- **Layer System**: Modular layer architecture for base images and overlays
  - `JupyterImageLayer`: Handles satellite imagery tiles
  - `JupyterOverlayLayer`: Manages vector/feature overlays
- **UI Components**: AWS Cloudscape design system integration

### Backend Integration
- **Kernel Setup Code**: Python code injected into Jupyter kernel on initialization
- **Comm Channel**: Bidirectional communication between frontend and Python kernel
- **Tile Factories**: OSML toolkit integration for image processing
  - `GDALTileFactory`: Converts satellite imagery to web-compatible tiles
  - `STRFeature2DSpatialIndex`: Spatial indexing for vector overlays

## Key Design Patterns

### 1. Factory Pattern
- `ImageViewerWidget.createForImage()`: Static factory for widget creation
- Tile factory caching system in Python backend
- Layer factory functions for different data types

### 2. Observer Pattern
- `statusSignal`: Signal-based status updates to JupyterLab status bar
- Comm message handling with event-driven responses
- Widget lifecycle management through Lumino signals

### 3. Command Pattern
- JupyterLab command system integration
- Context menu commands: `openWithViewer`, `addLayer`
- Extensible command architecture for future features

### 4. Singleton Pattern
- Single ImageViewerWidget instance management
- Cached tile factories to avoid redundant processing
- Session context management

## Communication Architecture

### Comm Protocol
The extension uses Jupyter's comm system for frontend-backend communication:

```typescript
// Frontend sends requests
comm.send({
  type: 'IMAGE_LOAD_REQUEST',
  dataset: imageName
});

// Backend responds
comm.send({
  type: 'IMAGE_LOAD_RESPONSE',
  dataset: dataset,
  status: 'SUCCESS'
});
```

### Message Types
- `IMAGE_LOAD_REQUEST/RESPONSE`: Initialize image processing
- `IMAGE_TILE_REQUEST/RESPONSE`: Request specific image tiles
- `OVERLAY_TILE_REQUEST/RESPONSE`: Request vector overlay data
- `KERNEL_COMM_SETUP_COMPLETE`: Confirm backend initialization

## Data Flow Patterns

### Image Loading Flow
1. User selects file via context menu
2. Frontend creates/reuses ImageViewerWidget
3. Widget establishes kernel session and comm channel
4. Python code injected into kernel for tile processing
5. Image load request sent via comm
6. Backend validates and prepares image for tiling
7. Leaflet map initialized with custom tile layer

### Tile Request Flow
1. Leaflet requests tile at specific zoom/coordinates
2. Frontend sends tile request via comm
3. Backend processes tile using GDAL/OSML toolkit
4. Processed tile returned as base64-encoded image
5. Frontend displays tile in map

## Error Handling Patterns
- Promise-based async operations with timeout handling
- Graceful degradation when kernel setup fails
- Status signal updates for user feedback
- Resource cleanup on widget disposal

## Performance Patterns
- Tile factory caching to avoid reprocessing
- Overview generation for large images
- Lazy loading of overlay data
- Memory management through proper disposal

## Integration Patterns
- JupyterLab extension lifecycle hooks
- Context menu integration with file browser
- Status bar integration for user feedback
- Session management aligned with Jupyter patterns
