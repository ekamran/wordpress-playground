import { useMemo } from 'react';
import { useStore } from 'react-redux';
import { createListenerMiddleware } from '@reduxjs/toolkit';
import type { PlaygroundReduxState, PlaygroundDispatch } from './store';
import { selectActiveSite, setActiveSite, useAppDispatch } from './store';
import { setActiveSiteError } from './slice-ui';
import { addClientInfo } from './slice-clients';
import {
	selectAllSites,
	selectSiteBySlug,
	setOPFSSitesLoadingState,
	updateSiteMetadata,
	removeSite,
	pruneAutosavedSites,
	preserveSite,
	setTemporarySiteSpec,
	setStoredSiteSpec,
	deriveSiteNameFromSlug,
	isAutosavedSite,
	type SitePersistence,
	type SiteStorageType,
} from './slice-sites';
import { randomSiteName } from './random-site-name';
import { persistTemporarySite } from './persist-temporary-site';
import { selectClientBySiteSlug } from './slice-clients';
import type { PlaygroundClient } from '@wp-playground/remote';
import type { AllPHPVersion } from '@php-wasm/universal';
import { opfsSiteStorage } from '../opfs/opfs-site-storage';

export interface SiteSettings {
	phpVersion?: AllPHPVersion;
	wpVersion?: string;
	networking?: boolean;
	language?: string;
	multisite?: boolean;
}

type PublicSiteStorageType = Exclude<SiteStorageType, 'none'> | 'temporary';
type SaveSiteResult = { slug: string; storage: SiteStorageType };

/**
 * API for listing, renaming, saving, and opening Playground
 * sites. Used by the MCP bridge, the `window.playgroundSites`
 * DevTools global, and UI components.
 */
export interface PlaygroundSitesAPI {
	/**
	 * Lists all known sites.
	 *
	 * @returns List of site info objects.
	 */
	list(): Array<{
		slug: string;
		name: string;
		storage: PublicSiteStorageType;
		persistence: SitePersistence;
		isActive: boolean;
	}>;

	/**
	 * Returns the PlaygroundClient for the active site.
	 *
	 * @returns The client, or `undefined` if not yet booted.
	 * @throws When no site is selected.
	 */
	getClient(): PlaygroundClient | undefined;

	/**
	 * Renames the active site.
	 *
	 * @param newName The new display name.
	 * @throws When no site is selected or the site is
	 *   temporary.
	 */
	rename(newName: string): Promise<void>;

	/**
	 * Saves the active Playground in browser storage when it is temporary.
	 *
	 * Temporary sites are persisted to OPFS. Existing autosaves are marked as
	 * explicitly saved and returned without changing storage backends.
	 *
	 * @param name Optional display name for a temporary site being saved.
	 * @returns The site's slug and storage type.
	 * @throws When no site is selected or saving fails.
	 */
	saveInBrowser(name?: string): Promise<SaveSiteResult>;

	/**
	 * Marks a stored Playground as explicitly saved.
	 *
	 * This prevents autosaved Playgrounds from being deleted by autosave
	 * pruning. Explicitly saved Playgrounds are left explicit.
	 *
	 * @param siteSlug Optional slug. Uses the active site when omitted.
	 * @throws When no site is selected or the site is temporary.
	 */
	keep(siteSlug?: string): Promise<void>;

	/**
	 * Saves the active Playground to a local directory when it is temporary.
	 *
	 * Existing saved sites are returned without changing storage backends.
	 * Existing autosaves are marked as explicitly saved first.
	 *
	 * @param name Optional display name for a temporary site being saved.
	 * @param localFsHandle Directory handle. When omitted the
	 *   browser prompts the user to pick one.
	 * @returns The site's slug and storage type.
	 * @throws When no site is selected or saving fails.
	 */
	saveToLocalFileSystem(
		name?: string,
		localFsHandle?: FileSystemDirectoryHandle
	): Promise<SaveSiteResult>;

	/**
	 * Changes the PHP version for the active site.
	 *
	 * Active viewports reboot when their persisted runtime configuration
	 * changes.
	 *
	 * @param version The PHP version to use (e.g. `"8.4"`).
	 * @throws When no site is selected or the site is temporary.
	 */
	setPhpVersion(version: AllPHPVersion): Promise<void>;

	/**
	 * Enables or disables network access for the active site.
	 *
	 * Active viewports reboot when their persisted runtime configuration
	 * changes.
	 *
	 * @param enabled Whether networking should be on.
	 * @throws When no site is selected or the site is temporary.
	 */
	setNetworking(enabled: boolean): Promise<void>;

