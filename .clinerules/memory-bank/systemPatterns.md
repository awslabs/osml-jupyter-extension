# System Patterns: OSML Jupyter Extension

## Architecture Overview
The OSML Jupyter Extension follows a modular, service-oriented architecture within the JupyterLab ecosystem:

```
JupyterLab Frontend (TypeScript)
├── Components (UI Layer)
├── Services (Business Logic)
├── Types (Type Definitions)
├── Layers (Map Layers)
├── Utils (Utilities)
└── Kernel (Python Integration)
    ↓ Comm Channel
Python Kernel (Backend)
    ↓ GDAL/OSML Toolkit
Satellite Image Files
```

## Directory Structure

### Frontend Architecture
```
src/
├── types/           # TypeScript type definitions
│   ├── tiles.ts     # Tile-related types
│   ├── features.ts  # Feature and heatmap types
│   ├── models.ts    # Model selection types
│   └── index.ts     # Common application types
├── services/        # Business logic services
│   ├── CommService.ts         # Jupyter comm communication
│   ├── ImageTileService.ts    # Image tile data loading/caching
│   ├── FeatureTileService.ts  # Feature tile data processing
│   ├── KernelService.ts       # Kernel lifecycle management
│   └── index.ts               # Service barrel exports
├── components/      # UI components
│   ├── ModelSelectionDialog.tsx
│   ├── ModelSelectionToolbarButton.ts
│   └── index.ts     # Component barrel exports
├── layers/          # Map layer implementations
│   ├── MultiResolutionFeatureLayer.ts
│   └── index.ts     # Layer barrel exports
├── utils/           # Utility functions
│   ├── icons.ts     # Icon definitions
│   ├── kernelSetupCode.ts          # Kernel setup code
│   ├── imageTileDataFunctions.ts   # Image tile utilities
│   ├── featureTileDataFunctions.ts # Feature tile utilities
│   └── index.ts     # Utility barrel exports
├── kernel/          # Python integration
│   └── kernel-setup.py    # Python kernel setup
├── ImageViewerWidget.ts   # Main widget component
└── index.ts         # Extension entry point
```

## Core Design Patterns

### 1. Service-Oriented Architecture
Each major functionality area is encapsulated in a dedicated service:

```typescript
// CommService: Handles Jupyter comm channel communication
class CommService {
  initialize(): Promise<void>
  sendMessage(message: CommMessage): void
  onMessage(callback: (message: CommMessage) => void): void
  dispose(): void
}

// ImageTileService: Manages image tile data loading and caching
class ImageTileService {
  createMockTileDataFunction(): TileDataFunction
  createRealTileDataFunction(): TileDataFunction
  clearCache(): void
}

// FeatureTileService: Handles feature tile data processing
class FeatureTileService {
  createMockFeatureDataFunction(): FeatureTileDataFunction
  createRealFeatureDataFunction(): FeatureTileDataFunction
  extractHeatmapPoints(): HeatmapPoint[]
}

// KernelService: Manages kernel lifecycle and setup
class KernelService {
  initialize(): Promise<void>
  executeSetupCode(): Promise<void>
  dispose(): void
}
```

### 2. Factory Pattern
- Service factories for creating tile and feature data functions
- Widget factory for ImageViewerWidget creation
- Layer factory functions for different data types

### 3. Observer Pattern
- Signal-based status updates to JupyterLab status bar
- Comm message handling with event-driven responses
- Widget lifecycle management through Lumino signals

### 4. Barrel Export Pattern
Each directory uses index.ts files to provide clean import paths:

```typescript
// src/services/index.ts
export { CommService } from './CommService';
export { ImageTileService } from './ImageTileService';
export { FeatureTileService } from './FeatureTileService';
export { KernelService } from './KernelService';

// Usage
import { CommService, ImageTileService } from './services';
```

### 5. Dependency Injection
Services are designed to be easily testable and mockable:

```typescript
class ImageViewerWidget {
  private commService: CommService;
  private imageTileService: ImageTileService;
  
  constructor(
    commService = new CommService(),
    imageTileService = new ImageTileService()
  ) {
    this.commService = commService;
    this.imageTileService = imageTileService;
  }
}
```

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
3. Widget establishes kernel session and comm channel via KernelService
4. Python code injected into kernel for tile processing
5. Image load request sent via CommService
6. Backend validates and prepares image for tiling
7. Deck.gl TileLayer initialized with custom tile functions

### Tile Request Flow
1. Deck.gl requests tile at specific zoom/coordinates
2. ImageTileService processes tile request
3. CommService sends tile request to backend
4. Backend processes tile using GDAL/OSML toolkit
5. Processed tile returned as base64-encoded image
6. Frontend displays tile in map

## Error Handling Patterns
- Promise-based async operations with timeout handling
- Graceful degradation when kernel setup fails
- Status signal updates for user feedback
- Resource cleanup on widget disposal through service dispose methods

## Performance Patterns
- Service-based caching to avoid reprocessing
- Overview generation for large images
- Lazy loading of overlay data
- Memory management through proper service disposal

## Testing Patterns
- Service isolation enables unit testing of individual components
- Dependency injection allows for easy mocking
- Barrel exports simplify test imports
- Clear separation of concerns facilitates focused testing

## Integration Patterns
- JupyterLab extension lifecycle hooks
- Context menu integration with file browser
- Status bar integration for user feedback
- Session management aligned with Jupyter patterns
- AWS Cloudscape Design System integration for UI consistency
