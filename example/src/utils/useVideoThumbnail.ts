import { useEffect, useState } from 'react';
import { createThumbnail } from 'react-native-create-thumbnail';

/** Extracts a frame from a local video; empty string while pending or on failure. */
export function useVideoThumbnail(videoPath: string): string {
  const [uri, setUri] = useState('');

  useEffect(() => {
    if (!videoPath) {
      setUri('');
      return;
    }
    let cancelled = false;
    createThumbnail({ url: `file://${videoPath}` })
      .then((result) => {
        if (!cancelled) {
          setUri(result.path);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUri('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  return uri;
}
