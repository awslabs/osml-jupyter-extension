import React, { FC } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import FormField from '@cloudscape-design/components/form-field';
import Select from '@cloudscape-design/components/select';
import Input from '@cloudscape-design/components/input';

interface ImageSelectionComponentProps {
  setImageLocation: (value: string | undefined) => void;
  setImageSourceType: (value: string | undefined) => void;
}

const ImageSelectionComponent: FC<ImageSelectionComponentProps> = ({
  setImageLocation,
  setImageSourceType
}) => {
  const [imageLocation, setImageLocationState] = React.useState('');
  const [imageSourceType, setImageSourceTypeState] = React.useState({
    label: 'Local Image',
    value: 'LOCAL_IMAGE'
  });
  const updateSelectedImage = (option: any, imageLocation: string) => {
    setImageLocationState(imageLocation);
    setImageSourceTypeState(option);
    setImageLocation(imageLocation);
    setImageSourceType(option.value);
  };

  return (
    <>
      <FormField label="Local Image Path">
        <Input
          value={imageLocation}
          onChange={event =>
            updateSelectedImage(imageSourceType, event.detail.value)
          }
        />
      </FormField>
      <Select
        selectedOption={imageSourceType}
        onChange={({ detail }) =>
          updateSelectedImage(detail.selectedOption, imageLocation)
        }
        options={[
          { label: 'Local Image', value: 'LOCAL_IMAGE' },
          { label: 'Tile Server', value: 'TILE_SERVER' }
        ]}
      />
    </>
  );
};
export default class ImageSelectionDialog extends ReactWidget {
  private imageLocation: string | undefined;
  private imageSourceType: string | undefined;

  constructor() {
    super();
    this.addClass('jp-react-widget');
    this.imageSourceType = '';
    this.imageLocation = '';
  }

  setImageLocation = (value: string | undefined) => {
    this.imageLocation = value;
  };
  setImageSourceType = (value: string | undefined) => {
    this.imageSourceType = value;
  };

  render(): JSX.Element {
    return (
      <ImageSelectionComponent
        setImageLocation={this.setImageLocation}
        setImageSourceType={this.setImageSourceType}
      />
    );
  }

  public getValue(): string {
    return JSON.stringify({
      imageLocation: this.imageLocation,
      imageSourceType: this.imageSourceType
    });
  }
}
