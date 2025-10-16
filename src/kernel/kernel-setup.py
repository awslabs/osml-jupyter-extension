# Auto-generated kernel setup file
# Created by concatenating numbered Python modules
# DO NOT EDIT DIRECTLY - Edit source files instead


# =============================================================================
# FROM: 01_core.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.

# Core infrastructure: Base classes, logging, performance monitoring, and error handling

import time
import logging
import traceback
from functools import wraps

class PerformanceMonitor:
    """Monitor and track performance metrics for message processing"""
    
    def __init__(self):
        self.request_counts = {}
        self.processing_times = {}
        self.error_counts = {}
    
    def track_request(self, message_type, processing_time):
        """Track a successful request"""
        if message_type not in self.request_counts:
            self.request_counts[message_type] = 0
            self.processing_times[message_type] = []
        
        self.request_counts[message_type] += 1
        self.processing_times[message_type].append(processing_time)
        
        # Keep only last 100 measurements per message type for memory management
        if len(self.processing_times[message_type]) > 100:
            self.processing_times[message_type] = self.processing_times[message_type][-100:]
    
    def track_error(self, message_type):
        """Track a failed request"""
        if message_type not in self.error_counts:
            self.error_counts[message_type] = 0
        self.error_counts[message_type] += 1
    
    def get_stats(self):
        """Get performance statistics"""
        stats = {}
        for message_type in self.request_counts:
            times = self.processing_times.get(message_type, [])
            avg_time = sum(times) / len(times) if times else 0
            max_time = max(times) if times else 0
            min_time = min(times) if times else 0
            
            stats[message_type] = {
                'request_count': self.request_counts[message_type],
                'error_count': self.error_counts.get(message_type, 0),
                'avg_processing_time': avg_time,
                'max_processing_time': max_time,
                'min_processing_time': min_time
            }
        return stats

class OSMLKernelLogger:
    """JupyterLab-compatible logging and error handling"""
    
    def __init__(self):
        self.logger = logging.getLogger('osml-jupyter-extension')
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)
            self.logger.setLevel(logging.INFO)
        
        self.error_mappings = {
            "FileNotFoundError": "Image file not found",
            "PermissionError": "Insufficient permissions to access file",
            "MemoryError": "Insufficient memory to process request",
            "ValueError": "Invalid request parameters",
            "KeyError": "Missing required field in request",
            "RuntimeError": "Processing failed due to runtime error"
        }
    
    def log_error_detailed(self, operation, error, data=None):
        """Log detailed error information to kernel logs"""
        error_msg = f"Operation '{operation}' failed: {str(error)}"
        if data:
            error_msg += f" | Request data: {data}"
        
        self.logger.error(error_msg)
        self.logger.debug(traceback.format_exc())
    
    def get_user_friendly_message(self, error):
        """Convert technical errors to user-friendly messages"""
        error_type = type(error).__name__
        friendly_msg = self.error_mappings.get(error_type, "Processing failed")
        return f"{friendly_msg}: {str(error)}"
    
    def info(self, message):
        """Log info message"""
        self.logger.info(message)
    
    def debug(self, message):
        """Log debug message"""
        self.logger.debug(message)
    
    def warning(self, message):
        """Log warning message"""
        self.logger.warning(message)
    
    def error(self, message):
        """Log error message"""
        self.logger.error(message)

class BaseMessageProcessor:
    """Base class for all message processors"""
    
    def __init__(self, cache_manager, logger):
        self.cache_manager = cache_manager
        self.logger = logger
    
    def process(self, data, comm):
        """Process a message - subclasses must implement this method"""
        raise NotImplementedError("Subclasses must implement process method")
    
    def validate_request(self, data, required_fields):
        """Validate that required fields are present in request data"""
        missing = [field for field in required_fields if field not in data]
        if missing:
            raise ValueError(f"Missing required fields: {missing}")



# =============================================================================
# FROM: 02_cache.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.

# Cache management: AdvancedCacheManager and caching logic

import time
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
        """Get cached model results with access tracking"""
        key = f"{dataset}:{endpoint}:{zoom}:{row}:{col}"
        if key in self.model_results_cache:
            self.cache_stats['hits'] += 1
            cache_entry = self.model_results_cache[key]
            
            # Update access statistics for LRU
            if isinstance(cache_entry, dict) and 'features' in cache_entry:
                cache_entry['access_count'] = cache_entry.get('access_count', 0) + 1
                cache_entry['last_access'] = time.time()
                return cache_entry['features']
            else:
                # Handle old cache format
                return cache_entry
        else:
            self.cache_stats['misses'] += 1
            return None
    
    def cache_model_results(self, dataset, endpoint, zoom, row, col, features):
        """Cache model inference results with memory management"""
        key = f"{dataset}:{endpoint}:{zoom}:{row}:{col}"
        
        # Implement LRU-style cache with size limit
        max_cache_size = 1000  # Maximum number of cached model results
        if len(self.model_results_cache) >= max_cache_size:
            # Remove oldest entries (simple FIFO for now, could be enhanced to true LRU)
            keys_to_remove = list(self.model_results_cache.keys())[:100]  # Remove oldest 100 entries
            for old_key in keys_to_remove:
                del self.model_results_cache[old_key]
        
        self.model_results_cache[key] = {
            'features': features,
            'timestamp': time.time(),
            'access_count': 1
        }
    
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



# =============================================================================
# FROM: 03_responses.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.

# Response building: ResponseBuilder and standardized response creation

from functools import wraps
import traceback

class ResponseBuilder:
    """Standardized response creation"""
    
    @staticmethod
    def success_response(message_type, data):
        """Create a successful response"""
        return {'type': message_type, 'status': 'SUCCESS', **data}
    
    @staticmethod
    def error_response(message_type, error_msg, error_code=None):
        """Create an error response"""
        response = {'type': message_type, 'status': 'ERROR', 'error': error_msg}
        if error_code:
            response['error_code'] = error_code
        return response
    
    @staticmethod
    def progress_response(message_type, progress_percent, message=None):
        """Create a progress response"""
        response = {'type': message_type, 'status': 'PROGRESS', 'progress': progress_percent}
        if message:
            response['message'] = message
        return response

def handle_errors_enhanced(response_type, operation_name):
    """Decorator for consistent error handling across all processors"""
    def decorator(func):
        @wraps(func)
        def wrapper(self, data, comm):
            try:
                return func(self, data, comm)
            except Exception as e:
                self.logger.log_error_detailed(operation_name, e, data)
                user_message = self.logger.get_user_friendly_message(e) + "".join(traceback.TracebackException.from_exception(e).format())
                error_response = ResponseBuilder.error_response(response_type, user_message)
                comm.send(error_response)
        return wrapper
    return decorator



# =============================================================================
# FROM: 04a_processor_registry.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.

# Message processor registry: Central registry for mapping message types to processors

import time

class MessageHandlerRegistry:
    """Central registry for mapping message types to processors"""
    
    def __init__(self):
        self.handlers = {}
        self.performance_monitor = PerformanceMonitor()
        self.logger = OSMLKernelLogger()
    
    def register(self, message_type, processor):
        """Register a message processor for a message type"""
        self.handlers[message_type] = processor
        self.logger.info(f"Registered handler for message type: {message_type}")
    
    def handle(self, message_type, message_data, comm):
        """Handle a message using the appropriate processor"""
        start_time = time.time()
        
        handler = self.handlers.get(message_type)
        if handler:
            try:
                result = handler.process(message_data, comm)
                processing_time = time.time() - start_time
                self.performance_monitor.track_request(message_type, processing_time)
                return result
            except Exception as e:
                self.performance_monitor.track_error(message_type)
                raise e
        else:
            return self._handle_unknown_message(message_type, message_data, comm)
    
    def _handle_unknown_message(self, message_type, message_data, comm):
        """Handle unknown message types"""
        error_msg = f"Unknown message type: {message_type}"
        self.logger.error(error_msg)
        
        response = ResponseBuilder.error_response(
            f"{message_type}_RESPONSE", 
            error_msg,
            "UNKNOWN_MESSAGE_TYPE"
        )
        comm.send(response)
    
    def get_performance_stats(self):
        """Get performance statistics"""
        return self.performance_monitor.get_stats()
    
    def get_registered_message_types(self):
        """Get list of registered message types"""
        return list(self.handlers.keys())

