# Message processors: MessageHandlerRegistry and processor management

import time
import base64
import shapely
import json
import boto3

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
        
        # Calculate scale and tile parameters (matching legacy logic)
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


class OverlayTileProcessor(BaseMessageProcessor):
    """Process OVERLAY_TILE_REQUEST messages with proper zoom level handling"""
    
    # Feature count limits based on zoom level for performance
    ZOOM_FEATURE_LIMITS = {
        -3: 50,   # Very zoomed out - only show most important features
        -2: 100,
        -1: 200,
        0: 500,   # Base zoom level
        1: 1000,
        2: 2000,
        3: 5000,  # Very zoomed in - show all details
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
            if features:
                features = self._filter_features_by_zoom(features, zoom)
            
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
            band_stats = {'band_number': band_num}
            
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
            # Create SageMaker client
            sagemaker = boto3.client('sagemaker')
            
            # List endpoints
            response = sagemaker.list_endpoints(
                StatusEquals='InService',  # Only get active endpoints
                MaxResults=100  # Reasonable limit
            )
            
            # Extract endpoint names
            endpoints = []
            for endpoint in response.get('Endpoints', []):
                endpoints.append(endpoint['EndpointName'])
            
            # Handle pagination if needed
            while 'NextToken' in response:
                response = sagemaker.list_endpoints(
                    StatusEquals='InService',
                    MaxResults=100,
                    NextToken=response['NextToken']
                )
                for endpoint in response.get('Endpoints', []):
                    endpoints.append(endpoint['EndpointName'])
            
            return endpoints
            
        except Exception as e:
            raise RuntimeError(f"SageMaker API error: {str(e)}")


class ModelTileProcessor(BaseMessageProcessor):
    """Process MODEL_TILE_REQUEST messages with zoom-aware inference"""
    
    @handle_errors_enhanced('MODEL_TILE_RESPONSE', 'model_tile')
    def process(self, data, comm):
        # Validate request
        self.validate_request(data, ['dataset', 'endpointName', 'zoom', 'row', 'col'])
        dataset = data['dataset']
        endpoint_name = data['endpointName']
        zoom = data['zoom']
        row = data['row']
        col = data['col']
        
        self.logger.debug(f"Processing model tile request for dataset: {dataset}, endpoint: {endpoint_name}, zoom: {zoom}, row: {row}, col: {col}")
        
        # Get features for the requested tile
        try:
            if zoom == 0:
                # Direct model inference at zoom 0
                features = self._process_zoom0_tile(dataset, endpoint_name, row, col)
            else:
                # Aggregate zoom 0 results for higher zoom levels
                features = self._process_higher_zoom_tile(dataset, endpoint_name, zoom, row, col)
            
            feature_count = len(features) if features else 0
            self.logger.debug(f"Returning {feature_count} features for model tile at zoom {zoom}")
            
            # Send successful response
            response = ResponseBuilder.success_response('MODEL_TILE_RESPONSE', {
                'features': features
            })
            comm.send(response)
            
        except Exception as e:
            # Re-raise to be caught by error handler decorator
            raise e
    
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
        scale_factor = 2 ** target_zoom
        
        # Calculate zoom 0 bounds 
        zoom0_start_row = target_row * scale_factor
        zoom0_start_col = target_col * scale_factor  
        zoom0_end_row = zoom0_start_row + scale_factor
        zoom0_end_col = zoom0_start_col + scale_factor
        
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
            # Create SageMaker Runtime client
            runtime = boto3.client('sagemaker-runtime')
            
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
                return geojson_response['features']
            else:
                self.logger.warning("Model response does not contain features")
                return []
            
        except Exception as e:
            raise RuntimeError(f"Model invocation failed: {str(e)}")
    
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
