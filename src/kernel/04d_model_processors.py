# Model processors: Handle endpoint listing and model inference

import time
import json
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
        scale_factor = 2**(-target_zoom)
        
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