def get_registered_message_types():
    """Get list of registered message types from global registry"""
    return global_message_registry.get_registered_message_types()



# =============================================================================
# FROM: 04b_image_processors.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.

# Image processors: Handle image loading, tiles, metadata, statistics, and unloading

import base64

class ImageLoadProcessor(BaseMessageProcessor):
    """Process IMAGE_LOAD_REQUEST messages"""
    
    @handle_errors_enhanced('IMAGE_LOAD_RESPONSE', 'image_load')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['dataset'])
        dataset = data['dataset']
        
        self.logger.debug(f"Processing image load request for dataset: {dataset}")
        
        # Load image using cache manager
        try:
            tile_factory = self.cache_manager.load_image(dataset)
            status = "SUCCESS" if tile_factory is not None else "FAILED"
            
            self.logger.info(f"Image load {'successful' if status == 'SUCCESS' else 'failed'} for dataset: {dataset}")
            
            # Send successful response
            response = ResponseBuilder.success_response('IMAGE_LOAD_RESPONSE', {
                'dataset': dataset,
                'status': status
            })
            comm.send(response)
            
        except Exception as e:
            # Re-raise to be caught by error handler decorator
            raise e


class ImageTileProcessor(BaseMessageProcessor):
    """Process IMAGE_TILE_REQUEST messages"""
    
    @handle_errors_enhanced('IMAGE_TILE_RESPONSE', 'image_tile')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['dataset', 'zoom', 'row', 'col'])
        dataset = data['dataset']
        zoom = data['zoom']
        row = data['row']
        col = data['col']
        
        self.logger.debug(f"Processing image tile request for dataset: {dataset}, zoom: {zoom}, row: {row}, col: {col}")
        
        # Get image factory from cache
        tile_factory = self.cache_manager.get_image_factory(dataset)
        if tile_factory is None:
            raise ValueError(f"Image not loaded: {dataset}")
        
        # Calculate scale and tile parameters 
        scale = 2**(-1 * zoom)
        scaled_tile_size = 512 * scale
        
        # Create tile
        try:
            encoded_tile = tile_factory.create_encoded_tile([
                int(col) * scaled_tile_size, 
                int(row) * scaled_tile_size, 
                scaled_tile_size, 
                scaled_tile_size
            ], [512, 512])
            
            # Encode tile as base64
            tile_b64 = base64.b64encode(encoded_tile).decode('utf-8')
            
            self.logger.debug(f"Successfully created tile for dataset: {dataset}")
            
            # Send successful response
            response = ResponseBuilder.success_response('IMAGE_TILE_RESPONSE', {
                'img': tile_b64
            })
            comm.send(response)
            
        except Exception as e:
            # Re-raise to be caught by error handler decorator
            raise e


class ImageMetadataProcessor(BaseMessageProcessor):
    """Process IMAGE_METADATA_REQUEST messages"""
    
    @handle_errors_enhanced('IMAGE_METADATA_RESPONSE', 'image_metadata')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['dataset'])
        dataset = data['dataset']
        
        self.logger.debug(f"Processing image metadata request for dataset: {dataset}")
        
        # Check cache first
        if dataset in self.cache_manager.metadata_cache:
            metadata = self.cache_manager.metadata_cache[dataset]
            self.logger.debug(f"Using cached metadata for {dataset}")
        else:
            # Load image and extract metadata
            image_factory = self.cache_manager.get_image_factory(dataset)
            if not image_factory:
                # Try to load the image if it's not in cache
                image_factory = self.cache_manager.load_image(dataset)
                if not image_factory:
                    raise ValueError(f"Failed to load image: {dataset}")
            
            metadata = self._extract_metadata(image_factory)
            self.cache_manager.metadata_cache[dataset] = metadata
            self.logger.debug(f"Extracted and cached metadata for {dataset}")
        
        # Send successful response
        response = ResponseBuilder.success_response('IMAGE_METADATA_RESPONSE', {
            'dataset': dataset,
            'metadata': metadata
        })
        comm.send(response)
    
    def _extract_metadata(self, image_factory):
        """Extract metadata from image factory"""
        ds = image_factory.raster_dataset
        
        # Get basic raster information
        metadata = {
            'width': ds.RasterXSize,
            'height': ds.RasterYSize,
            'bands': ds.RasterCount,
            'data_type': ds.GetRasterBand(1).DataType if ds.RasterCount > 0 else None,
            'projection': ds.GetProjection(),
            'geotransform': ds.GetGeoTransform(),
        }
        
        # Get overview information
        if ds.RasterCount > 0:
            band = ds.GetRasterBand(1)
            metadata['overview_count'] = band.GetOverviewCount()
            
            # Get overview dimensions
            overviews = []
            for i in range(band.GetOverviewCount()):
                overview = band.GetOverview(i)
                overviews.append({
                    'width': overview.XSize,
                    'height': overview.YSize
                })
            metadata['overviews'] = overviews
        
        # Get driver information
        driver = ds.GetDriver()
        if driver:
            metadata['driver'] = driver.GetDescription()
            metadata['format'] = driver.ShortName
        
        # Get file size if available
        file_list = ds.GetFileList()
        if file_list:
            metadata['file_list'] = file_list
        
        # Get coordinate system info
        spatial_ref = ds.GetSpatialRef()
        if spatial_ref:
            metadata['coordinate_system'] = {
                'authority_name': spatial_ref.GetAuthorityName(None),
                'authority_code': spatial_ref.GetAuthorityCode(None),
                'proj4': spatial_ref.ExportToProj4()
            }
        
        return metadata


