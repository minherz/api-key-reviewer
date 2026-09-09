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

import { ApiKeyRestrictions, RestrictionLevel, ApiKey, ParsedApiKey } from './types';

/**
 * Parses the URL hash parameters returned by Google OAuth.
 */
export function parseUrlHash(hash: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!hash) return params;

  // Remove the leading '#'
  const normalizedHash = hash.startsWith('#') ? hash.substring(1) : hash;
  const pairs = normalizedHash.split('&');

  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  }

  return params;
}

/**
 * Checks if API restrictions are configured.
 */
export function hasApiRestrictions(restrictions?: ApiKeyRestrictions): boolean {
  return !!(
    restrictions &&
    restrictions.apiTargets &&
    restrictions.apiTargets.length > 0
  );
}

/**
 * Checks if application restrictions (browser, server, android, or ios) are configured.
 */
export function hasAppRestrictions(restrictions?: ApiKeyRestrictions): boolean {
  if (!restrictions) return false;

  const hasBrowser = !!(
    restrictions.browserKeyRestrictions?.allowedReferrers &&
    restrictions.browserKeyRestrictions.allowedReferrers.length > 0
  );

  const hasServer = !!(
    restrictions.serverKeyRestrictions?.allowedIps &&
    restrictions.serverKeyRestrictions.allowedIps.length > 0
  );

  const hasAndroid = !!(
    restrictions.androidKeyRestrictions?.allowedApplications &&
    restrictions.androidKeyRestrictions.allowedApplications.length > 0
  );

  const hasIos = !!(
    restrictions.iosKeyRestrictions?.allowedBundleIds &&
    restrictions.iosKeyRestrictions.allowedBundleIds.length > 0
  );

  return hasBrowser || hasServer || hasAndroid || hasIos;
}

/**
 * Categorizes the restriction level of an API Key.
 */
export function getRestrictionLevel(restrictions?: ApiKeyRestrictions): RestrictionLevel {
  const api = hasApiRestrictions(restrictions);
  const app = hasAppRestrictions(restrictions);

  if (api && app) {
    return 'full';
  } else if (api || app) {
    return 'some';
  } else {
    return 'none';
  }
}

/**
 * Formats restrictions into a human-readable list of strings for tooltips.
 */
export function getHumanReadableRestrictions(
  restrictions?: ApiKeyRestrictions,
  serviceAccountEmail?: string
): string[] {
  const list: string[] = [];

  if (!restrictions) {
    list.push('No restrictions applied; can be used to call any enabled Google API');
    return list;
  }

  // API targets
  if (hasApiRestrictions(restrictions)) {
    const targets = restrictions.apiTargets!.map(t => {
      const methodsStr = t.methods && t.methods.length > 0 ? ` (methods: ${t.methods.join(', ')})` : '';
      return `${t.service}${methodsStr}`;
    });
    list.push(`API Restrictions: Restricted to ${targets.join(', ')}`);
  } else {
    list.push('API Restrictions: None (can be used to call any enabled Google API)');
  }

  // Browser referrers
  if (restrictions.browserKeyRestrictions?.allowedReferrers && restrictions.browserKeyRestrictions.allowedReferrers.length > 0) {
    list.push(`Application Restrictions (Web/Browser): Allowed referrers: ${restrictions.browserKeyRestrictions.allowedReferrers.join(', ')}`);
  }

  // Server IPs
  if (restrictions.serverKeyRestrictions?.allowedIps && restrictions.serverKeyRestrictions.allowedIps.length > 0) {
    list.push(`Application Restrictions (Server): Allowed IPs: ${restrictions.serverKeyRestrictions.allowedIps.join(', ')}`);
  }

  // Android apps
  if (restrictions.androidKeyRestrictions?.allowedApplications && restrictions.androidKeyRestrictions.allowedApplications.length > 0) {
    const apps = restrictions.androidKeyRestrictions.allowedApplications.map(app => {
      const shaShort = app.sha1Fingerprint ? ` [SHA1: ${app.sha1Fingerprint.substring(0, 8)}...]` : '';
      return `${app.packageName}${shaShort}`;
    });
    list.push(`Application Restrictions (Android): Allowed apps: ${apps.join(', ')}`);
  }

  // iOS apps
  if (restrictions.iosKeyRestrictions?.allowedBundleIds && restrictions.iosKeyRestrictions.allowedBundleIds.length > 0) {
    list.push(`Application Restrictions (iOS): Allowed bundle IDs: ${restrictions.iosKeyRestrictions.allowedBundleIds.join(', ')}`);
  }

  if (!hasAppRestrictions(restrictions)) {
    list.push('Application Restrictions: None (can be used in calls from anywhere)');
  }

  // Service Account Binding status
  if (serviceAccountEmail) {
    list.push(`Service Account: Bound to a service account`);
  } else {
    list.push('Service Account: Not bound to a service account');
  }

  return list;
}

/**
 * Copies a string of text to the clipboard using the modern Clipboard API.
 * Falls back to execCommand if not supported in old browsers.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    }
  } catch (err) {
    console.error('Failed to copy text: ', err);
    return false;
  }
}

/**
 * Validates whether a given token string matches the Google OAuth2 access token format.
 */
