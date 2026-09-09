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

import { AppState, GcpProject } from './types';
import { AppError, fetchUserProfile, fetchProjects } from './api';
import { copyToClipboard, formatDate, formatCopyrightVersion, getRecommendationText, hasApiRestrictions, hasAppRestrictions, logDebug, getScannerConfig, isValidAccessTokenFormat } from './utils';
import { login, logout, getAuthToken, getAuthSource, setManualAccessToken, clearManualAccessToken } from './auth';
import { executeLinearScan } from './scan-linear';
import { executeParallelScan } from './scan-parallel';

// SVGs for Copy and Checked/Copied indicators (with pointer-events disabled for clean event bubbling)
const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// Initial Application State
const state: AppState = {
  user: null,
  authSource: null,
  projects: [],
  keys: [],
  statusMessage: 'System Ready. Please sign in or provide an access token to begin.',
  isClientError: false,
  searchProgress: {
    status: 'idle',
    totalProjects: 0,
    completedProjects: 0,
    percentage: 0
  }
};

// Active AbortController for cancelable operations
let activeSearchController: AbortController | null = null;

// DOM Elements
const btnSearchKeys = document.getElementById('btn-search-keys') as HTMLButtonElement;
const btnCancelSearch = document.getElementById('btn-cancel-search') as HTMLButtonElement;
const btnShowSignIn = document.getElementById('btn-show-sign-in') as HTMLButtonElement;
const btnShowAccessToken = document.getElementById('btn-show-access-token') as HTMLButtonElement;
const btnSignOut = document.getElementById('btn-sign-out') as HTMLButtonElement;
const userProfileContainer = document.getElementById('user-profile') as HTMLDivElement;
const userNameDisplay = document.getElementById('user-name') as HTMLSpanElement;
const userAvatarDisplay = document.getElementById('user-avatar') as HTMLImageElement;

// Profile dropdown selectors
const btnProfileToggle = document.getElementById('btn-profile-toggle') as HTMLButtonElement;
const profileDropdown = document.getElementById('profile-dropdown') as HTMLDivElement;
const dropdownUserName = document.getElementById('dropdown-user-name') as HTMLDivElement;
const dropdownUserEmail = document.getElementById('dropdown-user-email') as HTMLDivElement;

const emptyStateContainer = document.getElementById('empty-state') as HTMLDivElement;
const keysListContainer = document.getElementById('keys-list') as HTMLDivElement;

const progressContainer = document.getElementById('progress-container') as HTMLDivElement;
const progressTextTitle = document.getElementById('progress-text-title') as HTMLDivElement;
const progressTextDetails = document.getElementById('progress-text-details') as HTMLDivElement;
const progressBarFill = document.getElementById('progress-bar-fill') as HTMLDivElement;
const btnProgressCancel = document.getElementById('btn-progress-cancel') as HTMLButtonElement;

const statusNotification = document.getElementById('status-notification') as HTMLSpanElement;
const permissionLevelPill = document.getElementById('permission-level') as HTMLSpanElement;

const errorsModal = document.getElementById('errors-modal') as HTMLDivElement;
const btnCloseErrorsModal = document.getElementById('btn-close-errors-modal') as HTMLButtonElement;
const btnConfirmErrorsModal = document.getElementById('btn-confirm-errors-modal') as HTMLButtonElement;
const errorsModalSummary = document.getElementById('errors-modal-summary') as HTMLParagraphElement;

// Access Token Modal elements
const accessTokenModal = document.getElementById('access-token-modal') as HTMLDivElement;
const btnCloseAccessTokenModal = document.getElementById('btn-close-access-token-modal') as HTMLButtonElement;
const btnCancelAccessTokenModal = document.getElementById('btn-cancel-access-token-modal') as HTMLButtonElement;
const btnApplyAccessToken = document.getElementById('btn-apply-access-token') as HTMLButtonElement;
const btnClearAccessToken = document.getElementById('btn-clear-access-token') as HTMLButtonElement;
const inputAccessToken = document.getElementById('input-access-token') as HTMLTextAreaElement;
const tokenErrorMessage = document.getElementById('token-error-message') as HTMLDivElement;
const btnCopyGcloudCmd = document.getElementById('btn-copy-gcloud-cmd') as HTMLButtonElement;
const copyCmdText = document.getElementById('copy-cmd-text') as HTMLSpanElement;

