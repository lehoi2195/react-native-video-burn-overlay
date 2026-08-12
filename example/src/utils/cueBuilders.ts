import type { RefObject } from 'react';
import type { OverlayCue } from 'rn-video-overlay';
import type { ViewShotRef } from 'react-native-view-shot';
import { stripFileScheme } from './videoPaths';

// Native only needs endSec >= actual video duration to cover the whole clip; we don't track
// the real duration here, so use a sentinel far beyond any realistic input video length.
export const CUE_END_SEC_SENTINEL = 24 * 60 * 60;

/** Builds a text cue from live settings state, matching what the panel and preview show. */
export function buildTextCue(message: string): OverlayCue {
  return {
    startSec: 0,
    endSec: CUE_END_SEC_SENTINEL,
    lines: message.split('\n'),
  };
}

/** Captures the off-screen card to a PNG imagePath cue; native composites whatever bitmap it's given. */
export async function buildImageCue(
  viewShotRef: RefObject<ViewShotRef | null>
): Promise<OverlayCue> {
  if (!viewShotRef.current) {
    throw new Error('The custom overlay card is not ready to capture yet.');
  }
  const capturedUri = await viewShotRef.current.capture();
  return {
    startSec: 0,
    endSec: CUE_END_SEC_SENTINEL,
    imagePath: stripFileScheme(capturedUri),
  };
}
