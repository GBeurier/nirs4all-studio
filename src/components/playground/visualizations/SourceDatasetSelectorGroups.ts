import type { SourceOption } from './sourceDatasetOptions';

export interface SourceOptionGroup {
  id: 'input' | 'preprocessing' | 'other';
  labelKey: string;
  options: SourceOption[];
}

export function groupSourceOptions(options: SourceOption[]): SourceOptionGroup[] {
  const inputGroup: SourceOptionGroup = { id: 'input', labelKey: 'playground.charts.sourceDataset.groupInput', options: [] };
  const preprocessingGroup: SourceOptionGroup = {
    id: 'preprocessing',
    labelKey: 'playground.charts.sourceDataset.groupPreprocessing',
    options: [],
  };
  const otherGroup: SourceOptionGroup = { id: 'other', labelKey: 'playground.charts.sourceDataset.groupOther', options: [] };
  const groups: SourceOptionGroup[] = [
    inputGroup,
    preprocessingGroup,
    otherGroup,
  ];

  options.forEach(option => {
    if (option.type === 'original') {
      inputGroup.options.push(option);
    } else if (option.type === 'preprocessor' || option.type === 'splitter') {
      preprocessingGroup.options.push(option);
    } else {
      otherGroup.options.push(option);
    }
  });

  return groups.filter(group => group.options.length > 0);
}