/**
 * Updates the Status Bar UI with the current notification message and style.
 */
function updateStatusBar(message: string, isError: boolean = false, isClient: boolean = false) {
  state.statusMessage = message;
  state.isClientError = isClient;

  statusNotification.textContent = message;

  // Reset classes
  statusNotification.className = '';

  if (isError) {
    statusNotification.classList.add('status-error');
    statusNotification.title = isClient ? 'Client-side error' : 'Server-side API error';
  } else {
    statusNotification.classList.add('status-neutral');
    statusNotification.title = '';
  }
}


/**
 * Shows/Hides the Errors Popup Modal.
 */
function setErrorsModalVisible(visible: boolean, summaryText: string = '') {
  if (visible) {
    if (summaryText) {
      errorsModalSummary.textContent = summaryText;
    }
    errorsModal.classList.remove('hidden');
  } else {
    errorsModal.classList.add('hidden');
  }
}

/**
 * Renders the empty state container based on the current authentication state.
 */
function renderEmptyState() {
  emptyStateContainer.innerHTML = `
    <div class="empty-icon">🔓</div>
    <h2>Review Your Google Cloud API Keys</h2>
    <p>Please sign in with your Google account or provide an access token to scan your active projects and review their restriction levels.</p>
    <div class="empty-state-actions">
      <button id="btn-empty-sign-in" class="btn btn-primary btn-large">Sign In with Google</button>
      <button id="btn-empty-access-token" class="btn btn-secondary btn-large">Paste Access Token</button>
    </div>
  `;

  const btnEmptySignInDynamic = document.getElementById('btn-empty-sign-in') as HTMLButtonElement;
  if (btnEmptySignInDynamic) {
    btnEmptySignInDynamic.addEventListener('click', () => redirectToGoogleOAuth());
  }

  const btnEmptyAccessToken = document.getElementById('btn-empty-access-token') as HTMLButtonElement;
  if (btnEmptyAccessToken) {
    btnEmptyAccessToken.addEventListener('click', () => openAccessTokenModal());
  }
}

/**
 * Updates UI elements based on the current authentication state.
 */
function updateAuthStateUI() {
  const token = getAuthToken();
  const source = getAuthSource();
  state.authSource = source;

  if (source === 'oauth' && token) {
    // 1. STANDARD SIGN-IN (OAuth)
    // The standard sign-in should disable the option for providing an access token until sign out.
    btnShowSignIn.classList.add('hidden');
    btnShowSignIn.disabled = false;

    btnShowAccessToken.classList.remove('hidden');
    btnShowAccessToken.disabled = true;
    btnShowAccessToken.title = 'Access token option is disabled while signed in with Google';

    userProfileContainer.classList.remove('hidden');
    btnProfileToggle.disabled = false;
    btnProfileToggle.classList.remove('disabled');
    btnProfileToggle.title = 'User Profile Menu';

    // Enable find API keys button
    btnSearchKeys.disabled = false;

    // Set permission level
    permissionLevelPill.textContent = 'Read-Only';
    permissionLevelPill.className = 'permission-pill level-readonly';

    // Clean the panel in the main area
    emptyStateContainer.classList.add('hidden');
    keysListContainer.classList.remove('hidden');
    keysListContainer.innerHTML = '';

  } else if (source === 'manual' && token) {
    // 2. USER-PROVIDED ACCESS TOKEN
    // Once the token is provided the sign-in and access token buttons should remain enabled but the profile should be disabled.
    btnShowSignIn.classList.remove('hidden');
    btnShowSignIn.disabled = false;

    btnShowAccessToken.classList.remove('hidden');
    btnShowAccessToken.disabled = false;
    btnShowAccessToken.title = 'Configure Access Token';

    userProfileContainer.classList.remove('hidden');
    btnProfileToggle.disabled = true;
    btnProfileToggle.classList.add('disabled');
    btnProfileToggle.title = 'Profile is disabled when using a manual access token';

    userNameDisplay.textContent = 'Manual Token';
    userAvatarDisplay.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23718096"><circle cx="12" cy="12" r="10" stroke="%23A0AEC0" stroke-width="2" fill="none"/><path d="M12 7v5l3 3" stroke="%23718096" stroke-width="2" stroke-linecap="round"/></svg>';

    if (profileDropdown) {
      profileDropdown.classList.add('hidden');
    }

    // Enable find API keys button
    btnSearchKeys.disabled = false;

    // Set permission level
    permissionLevelPill.textContent = 'Read-Only';
    permissionLevelPill.className = 'permission-pill level-readonly';

    // Clean the panel in the main area
    emptyStateContainer.classList.add('hidden');
    keysListContainer.classList.remove('hidden');
    keysListContainer.innerHTML = '';

    updateStatusBar('Access token configured. Ready to find API keys.');

  } else {
    // 3. LOGGED OUT
    state.user = null;
    state.projects = [];
    state.keys = [];

    btnShowSignIn.classList.remove('hidden');
    btnShowSignIn.disabled = false;

    btnShowAccessToken.classList.remove('hidden');
    btnShowAccessToken.disabled = false;
    btnShowAccessToken.title = 'Use Google Access Token';

    userProfileContainer.classList.add('hidden');
    btnProfileToggle.disabled = false;
    btnProfileToggle.classList.remove('disabled');

    if (profileDropdown) {
      profileDropdown.classList.add('hidden');
    }

    btnSearchKeys.disabled = true;

    permissionLevelPill.textContent = 'None';
    permissionLevelPill.className = 'permission-pill';

    emptyStateContainer.classList.remove('hidden');
    keysListContainer.classList.add('hidden');

    renderEmptyState();
    updateStatusBar('System Ready. Please sign in or provide an access token to begin.');
  }
}

