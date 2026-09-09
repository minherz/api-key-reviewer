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

export interface GoogleUser {
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email: string;
  email_verified?: boolean;
}

export interface GcpProject {
  projectId: string;
  projectNumber: string;
  lifecycleState: string;
  name: string;
  createTime: string;
}

export interface ProjectsListResponse {
  projects?: GcpProject[];
  nextPageToken?: string;
}

export interface ApiTarget {
  service: string;
  methods?: string[];
}

export interface BrowserKeyRestrictions {
  allowedReferrers?: string[];
}

export interface ServerKeyRestrictions {
  allowedIps?: string[];
}

export interface AndroidApplication {
  packageName: string;
  sha1Fingerprint: string;
}

export interface AndroidKeyRestrictions {
  allowedApplications?: AndroidApplication[];
}

export interface IosKeyRestrictions {
  allowedBundleIds?: string[];
}

export interface ApiKeyRestrictions {
  apiTargets?: ApiTarget[];
  browserKeyRestrictions?: BrowserKeyRestrictions;
  serverKeyRestrictions?: ServerKeyRestrictions;
  androidKeyRestrictions?: AndroidKeyRestrictions;
  iosKeyRestrictions?: IosKeyRestrictions;
}

export interface ApiKey {
  name: string; // format: "projects/{project}/locations/global/keys/{key_id}"
  uid: string;
  displayName?: string;
  keyString?: string;
  createTime: string;
  updateTime?: string;
  restrictions?: ApiKeyRestrictions;
  serviceAccountEmail?: string;
}

export interface ApiKeysListResponse {
  keys?: ApiKey[];
  nextPageToken?: string;
}

export type RestrictionLevel = 'none' | 'some' | 'full';

export interface ParsedApiKey {
  uid: string;
  displayName: string;
  projectId: string;
  createTime: string;
  rawRestrictions: ApiKeyRestrictions;
  restrictionLevel: RestrictionLevel;
  humanReadableRestrictions: string[];
  serviceAccountEmail?: string;
}

export type AuthSource = 'oauth' | 'manual' | null;

export interface AppState {
  user: GoogleUser | null;
  authSource: AuthSource;
  projects: GcpProject[];
  keys: ParsedApiKey[];
  statusMessage: string;
  isClientError: boolean;
  searchProgress: {
    status: 'idle' | 'searching-projects' | 'searching-keys' | 'complete' | 'cancelled';
    totalProjects: number;
    completedProjects: number;
    percentage: number;
  };
}