class ImageStatisticsProcessor(BaseMessageProcessor):
    """Process IMAGE_STATISTICS_REQUEST messages"""
    
    @handle_errors_enhanced('IMAGE_STATISTICS_RESPONSE', 'image_statistics')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['dataset'])
        dataset = data['dataset']
        
        # Optional parameters
        compute_histogram = data.get('compute_histogram', False)
        histogram_bins = data.get('histogram_bins', 256)
        
        self.logger.debug(f"Processing image statistics request for dataset: {dataset}")
        
        # Check cache first
        cache_key = f"{dataset}:{compute_histogram}:{histogram_bins}"
        if cache_key in self.cache_manager.statistics_cache:
            statistics = self.cache_manager.statistics_cache[cache_key]
            self.logger.debug(f"Using cached statistics for {dataset}")
        else:
            # Load image and extract statistics
            image_factory = self.cache_manager.get_image_factory(dataset)
            if not image_factory:
                # Try to load the image if it's not in cache
                image_factory = self.cache_manager.load_image(dataset)
                if not image_factory:
                    raise ValueError(f"Failed to load image: {dataset}")
            
            statistics = self._extract_statistics(image_factory, compute_histogram, histogram_bins)
            self.cache_manager.statistics_cache[cache_key] = statistics
            self.logger.debug(f"Extracted and cached statistics for {dataset}")
        
        # Send successful response
        response = ResponseBuilder.success_response('IMAGE_STATISTICS_RESPONSE', {
            'dataset': dataset,
            'statistics': statistics
        })
        comm.send(response)
    
    def _extract_statistics(self, image_factory, compute_histogram=False, histogram_bins=256):
        """Extract statistics from image factory"""
        ds = image_factory.raster_dataset
        statistics = {
            'band_count': ds.RasterCount,
            'bands': []
        }
        
        # Process each band
        for band_num in range(1, ds.RasterCount + 1):
            band = ds.GetRasterBand(band_num)
            band_stats = {
                'band_number': band_num,
                'error': None
                }
            
            # Get basic statistics
            try:
                # Try to get cached statistics first
                stats = band.GetStatistics(True, False)
                if stats and len(stats) == 4:
                    band_stats['min'] = stats[0]
                    band_stats['max'] = stats[1]
                    band_stats['mean'] = stats[2]
                    band_stats['std'] = stats[3]
                else:
                    # Compute statistics if not cached
                    stats = band.ComputeStatistics(False)
                    if stats and len(stats) == 4:
                        band_stats['min'] = stats[0]
                        band_stats['max'] = stats[1]
                        band_stats['mean'] = stats[2]
                        band_stats['std'] = stats[3]
            except Exception as e:
                self.logger.warning(f"Failed to compute statistics for band {band_num}: {e}")
                band_stats['error'] = f"Statistics computation failed: {str(e)}"
            
            # Get data type information
            band_stats['data_type'] = band.DataType
            band_stats['no_data_value'] = band.GetNoDataValue()
            
            # Get color interpretation
            color_interp = band.GetColorInterpretation()
            if color_interp:
                band_stats['color_interpretation'] = color_interp
            
            # Compute histogram if requested
            if compute_histogram and 'min' in band_stats and 'max' in band_stats:
                try:
                    histogram = band.GetHistogram(
                        min=band_stats['min'],
                        max=band_stats['max'],
                        buckets=histogram_bins,
                        include_out_of_range=0,
                        approx_ok=1
                    )
                    if histogram:
                        band_stats['histogram'] = {
                            'bins': histogram_bins,
                            'min': band_stats['min'],
                            'max': band_stats['max'],
                            'counts': histogram
                        }
                except Exception as e:
                    self.logger.warning(f"Failed to compute histogram for band {band_num}: {e}")
                    band_stats['histogram_error'] = f"Histogram computation failed: {str(e)}"
            
            statistics['bands'].append(band_stats)
        
        return statistics


class ImageUnloadProcessor(BaseMessageProcessor):
    """Process IMAGE_UNLOAD_REQUEST messages"""
    
    @handle_errors_enhanced('IMAGE_UNLOAD_RESPONSE', 'image_unload')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['dataset'])
        dataset = data['dataset']
        
        self.logger.debug(f"Processing image unload request for dataset: {dataset}")
        
        # Unload image from cache
        unloaded = self.cache_manager.unload_image(dataset)
        
        # Also clear related caches
        self._clear_related_caches(dataset)
        
        # Send successful response (operation is always successful, just report what happened)
        response = ResponseBuilder.success_response('IMAGE_UNLOAD_RESPONSE', {
            'dataset': dataset,
            'unloaded': unloaded,
            'result': 'SUCCESS' if unloaded else 'NOT_FOUND'
        })
        comm.send(response)
        
        if unloaded:
            self.logger.info(f"Successfully unloaded image: {dataset}")
        else:
            self.logger.info(f"Image not found in cache: {dataset}")
    
    def _clear_related_caches(self, dataset):
        """Clear metadata and statistics caches for the unloaded dataset"""
        # Clear metadata cache
        if dataset in self.cache_manager.metadata_cache:
            del self.cache_manager.metadata_cache[dataset]
        
        # Clear statistics cache (need to check all keys since they include parameters)
        keys_to_remove = []
        for key in self.cache_manager.statistics_cache.keys():
            if key.startswith(f"{dataset}:"):
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            del self.cache_manager.statistics_cache[key]
        
        self.logger.debug(f"Cleared related caches for dataset: {dataset}")



# =============================================================================
# FROM: 04c_overlay_processors.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.

# Overlay processors: Handle overlay loading, tiles, and unloading

import shapely

class OverlayTileProcessor(BaseMessageProcessor):
    """Process OVERLAY_TILE_REQUEST messages with proper zoom level handling"""
    
    # Feature count limits based on zoom level for performance
    ZOOM_FEATURE_LIMITS = {
        -3: 5000,   # Very zoomed out - only show most important features
        -2: 10000,
        -1: 20000,
        0: 50000,   # Base zoom level
        1: 100000,
        2: 200000,
        3: 500000,  # Very zoomed in - show all details
    }
    
    @handle_errors_enhanced('OVERLAY_TILE_RESPONSE', 'overlay_tile')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['imageName', 'overlayName', 'zoom', 'row', 'col'])
        image_name = data['imageName']
        overlay_name = data['overlayName']
        zoom = data['zoom']
        row = data['row']
        col = data['col']
        
        self.logger.debug(f"Processing overlay tile request for image: {image_name}, overlay: {overlay_name}, zoom: {zoom}, row: {row}, col: {col}")
        
        # Get overlay factory from cache
        overlay_key = f"{image_name}:{overlay_name}"
        tile_factory = self.cache_manager.get_overlay_factory(overlay_key)
        
        # Load overlay if not in cache
        if tile_factory is None:
            tile_factory = self.cache_manager.load_overlay(image_name, overlay_name)
        
        if tile_factory is None:
            raise ValueError(f"Could not load overlay: {overlay_name}")
        
        # Calculate proper zoom-aware coordinates (matching ImageTileProcessor logic)
        scale = 2**(-1 * zoom)
        scaled_tile_size = 512 * scale
        
        # Create bounding box for tile with proper zoom level scaling
        bbox = shapely.box(
            int(col) * scaled_tile_size, 
            int(row) * scaled_tile_size, 
            (int(col) + 1) * scaled_tile_size, 
            (int(row) + 1) * scaled_tile_size
        )
        
        self.logger.debug(f"Zoom level {zoom}: scale={scale}, scaled_tile_size={scaled_tile_size}, bbox={bbox.bounds}")
        
        # Find intersecting features
        try:
            features = tile_factory.find_intersects(bbox)
            
            # Apply zoom-aware feature filtering for performance
            # if features:
            #    features = self._filter_features_by_zoom(features, zoom)
            
            feature_count = len(features) if features else 0
            self.logger.debug(f"Found {feature_count} intersecting features for overlay tile at zoom {zoom}")
            
            # Send successful response
            response = ResponseBuilder.success_response('OVERLAY_TILE_RESPONSE', {
                'features': features
            })
            comm.send(response)
            
        except Exception as e:
            # Re-raise to be caught by error handler decorator
            raise e
    
    def _filter_features_by_zoom(self, features, zoom):
        """Filter features based on zoom level for performance"""
        if not features:
            return features
        
        # Get feature limit for this zoom level
        feature_limit = self.ZOOM_FEATURE_LIMITS.get(zoom)
        if feature_limit is None:
            # For zoom levels not in the table, interpolate or use nearest
            if zoom < min(self.ZOOM_FEATURE_LIMITS.keys()):
                feature_limit = self.ZOOM_FEATURE_LIMITS[min(self.ZOOM_FEATURE_LIMITS.keys())]
            else:
                feature_limit = self.ZOOM_FEATURE_LIMITS[max(self.ZOOM_FEATURE_LIMITS.keys())]
        
        # If we're under the limit, return all features
        if len(features) <= feature_limit:
            return features
        
        self.logger.debug(f"Filtering features: {len(features)} -> {feature_limit} for zoom level {zoom}")
        
        # For zoom levels with too many features, implement intelligent filtering
        if zoom < 0:
            # At negative zoom levels (zoomed out), prioritize larger or more important features
            return self._filter_by_importance(features, feature_limit)
        else:
            # At positive zoom levels (zoomed in), we can show more features
            # but still limit for performance - take a representative sample
            return features[:feature_limit]
    
    def _filter_by_importance(self, features, limit):
        """Filter features by importance/size for negative zoom levels"""
        try:
            # Try to sort by geometry area (larger features are more important when zoomed out)
            import shapely.geometry
            
            feature_areas = []
            for feature in features:
                try:
                    if 'geometry' in feature and feature['geometry']:
                        geom = shapely.geometry.shape(feature['geometry'])
                        area = geom.area if hasattr(geom, 'area') else 0
                        feature_areas.append((area, feature))
                    else:
                        # Features without geometry get area 0
                        feature_areas.append((0, feature))
                except Exception:
                    # If we can't calculate area, assign area 0
                    feature_areas.append((0, feature))
            
            # Sort by area (largest first) and take the top features
            feature_areas.sort(key=lambda x: x[0], reverse=True)
            return [feature for area, feature in feature_areas[:limit]]
            
        except Exception as e:
            # If importance filtering fails, fall back to simple truncation
            self.logger.warning(f"Feature importance filtering failed, using simple truncation: {e}")
            return features[:limit]


