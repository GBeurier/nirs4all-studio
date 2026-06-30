import type { SourceOption } from './sourceDatasetOptions';

export interface SourceOptionGroup {
  id: 'input' | 'preprocessing' | 'other';
  label: string;
  options: SourceOption[];
}

export function groupSourceOptions(options: SourceOption[]): SourceOptionGroup[] {
  const inputGroup: SourceOptionGroup = { id: 'input', label: 'Input', options: [] };
  const preprocessingGroup: SourceOptionGroup = {
    id: 'preprocessing',
    label: 'Preprocessing Steps',
    options: [],
  };
  const otherGroup: SourceOptionGroup = { id: 'other', label: 'Other', options: [] };
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
