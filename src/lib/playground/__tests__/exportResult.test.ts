import { describe, expect, it } from 'vitest';

import { buildExportBlob, toExportError } from '@/lib/playground/exportResult';
import { EXPORT_MIME_TYPES } from '@/lib/playground/exportDownload';

describe('buildExportBlob', () => {
  it('wraps text content in a blob with the format MIME type', () => {
    const blob = buildExportBlob('a,b,c\n1,2,3', 'csv');

    expect(blob.type).toBe(EXPORT_MIME_TYPES.csv);
    expect(blob.size).toBe('a,b,c\n1,2,3'.length);
  });

  it('uses the JSON MIME type for json exports', () => {
    const blob = buildExportBlob('{"a":1}', 'json');

    expect(blob.type).toBe(EXPORT_MIME_TYPES.json);
  });

  it('produces an empty blob for empty content', () => {
    const blob = buildExportBlob('', 'txt');

    expect(blob.size).toBe(0);
    expect(blob.type).toBe(EXPORT_MIME_TYPES.txt);
  });
});

describe('toExportError', () => {
  it('uses the message from Error instances', () => {
    expect(toExportError(new Error('boom'), 'csv')).toEqual({
      success: false,
      error: 'boom',
      format: 'csv',
    });
  });

  it('falls back to the default message for non-Error values', () => {
    expect(toExportError('nope', 'png')).toEqual({
      success: false,
      error: 'Export failed',
      format: 'png',
    });
  });

  it('honors a custom fallback message', () => {
    expect(toExportError(undefined, 'json', 'Custom failure')).toEqual({
      success: false,
      error: 'Custom failure',
      format: 'json',
    });
  });

  it('preserves the requested export format on failure', () => {
    expect(toExportError(new Error('x'), 'svg').format).toBe('svg');
  });
});