class OverlayLoadProcessor(BaseMessageProcessor):
    """Process OVERLAY_LOAD_REQUEST messages"""
    
    @handle_errors_enhanced('OVERLAY_LOAD_RESPONSE', 'overlay_load')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['imageName', 'overlayName'])
        image_name = data['imageName']
        overlay_name = data['overlayName']
        
        self.logger.debug(f"Processing overlay load request for image: {image_name}, overlay: {overlay_name}")
        
        # Load overlay using cache manager
        try:
            tile_factory = self.cache_manager.load_overlay(image_name, overlay_name)
            status = "SUCCESS" if tile_factory is not None else "FAILED"
            
            self.logger.info(f"Overlay load {'successful' if status == 'SUCCESS' else 'failed'} for image: {image_name}, overlay: {overlay_name}")
            
            # Send successful response
            response = ResponseBuilder.success_response('OVERLAY_LOAD_RESPONSE', {
                'imageName': image_name,
                'overlayName': overlay_name,
                'status': status
            })
            comm.send(response)
            
        except Exception as e:
            # Re-raise to be caught by error handler decorator
            raise e


class OverlayUnloadProcessor(BaseMessageProcessor):
    """Process OVERLAY_UNLOAD_REQUEST messages"""
    
    @handle_errors_enhanced('OVERLAY_UNLOAD_RESPONSE', 'overlay_unload')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['imageName', 'overlayName'])
        image_name = data['imageName']
        overlay_name = data['overlayName']
        
        self.logger.debug(f"Processing overlay unload request for image: {image_name}, overlay: {overlay_name}")
        
        # Unload overlay from cache
        unloaded = self.cache_manager.unload_overlay(image_name, overlay_name)
        
        # Send successful response (operation is always successful, just report what happened)
        response = ResponseBuilder.success_response('OVERLAY_UNLOAD_RESPONSE', {
            'imageName': image_name,
            'overlayName': overlay_name,
            'unloaded': unloaded,
            'result': 'SUCCESS' if unloaded else 'NOT_FOUND'
        })
        comm.send(response)
        
        if unloaded:
            self.logger.info(f"Successfully unloaded overlay: {image_name}:{overlay_name}")
        else:
            self.logger.info(f"Overlay not found in cache: {image_name}:{overlay_name}")



# =============================================================================
# FROM: 04d_model_processors.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.

# Model processors: Handle endpoint listing and model inference with integrated async optimization

import time
import json
import concurrent.futures
from threading import Lock, Semaphore
from collections import defaultdict
from typing import Dict, List, Optional
import boto3
try:
    from aws.osml.features import ImagedFeaturePropertyAccessor
except ImportError:
    # Fallback if osml.features is not available
    ImagedFeaturePropertyAccessor = None

class EndpointListProcessor(BaseMessageProcessor):
    """Process LIST_AVAILABLE_ENDPOINTS messages"""
    
    # Cache TTL for endpoint list (5 minutes)
    ENDPOINT_CACHE_TTL = 300
    
    @handle_errors_enhanced('LIST_AVAILABLE_ENDPOINTS_RESPONSE', 'list_endpoints')
    def process(self, data, comm):
        self.logger.debug("Processing list available endpoints request")
        
        # Check cache first
        cached_result = self._get_cached_endpoints()
        if cached_result is not None:
            endpoints = cached_result
            self.logger.debug("Using cached endpoint list")
        else:
            # Fetch endpoints from SageMaker
            try:
                endpoints = self._fetch_sagemaker_endpoints()
                self._cache_endpoints(endpoints)
                self.logger.debug(f"Fetched {len(endpoints)} endpoints from SageMaker")
            except Exception as e:
                self.logger.error(f"Failed to fetch SageMaker endpoints: {e}")
                raise RuntimeError(f"Failed to list SageMaker endpoints: {str(e)}")
        
        # Send successful response
        response = ResponseBuilder.success_response('LIST_AVAILABLE_ENDPOINTS_RESPONSE', {
            'endpoints': endpoints
        })
        comm.send(response)
    
    def _get_cached_endpoints(self):
        """Get endpoints from cache if not expired"""
        if 'endpoints' in self.cache_manager.endpoint_cache:
            cache_entry = self.cache_manager.endpoint_cache['endpoints']
            if time.time() - cache_entry['timestamp'] < self.ENDPOINT_CACHE_TTL:
                return cache_entry['data']
        return None
    
    def _cache_endpoints(self, endpoints):
        """Cache endpoints with timestamp"""
        self.cache_manager.endpoint_cache['endpoints'] = {
            'data': endpoints,
            'timestamp': time.time()
        }
    
    def _fetch_sagemaker_endpoints(self):
        """Fetch endpoint list from SageMaker using boto3"""
        try:
            # Create SageMaker client with default region
            # TODO: Make region configurable instead of hardcoded
            sagemaker = boto3.client('sagemaker', region_name='us-west-2')
            
            # List endpoints
            response = sagemaker.list_endpoints(
                StatusEquals='InService',  # Only get active endpoints
                MaxResults=100  # Reasonable limit
            )
            
            # Extract endpoint information
            endpoints = []
            for endpoint in response.get('Endpoints', []):
                endpoint_info = {
                    'name': endpoint['EndpointName'],
                    'status': endpoint['EndpointStatus'],
                    'creationTime': endpoint.get('CreationTime', '').isoformat() if endpoint.get('CreationTime') else None,
                    'lastModifiedTime': endpoint.get('LastModifiedTime', '').isoformat() if endpoint.get('LastModifiedTime') else None,
                    'instanceType': None  # Will be filled from endpoint config if needed
                }
                endpoints.append(endpoint_info)
            
            # Handle pagination if needed
            while 'NextToken' in response:
                response = sagemaker.list_endpoints(
                    StatusEquals='InService',
                    MaxResults=100,
                    NextToken=response['NextToken']
                )
                for endpoint in response.get('Endpoints', []):
                    endpoint_info = {
                        'name': endpoint['EndpointName'],
                        'status': endpoint['EndpointStatus'],
                        'creationTime': endpoint.get('CreationTime', '').isoformat() if endpoint.get('CreationTime') else None,
                        'lastModifiedTime': endpoint.get('LastModifiedTime', '').isoformat() if endpoint.get('LastModifiedTime') else None,
                        'instanceType': None  # Will be filled from endpoint config if needed
                    }
                    endpoints.append(endpoint_info)
            
            return endpoints
            
        except Exception as e:
            raise RuntimeError(f"SageMaker API error: {str(e)}")


