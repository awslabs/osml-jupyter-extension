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
