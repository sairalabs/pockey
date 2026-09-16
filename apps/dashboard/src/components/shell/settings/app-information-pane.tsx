'use client';

import { Pencil } from 'lucide-react';
import { useId, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import type { AppSummary } from '@/lib/mock-data';
import { Pane, SavedHint } from './pane';

const NAME_MAX = 25;
const TAGLINE_MAX = 60;
const DESCRIPTION_MAX = 200;

export function AppInformationPane({ app }: { app: AppSummary }) {
  const id = useId();
  const [name, setName] = useState(app.app.name);
  const [tagline, setTagline] = useState(app.tagline);
  const [description, setDescription] = useState(app.description);
  const [saved, setSaved] = useState(false);

  const valid =
    name.trim().length > 0 &&
    name.length <= NAME_MAX &&
    tagline.length <= TAGLINE_MAX &&
    description.length <= DESCRIPTION_MAX;

  return (
    <Pane
      title="App information"
      actions={
        <>
          <SavedHint visible={saved} />
          <Button
            variant="primary"
            size="sm"
            disabled={!valid}
            onClick={() => {
              // TODO(T5.1): PATCH /admin/apps/:id with name, tagline, description.
              setSaved(true);
              setTimeout(() => {
                setSaved(false);
              }, 1500);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-5">
          <div className="relative">
            <Avatar seed={app.app.id} size={80} shape="square" initial={name.charAt(0) || '?'} />
            <button
              type="button"
              aria-label="Change icon"
              className="absolute -right-1.5 -bottom-1.5 flex size-7 items-center justify-center rounded-full bg-surface-3 text-fg shadow-border transition-[transform,background-color] duration-150 ease-out hover:bg-[#2a2a2a] active:scale-[0.96]"
            >
              <Pencil className="size-3.5" strokeWidth={2} />
            </button>
          </div>
          <div>
            <p className="text-sm font-medium">App icon</p>
            <p className="mt-0.5 text-[13px] text-fg-2">
              Square PNG or SVG, at least 256px. Shown in the login modal and this dashboard.
            </p>
          </div>
        </div>

        <Field label="Name" htmlFor={`${id}-name`} counter={{ value: name.length, max: NAME_MAX }}>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>

        <Field
          label="Tagline"
          htmlFor={`${id}-tagline`}
          counter={{ value: tagline.length, max: TAGLINE_MAX }}
        >
          <Input
            id={`${id}-tagline`}
            value={tagline}
            maxLength={TAGLINE_MAX}
            placeholder="One line about the app"
            onChange={(event) => {
              setTagline(event.target.value);
            }}
          />
        </Field>

        <Field
          label="Description"
          htmlFor={`${id}-description`}
          counter={{ value: description.length, max: DESCRIPTION_MAX }}
        >
          <Textarea
            id={`${id}-description`}
            value={description}
            maxLength={DESCRIPTION_MAX}
            placeholder="What end users sign in to"
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </Field>
      </div>
    </Pane>
  );
}