class ModelTileProcessor(BaseMessageProcessor):
    """Process MODEL_TILE_REQUEST messages with integrated async processing and zoom-level-aware optimization"""
    
    def __init__(self, cache_manager, logger):
        super().__init__(cache_manager, logger)
        
        # Threading controls for async operations
        self.max_concurrent = 3
        self.request_timeout = 30.0
        self.semaphore = Semaphore(self.max_concurrent)
        self.executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=self.max_concurrent,
            thread_name_prefix="model_inference"
        )
        
        # Request deduplication for zoom 0 tiles only
        self.pending_zoom0_requests: Dict[str, List] = defaultdict(list)
        self.request_lock = Lock()
        
        # Statistics
        self.stats = {
            'total_requests': 0,
            'cache_hits': 0,
            'concurrent_requests': 0,
            'deduplicated_requests': 0,
            'timeout_requests': 0,
            'zoom0_async_requests': 0,
            'higher_zoom_sync_requests': 0
        }
    
    def _generate_zoom0_request_key(self, dataset: str, endpoint: str, row: int, col: int) -> str:
        """Generate unique key for zoom 0 request deduplication"""
        return f"{dataset}:{endpoint}:0:{row}:{col}"
    
    @handle_errors_enhanced('MODEL_TILE_RESPONSE', 'model_tile')  
    def process(self, data, comm):
        """Process model tile request with zoom-level-aware async optimization"""
        # Validate request
        self.validate_request(data, ['dataset', 'endpointName', 'zoom', 'row', 'col'])
        dataset = data['dataset']
        endpoint_name = data['endpointName']
        zoom = data['zoom']
        row = data['row']
        col = data['col']
        
        with self.request_lock:
            self.stats['total_requests'] += 1
        
        self.logger.debug(f"Processing model tile request for dataset: {dataset}, endpoint: {endpoint_name}, zoom: {zoom}, row: {row}, col: {col}")
        
        if zoom == 0:
            # Zoom 0: Use async processing with deduplication
            self._process_zoom0_async(dataset, endpoint_name, row, col, comm)
        else:
            # Higher zoom: Process synchronously by aggregating zoom 0 results
            self._process_higher_zoom_sync(dataset, endpoint_name, zoom, row, col, comm)
    
    def _process_zoom0_async(self, dataset: str, endpoint_name: str, row: int, col: int, comm):
        """Process zoom 0 tile with async deduplication"""
        request_key = self._generate_zoom0_request_key(dataset, endpoint_name, row, col)
        
        with self.request_lock:
            self.stats['zoom0_async_requests'] += 1
            
            # Check if identical request is already being processed
            if request_key in self.pending_zoom0_requests:
                # Add comm to existing request's callback list
                self.pending_zoom0_requests[request_key].append(comm)
                self.stats['deduplicated_requests'] += 1
                self.logger.debug(f"Deduplicated zoom 0 request: {request_key}")
                return
            
            # Mark request as pending and add comm to callback list
            self.pending_zoom0_requests[request_key] = [comm]
        
        # Submit async work
        future = self.executor.submit(
            self._execute_zoom0_inference,
            dataset, endpoint_name, row, col, request_key
        )
        
        self.logger.debug(f"Submitted async zoom 0 request: {request_key}")
    
    def _process_higher_zoom_sync(self, dataset: str, endpoint_name: str, zoom: int, row: int, col: int, comm):
        """Process higher zoom tile synchronously by aggregating zoom 0 results"""
        with self.request_lock:
            self.stats['higher_zoom_sync_requests'] += 1
        
        try:
            # Calculate covering zoom 0 tiles
            covering_tiles = self._calculate_covering_zoom0_tiles(zoom, row, col)
            self.logger.debug(f"Higher zoom request needs {len(covering_tiles)} zoom 0 tiles")
            
            # Collect features from all covering tiles (uses caching, may be instant)
            all_features = []
            for z0_row, z0_col in covering_tiles:
                features = self._get_zoom0_features_sync(dataset, endpoint_name, z0_row, z0_col)
                all_features.extend(features)
            
            # Filter features to requested tile bounds
            filtered_features = self._filter_features_to_tile_bounds(all_features, zoom, row, col)
            
            feature_count = len(filtered_features) if filtered_features else 0
            self.logger.debug(f"Returning {feature_count} features for higher zoom tile at zoom {zoom}")
            
            # Send response immediately
            response = ResponseBuilder.success_response('MODEL_TILE_RESPONSE', {
                'features': filtered_features
            })
            comm.send(response)
            
        except Exception as e:
            self.logger.error(f"Higher zoom processing failed: {e}")
            # Re-raise to be caught by error handler decorator
            raise e
    
    def _execute_zoom0_inference(self, dataset: str, endpoint_name: str, row: int, col: int, request_key: str):
        """Execute zoom 0 model inference in background thread"""
        try:
            # Acquire semaphore to limit concurrent SageMaker calls
            acquired = self.semaphore.acquire(timeout=self.request_timeout)
            if not acquired:
                raise TimeoutError(f"Request timeout waiting for semaphore: {request_key}")
            
            try:
                with self.request_lock:
                    self.stats['concurrent_requests'] += 1
                
                self.logger.debug(f"Executing async zoom 0 inference: {request_key}")
                
                # Process the zoom 0 tile
                features = self._process_zoom0_tile(dataset, endpoint_name, row, col)
                
                # Send response to all pending comms for this request
                with self.request_lock:
                    comms = self.pending_zoom0_requests.pop(request_key, [])
                
                response = ResponseBuilder.success_response('MODEL_TILE_RESPONSE', {
                    'features': features
                })
                
                for comm in comms:
                    try:
                        comm.send(response)
                    except Exception as e:
                        self.logger.error(f"Failed to send response for {request_key}: {e}")
                
                feature_count = len(features) if features else 0
                self.logger.debug(f"Completed async zoom 0 inference: {request_key}, features: {feature_count}")
                
            finally:
                self.semaphore.release()
                with self.request_lock:
                    self.stats['concurrent_requests'] -= 1
                    
        except Exception as e:
            self.logger.error(f"Async zoom 0 inference failed: {request_key}, error: {e}")
            
            # Send error response to all pending comms
            with self.request_lock:
                comms = self.pending_zoom0_requests.pop(request_key, [])
            
            error_response = ResponseBuilder.error_response('MODEL_TILE_RESPONSE', str(e))
            
            for comm in comms:
                try:
                    comm.send(error_response)
                except Exception as send_error:
                    self.logger.error(f"Failed to send error response for {request_key}: {send_error}")
    
    def _get_zoom0_features_sync(self, dataset: str, endpoint_name: str, row: int, col: int) -> List:
        """Get zoom 0 features synchronously (from cache or direct processing)"""
        # Check cache first
        cached_features = self.cache_manager.get_model_results(dataset, endpoint_name, 0, row, col)
        if cached_features is not None:
            with self.request_lock:
                self.stats['cache_hits'] += 1
            self.logger.debug(f"Using cached zoom 0 features for ({row}, {col})")
            return cached_features
        
        # Process synchronously if not cached
        self.logger.debug(f"Processing zoom 0 tile synchronously for aggregation: ({row}, {col})")
        return self._process_zoom0_tile(dataset, endpoint_name, row, col)
    
    def cleanup(self):
        """Cleanup resources"""
        if hasattr(self, 'executor'):
            self.executor.shutdown(wait=True)
    
    def get_stats(self) -> dict:
        """Get current statistics"""
        with self.request_lock:
            return {
                **self.stats,
                'pending_zoom0_requests': len(self.pending_zoom0_requests)
            }
    
    def _process_zoom0_tile(self, dataset, endpoint_name, row, col):
        """Process a single zoom 0 tile with model inference"""
        # Check cache first
        cached_features = self.cache_manager.get_model_results(dataset, endpoint_name, 0, row, col)
        if cached_features is not None:
            self.logger.debug(f"Using cached model results for zoom 0 tile ({row}, {col})")
            return cached_features
        
        # Get image tile data
        image_factory = self.cache_manager.get_image_factory(dataset)
        if image_factory is None:
            raise ValueError(f"Image not loaded: {dataset}")
        
        # Create tile (zoom 0 = scale 1.0, so 512x512 image pixels)
        scaled_tile_size = 512.0
        encoded_tile = image_factory.create_encoded_tile([
            int(col) * scaled_tile_size, 
            int(row) * scaled_tile_size, 
            scaled_tile_size, 
            scaled_tile_size
        ], [512, 512])
        
        # Invoke model
        features = self._invoke_sagemaker_model(endpoint_name, encoded_tile)
        
        # Transform pixel coordinates to be relative to full image
        tile_offset_x = int(col) * scaled_tile_size
        tile_offset_y = int(row) * scaled_tile_size
        features = self._transform_pixel_coordinates(features, tile_offset_x, tile_offset_y)
        
        # Cache results
        self.cache_manager.cache_model_results(dataset, endpoint_name, 0, row, col, features)
        
        return features
    
    def _process_higher_zoom_tile(self, dataset, endpoint_name, zoom, row, col):
        """Process higher zoom tiles by aggregating zoom 0 results"""
        # Calculate which zoom 0 tiles cover this area
        covering_tiles = self._calculate_covering_zoom0_tiles(zoom, row, col)
        
        all_features = []
        for z0_row, z0_col in covering_tiles:
            # Process each zoom 0 tile (uses caching)
            features = self._process_zoom0_tile(dataset, endpoint_name, z0_row, z0_col)
            all_features.extend(features)
        
        # Filter features to the requested tile bounds
        filtered_features = self._filter_features_to_tile_bounds(all_features, zoom, row, col)
        
        return filtered_features
    
    def _calculate_covering_zoom0_tiles(self, target_zoom, target_row, target_col):
        """Calculate which zoom 0 tiles cover the requested tile area"""
        if target_zoom == 0:
            return [(target_row, target_col)]
        
        # Scale factor from target zoom to zoom 0
        scale_factor = 2**(-target_zoom)
        
        # Calculate zoom 0 bounds (using integer math to avoid floating point issues)
        zoom0_start_row = int(target_row * scale_factor)
        zoom0_start_col = int(target_col * scale_factor)  
        zoom0_end_row = int(zoom0_start_row + scale_factor)
        zoom0_end_col = int(zoom0_start_col + scale_factor)
        
        # Generate all zoom 0 tiles in this range
        tiles = []
        for row in range(zoom0_start_row, zoom0_end_row):
            for col in range(zoom0_start_col, zoom0_end_col):
                tiles.append((row, col))
        
        return tiles
    
    def _filter_features_to_tile_bounds(self, features, target_zoom, target_row, target_col):
        """Filter features to only those within the requested tile bounds"""
        if not features:
            return features
        
        # Calculate pixel bounds of the requested tile
        scale = 2**(-target_zoom)  # Same as ImageTileProcessor
        scaled_tile_size = 512 * scale
        
        min_x = target_col * scaled_tile_size
        min_y = target_row * scaled_tile_size
        max_x = min_x + scaled_tile_size  
        max_y = min_y + scaled_tile_size
        
        filtered_features = []
        for feature in features:
            if self._feature_intersects_bounds(feature, min_x, min_y, max_x, max_y):
                filtered_features.append(feature)
        
        return filtered_features
    
    def _feature_intersects_bounds(self, feature, min_x, min_y, max_x, max_y):
        """Check if feature intersects the given bounds"""
        try:
            # Check imageGeometry property for pixel coordinates
            if 'properties' in feature and 'imageGeometry' in feature['properties']:
                image_geom = feature['properties']['imageGeometry']
                
                if image_geom['type'] == 'Point':
                    x, y = image_geom['coordinates']
                    return min_x <= x <= max_x and min_y <= y <= max_y
                
                elif image_geom['type'] == 'Polygon':
                    # Check if any coordinate is within bounds
                    for ring in image_geom['coordinates']:
                        for x, y in ring:
                            if min_x <= x <= max_x and min_y <= y <= max_y:
                                return True
                
                elif image_geom['type'] == 'LineString':
                    # Check if any coordinate is within bounds
                    for x, y in image_geom['coordinates']:
                        if min_x <= x <= max_x and min_y <= y <= max_y:
                            return True
            
            # Check imageBBox if available
            if 'properties' in feature and 'imageBBox' in feature['properties']:
                bbox = feature['properties']['imageBBox']
                if len(bbox) >= 4:
                    bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y = bbox[:4]
                    # Check if bounding boxes intersect
                    return not (bbox_max_x < min_x or bbox_min_x > max_x or 
                              bbox_max_y < min_y or bbox_min_y > max_y)
            
            return False
            
        except Exception as e:
            self.logger.warning(f"Error checking feature bounds: {e}")
            return False
    
    def _invoke_sagemaker_model(self, endpoint_name, image_data):
        """Invoke SageMaker model with image tile data"""
        try:
            # Create SageMaker Runtime client with default region
            # TODO: Make region configurable instead of hardcoded
            runtime = boto3.client('sagemaker-runtime', region_name='us-west-2')
            
            # Invoke endpoint with image data
            response = runtime.invoke_endpoint(
                EndpointName=endpoint_name,
                ContentType='image/png',  # Assuming PNG format from GDALTileFactory
                Body=image_data
            )
            
            # Parse response
            response_body = response['Body'].read()
            
            # Parse GeoJSON response
            geojson_response = json.loads(response_body.decode('utf-8'))
            
            # Extract features from FeatureCollection
            if 'features' in geojson_response:
                features = geojson_response['features']
                # Standardize feature properties to handle deprecated model responses
                features = self._standardize_feature_properties(features)
                return features
            else:
                self.logger.warning("Model response does not contain features")
                return []
            
        except Exception as e:
            raise RuntimeError(f"Model invocation failed: {str(e)}")
    
    def _standardize_feature_properties(self, features):
        """Standardize feature properties to handle deprecated model endpoint responses"""
        if not features:
            self.logger.debug("No features to standardize")
            return features
        
        self.logger.debug(f"Starting standardization of {len(features)} features")
        standardized_features = []
        
        for i, feature in enumerate(features):
            try:
                self.logger.debug(f"Processing feature {i}: {json.dumps(feature, indent=2)}")
                
                # Make a copy to avoid modifying original
                standardized_feature = json.loads(json.dumps(feature))
                
                # Ensure properties exist
                if 'properties' not in standardized_feature:
                    standardized_feature['properties'] = {}
                
                properties = standardized_feature['properties']
                original_props = list(properties.keys())
                self.logger.debug(f"Feature {i} original properties: {original_props}")
                
                # 1. Handle deprecated bounds_imcoords -> imageGeometry and imageBBox
                if 'bounds_imcoords' in properties:
                    bounds = properties['bounds_imcoords']
                    self.logger.debug(f"Feature {i} converting bounds_imcoords: {bounds}")
                    
                    if len(bounds) >= 4:
                        min_x, min_y, max_x, max_y = bounds[:4]
                        
                        # Create imageGeometry as a Point at the center
                        center_x = (min_x + max_x) / 2.0
                        center_y = (min_y + max_y) / 2.0
                        
                        properties['imageGeometry'] = {
                            'type': 'Point',
                            'coordinates': [center_x, center_y]
                        }
                        
                        # Create imageBBox from bounds
                        properties['imageBBox'] = [min_x, min_y, max_x, max_y]
                        
                        self.logger.debug(f"Feature {i} set imageGeometry: {properties['imageGeometry']}")
                        self.logger.debug(f"Feature {i} set imageBBox: {properties['imageBBox']}")
                    
                    # Remove deprecated property
                    del properties['bounds_imcoords']
                    self.logger.debug(f"Feature {i} removed bounds_imcoords")
                
                # Handle other deprecated geometry properties if ImagedFeaturePropertyAccessor is available
                elif ImagedFeaturePropertyAccessor is not None:
                    try:
                        property_accessor = ImagedFeaturePropertyAccessor(allow_deprecated=True)
                        existing_geometry = property_accessor.find_image_geometry(standardized_feature)
                        if existing_geometry is not None:
                            self.logger.debug(f"Feature {i} found existing geometry via accessor: {existing_geometry}")
                            
                            # Convert to current standard properties
                            ImagedFeaturePropertyAccessor.set_image_geometry(standardized_feature, existing_geometry)
                            ImagedFeaturePropertyAccessor.set_image_bbox(standardized_feature, existing_geometry)
                            
                            self.logger.debug(f"Feature {i} set imageGeometry via accessor: {standardized_feature['properties'].get('imageGeometry')}")
                            self.logger.debug(f"Feature {i} set imageBBox via accessor: {standardized_feature['properties'].get('imageBBox')}")
                            
                            # Remove other deprecated geometry properties
                            deprecated_geom_props = ['geom_imcoords', 'detection']
                            removed_props = []
                            for prop in deprecated_geom_props:
                                if prop in properties:
                                    del properties[prop]
                                    removed_props.append(prop)
                            
                            if removed_props:
                                self.logger.debug(f"Feature {i} removed deprecated geometry props: {removed_props}")
                    except Exception as e:
                        self.logger.warning(f"Feature {i} failed to use ImagedFeaturePropertyAccessor: {e}")
                
                # 2. Handle deprecated feature_types -> featureClasses conversion
                if 'feature_types' in properties:
                    feature_types = properties['feature_types']
                    self.logger.debug(f"Feature {i} converting feature_types: {feature_types} (type: {type(feature_types)})")
                    
                    feature_classes = []
                    
                    # Get detection score if available (fallback for missing scores)
                    fallback_detection_score = properties.get('detection_score', 1.0)
                    self.logger.debug(f"Feature {i} fallback detection score: {fallback_detection_score}")
                    
                    # Convert feature_types (can be string, array, or object)
                    if isinstance(feature_types, str):
                        self.logger.debug(f"Feature {i} processing string feature_types")
                        feature_classes.append({
                            'iri': feature_types,
                            'score': fallback_detection_score
                        })
                    elif isinstance(feature_types, list):
                        self.logger.debug(f"Feature {i} processing list feature_types")
                        for j, feature_type in enumerate(feature_types):
                            if isinstance(feature_type, str):
                                feature_classes.append({
                                    'iri': feature_type,
                                    'score': fallback_detection_score
                                })
                            elif isinstance(feature_type, dict) and 'iri' in feature_type:
                                # Already in correct format, just ensure score is present
                                feature_class = feature_type.copy()
                                if 'score' not in feature_class:
                                    feature_class['score'] = fallback_detection_score
                                feature_classes.append(feature_class)
                    elif isinstance(feature_types, dict):
                        self.logger.debug(f"Feature {i} processing object feature_types")
                        # Handle object format like { "sample_object": 1 }
                        for feature_type, score in feature_types.items():
                            converted_score = float(score) if score is not None else fallback_detection_score
                            self.logger.debug(f"Feature {i} converting {feature_type}: {score} -> {converted_score}")
                            feature_classes.append({
                                'iri': feature_type,
                                'score': converted_score
                            })
                    
                    if feature_classes:
                        properties['featureClasses'] = feature_classes
                        self.logger.debug(f"Feature {i} set featureClasses: {feature_classes}")
                    
                    # Remove deprecated properties
                    del properties['feature_types']
                    self.logger.debug(f"Feature {i} removed feature_types")
                
                # 3. Handle standalone detection_score -> featureClasses score conversion
                elif 'detection_score' in properties and 'featureClasses' in properties:
                    self.logger.debug(f"Feature {i} updating existing featureClasses with detection_score")
                    # Update existing featureClasses with detection_score if scores are missing
                    detection_score = properties['detection_score']
                    feature_classes = properties['featureClasses']
                    
                    for feature_class in feature_classes:
                        if 'score' not in feature_class or feature_class['score'] is None:
                            feature_class['score'] = detection_score
                            self.logger.debug(f"Feature {i} updated featureClass score to: {detection_score}")
                
                # 4. Remove standalone detection_score after processing
                if 'detection_score' in properties:
                    del properties['detection_score']
                    self.logger.debug(f"Feature {i} removed detection_score")
                
                final_props = list(properties.keys())
                self.logger.debug(f"Feature {i} final properties: {final_props}")
                self.logger.debug(f"Feature {i} standardized: {json.dumps(standardized_feature, indent=2)}")
                
                standardized_features.append(standardized_feature)
                
            except Exception as e:
                self.logger.error(f"Failed to standardize feature {i} properties: {e}")
                self.logger.debug(f"Feature {i} original data: {json.dumps(feature, indent=2)}")
                # Include original feature if standardization fails
                standardized_features.append(feature)
        
        self.logger.info(f"Standardized {len(standardized_features)} features from deprecated properties")
        return standardized_features
    
    def _transform_pixel_coordinates(self, features, offset_x, offset_y):
        """Transform pixel coordinates from tile-relative to image-relative"""
        transformed_features = []
        
        for feature in features:
            # Make a copy to avoid modifying original
            transformed_feature = json.loads(json.dumps(feature))
            
            try:
                # Transform imageGeometry coordinates
                if ('properties' in transformed_feature and 
                    'imageGeometry' in transformed_feature['properties']):
                    
                    image_geom = transformed_feature['properties']['imageGeometry']
                    
                    if image_geom['type'] == 'Point':
                        x, y = image_geom['coordinates']
                        image_geom['coordinates'] = [x + offset_x, y + offset_y]
                    
                    elif image_geom['type'] == 'Polygon':
                        for ring in image_geom['coordinates']:
                            for i, (x, y) in enumerate(ring):
                                ring[i] = [x + offset_x, y + offset_y]
                    
                    elif image_geom['type'] == 'LineString':
                        for i, (x, y) in enumerate(image_geom['coordinates']):
                            image_geom['coordinates'][i] = [x + offset_x, y + offset_y]
                
                # Transform imageBBox coordinates
                if ('properties' in transformed_feature and 
                    'imageBBox' in transformed_feature['properties']):
                    
                    bbox = transformed_feature['properties']['imageBBox']
                    if len(bbox) >= 4:
                        bbox[0] += offset_x  # min_x
                        bbox[1] += offset_y  # min_y
                        bbox[2] += offset_x  # max_x
                        bbox[3] += offset_y  # max_y
                
                transformed_features.append(transformed_feature)
                
            except Exception as e:
                self.logger.warning(f"Failed to transform feature coordinates: {e}")
                # Include original feature if transformation fails
                transformed_features.append(feature)
        
        return transformed_features