/**
 * Opens the Access Token modal.
 */
function openAccessTokenModal() {
  const currentToken = getAuthToken();
  const currentSource = getAuthSource();

  // Always reset the input field to prevent sensitive tokens from lingering
  inputAccessToken.value = '';

  if (currentToken && currentSource === 'manual') {
    btnClearAccessToken.classList.remove('hidden');
  } else {
    btnClearAccessToken.classList.add('hidden');
  }

  tokenErrorMessage.textContent = '';
  tokenErrorMessage.classList.add('hidden');

  accessTokenModal.classList.remove('hidden');
  inputAccessToken.focus();
}

/**
 * Closes the Access Token modal.
 */
function closeAccessTokenModal() {
  accessTokenModal.classList.add('hidden');
  inputAccessToken.value = '';
  tokenErrorMessage.textContent = '';
  tokenErrorMessage.classList.add('hidden');
}

/**
 * Applies the user-provided access token from the modal.
 */
function handleApplyAccessToken() {
  const token = inputAccessToken.value.trim();

  if (!token) {
    tokenErrorMessage.textContent = 'Please enter a Google access token.';
    tokenErrorMessage.classList.remove('hidden');
    inputAccessToken.focus();
    return;
  }

  if (!isValidAccessTokenFormat(token)) {
    tokenErrorMessage.textContent = "Invalid token format. Access tokens must start with 'ya29.'.";
    tokenErrorMessage.classList.remove('hidden');
    inputAccessToken.focus();
    return;
  }

  setManualAccessToken(token);
  inputAccessToken.value = '';
  closeAccessTokenModal();
  updateAuthStateUI();
}

/**
 * Clears the user-provided access token and resets application state.
 */
function handleClearAccessToken() {
  inputAccessToken.value = '';
  clearManualAccessToken();
  closeAccessTokenModal();
  handleSignOutState();
  updateStatusBar('Access token cleared.');
}

/**
 * Copies the gcloud command to clipboard with UI feedback.
 */
async function handleCopyGcloudCommand() {
  const success = await copyToClipboard('gcloud auth application-default print-access-token');
  if (success) {
    if (copyCmdText) copyCmdText.textContent = 'Copied!';
    btnCopyGcloudCmd.classList.add('copied');
    setTimeout(() => {
      if (copyCmdText) copyCmdText.textContent = 'Copy';
      btnCopyGcloudCmd.classList.remove('copied');
    }, 2000);
  } else {
    updateStatusBar('Failed to copy command to clipboard', true, true);
  }
}