	/**
	 * Deletes a saved site by slug.
	 *
	 * @param siteSlug The slug of the site to delete.
	 * @throws When the site is not found or the site is temporary.
	 */
	delete(siteSlug: string): Promise<void>;

	/**
	 * Switches to a different site and boots it.
	 *
	 * @param siteSlug The slug of the site to activate.
	 * @param options Optional activation behavior.
	 * @throws When the site is not found or fails to boot.
	 */
	setActiveSite(
		siteSlug: string,
		options?: {
			/**
			 * Whether to update the browser URL after activating the site.
			 */
			updateUrl?: boolean;
		}
	): Promise<void>;

	/**
	 * Creates a new temporary site and boots it.
	 *
	 * @param siteSlug Optional slug hint. A random name is
	 *   generated when omitted.
	 * @param settings Optional site settings.
	 * @returns The new site's slug.
	 */
	createNewTemporarySite(
		siteSlug?: string,
		settings?: SiteSettings
	): Promise<string>;

	/**
	 * Creates a new browser-stored site and boots it.
	 *
	 * @param siteSlug Optional slug hint. A random name is
	 *   generated when omitted.
	 * @param settings Optional site settings.
	 * @param options Optional persistence, routing, and pruning behavior.
	 * @returns The new site's slug.
	 */
	createNewSavedSite(
		siteSlug?: string,
		settings?: SiteSettings,
		options?: {
			/**
			 * Whether the new site starts as an autosave or an explicit save.
			 */
			persistence?: SitePersistence;
			/**
			 * Whether to update the browser URL after booting the new site.
			 */
			updateUrl?: boolean;
			/**
			 * Autosaved site slugs to protect from pruning during creation.
			 */
			excludeFromPruning?: string[];
		}
	): Promise<string>;

	/**
	 * Autosaves an active temporary site.
	 *
	 * By default this keeps the current URL unchanged; callers may opt into a
	 * route update with `options.updateUrl`.
	 *
	 * @param siteSlug Optional slug. Uses the active site when omitted.
	 * @param options Optional autosave behavior overrides.
	 * @returns The site's slug and storage type.
	 */
	autosaveTemporarySite(
		siteSlug?: string,
		options?: {
			/**
			 * Whether to update the browser URL after autosaving the site.
			 */
			updateUrl?: boolean;
			/**
			 * Autosaved site slugs to protect from pruning during autosave.
			 */
			excludeFromPruning?: string[];
		}
	): Promise<SaveSiteResult>;
}

export const siteManagementMiddleware = createListenerMiddleware();

export const startListening = siteManagementMiddleware.startListening.withTypes<
	PlaygroundReduxState,
	PlaygroundDispatch
>();

declare global {
	interface Window {
		playgroundSites?: PlaygroundSitesAPI;
	}
}

