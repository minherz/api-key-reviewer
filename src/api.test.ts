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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchUserProfile, fetchProjects, fetchProjectApiKeys, AppError, ServiceDisabledError } from './api';

// Mock only the getAuthToken export of auth.ts which is imported and consumed by api.ts
vi.mock('./auth', () => ({
  getAuthToken: () => 'dummy_token'
}));

describe('api.ts unit tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchUserProfile', () => {
    it('should return user profile on successful response', async () => {
      const mockUser = { sub: '123', name: 'Jane Doe', email: 'jane@example.com' };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockUser
      } as Response);
      vi.stubGlobal('fetch', mockFetch);

      const user = await fetchUserProfile();
      expect(user).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v3/userinfo', expect.any(Object));
    });

    it('should throw AppError on server error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid credentials'
      } as Response);
      vi.stubGlobal('fetch', mockFetch);

      await expect(fetchUserProfile()).rejects.toThrow(AppError);
    });

    it('should throw network error on client failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection failed'));
      vi.stubGlobal('fetch', mockFetch);

      try {
        await fetchUserProfile();
        expect.fail('Should have thrown an error');
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.source).toBe('client');
        expect(err.message).toBe('Connection failed');
      }
    });
  });

  describe('fetchProjects', () => {
    it('should fetch and paginate active projects', async () => {
      const mockResponse1 = {
        projects: [
          { projectId: 'proj-1', lifecycleState: 'ACTIVE' },
          { projectId: 'proj-2', lifecycleState: 'DELETED' } // should be filtered out
        ],
        nextPageToken: 'token-page-2'
      };

      const mockResponse2 = {
        projects: [
          { projectId: 'proj-3', lifecycleState: 'ACTIVE' }
        ]
      };

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse1
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse2
        } as Response);
      vi.stubGlobal('fetch', mockFetch);

      const projects = await fetchProjects();
      expect(projects).toHaveLength(2);
      expect(projects[0].projectId).toBe('proj-1');
      expect(projects[1].projectId).toBe('proj-3');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchProjectApiKeys', () => {
    it('should throw AppError on 403 or 404 error so callers can aggregate them', async () => {
      const mockResponse = {
        error: {
          code: 403,
          message: 'API Keys API is not enabled'
        }
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => JSON.stringify(mockResponse)
      } as Response);
      vi.stubGlobal('fetch', mockFetch);

      await expect(fetchProjectApiKeys('forbidden-proj')).rejects.toThrow(AppError);
    });

    it('should throw ServiceDisabledError on 403 when reason is SERVICE_DISABLED', async () => {
      const mockResponse = {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'API Keys API has not been used before or is disabled',
          details: [
            {
              reason: 'SERVICE_DISABLED',
              domain: 'googleapis.com'
            }
          ]
        }
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => JSON.stringify(mockResponse)
      } as Response);
      vi.stubGlobal('fetch', mockFetch);

      await expect(fetchProjectApiKeys('disabled-proj')).rejects.toThrow(ServiceDisabledError);
    });

    it('should use custom quotaProjectId for x-goog-user-project header when provided', async () => {
      const mockKeys = { keys: [] };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockKeys
      } as Response);
      vi.stubGlobal('fetch', mockFetch);

      await fetchProjectApiKeys('target-proj', undefined, 'quota-proj');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-goog-user-project': 'quota-proj'
          })
        })
      );
    });

    it('should default x-goog-user-project header to target projectId when quotaProjectId is not provided', async () => {
      const mockKeys = { keys: [] };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockKeys
      } as Response);
      vi.stubGlobal('fetch', mockFetch);

      await fetchProjectApiKeys('target-proj');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-goog-user-project': 'target-proj'
          })
        })
      );
    });
  });
});
