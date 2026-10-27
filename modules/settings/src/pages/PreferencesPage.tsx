import type { UserPreferences } from '@govcloud-mfe/contracts';
import { platformQueries, useBuildInfo, useUpdatePreferences } from '@govcloud-mfe/platform-sdk';
import { Alert, Button, Card, PageHeader, Spinner } from '@govcloud-mfe/ui';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { flags } from '../flags';
import styles from '../settings.module.css';

export function PreferencesPage() {
  const preferences = useQuery(platformQueries.preferences());
  const { modules } = useBuildInfo();

  return (
    <>
      <PageHeader
        title="Preferences"
        description="Saved by the frontend API. The app applies them as soon as you save."
      />
      {preferences.isPending && <Spinner />}
      {preferences.isError && <Alert tone="error" title="Could not load your preferences" />}
      {preferences.data && (
        <Card>
          {/* Re-mount the form when saved data changes so its local state starts fresh. */}
          <PreferencesForm
            key={JSON.stringify(preferences.data)}
            saved={preferences.data}
            moduleNames={modules.map((m) => m.name)}
          />
        </Card>
      )}
    </>
  );
}

function PreferencesForm({
  saved,
  moduleNames,
}: {
  saved: UserPreferences;
  moduleNames: string[];
}) {
  const [draft, setDraft] = useState(saved);
  const update = useUpdatePreferences();
  const compactAvailable = flags.useFlag('compactDensity');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate(draft);
  };

  const togglePinned = (name: string) =>
    setDraft((current) => ({
      ...current,
      pinnedModules: current.pinnedModules.includes(name)
        ? current.pinnedModules.filter((m) => m !== name)
        : [...current.pinnedModules, name],
    }));

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <fieldset>
        <legend>Theme</legend>
        {(['system', 'light', 'dark'] as const).map((theme) => (
          <label key={theme}>
            <input
              type="radio"
              name="theme"
              value={theme}
              checked={draft.theme === theme}
              onChange={() => setDraft({ ...draft, theme })}
            />{' '}
            {theme}
          </label>
        ))}
      </fieldset>

      <label>
        Density{' '}
        <select
          value={draft.density}
          onChange={(e) =>
            setDraft({ ...draft, density: e.target.value as UserPreferences['density'] })
          }
        >
          <option value="comfortable">Comfortable</option>
          {(compactAvailable || draft.density === 'compact') && (
            <option value="compact">Compact</option>
          )}
        </select>
      </label>

      {moduleNames.length > 0 && (
        <fieldset>
          <legend>Pinned modules</legend>
          {moduleNames.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={draft.pinnedModules.includes(name)}
                onChange={() => togglePinned(name)}
              />{' '}
              {name}
            </label>
          ))}
        </fieldset>
      )}

      {update.isError && <Alert tone="error" title="Your preferences were not saved" />}
      <div>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
