import type { RefObject } from 'react';
import type { OverlayCue } from 'react-native-video-burn-overlay';
import type { ViewShotRef } from 'react-native-view-shot';
import type { AddressLines } from './geocoding';
import { formatCoordinateLine, formatTimeLine } from './useLocationStamp';
import type { GpsSample } from './useLocationStamp';
import { stripFileScheme } from './videoPaths';

// Native only needs endSec >= actual duration; we don't track it, so use a huge sentinel.
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

/** Nearest GPS sample at or before atSec — holds the last known fix between updates. */
function findSampleAt(
  samples: readonly GpsSample[],
  atSec: number
): GpsSample | null {
  let found: GpsSample | null = null;
  for (const sample of samples) {
    if (sample.elapsedSec > atSec) {
      break;
    }
    found = sample;
  }
  return found;
}

function buildStampLines(
  sample: GpsSample | null,
  clockAt: Date,
  addressLines: AddressLines | null
): string[] {
  const lines = [formatTimeLine(clockAt)];
  if (sample) {
    lines.push(formatCoordinateLine(sample));
  }
  if (addressLines) {
    for (const line of addressLines) {
      if (line) {
        lines.push(line);
      }
    }
  }
  return lines;
}

/** One cue per second so the clock ticks and the GPS trail moves in the burned video. */
export function buildLocationStampCues(
  samples: readonly GpsSample[],
  startedAt: Date,
  addressLines: AddressLines | null
): OverlayCue[] {
  // First cue only covers the leftover of the mid-second startedAt lands in.
  const firstCueEndSec = (1000 - startedAt.getMilliseconds()) / 1000;
  const clockStart = new Date(
    startedAt.getTime() - startedAt.getMilliseconds()
  );

  if (samples.length === 0) {
    return [
      {
        startSec: 0,
        endSec: CUE_END_SEC_SENTINEL,
        lines: buildStampLines(null, clockStart, addressLines),
      },
    ];
  }

  const totalSec = samples[samples.length - 1]!.elapsedSec + 1;
  const cueCount = Math.ceil(totalSec - firstCueEndSec) + 1;

  return Array.from({ length: cueCount }, (_unused, index) => {
    const startSec = index === 0 ? 0 : firstCueEndSec + index - 1;
    const clockAt = new Date(clockStart.getTime() + index * 1000);
    return {
      startSec,
      endSec: firstCueEndSec + index,
      lines: buildStampLines(
        findSampleAt(samples, startSec),
        clockAt,
        addressLines
      ),
    };
  });
}