# =============================================================================
# FROM: 04e_coordinate_processors.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.

# Coordinate processors: Handle image-to-world and world-to-image coordinate transformations

class ImageToWorldProcessor(BaseMessageProcessor):
    """Process IMAGE_TO_WORLD messages for coordinate transformation"""
    
    @handle_errors_enhanced('IMAGE_TO_WORLD_RESPONSE', 'image_to_world')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['dataset', 'imageCoordinates'])
        dataset = data['dataset']
        image_coordinates = data['imageCoordinates']
        
        self.logger.debug(f"Processing image to world transformation for dataset: {dataset}")
        
        # Get image factory from cache to access sensor model
        image_factory = self.cache_manager.get_image_factory(dataset)
        if image_factory is None:
            # Try to load the image if it's not in cache
            image_factory = self.cache_manager.load_image(dataset)
            if image_factory is None:
                raise ValueError(f"Failed to load image: {dataset}")
        
        # Get the sensor model
        sensor_model = image_factory.sensor_model
        if sensor_model is None:
            raise ValueError(f"No sensor model available for dataset: {dataset}")
        
        # Transform coordinates
        try:
            world_coordinates = []
            
            for img_coord in image_coordinates:
                # Validate coordinate format
                if not isinstance(img_coord, (list, tuple)) or len(img_coord) < 2:
                    raise ValueError(f"Invalid image coordinate format: {img_coord}. Expected [x, y] or [x, y, z]")
                
                x, y = img_coord[0], img_coord[1]
                
                # Create ImageCoordinate object
                from aws.osml.photogrammetry import ImageCoordinate
                image_coordinate = ImageCoordinate([x, y])
                
                # Transform to world coordinate using sensor model
                # Note: elevation_model parameter is optional - if not provided, 
                # sensor model will use default elevation assumptions
                elevation_model = None  # Could be enhanced to accept DEM in future
                world_coord = sensor_model.image_to_world(image_coordinate, elevation_model)
                
                # Convert from radians to degrees for user interface
                longitude_degrees = world_coord.longitude * 180.0 / 3.14159265359
                latitude_degrees = world_coord.latitude * 180.0 / 3.14159265359
                elevation_meters = world_coord.elevation
                
                world_coordinates.append([longitude_degrees, latitude_degrees, elevation_meters])
            
            self.logger.debug(f"Successfully transformed {len(world_coordinates)} coordinates")
            
            # Send successful response
            response = ResponseBuilder.success_response('IMAGE_TO_WORLD_RESPONSE', {
                'dataset': dataset,
                'worldCoordinates': world_coordinates
            })
            comm.send(response)
            
        except Exception as e:
            # Re-raise to be caught by error handler decorator
            raise e


