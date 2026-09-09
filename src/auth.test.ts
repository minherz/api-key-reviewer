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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAuthToken,
  getAuthSource,
  setManualAccessToken,
  clearManualAccessToken,
  logout
} from './auth';

describe('auth.ts unit tests', () => {
  let sessionStorageStore: Record<string, string> = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorageStore = {};

    // Mock sessionStorage
    const mockSessionStorage = {
      getItem: vi.fn((key: string) => sessionStorageStore[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        sessionStorageStore[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete sessionStorageStore[key];
      }),
      clear: vi.fn(() => {
        sessionStorageStore = {};
      }),
      length: 0,
      key: vi.fn()
    };

    vi.stubGlobal('sessionStorage', mockSessionStorage);

    // Clear active session in auth module
    clearManualAccessToken();
  });

  describe('initialization and session state', () => {
    it('should return null token and null source when unauthenticated', () => {
      expect(getAuthToken()).toBeNull();
      expect(getAuthSource()).toBeNull();
    });

    it('should default auth source to oauth for legacy sessions with missing auth source in storage', () => {
      clearManualAccessToken();
      sessionStorageStore['gcp_reviewer_token'] = 'ya29.legacy_token';
      // gcp_reviewer_auth_source is deliberately omitted

      expect(getAuthToken()).toBe('ya29.legacy_token');
      expect(getAuthSource()).toBe('oauth');
    });

    it('should trim whitespace when setting manual access token', () => {
      setManualAccessToken('   ya29.trimmed_token   ');
      expect(getAuthToken()).toBe('ya29.trimmed_token');
      expect(sessionStorageStore['gcp_reviewer_token']).toBe('ya29.trimmed_token');
    });
  });

  describe('manual access token management', () => {
    it('should set, retrieve, and store a manual access token', () => {
      const sampleToken = 'ya29.sample_manual_access_token_for_testing';

      setManualAccessToken(sampleToken);

      expect(getAuthToken()).toBe(sampleToken);
      expect(getAuthSource()).toBe('manual');
      expect(sessionStorageStore['gcp_reviewer_token']).toBe(sampleToken);
      expect(sessionStorageStore['gcp_reviewer_auth_source']).toBe('manual');
    });

    it('should clear manual access token and reset session', () => {
      setManualAccessToken('ya29.dummy_token');
      expect(getAuthToken()).toBe('ya29.dummy_token');

      clearManualAccessToken();

      expect(getAuthToken()).toBeNull();
      expect(getAuthSource()).toBeNull();
      expect(sessionStorageStore['gcp_reviewer_token']).toBeUndefined();
      expect(sessionStorageStore['gcp_reviewer_auth_source']).toBeUndefined();
    });
  });

  describe('logout and token revocation', () => {
    it('should not call Google token revocation endpoint when logging out with a manual token', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
      vi.stubGlobal('fetch', mockFetch);

      setManualAccessToken('ya29.manual_token');
      expect(getAuthSource()).toBe('manual');

      await logout();

      expect(getAuthToken()).toBeNull();
      expect(getAuthSource()).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should call Google token revocation endpoint when logging out with an OAuth token', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
      vi.stubGlobal('fetch', mockFetch);

      // Simulate OAuth session in sessionStorage
      clearManualAccessToken();
      sessionStorageStore['gcp_reviewer_token'] = 'ya29.oauth_token';
      sessionStorageStore['gcp_reviewer_auth_source'] = 'oauth';

      // Re-initialize session from sessionStorage
      expect(getAuthToken()).toBe('ya29.oauth_token');
      expect(getAuthSource()).toBe('oauth');

      await logout();

      expect(getAuthToken()).toBeNull();
      expect(getAuthSource()).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://oauth2.googleapis.com/revoke?token=ya29.oauth_token'),
        expect.any(Object)
      );
    });
  });
});

