import { joinPaths } from '@php-wasm/util';

export const OPFS_SITES_ROOT_PATH = '/sites';

export function getDirectoryPathForSlug(slug: string) {
	return joinPaths(OPFS_SITES_ROOT_PATH, getDirectoryNameForSlug(slug));
}

/**
 * Returns the OPFS directory name for a site slug.
 *
 * The slug itself may contain characters that are fine in a query parameter
 * but not as an OPFS path segment, such as `/`. Percent-encoding keeps the
 * mapping reversible instead of collapsing distinct slugs to the same name.
 */
export function getDirectoryNameForSlug(slug: string) {
	return `site-${encodeURIComponent(slug)}`;
}

/**
 * Returns the OPFS directory names that may contain the site data for a slug.
 *
 * Check the current reversible name first, then the legacy lossy name for sites
 * saved before slug path encoding was introduced.
 */
export function getCandidateDirectoryNamesForSlug(slug: string) {
	const directoryName = getDirectoryNameForSlug(slug);
	const legacyDirectoryName = getLegacyDirectoryNameForSlug(slug);
	if (legacyDirectoryName === directoryName) {
		return [directoryName];
	}
	return [directoryName, legacyDirectoryName];
}

/**
 * Returns the lossy OPFS directory name used before site slugs were encoded.
 *
 * Keep this for reading already-saved sites. New sites should use
 * `getDirectoryNameForSlug()` instead.
 */
export function getLegacyDirectoryNameForSlug(slug: string) {
	return `site-${slug}`.replaceAll(/[^a-zA-Z0-9_-]/g, '-');
}