export function isValidAccessTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  return token.trim().startsWith('ya29.');
}

/**
 * Formats an ISO 8601 date string into a clean, human-readable date.
 */
export function formatDate(isoString?: string): string {
  if (!isoString) return 'Unknown';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return 'Unknown';
  }
}

/**
 * Formats the copyright and version notice for display in the app footer.
 * Supports hybrid versioning format (e.g. "v0.0.1+a1b2c3d" or "v1.2.0-b42+a1b2c3d").
 */
export function formatCopyrightVersion(
  rawVersion?: string,
  repoPath = 'minherz/api-keys-finder'
): string {
  const versionStr = rawVersion?.trim() || 'v0.0.1-preview';
  const normalizedVersion = versionStr.startsWith('v')
    ? versionStr
    : `v${versionStr}`;

  const plusIndex = normalizedVersion.indexOf('+');
  if (plusIndex !== -1) {
    const semverPart = normalizedVersion.substring(0, plusIndex);
    const shaPart = normalizedVersion.substring(plusIndex + 1);

    if (shaPart) {
      const commitUrl = `https://github.com/${repoPath}/commit/${shaPart}`;
      const commitLink = `<a href="${commitUrl}" target="_blank" rel="noopener noreferrer">${shaPart}</a>`;
      return `&copy; 2026 Google API Keys Finder ${semverPart}+${commitLink}. All rights reserved.`;
    }
  }

  return `&copy; 2026 Google API Keys Finder ${normalizedVersion}. All rights reserved.`;
}

/**
 * Returns a human-readable security recommendation based on the key's restriction settings.
 */
export function getRecommendationText(restrictions?: ApiKeyRestrictions, serviceAccountEmail?: string): string {
  const api = hasApiRestrictions(restrictions);
  const app = hasAppRestrictions(restrictions);
  const message: string[] = [];

  if (!api && !app) {
    message.push("This key poses critical security and financial risks and should be deleted or restricted as soon as possible.");
    if (serviceAccountEmail) {
      message.push("Bounding the key to service account doesn't provide sufficient protection.");
    }
  } else if (api && app) {
    if (serviceAccountEmail) {
      message.push("This key is secured.");
    } else {
      message.push("This key is restricted.");
    }
  } else if (api && !app) {
    message.push("This key has API restrictions.");
    if (serviceAccountEmail) {
      message.push("Being bound to a service account increases protection level of the key.");
    }
    message.push("Consider setting application constraints to protect the key from unintended use in other applications.");
  } else if (!api && app) {
    message.push("This key can call ANY API from the restricted list of application(s), which is not secure.");
  }
  message.push("Use the key name link to review and modify the key's settings in the Cloud console.");
  return message.join(" ");
}

/**
 * Helper to parse a raw API Key resource from Google API into a ParsedApiKey.
 */
export function parseApiKey(k: ApiKey, projectId: string): ParsedApiKey {
  const restrictionLevel = getRestrictionLevel(k.restrictions);
  const humanReadableRestrictions = getHumanReadableRestrictions(k.restrictions, k.serviceAccountEmail);

  return {
    uid: k.uid,
    displayName: k.displayName || 'Unnamed Key',
    projectId: projectId,
    createTime: k.createTime,
    rawRestrictions: k.restrictions || {},
    restrictionLevel,
    humanReadableRestrictions,
    serviceAccountEmail: k.serviceAccountEmail
  };
}

/**
 * Executes async tasks concurrently with a limit.
 */
export async function runConcurrentTasks<T>(
  items: T[],
  concurrency: number,
  taskFn: (item: T) => Promise<void>
) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const itemIndex = index++;
      if (itemIndex < items.length) {
        await taskFn(items[itemIndex]);
      }
    }
  });
  await Promise.all(workers);
}

/**
 * A standard, clean delay promise.
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface ScannerConfig {
  debug: boolean;
  threshold: number;
}

/**
 * Retrieves the scanner configuration from LocalStorage with clean fallbacks.
 */
export function getScannerConfig(): ScannerConfig {
  let debug = false;
  let threshold = 64;

  try {
    if (typeof localStorage !== 'undefined') {
      debug = localStorage.getItem('api_keys_scanner_debug') === 'true';

      const storedThreshold = localStorage.getItem('api_keys_scanner_threshold');
      if (storedThreshold !== null) {
        const parsed = parseInt(storedThreshold, 10);
        if (!isNaN(parsed) && parsed > 0) {
          threshold = parsed;
        }
      }
    }
  } catch {
    // Fallbacks if localStorage is blocked or not available
  }

  return { debug, threshold };
}

/**
 * Checks if verbose diagnostic log printing is enabled via LocalStorage.
 * Enable by running: localStorage.setItem('api_keys_scanner_debug', 'true')
 */
export function isDebugLogEnabled(): boolean {
  return getScannerConfig().debug;
}

/**
 * Logs a standard debug message if debug logging is enabled.
 */
export function logDebug(message: string, ...optionalParams: any[]) {
  if (isDebugLogEnabled()) {
    console.log(`[SCANNER_DEBUG] ${message}`, ...optionalParams);
  }
}