class WorldToImageProcessor(BaseMessageProcessor):
    """Process WORLD_TO_IMAGE messages for coordinate transformation"""
    
    @handle_errors_enhanced('WORLD_TO_IMAGE_RESPONSE', 'world_to_image')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['dataset', 'worldCoordinates'])
        dataset = data['dataset']
        world_coordinates = data['worldCoordinates']
        
        self.logger.debug(f"Processing world to image transformation for dataset: {dataset}")
        
        # Get image factory from cache to access sensor model
        image_factory = self.cache_manager.get_image_factory(dataset)
        if image_factory is None:
            # Try to load the image if it's not in cache
            image_factory = self.cache_manager.load_image(dataset)
            if image_factory is None:
                raise ValueError(f"Failed to load image: {dataset}")
        
        # Get the sensor model
        sensor_model = image_factory.sensor_model
        if sensor_model is None:
            raise ValueError(f"No sensor model available for dataset: {dataset}")
        
        # Transform coordinates
        try:
            image_coordinates = []
            
            for world_coord in world_coordinates:
                # Validate coordinate format
                if not isinstance(world_coord, (list, tuple)) or len(world_coord) < 3:
                    raise ValueError(f"Invalid world coordinate format: {world_coord}. Expected [longitude_deg, latitude_deg, elevation_m]")
                
                longitude_degrees, latitude_degrees, elevation_meters = world_coord[0], world_coord[1], world_coord[2]
                
                # Convert from degrees to radians for internal API
                longitude_radians = longitude_degrees * 3.14159265359 / 180.0
                latitude_radians = latitude_degrees * 3.14159265359 / 180.0
                
                # Create GeodeticWorldCoordinate object
                from aws.osml.photogrammetry import GeodeticWorldCoordinate
                world_coordinate = GeodeticWorldCoordinate([longitude_radians, latitude_radians, elevation_meters])
                
                # Transform to image coordinate using sensor model
                image_coord = sensor_model.world_to_image(world_coordinate)
                
                # Extract x, y coordinates
                x = image_coord.x
                y = image_coord.y
                
                image_coordinates.append([x, y])
            
            self.logger.debug(f"Successfully transformed {len(image_coordinates)} coordinates")
            
            # Send successful response
            response = ResponseBuilder.success_response('WORLD_TO_IMAGE_RESPONSE', {
                'dataset': dataset,
                'imageCoordinates': image_coordinates
            })
            comm.send(response)
            
        except Exception as e:
            # Re-raise to be caught by error handler decorator
            raise e