export function createSitesAPI(
	getState: () => PlaygroundReduxState,
	dispatch: PlaygroundDispatch
): PlaygroundSitesAPI {
	const api: PlaygroundSitesAPI = {
		list() {
			const state = getState();
			const allSites = selectAllSites(state);
			const active = selectActiveSite(state);
			/**
			 * We rename storage "none" to "temporary" in the API because the name temporary
			 * is more descriptive of the actual behavior of these sites.
			 */
			return allSites.map((s) => ({
				slug: s.slug,
				name: s.metadata.name,
				storage: getPublicStorageType(s.metadata.storage),
				persistence: isAutosavedSite(s) ? 'autosave' : 'explicit',
				isActive: s.slug === active?.slug,
			}));
		},

		getClient() {
			const site = selectActiveSite(getState());
			if (!site) {
				throw new Error('No active site selected');
			}
			return selectClientBySiteSlug(getState(), site.slug);
		},

		async rename(newName: string) {
			const site = selectActiveSite(getState());
			if (!site) {
				throw new Error('No active site selected');
			}
			if (site.metadata.storage === 'none') {
				throw new Error(
					'Cannot rename a temporary site. Save it first.'
				);
			}
			await dispatch(
				updateSiteMetadata({
					slug: site.slug,
					changes: { name: newName, persistence: 'explicit' },
				})
			);
		},

		async saveInBrowser(name?: string) {
			const site = selectActiveSite(getState());
			if (!site) {
				throw new Error('No active site selected');
			}
			if (site.metadata.storage !== 'none') {
				if (isAutosavedSite(site)) {
					await dispatch(preserveSite(site.slug));
				}
				return { slug: site.slug, storage: site.metadata.storage };
			}
			await dispatch(
				persistTemporarySite(site.slug, 'opfs', {
					siteName: name,
					skipRenameModal: true,
				})
			);
			const updatedSite = selectSiteBySlug(getState(), site.slug);
			const storage = updatedSite?.metadata.storage ?? 'none';
			return { slug: site.slug, storage };
		},

		async autosaveTemporarySite(siteSlug?: string, options = {}) {
			const site = siteSlug
				? selectSiteBySlug(getState(), siteSlug)
				: selectActiveSite(getState());
			if (!site) {
				throw new Error('No site selected');
			}
			if (site.metadata.storage !== 'none') {
				return { slug: site.slug, storage: site.metadata.storage };
			}
			await dispatch(
				persistTemporarySite(site.slug, 'opfs', {
					skipRenameModal: true,
					persistence: 'autosave',
					updateUrl: options.updateUrl ?? false,
					keepOriginalUrlParams: true,
					keepRunningClient: true,
				})
			);
			await dispatch(
				pruneAutosavedSites({
					excludeSlugs: [
						site.slug,
						...(options.excludeFromPruning ?? []),
					],
				})
			);
			const updatedSite = selectSiteBySlug(getState(), site.slug);
			const storage = updatedSite?.metadata.storage ?? 'none';
			return { slug: site.slug, storage };
		},

		async keep(siteSlug?: string) {
			const site = siteSlug
				? selectSiteBySlug(getState(), siteSlug)
				: selectActiveSite(getState());
			if (!site) {
				throw new Error('No site selected');
			}
			await dispatch(preserveSite(site.slug));
		},

		async saveToLocalFileSystem(
			name?: string,
			localFsHandle?: FileSystemDirectoryHandle
		) {
			const site = selectActiveSite(getState());
			if (!site) {
				throw new Error('No active site selected');
			}
			if (site.metadata.storage !== 'none') {
				if (isAutosavedSite(site)) {
					await dispatch(preserveSite(site.slug));
				}
				return { slug: site.slug, storage: site.metadata.storage };
			}
			await dispatch(
				persistTemporarySite(site.slug, 'local-fs', {
					siteName: name,
					localFsHandle,
					skipRenameModal: true,
				})
			);
			const updatedSite = selectSiteBySlug(getState(), site.slug);
			const storage = updatedSite?.metadata.storage ?? 'none';
			return { slug: site.slug, storage };
		},

		async setPhpVersion(version: AllPHPVersion) {
			const site = selectActiveSite(getState());
			if (!site) {
				throw new Error('No active site selected');
			}
			if (site.metadata.storage === 'none') {
				throw new Error(
					'Cannot update settings on a temporary site. Save it first.'
				);
			}
			await dispatch(
				updateSiteMetadata({
					slug: site.slug,
					changes: {
						runtimeConfiguration: {
							...site.metadata.runtimeConfiguration,
							phpVersion: version,
						},
					},
				})
			);
		},

		async setNetworking(enabled: boolean) {
			const site = selectActiveSite(getState());
			if (!site) {
				throw new Error('No active site selected');
			}
			if (site.metadata.storage === 'none') {
				throw new Error(
					'Cannot update settings on a temporary site. Save it first.'
				);
			}
			await dispatch(
				updateSiteMetadata({
					slug: site.slug,
					changes: {
						runtimeConfiguration: {
							...site.metadata.runtimeConfiguration,
							networking: enabled,
						},
					},
				})
			);
		},

		async delete(siteSlug: string) {
			const site = selectSiteBySlug(getState(), siteSlug);
			if (!site) {
				throw new Error(`Site not found: ${siteSlug}`);
			}
			if (site.metadata.storage === 'none') {
				throw new Error(
					'Cannot delete a temporary site. It will be reset on the next page load.'
				);
			}
			await dispatch(removeSite(siteSlug));
		},

		async setActiveSite(siteSlug: string, options = {}) {
			const state = getState();
			const site = selectSiteBySlug(state, siteSlug);
			if (!site) {
				throw new Error(`Site not found: ${siteSlug}`);
			}
			// If the requested site is already active, avoid registering a
			// listener that will never fire. The underlying setActiveSite
			// thunk short-circuits in this case, so we can safely return.
			const activeSite = selectActiveSite(state);
			if (activeSite?.slug === siteSlug) {
				return;
			}
			const bootPromise = new Promise<void>((resolve, reject) => {
				const unsubscribe = startListening({
					predicate: (action) =>
						(addClientInfo.match(action) &&
							action.payload.siteSlug === siteSlug) ||
						setActiveSiteError.match(action),
					effect: (action) => {
						unsubscribe();
						if (setActiveSiteError.match(action)) {
							const details = action.payload.details;
							const message =
								typeof details === 'string'
									? details
									: (details?.message ??
										action.payload.error);
							reject(new Error(message));
						} else {
							resolve();
						}
					},
				});
			});
			dispatch(setActiveSite(siteSlug, options));
			await bootPromise;
		},

		async createNewTemporarySite(
			requestedSiteSlug?: string,
			settings?: SiteSettings
		) {
			const siteName = requestedSiteSlug
				? deriveSiteNameFromSlug(requestedSiteSlug)
				: randomSiteName();
			const url = new URL(window.location.href);
			if (settings) {
				if (settings.phpVersion !== undefined) {
					url.searchParams.set('php', settings.phpVersion);
				}
				if (settings.wpVersion !== undefined) {
					url.searchParams.set('wp', settings.wpVersion);
				}
				if (settings.networking !== undefined) {
					url.searchParams.set(
						'networking',
						settings.networking ? 'yes' : 'no'
					);
				}
				if (settings.language !== undefined) {
					url.searchParams.set('language', settings.language);
				}
				if (settings.multisite !== undefined) {
					url.searchParams.set(
						'multisite',
						settings.multisite ? 'yes' : 'no'
					);
				}
			}
			const newSiteInfo = await dispatch(
				setTemporarySiteSpec(siteName, url, requestedSiteSlug)
			);
			await api.setActiveSite(newSiteInfo.slug);
			return newSiteInfo.slug;
		},

		async createNewSavedSite(
			requestedSiteSlug?: string,
			settings?: SiteSettings,
			options = {}
		) {
			if (!opfsSiteStorage) {
				throw new Error(
					'Cannot create a saved Playground because browser storage is not available.'
				);
			}
			const siteName = requestedSiteSlug
				? deriveSiteNameFromSlug(requestedSiteSlug)
				: randomSiteName();
			const url = getUrlWithSettings(settings);
			const newSiteInfo = await dispatch(
				setStoredSiteSpec(siteName, url, requestedSiteSlug, {
					persistence: options.persistence ?? 'autosave',
				})
			);
			await api.setActiveSite(newSiteInfo.slug, {
				updateUrl: options.updateUrl,
			});
			await dispatch(
				pruneAutosavedSites({
					excludeSlugs: [
						newSiteInfo.slug,
						...(options.excludeFromPruning ?? []),
					],
				})
			);
			return newSiteInfo.slug;
		},
	};
	return api;
}

