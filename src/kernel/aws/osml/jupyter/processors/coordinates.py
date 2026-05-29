# Copyright Amazon.com, Inc. or its affiliates.

from aws.osml.jupyter.core import BaseMessageProcessor
from aws.osml.jupyter.responses import ResponseBuilder, handle_errors_enhanced


class ImageToWorldProcessor(BaseMessageProcessor):
    """Process IMAGE_TO_WORLD messages for coordinate transformation"""

    @handle_errors_enhanced('IMAGE_TO_WORLD_RESPONSE', 'image_to_world')
    def process(self, data, comm):
        self.validate_request(data, ['dataset', 'imageCoordinates'])
        dataset = data['dataset']
        image_coordinates = data['imageCoordinates']

        self.logger.debug(f"Processing image to world transformation for dataset: {dataset}")

        session = self.cache_manager.get_image_session(dataset)
        if session is None:
            session = self.cache_manager.load_image(dataset)
            if session is None:
                raise ValueError(f"Failed to load image: {dataset}")

        if session.sensor_model is None:
            raise ValueError(f"No sensor model available for dataset: {dataset}")

        try:
            world_coordinates = []

            for img_coord in image_coordinates:
                if not isinstance(img_coord, (list, tuple)) or len(img_coord) < 2:
                    raise ValueError(
                        f"Invalid image coordinate format: {img_coord}. Expected [x, y] or [x, y, z]"
                    )

                x, y = img_coord[0], img_coord[1]

                from aws.osml.photogrammetry import ImageCoordinate
                image_coordinate = ImageCoordinate([x, y])

                elevation_model = None
                world_coord = session.sensor_model.image_to_world(image_coordinate, elevation_model)

                longitude_degrees = world_coord.longitude * 180.0 / 3.14159265359
                latitude_degrees = world_coord.latitude * 180.0 / 3.14159265359
                elevation_meters = world_coord.elevation

                world_coordinates.append([longitude_degrees, latitude_degrees, elevation_meters])

            self.logger.debug(f"Successfully transformed {len(world_coordinates)} coordinates")

            response = ResponseBuilder.success_response('IMAGE_TO_WORLD_RESPONSE', {
                'dataset': dataset,
                'worldCoordinates': world_coordinates,
            })
            comm.send(response)
        except Exception as e:
            raise e


class WorldToImageProcessor(BaseMessageProcessor):
    """Process WORLD_TO_IMAGE messages for coordinate transformation"""

    @handle_errors_enhanced('WORLD_TO_IMAGE_RESPONSE', 'world_to_image')
    def process(self, data, comm):
        self.validate_request(data, ['dataset', 'worldCoordinates'])
        dataset = data['dataset']
        world_coordinates = data['worldCoordinates']

        self.logger.debug(f"Processing world to image transformation for dataset: {dataset}")

        session = self.cache_manager.get_image_session(dataset)
        if session is None:
            session = self.cache_manager.load_image(dataset)
            if session is None:
                raise ValueError(f"Failed to load image: {dataset}")

        if session.sensor_model is None:
            raise ValueError(f"No sensor model available for dataset: {dataset}")

        try:
            image_coordinates = []

            for world_coord in world_coordinates:
                if not isinstance(world_coord, (list, tuple)) or len(world_coord) < 3:
                    raise ValueError(
                        f"Invalid world coordinate format: {world_coord}. "
                        "Expected [longitude_deg, latitude_deg, elevation_m]"
                    )

                longitude_degrees, latitude_degrees, elevation_meters = (
                    world_coord[0], world_coord[1], world_coord[2]
                )

                longitude_radians = longitude_degrees * 3.14159265359 / 180.0
                latitude_radians = latitude_degrees * 3.14159265359 / 180.0

                from aws.osml.photogrammetry import GeodeticWorldCoordinate
                world_coordinate = GeodeticWorldCoordinate(
                    [longitude_radians, latitude_radians, elevation_meters]
                )

                image_coord = session.sensor_model.world_to_image(world_coordinate)
                x = image_coord.x
                y = image_coord.y

                image_coordinates.append([x, y])

            self.logger.debug(f"Successfully transformed {len(image_coordinates)} coordinates")

            response = ResponseBuilder.success_response('WORLD_TO_IMAGE_RESPONSE', {
                'dataset': dataset,
                'imageCoordinates': image_coordinates,
            })
            comm.send(response)
        except Exception as e:
            raise e