/**
 * Triggers Google OAuth sign-in popup using the modern Google Identity Services library.
 */
function redirectToGoogleOAuth() {
  updateStatusBar('Opening Google Sign-In popup...');
  login(
    () => {
      handleOAuthSession();
    },
    (errMessage) => {
      updateStatusBar(errMessage, true, true);
    }
  );
}

/**
 * Applies the authenticated session to the application state and fetches the user profile.
 */
async function handleOAuthSession() {
  const token = getAuthToken();
  const source = getAuthSource();

  if (token && source === 'oauth') {
    updateAuthStateUI();

    userNameDisplay.textContent = 'Loading Profile...';
    userAvatarDisplay.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23CBD5E0"/><text x="12" y="16" font-size="12" font-family="system-ui" font-weight="bold" fill="%23718096" text-anchor="middle">👤</text></svg>';

    try {
      updateStatusBar('Fetching user profile...');
      const userProfile = await fetchUserProfile();
      state.user = userProfile;

      // Render profile
      userNameDisplay.textContent = userProfile.name || userProfile.email;
      if (dropdownUserName) {
        dropdownUserName.textContent = userProfile.name || 'GCP Auditor';
      }
      if (dropdownUserEmail) {
        dropdownUserEmail.textContent = userProfile.email;
      }
      if (userProfile.picture) {
        userAvatarDisplay.src = userProfile.picture;
        userAvatarDisplay.alt = `Signed in as ${userProfile.name}. Click to Sign Out.`;
      } else {
        userAvatarDisplay.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="darkgrey"><circle cx="12" cy="12" r="12"/></svg>';
      }

      updateStatusBar('Successfully authenticated. Ready to scan keys.');
    } catch (err: any) {
      console.error('Error loading user profile:', err);
      // If our token is invalid/expired, prompt sign-in again
      if (err instanceof AppError && err.status === 401) {
        handleSignOut();
        updateStatusBar('Session expired. Please sign in again.', true, false);
      } else {
        userNameDisplay.textContent = 'Auth Error';
        updateStatusBar(`Authentication warning: ${err.message}`, true, err.source === 'client');
      }
    }
  } else if (token && source === 'manual') {
    updateAuthStateUI();
  } else {
    // Not signed in
    handleSignOutState();
  }
}

/**
 * Resets application state variables to signed-out values (internal helper).
 */
function handleSignOutState() {
  state.authSource = null;
  state.user = null;
  state.projects = [];
  state.keys = [];
  updateAuthStateUI();
}

/**
 * Performs full Sign Out, revoking the token from Google if possible.
 */
async function handleSignOut() {
  updateStatusBar('Signing out and revoking session token...');
  await logout();
  handleSignOutState();
}

// Dynamic badge configuration is computed inline inside renderKeysList based on active security profiles.

/**
 * Displays/Updates the list of API Keys in the main area.
 */
