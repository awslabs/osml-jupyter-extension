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
