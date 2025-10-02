# Legacy functions: Backward compatibility layer

import base64
import geojson
import shapely

# Legacy cache dictionaries (maintained for backward compatibility)
image_tile_factory_cache = {}
overlay_tile_factory_cache = {}

def get_image_tile_factory(dataset):
    """Legacy function for getting image tile factory (uses old cache)"""
    if dataset not in image_tile_factory_cache.keys():
        ds, sensor_model = load_gdal_dataset(dataset)
        band = ds.GetRasterBand(1)
        overview_count = band.GetOverviewCount()
        if overview_count == 0:
            overviews = get_standard_overviews(ds.RasterXSize, ds.RasterYSize, 1024)
            ds.BuildOverviews("CUBIC", overviews)
        viz_tile_factory = GDALTileFactory(ds,
                                           sensor_model,
                                           GDALImageFormats.PNG,
                                           GDALCompressionOptions.NONE,
                                           output_type=gdalconst.GDT_Byte,
                                           range_adjustment=RangeAdjustmentType.DRA)
        image_tile_factory_cache[dataset] = viz_tile_factory
    return image_tile_factory_cache.get(dataset)

def get_overlay_tile_factory(image_name, overlay_name):
    """Legacy function for getting overlay tile factory (uses old cache)"""
    key = f"{image_name}:{overlay_name}"
    if key not in overlay_tile_factory_cache.keys():
        with open(overlay_name,"r") as geojson_file:
            fc = geojson.load(geojson_file)
        
        # This workaround ensures all features have the imageGeometry property
        accessor = ImagedFeaturePropertyAccessor()
        for f in fc['features']:
            geom = accessor.find_image_geometry(f)
            accessor.set_image_geometry(f, geom)
                
        tile_index = STRFeature2DSpatialIndex(fc, use_image_geometries=True)
        overlay_tile_factory_cache[key] = tile_index    
    return overlay_tile_factory_cache.get(key)

# NOTE: Removed legacy functions that are no longer needed after registry migration:
# - get_image_tile(): Unused debugging function  
# - create_recv(): Replaced by registry-based message handling in create_new_recv()

# Diagnostic and utility functions
def get_cache_diagnostics():
    """Get diagnostic information about cache state"""
    info = global_cache_manager.get_cache_info()
    stats = global_message_registry.get_performance_stats()
    
    return {
        'cache_info': info,
        'performance_stats': stats,
        'legacy_cache_sizes': {
            'image_tile_factory_cache': len(image_tile_factory_cache),
            'overlay_tile_factory_cache': len(overlay_tile_factory_cache)
        }
    }

def clear_all_caches():
    """Clear all caches (both new and legacy)"""
    global_cache_manager.clear_all_caches()
    image_tile_factory_cache.clear()
    overlay_tile_factory_cache.clear()
    global_logger.info("All caches cleared")

def get_registered_message_types():
    """Get list of registered message types"""
    return list(global_message_registry.handlers.keys())
