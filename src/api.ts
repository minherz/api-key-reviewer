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

import { GoogleUser, GcpProject, ProjectsListResponse, ApiKey, ApiKeysListResponse } from './types';
import { getAuthToken } from './auth';

export class AppError extends Error {
  public source: 'client' | 'server';
  public status?: number;
  public statusText?: string;

  constructor(message: string, source: 'client' | 'server', status?: number, statusText?: string) {
    super(message);
    this.name = 'AppError';
    this.source = source;
    this.status = status;
    this.statusText = statusText;
  }
}

export class ServiceDisabledError extends AppError {
  constructor(message: string, status?: number, statusText?: string) {
    super(message, 'server', status, statusText);
    this.name = 'ServiceDisabledError';
  }
}

/**
 * Fetches the user profile from Google UserInfo API.
 */
export async function fetchUserProfile(signal?: AbortSignal): Promise<GoogleUser> {
  const activeToken = getAuthToken();
  if (!activeToken) {
    throw new AppError('Authentication token is missing. Please sign in.', 'client');
  }

  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        'Authorization': `Bearer ${activeToken}`
      },
      signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new AppError(
        `Failed to fetch user profile: ${response.statusText || response.status} (${errorText})`,
        'server',
        response.status,
        response.statusText
      );
    }

    return await response.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw err; // Re-throw cancellation
    }
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(err.message || 'Network error fetching user profile', 'client');
  }
}

/**
 * Fetches the list of all active GCP projects the user has access to (using CRM v1).
 */
export async function fetchProjects(signal?: AbortSignal): Promise<GcpProject[]> {
  const activeToken = getAuthToken();
  if (!activeToken) {
    throw new AppError('Authentication token is missing. Please sign in.', 'client');
  }

  let projects: GcpProject[] = [];
  let nextPageToken: string | undefined = undefined;

  try {
    do {
      const url = new URL('https://cloudresourcemanager.googleapis.com/v1/projects');
      if (nextPageToken) {
        url.searchParams.set('pageToken', nextPageToken);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${activeToken}`
        },
        signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let apiMessage = `GCP API Error listing projects: ${response.statusText || response.status}`;

        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error && errorJson.error.message) {
            apiMessage = errorJson.error.message;
          }
        } catch {
          if (errorText) {
            apiMessage = errorText;
          }
        }

        throw new AppError(
          apiMessage,
          'server',
          response.status,
          response.statusText
        );
      }

      const data: ProjectsListResponse = await response.json();
      if (data.projects) {
        // Only collect ACTIVE projects
        const activeProjects = data.projects.filter(p => p.lifecycleState === 'ACTIVE');
        projects = projects.concat(activeProjects);
      }
      nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    return projects;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw err;
    }
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(err.message || 'Network error listing projects', 'client');
  }
}

/**
 * Fetches the active API keys for a given GCP project.
 * If the API keys service is not enabled, returns an empty array and doesn't crash.
 */
export async function fetchProjectApiKeys(
  projectId: string,
  signal?: AbortSignal,
  quotaProjectId?: string
): Promise<ApiKey[]> {
  const activeToken = getAuthToken();
  if (!activeToken) {
    throw new AppError('Authentication token is missing. Please sign in.', 'client');
  }

  try {
    const url = `https://apikeys.googleapis.com/v2/projects/${projectId}/locations/global/keys`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${activeToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': quotaProjectId || projectId
    };

    const response = await fetch(url, {
      headers,
      signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let apiMessage = `Failed to fetch API keys for project ${projectId}: ${response.statusText || response.status}`;
      let isServiceDisabled = false;

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          if (errorJson.error.message) {
            apiMessage = errorJson.error.message;
          }

          const errPayload = errorJson.error;
          if (
            errPayload.code === 403 &&
            errPayload.status === 'PERMISSION_DENIED' &&
            Array.isArray(errPayload.details) &&
            errPayload.details.some((detail: any) =>
              detail && typeof detail === 'object' && detail.reason === 'SERVICE_DISABLED'
            )
          ) {
            isServiceDisabled = true;
          }
        }
      } catch {
        if (errorText) {
          apiMessage = errorText;
        }
      }

      if (isServiceDisabled) {
        throw new ServiceDisabledError(apiMessage, response.status, response.statusText);
      } else {
        throw new AppError(
          apiMessage,
          'server',
          response.status,
          response.statusText
        );
      }
    }

    const data: ApiKeysListResponse = await response.json();
    return data.keys || [];
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw err;
    }
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(err.message || `Network error fetching API keys for project ${projectId}`, 'client');
  }
}
