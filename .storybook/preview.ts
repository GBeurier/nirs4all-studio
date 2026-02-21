import type { Preview } from '@storybook/react-vite';
import React from 'react';
import '../src/index.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#f8fafc' },
        { name: 'dark', value: '#1e293b' },
      ],
    },
  },
  decorators: [
    (Story) => React.createElement('div', { className: 'p-4' }, React.createElement(Story)),
  ],
};

export default preview;