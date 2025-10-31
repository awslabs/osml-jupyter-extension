# Property Inspector Integration

This document describes the implementation of JupyterLab's Property Inspector panel integration in the OSML Jupyter Extension.

## Overview

The Property Inspector is a JupyterLab side panel that provides contextual information about the currently active widget. This integration allows the OSML Image Viewer to display relevant information in the Property Inspector panel when the viewer is focused.

## Implementation Details

### 1. Dependencies Added

- Added `@jupyterlab/property-inspector: ^4.4.0` to package.json dependencies

### 2. Plugin Configuration

**File: `src/index.ts`**

- Added `IPropertyInspectorProvider` import from `@jupyterlab/property-inspector`
- Added `IPropertyInspectorProvider` to the plugin's optional dependencies
- Added `propertyInspectorProvider` parameter to the activate function
- Registration of the ImageViewerWidget with the property inspector provider when widgets are created

### 3. Widget Integration

**File: `src/ImageViewerWidget.ts`**

- Added imports for `IPropertyInspector`, `IPropertyInspectorProvider`, and React
- Added private `propertyInspector?: IPropertyInspector` property
- Implemented `registerWithPropertyInspector()` method to register the widget with the provider
- Implemented `updatePropertyInspectorContent()` method to render content in the property inspector panel

### 4. Content Display

The current implementation displays a basic "Hello World" interface containing:

- **Title**: "OSML Image Viewer"
- **Greeting**: "Hello World! 👋"
- **Description**: Brief explanation of the integration
- **Status**: Connection status indicator

## How It Works

1. **Registration**: When an ImageViewerWidget is created, it registers itself with the Property Inspector provider
2. **Focus-based Display**: The Property Inspector automatically shows/hides content based on which widget has focus
3. **Content Rendering**: The widget renders React elements to display information in the Property Inspector panel
4. **Styling**: Uses JupyterLab CSS variables for consistent theming

## Usage

1. **Enable Property Inspector**: In JupyterLab, go to `View > Activate Command Palette` and search for "Show Property Inspector" to open the panel
2. **Open OSML Viewer**: Use the context menu to open an image with the OSML viewer
3. **View Properties**: When the OSML Image Viewer is focused, the Property Inspector will display the custom content

## Future Enhancements

The current implementation provides a foundation for more sophisticated property inspection. Future enhancements could include:

- **Image Metadata**: Display current image name, dimensions, coordinate system
- **Layer Information**: Show active layers and their properties
- **Viewport Details**: Current zoom level and center coordinates
- **Model Status**: Information about selected ML models
- **Interactive Controls**: Buttons or forms for quick actions

## Code Structure

```typescript
// Registration with property inspector
public registerWithPropertyInspector(provider: IPropertyInspectorProvider): void {
  this.propertyInspector = provider.register(this);
  this.updatePropertyInspectorContent();
}

// Content rendering
private updatePropertyInspectorContent(): void {
  const content = React.createElement(/* React component */);
  this.propertyInspector.render(content);
}
```

## Extension Points

To extend the property inspector content:

1. **Modify `updatePropertyInspectorContent()`**: Update the React element structure
2. **Add Signal Connections**: Connect to widget signals to update content dynamically
3. **Create Separate Components**: Extract complex UI into separate React components
4. **Add User Interactions**: Include buttons, forms, or other interactive elements

## Testing

To test the integration:

1. Build the extension: `jlpm build`
2. Start JupyterLab with the extension loaded
3. Open the Property Inspector panel
4. Create an OSML Image Viewer widget
5. Verify that the "Hello World" content appears when the viewer is focused
6. Switch focus to other widgets and confirm the content updates appropriately

## Architecture Benefits

This integration follows JupyterLab's standard extension patterns:

- **Automatic Focus Management**: JupyterLab handles showing/hiding content based on widget focus
- **Minimal Code Changes**: Integration required minimal modifications to existing code
- **Extensible Design**: Easy to add more sophisticated content in the future
- **Consistent UI**: Uses JupyterLab's standard styling and theming