# =============================================================================
# FROM: 05_legacy.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.



# =============================================================================
# FROM: 06_main.py
# =============================================================================

# Copyright Amazon.com, Inc. or its affiliates.

# Main initialization: Infrastructure setup and comm channel registration

# Initialize the global infrastructure components
global_cache_manager = AdvancedCacheManager()
global_logger = OSMLKernelLogger()
global_message_registry = MessageHandlerRegistry()

# Register message processors with the registry
def initialize_message_processors():
    """Initialize and register message processors"""
    # Create processor instances
    image_load_processor = ImageLoadProcessor(global_cache_manager, global_logger)
    image_tile_processor = ImageTileProcessor(global_cache_manager, global_logger)
    overlay_tile_processor = OverlayTileProcessor(global_cache_manager, global_logger)
    
    # Image metadata and lifecycle processors
    image_metadata_processor = ImageMetadataProcessor(global_cache_manager, global_logger)
    image_statistics_processor = ImageStatisticsProcessor(global_cache_manager, global_logger)
    image_unload_processor = ImageUnloadProcessor(global_cache_manager, global_logger)
    
    # Overlay lifecycle and ML/model inference processors
    overlay_load_processor = OverlayLoadProcessor(global_cache_manager, global_logger)
    overlay_unload_processor = OverlayUnloadProcessor(global_cache_manager, global_logger)
    endpoint_list_processor = EndpointListProcessor(global_cache_manager, global_logger)
    model_tile_processor = ModelTileProcessor(global_cache_manager, global_logger)
    
    # Register existing processors with the message registry
    global_message_registry.register('IMAGE_LOAD_REQUEST', image_load_processor)
    global_message_registry.register('IMAGE_TILE_REQUEST', image_tile_processor)
    global_message_registry.register('OVERLAY_TILE_REQUEST', overlay_tile_processor)
    
    # Register image metadata and lifecycle processors
    global_message_registry.register('IMAGE_METADATA_REQUEST', image_metadata_processor)
    global_message_registry.register('IMAGE_STATISTICS_REQUEST', image_statistics_processor)
    global_message_registry.register('IMAGE_UNLOAD_REQUEST', image_unload_processor)
    
    # Register overlay lifecycle and ML/model inference processors
    global_message_registry.register('OVERLAY_LOAD_REQUEST', overlay_load_processor)
    global_message_registry.register('OVERLAY_UNLOAD_REQUEST', overlay_unload_processor)
    global_message_registry.register('LIST_AVAILABLE_ENDPOINTS', endpoint_list_processor)
    global_message_registry.register('MODEL_TILE_REQUEST', model_tile_processor)
    
    global_logger.info("Message processors initialized and registered")

# Initialize message processors
initialize_message_processors()

# Global comm reference for debugging and diagnostics
osml_comm = None

def create_router_function(comm):
    """New message handler that uses the message registry"""
    def _recv(msg):
        try:
            # Extract message data
            message_data = msg['content']['data']
            message_type = message_data.get('type')
            
            if not message_type:
                global_logger.error("Received message without type field")
                return
            
            global_logger.debug(f"Processing message type: {message_type}")
            
            # Use the message registry to handle the message
            global_message_registry.handle(message_type, message_data, comm)
            
        except Exception as e:
            global_logger.log_error_detailed("message_processing", e, message_data if 'message_data' in locals() else None)
            # Send generic error response if we can determine the expected response type
            if 'message_type' in locals() and message_type:
                response = ResponseBuilder.error_response(
                    f"{message_type}_RESPONSE",
                    f"Message processing failed: {str(e)}"
                )
                comm.send(response)
    
    return _recv

def osml_comm_target_func(comm, msg):
    """Main comm target function for handling frontend communication"""
    global osml_comm
    # comm is the kernel Comm instance
    # msg is the comm_open message

    osml_comm = comm
    
    # Register handler for later messages using new registry-based system
    comm.on_msg(create_router_function(comm))

    # Send data to the frontend
    comm.send({'type': "KERNEL_COMM_SETUP_COMPLETE"})

# Register the communication target with IPython kernel
get_ipython().kernel.comm_manager.register_target('osml_comm_target', osml_comm_target_func)

# Log successful initialization
global_logger.info("OSML Jupyter Extension kernel setup complete")
global_logger.info(f"Registered message types: {get_registered_message_types()}")
global_logger.info("Using new message processor architecture")


"osml-jupyter-extension:JupyterImageLayer:KERNEL_SETUP_COMPLETE"
