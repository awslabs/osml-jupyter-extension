# Cache management: AdvancedCacheManager and caching logic

from osgeo import gdal, gdalconst
gdal.UseExceptions()

from aws.osml.gdal import load_gdal_dataset, GDALImageFormats, GDALCompressionOptions, RangeAdjustmentType
from aws.osml.image_processing import GDALTileFactory
from aws.osml.features import STRFeature2DSpatialIndex, ImagedFeaturePropertyAccessor

import geojson
from math import ceil, log

def get_standard_overviews(width: int, height: int, preview_size: int):
    """Calculate standard overview levels for an image"""
    min_side = min(width, height)
    num_overviews = ceil(log(min_side / preview_size) / log(2))
    if num_overviews > 0:
        result = []
        for i in range(1, num_overviews + 1):
            result.append(2**i)
        return result
    return []

class AdvancedCacheManager:
    """Centralized cache management with lifecycle support"""
    
    def __init__(self):
        self.image_factories = {}
        self.overlay_factories = {}
        self.metadata_cache = {}
        self.statistics_cache = {}
        self.endpoint_cache = {}
        self.model_results_cache = {}  # Key: "dataset:endpoint:zoom:row:col"
        self.cache_stats = {'hits': 0, 'misses': 0}
    
    def get_image_factory(self, dataset):
        """Get image factory from cache"""
        if dataset in self.image_factories:
            self.cache_stats['hits'] += 1
            return self.image_factories[dataset]
        else:
            self.cache_stats['misses'] += 1
            return None
    
    def set_image_factory(self, dataset, factory):
        """Store image factory in cache"""
        self.image_factories[dataset] = factory
    
    def get_overlay_factory(self, key):
        """Get overlay factory from cache"""
        if key in self.overlay_factories:
            self.cache_stats['hits'] += 1
            return self.overlay_factories[key]
        else:
            self.cache_stats['misses'] += 1
            return None
    
    def set_overlay_factory(self, key, factory):
        """Store overlay factory in cache"""
        self.overlay_factories[key] = factory
    
    def load_image(self, dataset):
        """Load and cache image factory with proper error handling"""
        if dataset in self.image_factories:
            return self.image_factories[dataset]
        
        try:
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
            self.image_factories[dataset] = viz_tile_factory
            return viz_tile_factory
        except Exception as e:
            raise RuntimeError(f"Failed to load image dataset '{dataset}': {str(e)}")
    
    def unload_image(self, dataset):
        """Explicit cleanup with resource disposal"""
        if dataset in self.image_factories:
            # Note: In future versions, we might want to call cleanup methods on the factory
            del self.image_factories[dataset]
            return True
        return False
    
    def load_overlay(self, image_name, overlay_name):
        """Load and cache overlay factory with proper error handling"""
        key = f"{image_name}:{overlay_name}"
        if key in self.overlay_factories:
            return self.overlay_factories[key]
        
        try:
            with open(overlay_name, "r") as geojson_file:
                fc = geojson.load(geojson_file)
            
            # This workaround ensures all features have the imageGeometry property
            accessor = ImagedFeaturePropertyAccessor()
            for f in fc['features']:
                geom = accessor.find_image_geometry(f)
                accessor.set_image_geometry(f, geom)
            
            tile_index = STRFeature2DSpatialIndex(fc, use_image_geometries=True)
            self.overlay_factories[key] = tile_index
            return tile_index
        except Exception as e:
            raise RuntimeError(f"Failed to load overlay '{overlay_name}': {str(e)}")
    
    def unload_overlay(self, image_name, overlay_name):
        """Explicit cleanup of overlay resources"""
        key = f"{image_name}:{overlay_name}"
        if key in self.overlay_factories:
            del self.overlay_factories[key]
            return True
        return False
    
    def get_model_results(self, dataset, endpoint, zoom, row, col):
        """Get cached model results"""
        key = f"{dataset}:{endpoint}:{zoom}:{row}:{col}"
        if key in self.model_results_cache:
            self.cache_stats['hits'] += 1
            return self.model_results_cache[key]
        else:
            self.cache_stats['misses'] += 1
            return None
    
    def cache_model_results(self, dataset, endpoint, zoom, row, col, features):
        """Cache model inference results"""
        key = f"{dataset}:{endpoint}:{zoom}:{row}:{col}"
        self.model_results_cache[key] = features
    
    def clear_model_cache_for_dataset(self, dataset):
        """Clear all model results for a specific dataset"""
        keys_to_remove = []
        for key in self.model_results_cache.keys():
            if key.startswith(f"{dataset}:"):
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            del self.model_results_cache[key]
    
    def get_cache_info(self):
        """Get cache information and statistics"""
        return {
            'image_count': len(self.image_factories),
            'overlay_count': len(self.overlay_factories),
            'metadata_count': len(self.metadata_cache),
            'statistics_count': len(self.statistics_cache),
            'endpoint_count': len(self.endpoint_cache),
            'model_results_count': len(self.model_results_cache),
            'cache_stats': self.cache_stats.copy()
        }
    
    def clear_all_caches(self):
        """Clear all caches"""
        self.image_factories.clear()
        self.overlay_factories.clear()
        self.metadata_cache.clear()
        self.statistics_cache.clear()
        self.endpoint_cache.clear()
        self.model_results_cache.clear()
        self.cache_stats = {'hits': 0, 'misses': 0}
