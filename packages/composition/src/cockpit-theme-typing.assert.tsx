/**
 * Type-level assertion (checked by `pnpm typecheck`, not run as a test):
 * how a CockpitTheme applies to a React `style` prop under THIS repo's
 * @types/react (cockpit-design-pass T1 — the N-5 question).
 *
 * Answer: a CAST is required. @types/react@19's `CSSProperties` has closed
 * typing (no `--*` index signature), so a `Partial<Record<CockpitVar, string>>`
 * is NOT directly assignable to `style` — it raises TS2559. The docs task
 * carries this into the consumer contract; this file pins it so the answer can't
 * silently rot.
 */

import type { CSSProperties } from 'react';
import { themes, type CockpitTheme } from '@surface/cockpit-ui';

const theme: CockpitTheme = themes.default;

// @ts-expect-error CockpitTheme is not assignable to `style` without a cast (TS2559).
export const uncast = <div style={theme} />;

// With the documented cast it typechecks cleanly:
export const cast = <div style={theme as CSSProperties} />;