function renderKeysList() {
  if (state.keys.length === 0) {
    keysListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <h2>No Active API Keys Found</h2>
        <p>We scanned ${state.projects.length} project(s) and found no active Google Cloud API Keys.</p>
      </div>
    `;
    return;
  }

  // Sort keys: Unrestricted (none) first, then Partially restricted (some), then Fully restricted (full)
  const sortedKeys = [...state.keys].sort((a, b) => {
    const weights = { none: 0, some: 1, full: 2 };
    return weights[a.restrictionLevel] - weights[b.restrictionLevel];
  });

  keysListContainer.innerHTML = '';

  const fragment = document.createDocumentFragment();

  for (const key of sortedKeys) {
    const row = document.createElement('div');
    row.className = `key-item-row level-${key.restrictionLevel}`;

    const tooltipText = key.humanReadableRestrictions.join('\n');

    // Dynamic badge and emoji configuration based on security profile
    const api = hasApiRestrictions(key.rawRestrictions);
    const app = hasAppRestrictions(key.rawRestrictions);
    const hasSa = !!key.serviceAccountEmail;

    let badgeIconEmoji = '🔓';
    let badgeText = 'Some';
    let badgeClass = 'badge-some';

    if (!api && !app) {
      // 🚨 None -- No restrictions found regardless whether key is bound or not to a service account
      badgeIconEmoji = '🚨';
      badgeText = 'None';
      badgeClass = 'badge-none';
    } else if (hasSa) {
      // 🔐 Locked -- When API or Application restrictions are set and key is bound to a service account
      badgeIconEmoji = '🔐';
      badgeText = 'Locked';
      badgeClass = 'badge-full';
    } else if (api && app) {
      // 🔒 Restricted -- When both API and Application restrictions are set but key is not bound to a service account
      badgeIconEmoji = '🔒';
      badgeText = 'Restricted';
      badgeClass = 'badge-full';
    } else {
      // 🔓 Some -- If either API or Application restrictions are set but key is not bound to a service account
      badgeIconEmoji = '🔓';
      badgeText = 'Some';
      badgeClass = 'badge-some';
    }

    row.innerHTML = `
      <!-- Column 1: Display Name -->
      <div class="text-truncate-wrapper">
        <span class="text-truncate" id="name-${key.uid}" title="${key.displayName}">
          <a class="key-link" href="https://console.cloud.google.com/apis/credentials/key/${key.uid}?project=${key.projectId}" target="_blank" rel="noopener noreferrer">
            ${key.displayName}
          </a>
        </span>
        <button class="btn btn-copy" data-copy-target="name-${key.uid}" title="Copy Name">${COPY_SVG}</button>
      </div>
      
      <!-- Column 2: UID -->
      <div class="text-truncate-wrapper">
        <div class="text-truncate" style="font-family: monospace;" id="uid-${key.uid}" title="${key.uid}">
          ${key.uid}
          <div class="key-uid-sub">Created ${formatDate(key.createTime)}</div>
        </div>
        <button class="btn btn-copy" data-copy-target="uid-${key.uid}" title="Copy UID">${COPY_SVG}</button>
      </div>
      
      <!-- Column 3: Project ID -->
      <div class="text-truncate-wrapper">
        <span class="text-truncate" id="proj-${key.uid}" title="${key.projectId}">${key.projectId}</span>
        <button class="btn btn-copy" data-copy-target="proj-${key.uid}" title="Copy Project ID">${COPY_SVG}</button>
      </div>
      
      <!-- Column 4: Restriction Badge -->
      <div class="restriction-badge-container">
        <div class="restriction-badge ${badgeClass}" title="${tooltipText}">
          <span class="badge-icon">${badgeIconEmoji}</span>
          <span>${badgeText}</span>
        </div>
      </div>

      <!-- Column 5: Recommendations -->
      <div class="key-recommendation-text">
        ${getRecommendationText(key.rawRestrictions, key.serviceAccountEmail)}
      </div>
    `;

    fragment.appendChild(row);
  }

  keysListContainer.appendChild(fragment);

  // Setup click listeners for all Copy buttons
  const copyButtons = keysListContainer.querySelectorAll('.btn-copy');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      const targetId = button.getAttribute('data-copy-target');
      if (!targetId) return;

      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      // Extract only the direct text (avoid copy-sub text)
      // We clone the node and remove subtext if any
      const cloned = targetEl.cloneNode(true) as HTMLElement;
      const sub = cloned.querySelector('.key-uid-sub, .key-project-sub');
      if (sub) cloned.removeChild(sub);

      const textToCopy = cloned.textContent?.trim() || '';

      const success = await copyToClipboard(textToCopy);
      if (success) {
        const originalTitle = button.getAttribute('title') || '';
        button.innerHTML = CHECK_SVG;
        button.classList.add('copied');
        button.setAttribute('title', 'Copied!');
        setTimeout(() => {
          button.innerHTML = COPY_SVG;
          button.classList.remove('copied');
          button.setAttribute('title', originalTitle);
        }, 2000);
      } else {
        updateStatusBar('Failed to copy to clipboard', true, true);
      }
    });
  });
}

/**
 * Cancels any active search workflow and resets UI.
 */
function cancelSearch() {
  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }

  state.searchProgress.status = 'cancelled';
  progressContainer.classList.add('hidden');
  btnSearchKeys.classList.remove('hidden');
  btnCancelSearch.classList.add('hidden');

  updateStatusBar('Search cancelled by user.');
}

/**
 * Main Search Workflow: Scans all active projects and retrieves active API keys.
 */
async function executeSearchWorkflow() {
  if (!getAuthToken()) {
    updateStatusBar('Error: You must be signed in or provide an access token to search API keys.', true, true);
    return;
  }

  // Setup AbortController for cancelable fetch operations
  activeSearchController = new AbortController();
  const signal = activeSearchController.signal;

  // Initialize progress state
  state.searchProgress = {
    status: 'searching-projects',
    totalProjects: 0,
    completedProjects: 0,
    percentage: 0
  };
  state.keys = [];

  // Track findings/errors
  const permissionDeniedProjects: { projectId: string; message: string }[] = [];
  const otherErrors: { projectId: string; message: string }[] = [];

  // Update UI Layout
  emptyStateContainer.classList.add('hidden');
  keysListContainer.classList.remove('hidden');
  keysListContainer.innerHTML = ''; // Clear previous lists

  progressContainer.classList.remove('hidden');
  btnSearchKeys.classList.add('hidden');
  btnCancelSearch.classList.remove('hidden');

  progressTextTitle.textContent = 'Scanning Google Cloud Projects...';
  progressTextDetails.textContent = 'Requesting the list of all accessible projects...';
  progressBarFill.style.width = '0%';

  updateStatusBar('Scanning Google Cloud projects...');

  let projects: GcpProject[] = [];

  // STEP 1: Handle Project List Failure separately
  try {
    projects = await fetchProjects(signal);
    state.projects = projects;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      cancelSearch();
      return;
    }
    console.error('Failed to list Google Cloud projects:', err);
    progressContainer.classList.add('hidden');
    btnSearchKeys.classList.remove('hidden');
    btnCancelSearch.classList.add('hidden');

    let friendlyMessage = 'Failed to retrieve projects. ';
    if (err instanceof AppError && (err.status === 401 || err.status === 403)) {
      if (getAuthSource() === 'manual') {
        friendlyMessage = 'Access token is invalid, expired, or lacks permissions. Please generate a fresh token with gcloud auth application-default print-access-token.';
      } else {
        friendlyMessage += 'Please verify that your Google account has active access to Google Cloud and has granted "Cloud Platform (Read-Only)" scope.';
      }
    } else {
      friendlyMessage += err.message || 'Unknown network error.';
    }
    updateStatusBar(friendlyMessage, true, err.source === 'client');
    return;
  }

  if (projects.length === 0) {
    progressContainer.classList.add('hidden');
    btnSearchKeys.classList.remove('hidden');
    btnCancelSearch.classList.add('hidden');
    renderKeysList();
    updateStatusBar('Search complete. No projects found.');
    return;
  }

  // STEP 2: Configure state for Keys scanning
  state.searchProgress.status = 'searching-keys';
  state.searchProgress.totalProjects = projects.length;

  progressTextTitle.textContent = 'Scanning Active API Keys...';

  // Progress and error callbacks
  const onProgress = (completedIndex: number, projectId: string) => {
    const percent = Math.round((completedIndex / projects.length) * 100);
    progressTextDetails.textContent = `Scanning project ${completedIndex} of ${projects.length}: ${projectId} (${percent}%)`;
    progressBarFill.style.width = `${percent}%`;
    updateStatusBar(`Scanning project: ${projectId}...`);
  };

  const onResult = (parsedKeys: any[], _projectId: string) => {
    state.keys = state.keys.concat(parsedKeys);
    renderKeysList();
  };

  const onError = (err: any, projectId: string) => {
    if (err instanceof AppError && err.status === 403) {
      permissionDeniedProjects.push({
        projectId,
        message: err.message || 'Permission denied'
      });
    } else {
      otherErrors.push({
        projectId,
        message: err.message || 'Unknown scan error'
      });
    }
  };

  try {
    let result: { quotaProject: string | null };
    const config = getScannerConfig();

    if (projects.length < config.threshold) {
      logDebug(`Project count (${projects.length}) < threshold (${config.threshold}). Selecting LINEAR scan path.`);
      result = await executeLinearScan(projects, signal, onProgress, onResult, onError);
    } else {
      logDebug(`Project count (${projects.length}) >= threshold (${config.threshold}). Selecting PARALLEL scan path.`);
      result = await executeParallelScan(projects, signal, onProgress, onResult, onError);
    }

    logDebug(`Scan execution path completed. Final quotaProjectId established: ${result.quotaProject}`);

    // STEP 3: Complete scan
    state.searchProgress.status = 'complete';
    state.searchProgress.percentage = 100;
    progressBarFill.style.width = '100%';
    progressContainer.classList.add('hidden');

    btnSearchKeys.classList.remove('hidden');
    btnCancelSearch.classList.add('hidden');

    // RULE 5 & UI update: Present summary/warnings
    if (permissionDeniedProjects.length === 0) {
      updateStatusBar(`Search complete. Found ${state.keys.length} API key(s) across ${projects.length} project(s).`);
    } else {
      // Report lacking permissions only as warning on status bar
      updateStatusBar(`⚠️ Scan complete. Lacked permissions to list keys on ${permissionDeniedProjects.length} project(s).`, true, false);

      const summaryText = `During the scan, you lacked permissions to view keys on ${permissionDeniedProjects.length} project(s). These have been logged.`;
      setErrorsModalVisible(true, summaryText);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      cancelSearch();
      return;
    }

    console.error('Error during search workflow:', err);
    progressContainer.classList.add('hidden');
    btnSearchKeys.classList.remove('hidden');
    btnCancelSearch.classList.add('hidden');

    const isClient = err.source === 'client' || !(err instanceof AppError);
    updateStatusBar(`Search failed: ${err.message}`, true, isClient);
  } finally {
    activeSearchController = null;
  }
}

/**
 * Attaches event listeners to DOM controls.
 */
function setupEventListeners() {
  btnShowSignIn.addEventListener('click', () => redirectToGoogleOAuth());

  // Access token modal triggers and actions
  btnShowAccessToken.addEventListener('click', openAccessTokenModal);
  btnCloseAccessTokenModal.addEventListener('click', closeAccessTokenModal);
  btnCancelAccessTokenModal.addEventListener('click', closeAccessTokenModal);
  btnApplyAccessToken.addEventListener('click', handleApplyAccessToken);
  btnClearAccessToken.addEventListener('click', handleClearAccessToken);
  btnCopyGcloudCmd.addEventListener('click', handleCopyGcloudCommand);

  // Close access token modal when clicking on overlay background
  accessTokenModal.addEventListener('click', (e) => {
    if (e.target === accessTokenModal) {
      closeAccessTokenModal();
    }
  });

  // Enter key inside token textarea to apply token (unless shift+enter)
  inputAccessToken.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleApplyAccessToken();
    }
  });

  btnCloseErrorsModal.addEventListener('click', () => setErrorsModalVisible(false));
  btnConfirmErrorsModal.addEventListener('click', () => setErrorsModalVisible(false));

  // Profile dropdown toggle behaviour
  if (btnProfileToggle) {
    btnProfileToggle.addEventListener('click', (e) => {
      if (btnProfileToggle.disabled) return;
      e.stopPropagation(); // Prevent document click listener from instantly closing the dropdown
      profileDropdown.classList.toggle('hidden');
    });
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (
      profileDropdown &&
      !profileDropdown.classList.contains('hidden') &&
      !profileDropdown.contains(target) &&
      !btnProfileToggle.contains(target)
    ) {
      profileDropdown.classList.add('hidden');
    }
  });

  // Sign Out click on dropdown sign-out button
  btnSignOut.addEventListener('click', handleSignOut);

  // Fallback if Google picture fails to load
  userAvatarDisplay.addEventListener('error', () => {
    userAvatarDisplay.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23CBD5E0"/><text x="12" y="16" font-size="12" font-family="system-ui" font-weight="bold" fill="%234A5568" text-anchor="middle">👤</text></svg>';
  });

  // Search API keys click trigger
  btnSearchKeys.addEventListener('click', executeSearchWorkflow);

  // Cancel button clicks
  btnCancelSearch.addEventListener('click', cancelSearch);
  btnProgressCancel.addEventListener('click', cancelSearch);
}

function init() {
  setupEventListeners();

  handleOAuthSession();

  // Set the application version dynamically in the status bar
  const copyrightElement = document.getElementById('copyright');
  if (copyrightElement) {
    copyrightElement.innerHTML = formatCopyrightVersion(import.meta.env.APP_VERSION);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
