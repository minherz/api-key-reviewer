// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseUrlHash,
  hasApiRestrictions,
  hasAppRestrictions,
  getRestrictionLevel,
  getHumanReadableRestrictions,
  formatDate,
  formatCopyrightVersion,
  parseApiKey,
  runConcurrentTasks,
  isValidAccessTokenFormat,
  copyToClipboard
} from './utils';
import { ApiKeyRestrictions } from './types';

describe('utils.ts unit tests', () => {
  describe('parseUrlHash', () => {
    it('should parse standard query parameter hashes correctly', () => {
      const hash = '#access_token=ya29.xxxx&token_type=Bearer&expires_in=3600&state=secure_state';
      const parsed = parseUrlHash(hash);
      expect(parsed.access_token).toBe('ya29.xxxx');
      expect(parsed.token_type).toBe('Bearer');
      expect(parsed.expires_in).toBe('3600');
      expect(parsed.state).toBe('secure_state');
    });

    it('should work without the leading hash mark', () => {
      const hash = 'access_token=ya29.xxxx&state=123';
      const parsed = parseUrlHash(hash);
      expect(parsed.access_token).toBe('ya29.xxxx');
      expect(parsed.state).toBe('123');
    });

    it('should return empty object for empty or missing hash', () => {
      expect(parseUrlHash('')).toEqual({});
    });
  });

  describe('hasApiRestrictions', () => {
    it('should return false for empty or undefined restrictions', () => {
      expect(hasApiRestrictions(undefined)).toBe(false);
      expect(hasApiRestrictions({})).toBe(false);
    });

    it('should return false for empty apiTargets array', () => {
      expect(hasApiRestrictions({ apiTargets: [] })).toBe(false);
    });

    it('should return true when apiTargets has items', () => {
      expect(hasApiRestrictions({ apiTargets: [{ service: 'translate.googleapis.com' }] })).toBe(true);
    });
  });

  describe('hasAppRestrictions', () => {
    it('should return false for empty or undefined restrictions', () => {
      expect(hasAppRestrictions(undefined)).toBe(false);
      expect(hasAppRestrictions({})).toBe(false);
    });

    it('should return true for browser restrictions', () => {
      const r: ApiKeyRestrictions = {
        browserKeyRestrictions: { allowedReferrers: ['*.example.com'] }
      };
      expect(hasAppRestrictions(r)).toBe(true);
    });

    it('should return true for server restrictions', () => {
      const r: ApiKeyRestrictions = {
        serverKeyRestrictions: { allowedIps: ['192.168.1.1'] }
      };
      expect(hasAppRestrictions(r)).toBe(true);
    });

    it('should return true for android restrictions', () => {
      const r: ApiKeyRestrictions = {
        androidKeyRestrictions: {
          allowedApplications: [{ packageName: 'com.example', sha1Fingerprint: 'A1B2' }]
        }
      };
      expect(hasAppRestrictions(r)).toBe(true);
    });

    it('should return true for ios restrictions', () => {
      const r: ApiKeyRestrictions = {
        iosKeyRestrictions: { allowedBundleIds: ['com.example.bundle'] }
      };
      expect(hasAppRestrictions(r)).toBe(true);
    });

    it('should return false if arrays are empty', () => {
      const r: ApiKeyRestrictions = {
        browserKeyRestrictions: { allowedReferrers: [] },
        serverKeyRestrictions: { allowedIps: [] }
      };
      expect(hasAppRestrictions(r)).toBe(false);
    });
  });

  describe('getRestrictionLevel', () => {
    it('should return none when there are no restrictions', () => {
      expect(getRestrictionLevel(undefined)).toBe('none');
      expect(getRestrictionLevel({})).toBe('none');
    });

    it('should return some when only API restrictions are present', () => {
      const r: ApiKeyRestrictions = {
        apiTargets: [{ service: 'sheets.googleapis.com' }]
      };
      expect(getRestrictionLevel(r)).toBe('some');
    });

    it('should return some when only application restrictions are present', () => {
      const r: ApiKeyRestrictions = {
        browserKeyRestrictions: { allowedReferrers: ['*'] }
      };
      expect(getRestrictionLevel(r)).toBe('some');
    });

    it('should return full when both API and application restrictions are present', () => {
      const r: ApiKeyRestrictions = {
        apiTargets: [{ service: 'sheets.googleapis.com' }],
        browserKeyRestrictions: { allowedReferrers: ['*'] }
      };
      expect(getRestrictionLevel(r)).toBe('full');
    });
  });

  describe('getHumanReadableRestrictions', () => {
    it('should return warning for undefined restrictions', () => {
      const text = getHumanReadableRestrictions(undefined);
      expect(text).toHaveLength(1);
      expect(text[0]).toContain('No restrictions applied; can be used to call any enabled Google API');
    });

    it('should detail API and Application restrictions correctly', () => {
      const r: ApiKeyRestrictions = {
        apiTargets: [{ service: 'sheets.googleapis.com', methods: ['GetValues'] }],
        browserKeyRestrictions: { allowedReferrers: ['https://example.com/*'] }
      };
      const text = getHumanReadableRestrictions(r);
      expect(text).toHaveLength(3);
      expect(text[0]).toContain('API Restrictions: Restricted to sheets.googleapis.com (methods: GetValues)');
      expect(text[1]).toContain('Application Restrictions (Web/Browser): Allowed referrers: https://example.com/*');
      expect(text[2]).toBe('Service Account: Not bound to a service account');
    });

    it('should detail service account binding correctly', () => {
      const r: ApiKeyRestrictions = {
        apiTargets: [{ service: 'sheets.googleapis.com', methods: ['GetValues'] }],
        browserKeyRestrictions: { allowedReferrers: ['https://example.com/*'] }
      };
      const text = getHumanReadableRestrictions(r, 'app-service-account@project.iam.gserviceaccount.com');
      expect(text).toHaveLength(3);
      expect(text[0]).toContain('API Restrictions: Restricted to sheets.googleapis.com (methods: GetValues)');
      expect(text[1]).toContain('Application Restrictions (Web/Browser): Allowed referrers: https://example.com/*');
      expect(text[2]).toBe('Service Account: Bound to a service account');
    });
  });

  describe('formatDate', () => {
    it('should handle undefined or invalid dates gracefully', () => {
      expect(formatDate(undefined)).toBe('Unknown');
      expect(formatDate('invalid-date')).toBe('Unknown');
    });

    it('should format valid ISO strings correctly', () => {
      const dateStr = '2026-07-04T12:00:00Z';
      const formatted = formatDate(dateStr);
      expect(formatted).not.toBe('Unknown');
      expect(formatted).toContain('2026');
    });
  });

  describe('formatCopyrightVersion', () => {
    it('should format version without short SHA', () => {
      const result = formatCopyrightVersion('v0.0.1');
      expect(result).toBe('&copy; 2026 Google API Keys Finder v0.0.1. All rights reserved.');
    });

    it('should format version with short SHA and create commit link', () => {
      const result = formatCopyrightVersion('v1.2.0-b42+a1b2c3d');
      expect(result).toBe(
        '&copy; 2026 Google API Keys Finder v1.2.0-b42+<a href="https://github.com/minherz/api-keys-finder/commit/a1b2c3d" target="_blank" rel="noopener noreferrer">a1b2c3d</a>. All rights reserved.'
      );
    });

    it('should handle undefined, empty string, and whitespace with fallback', () => {
      const expectedFallback = '&copy; 2026 Google API Keys Finder v0.0.1-preview. All rights reserved.';
      expect(formatCopyrightVersion(undefined)).toBe(expectedFallback);
      expect(formatCopyrightVersion('')).toBe(expectedFallback);
      expect(formatCopyrightVersion('   ')).toBe(expectedFallback);
    });

    it('should prepend v if version string lacks leading v', () => {
      const result = formatCopyrightVersion('1.0.0+a1b2c3d');
      expect(result).toBe(
        '&copy; 2026 Google API Keys Finder v1.0.0+<a href="https://github.com/minherz/api-keys-finder/commit/a1b2c3d" target="_blank" rel="noopener noreferrer">a1b2c3d</a>. All rights reserved.'
      );
    });

    it('should support custom repository path', () => {
      const result = formatCopyrightVersion('v2.0.0+1234567', 'my-org/my-repo');
      expect(result).toBe(
        '&copy; 2026 Google API Keys Finder v2.0.0+<a href="https://github.com/my-org/my-repo/commit/1234567" target="_blank" rel="noopener noreferrer">1234567</a>. All rights reserved.'
      );
    });
  });

  describe('parseApiKey', () => {
    it('should parse an unrestricted key correctly with default fallback values', () => {
      const rawKey = { uid: 'key-1', createTime: '2026-07-28T00:00:00Z' };
      const parsed = parseApiKey(rawKey as any, 'proj-abc');

      expect(parsed.uid).toBe('key-1');
      expect(parsed.displayName).toBe('Unnamed Key');
      expect(parsed.projectId).toBe('proj-abc');
      expect(parsed.restrictionLevel).toBe('none');
      expect(parsed.rawRestrictions).toEqual({});
      expect(parsed.humanReadableRestrictions).toEqual(['No restrictions applied; can be used to call any enabled Google API']);
    });

    it('should respect custom display name when provided', () => {
      const rawKey = { uid: 'key-2', displayName: 'Production DB Key' };
      const parsed = parseApiKey(rawKey as any, 'proj-xyz');
      expect(parsed.displayName).toBe('Production DB Key');
    });

    it('should parse fully restricted keys correctly', () => {
      const rawKey = {
        uid: 'key-3',
        restrictions: {
          browserKeyRestrictions: { allowedReferrers: ['*.example.com'] },
          apiTargets: [{ service: 'translate.googleapis.com' }]
        }
      };
      const parsed = parseApiKey(rawKey as any, 'proj-123');
      expect(parsed.restrictionLevel).toBe('full');
      expect(parsed.rawRestrictions.apiTargets).toBeDefined();
    });
  });

  describe('runConcurrentTasks', () => {
    it('should execute the task function once for each item', async () => {
      const items = [10, 20, 30];
      const processed: number[] = [];

      await runConcurrentTasks(items, 2, async (item) => {
        processed.push(item);
      });

      expect(processed).toHaveLength(3);
      expect(processed).toContain(10);
      expect(processed).toContain(20);
      expect(processed).toContain(30);
    });

    it('should strictly respect the maximum concurrency ceiling', async () => {
      const items = [1, 2, 3, 4, 5];
      let activeTasks = 0;
      let maxSeenConcurrency = 0;

      await runConcurrentTasks(items, 2, async () => {
        activeTasks++;
        maxSeenConcurrency = Math.max(maxSeenConcurrency, activeTasks);

        // Short async delay to guarantee overlap
        await new Promise(resolve => setTimeout(resolve, 20));

        activeTasks--;
      });

      expect(maxSeenConcurrency).toBeLessThanOrEqual(2);
    });

    it('should resolve immediately and do nothing for empty arrays', async () => {
      let runCount = 0;
      await runConcurrentTasks([], 4, async () => {
        runCount++;
      });
      expect(runCount).toBe(0);
    });

    it('should function correctly when concurrency is greater than the item list size', async () => {
      const items = [1, 2];
      const processed: number[] = [];

      await runConcurrentTasks(items, 10, async (item) => {
        processed.push(item);
      });

      expect(processed).toHaveLength(2);
    });
  });

  describe('isValidAccessTokenFormat', () => {
    it('should return true for valid ya29 access tokens', () => {
      expect(isValidAccessTokenFormat('ya29.valid_test_token_string')).toBe(true);
      expect(isValidAccessTokenFormat('  ya29.whitespace_padded  ')).toBe(true);
    });

    it('should return false for empty or non-ya29 tokens', () => {
      expect(isValidAccessTokenFormat('')).toBe(false);
      expect(isValidAccessTokenFormat('   ')).toBe(false);
      expect(isValidAccessTokenFormat('bearer 12345')).toBe(false);
      expect(isValidAccessTokenFormat(null as any)).toBe(false);
      expect(isValidAccessTokenFormat(undefined as any)).toBe(false);
    });
  });

  describe('copyToClipboard', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should use navigator.clipboard.writeText in secure context', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText: writeTextMock } });
      vi.stubGlobal('window', { isSecureContext: true });

      const result = await copyToClipboard('test command');
      expect(result).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith('test command');
    });

    it('should return false when navigator.clipboard.writeText rejects', async () => {
      const writeTextMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
      vi.stubGlobal('navigator', { clipboard: { writeText: writeTextMock } });
      vi.stubGlobal('window', { isSecureContext: true });

      const result = await copyToClipboard('test command');
      expect(result).toBe(false);
    });

    it('should fallback to document.execCommand when clipboard API is unavailable', async () => {
      const mockTextArea = {
        style: {} as any,
        focus: vi.fn(),
        select: vi.fn(),
        value: ''
      };
      const execCommandMock = vi.fn().mockReturnValue(true);
      const appendChildMock = vi.fn();
      const removeChildMock = vi.fn();

      vi.stubGlobal('navigator', {});
      vi.stubGlobal('window', { isSecureContext: false });
      vi.stubGlobal('document', {
        createElement: vi.fn().mockReturnValue(mockTextArea),
        body: {
          appendChild: appendChildMock,
          removeChild: removeChildMock
        },
        execCommand: execCommandMock
      });

      const result = await copyToClipboard('fallback command');
      expect(result).toBe(true);
      expect(execCommandMock).toHaveBeenCalledWith('copy');
      expect(appendChildMock).toHaveBeenCalled();
      expect(removeChildMock).toHaveBeenCalled();
    });
  });
});