function getUrlWithSettings(settings?: SiteSettings) {
	const url = new URL(window.location.href);
	url.searchParams.delete('random');
	url.searchParams.delete('site-slug');
	url.searchParams.delete('storage');
	if (settings) {
		if (settings.phpVersion !== undefined) {
			url.searchParams.set('php', settings.phpVersion);
		}
		if (settings.wpVersion !== undefined) {
			url.searchParams.set('wp', settings.wpVersion);
		}
		if (settings.networking !== undefined) {
			url.searchParams.set(
				'networking',
				settings.networking ? 'yes' : 'no'
			);
		}
		if (settings.language !== undefined) {
			url.searchParams.set('language', settings.language);
		}
		if (settings.multisite !== undefined) {
			url.searchParams.set(
				'multisite',
				settings.multisite ? 'yes' : 'no'
			);
		}
	}
	return url;
}

function getPublicStorageType(storage: SiteStorageType): PublicSiteStorageType {
	return storage === 'none' ? 'temporary' : storage;
}

/**
 * Once OPFS sites have loaded, expose the site management API on
 * `window.playgroundSites` and, when the MCP query-arg is present,
 * start the MCP bridge.
 */
startListening({
	actionCreator: setOPFSSitesLoadingState,
	effect: (_action, listenerApi) => {
		listenerApi.unsubscribe();
		window.playgroundSites = createSitesAPI(
			listenerApi.getState,
			listenerApi.dispatch
		);
	},
});

export function useSitesAPI(): PlaygroundSitesAPI {
	const store = useStore<PlaygroundReduxState>();
	const dispatch = useAppDispatch();
	return useMemo(
		() => createSitesAPI(store.getState, dispatch),
		[store, dispatch]
	);
}
