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
