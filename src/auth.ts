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

import { AuthSource } from './types';

// Declare the external Google Identity Services library global variable
declare const google: any;

// Google OAuth 2.0 Client ID read from environment variable
const GOOGLE_OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
if (!GOOGLE_OAUTH_CLIENT_ID) {
  throw new Error('OAuth Client ID is undefined.');
}

const STORAGE_KEY_TOKEN = 'gcp_reviewer_token';
const STORAGE_KEY_SOURCE = 'gcp_reviewer_auth_source';

interface AuthSession {
  token: string | null;
  source: AuthSource;
}

// Global In-Memory state for the active session
let activeSession: AuthSession | null = null;

// Required Google OAuth 2.0 scopes (Read-Only Cloud Platform auditing)
const OAUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/cloud-platform.read-only'
].join(' ');

const REQUIRED_CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform.read-only';

/**
 * Initializes the auth session by restoring any saved credentials from sessionStorage.
 * This is called exactly once when the application boots up.
 */
function initializeSession(): AuthSession {
  const token = sessionStorage.getItem(STORAGE_KEY_TOKEN);
  const source = sessionStorage.getItem(STORAGE_KEY_SOURCE) as AuthSource;

  if (token && (source === 'oauth' || source === 'manual')) {
    activeSession = { token, source };
  } else if (token) {
    activeSession = { token, source: 'oauth' };
  } else {
    activeSession = { token: null, source: null };
  }

  return activeSession;
}

/**
 * Retrieves the active access token.
 */
export function getAuthToken(): string | null {
  let s: AuthSession = (activeSession ??= initializeSession());
  return s.token;
}

/**
 * Retrieves the current authentication source ('oauth', 'manual', or null).
 */
export function getAuthSource(): AuthSource {
  let s: AuthSession = (activeSession ??= initializeSession());
  return s.source;
}

/**
 * Sets a user-provided manual access token (e.g. from gcloud auth application-default print-access-token).
 */
export function setManualAccessToken(token: string): void {
  const trimmedToken = token.trim();
  activeSession = {
    token: trimmedToken,
    source: 'manual'
  };
  sessionStorage.setItem(STORAGE_KEY_TOKEN, trimmedToken);
  sessionStorage.setItem(STORAGE_KEY_SOURCE, 'manual');
}

/**
 * Clears the user-provided manual access token and resets the session.
 */
export function clearManualAccessToken(): void {
  activeSession = null;
  sessionStorage.removeItem(STORAGE_KEY_TOKEN);
  sessionStorage.removeItem(STORAGE_KEY_SOURCE);
}

/**
 * Triggers the modern Google Identity Services popup login flow with read-only Cloud Platform scopes.
 */
export function login(
  onSuccess: () => void,
  onError: (errorMessage: string) => void
): void {
  // Defensive check: Verify that Google Identity Services script loaded successfully
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    onError(
      'Google Sign-In library is unavailable. Please disable any ad-blockers, tracking protection, or check your network connection and reload.'
    );
    return;
  }

  try {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      scope: OAUTH_SCOPES,
      prompt: 'select_account',
      callback: (tokenResponse: any) => {
        if (tokenResponse.error) {
          console.error('Google Sign-In callback error:', tokenResponse.error);
          onError(`Google Sign-In failed: ${tokenResponse.error_description || tokenResponse.error}`);
          return;
        }

        // Validate that requested read-only scope was actually granted by the user
        if (!google.accounts.oauth2.hasGrantedAllScopes(tokenResponse, REQUIRED_CLOUD_SCOPE)) {
          onError('Access Denied: You must grant the application permissions to access Google Cloud Platform resources to perform key reviews.');
          return;
        }

        // Store session in memory and sessionStorage
        activeSession = {
          token: tokenResponse.access_token,
          source: 'oauth'
        };
        sessionStorage.setItem(STORAGE_KEY_TOKEN, tokenResponse.access_token);
        sessionStorage.setItem(STORAGE_KEY_SOURCE, 'oauth');

        onSuccess();
      },
      error_callback: (err: any) => {
        console.error('Google Sign-In initialization runtime error:', err);
        onError(`Sign-In client initialization error: ${err.message || 'Unknown error'}`);
      }
    });

    // Request the token opening the popup window
    client.requestAccessToken();
  } catch (err: any) {
    console.error('Error during initTokenClient flow:', err);
    onError(`Failed to open Google Sign-In: ${err.message || err}`);
  }
}

/**
 * Revokes Google OAuth access token on Sign Out and wipes session data.
 */
export async function logout(): Promise<void> {
  const currentToken = getAuthToken();
  const currentSource = getAuthSource();

  // Wipe active session from memory and storage first
  activeSession = null;
  sessionStorage.removeItem(STORAGE_KEY_TOKEN);
  sessionStorage.removeItem(STORAGE_KEY_SOURCE);
  sessionStorage.removeItem('gcp_reviewer_scope');
  sessionStorage.removeItem('gcp_reviewer_oauth_state');

  // Trigger server-side token revocation if an OAuth token was active
  if (currentToken && currentSource === 'oauth') {
    await revokeOAuthToken(currentToken);
  }
}

/**
 * Revokes Google OAuth access token on the server.
 */
async function revokeOAuthToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      mode: 'no-cors' // Google's revoke endpoint allows no-cors
    });
  } catch (err) {
    console.error('Failed to revoke OAuth token on server:', err);
  }
}
