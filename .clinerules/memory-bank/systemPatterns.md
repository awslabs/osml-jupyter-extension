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
├── Message Registry System
├── Specialized Processors
├── Advanced Caching
└── GDAL/OSML Toolkit Integration
    ↓
Satellite Image Files
```

## Directory Structure - Architectural Organization

### Frontend Architecture
```
src/
├── types/           # TypeScript type definitions
│                    # Tiles, features, models, and core application interfaces
├── services/        # Business logic services
│                    # Communication, tile loading, feature processing, kernel management
├── components/      # UI components
│                    # React dialogs, Lumino toolbar buttons, user interaction components
├── layers/          # Custom Deck.gl layer implementations
│                    # Specialized geospatial data rendering layers
├── utils/           # Utility functions and helpers
│                    # Icons, setup code, data processing utilities, type definitions
├── ImageViewerWidget.ts   # Main widget component
└── index.ts         # Extension entry point
```

### Backend Architecture
```
src/
└──kernel/          # Python backend integration
                    # Numbered modules: core, cache, processors, message registry, main
```

The Python kernel backend follows a modular, numbered file architecture that ensures proper dependency resolution when concatenated. The kernel modules are concatenated into a single deployable file using `scripts/concat-kernel.py`

#### Concatenation Process Flow:
1. Scan src/kernel/ for files matching pattern [0-9][0-9]*_*.py
2. Sort files numerically (01_core.py, 02_cache.py, etc.)
3. Filter out encoding/shebang conflicts during concatenation
4. Generate src/kernel/kernel-setup.py with section markers
5. Add completion indicator for injection validation

#### Kernel Injection and Initialization

The concatenated kernel code is injected into Jupyter kernels from the frontend. The concatinated
kernel-setup.py file is bundled with the frontend application. When the ImageViewerWidget connects
to a new backend kernel the python code is executed in that kernel to initialize the comm channel,
message handlers, and caches.

### Comm Channel Architecture
Once injected, the kernel code establishes bidirectional communication:

- **Target Registration**: `'osml_comm_target'` registered with IPython kernel
- **Message Routing**: Registry-based message handling with type validation
- **Error Handling**: Comprehensive error catching with user-friendly responses
- **Performance Monitoring**: Request tracking and processing time metrics
- **Resource Management**: Automatic cache cleanup and memory management

**Communication Protocol:**
```javascript
Frontend (TypeScript) ←→ Comm Channel ←→ Backend (Python)
     ↑                                           ↓
Message Types:                          Message Processors:
- IMAGE_LOAD_REQUEST                   - ImageLoadProcessor
- IMAGE_TILE_REQUEST                   - ImageTileProcessor  
- OVERLAY_TILE_REQUEST                 - OverlayTileProcessor
- MODEL_TILE_REQUEST                   - ModelTileProcessor
```
