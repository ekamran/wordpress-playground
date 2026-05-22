import { Notice, Flex, FlexItem, Button } from '@wordpress/components';
import css from './style.module.css';
import { SitePersistButton } from '../site-persist-button';
import { useState } from 'react';
import classNames from 'classnames';
import { usePlaygroundClient } from '../../../lib/use-playground-client';
import { useActiveSite, useAppSelector } from '../../../lib/state/redux/store';
import { isSaveDisabledByQueryParam } from '../../../lib/state/url/router';
import { isOpfsAvailable } from '../../../lib/state/opfs/opfs-site-storage';
import { useLocalFsAvailability } from '../../../lib/hooks/use-local-fs-availability';

export function TemporarySiteNotice({
	isDismissible = false,
	className,
}: {
	isDismissible?: boolean;
	className?: string;
}) {
	const [isDismissed, setIsDismissed] = useState(false);
	const site = useActiveSite()!;
	const playground = usePlaygroundClient(site.slug);
	const localFsAvailability = useLocalFsAvailability(playground ?? undefined);
	const autosaveRestorePending = useAppSelector(
		(state) => state.ui.autosaveRestorePending
	);
	const canStorePermanently =
		isOpfsAvailable || localFsAvailability === 'available';
	if (isDismissed || isSaveDisabledByQueryParam() || autosaveRestorePending) {
		return null;
	}
	return (
		<Notice
			className={classNames(css.siteNotice, className)}
			spokenMessage="This is an Unsaved Playground. Your changes will be lost on page refresh."
			status="info"
			isDismissible={isDismissible}
			onDismiss={() => setIsDismissed(true)}
		>
			<Flex direction="row" gap={2} expanded={true}>
				<FlexItem>
					<b>This is an Unsaved Playground.</b> Your changes will be
					lost on page refresh.
				</FlexItem>
				{canStorePermanently && (
					<FlexItem>
						<SitePersistButton siteSlug={site.slug}>
							<Button
								variant="primary"
								disabled={!playground}
								aria-label="Save site locally"
							>
								Save
							</Button>
						</SitePersistButton>
					</FlexItem>
				)}
			</Flex>
		</Notice>
	);
}
