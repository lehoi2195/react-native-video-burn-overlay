import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation, {
  type GeoError,
  type GeoPosition,
} from 'react-native-geolocation-service';
import { distanceMeters, reverseGeocode, type AddressLines } from './geocoding';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GpsSample {
  elapsedSec: number;
  latitude: number;
  longitude: number;
}

export interface LocationStamp {
  hasPermission: boolean;
  coordinates: Coordinates | null;
  /** Raw 2-line address, for cueBuilders to combine with a per-second GPS sample. */
  addressLines: AddressLines | null;
  /** 4 lines: time, coordinates, address line 1, address line 2 — empty ones omitted. */
  previewLines: string[];
  /** One GPS sample per second while recording, for a moving-trail burn. */
  start: (startedAt: Date) => void;
  stop: () => GpsSample[];
}

const CLOCK_TICK_MS = 1000;
const SAMPLE_INTERVAL_MS = 1000;
/** OSM's Nominatim asks for max ~1 req/sec; re-geocode only this often at most. */
const GEOCODE_MIN_INTERVAL_MS = 30_000;
const GEOCODE_MIN_MOVE_METERS = 30;

// On timeout (code 3), retry with a looser network fix — reliable indoors.
const HIGH_ACCURACY_OPTIONS = {
  timeout: 30_000,
  maximumAge: 10_000,
  distanceFilter: 3,
  accuracy: { android: 'high' as const, ios: 'bestForNavigation' as const },
  enableHighAccuracy: true,
  showLocationDialog: true,
  forceRequestLocation: true,
};
const NETWORK_FALLBACK_OPTIONS = {
  ...HIGH_ACCURACY_OPTIONS,
  enableHighAccuracy: false,
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

export function formatTimeLine(date: Date): string {
  const day = `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  return `${day} ${time}`;
}

export function formatCoordinateLine(coordinates: Coordinates): string {
  return `${coordinates.latitude.toFixed(7)}, ${coordinates.longitude.toFixed(7)}`;
}

async function requestLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    try {
      const result = await Geolocation.requestAuthorization('whenInUse');
      return result === 'granted';
    } catch {
      return false;
    }
  }
  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (await PermissionsAndroid.check(permission)) {
    return true;
  }
  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** Live time/coordinates/address for the camera overlay; also samples GPS once per second while recording. */
export function useLocationStamp(): LocationStamp {
  const [hasPermission, setHasPermission] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [addressLines, setAddressLines] = useState<AddressLines | null>(null);
  const [now, setNow] = useState(() => new Date());

  const samplesRef = useRef<GpsSample[]>([]);
  const latestRef = useRef<Coordinates | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const samplingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const lastGeocodedRef = useRef<{ at: number; coords: Coordinates } | null>(
    null
  );
  const geocodeInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    requestLocationPermission().then((granted) => {
      if (!cancelled) {
        setHasPermission(granted);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPosition = useCallback((position: GeoPosition) => {
    const next: Coordinates = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    latestRef.current = next;
    setCoordinates(next);
  }, []);

  // Live GPS coordinates for the preview and to feed reverse geocoding.
  useEffect(() => {
    if (!hasPermission) {
      return;
    }
    const onError = (error: GeoError): void => {
      // TIMEOUT (3): a high-accuracy fix took too long — retry once with a looser fix.
      if (error.code === 3) {
        Geolocation.getCurrentPosition(
          applyPosition,
          undefined,
          NETWORK_FALLBACK_OPTIONS
        );
      }
    };
    Geolocation.getCurrentPosition(
      applyPosition,
      onError,
      HIGH_ACCURACY_OPTIONS
    );
    const watchId = Geolocation.watchPosition(
      applyPosition,
      undefined,
      HIGH_ACCURACY_OPTIONS
    );
    return () => Geolocation.clearWatch(watchId);
  }, [hasPermission, applyPosition]);

  // Ticking clock for the time line, independent of recording state.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // Reverse geocode on a throttle — never on every GPS update.
  useEffect(() => {
    if (!coordinates || geocodeInFlightRef.current) {
      return;
    }
    const last = lastGeocodedRef.current;
    const dueByTime = !last || Date.now() - last.at >= GEOCODE_MIN_INTERVAL_MS;
    const dueByMove =
      !last ||
      distanceMeters(last.coords, coordinates) >= GEOCODE_MIN_MOVE_METERS;
    if (!dueByTime && !dueByMove) {
      return;
    }

    geocodeInFlightRef.current = true;
    lastGeocodedRef.current = { at: Date.now(), coords: coordinates };
    reverseGeocode(coordinates.latitude, coordinates.longitude)
      .then((lines) => {
        if (lines) {
          setAddressLines(lines);
        }
      })
      .catch(() => {
        // Keeps the last-known address rather than blanking it on a transient failure.
      })
      .finally(() => {
        geocodeInFlightRef.current = false;
      });
  }, [coordinates]);

  const stopSampling = useCallback(() => {
    if (watchIdRef.current !== null) {
      Geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (samplingIntervalRef.current !== null) {
      clearInterval(samplingIntervalRef.current);
      samplingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => stopSampling, [stopSampling]);

  const start = useCallback(
    (startedAt: Date) => {
      stopSampling();
      samplesRef.current = [];

      const pushSample = (): void => {
        const latest = latestRef.current;
        if (!latest) {
          return;
        }
        samplesRef.current = [
          ...samplesRef.current,
          {
            elapsedSec: Math.floor((Date.now() - startedAt.getTime()) / 1000),
            latitude: latest.latitude,
            longitude: latest.longitude,
          },
        ];
      };

      // setInterval only fires after 1s; sample immediately so second 0 has a line too.
      pushSample();
      samplingIntervalRef.current = setInterval(pushSample, SAMPLE_INTERVAL_MS);
    },
    [stopSampling]
  );

  const stop = useCallback((): GpsSample[] => {
    stopSampling();
    return [...samplesRef.current].sort((a, b) => a.elapsedSec - b.elapsedSec);
  }, [stopSampling]);

  const previewLines: string[] = [formatTimeLine(now)];
  if (hasPermission && coordinates) {
    previewLines.push(formatCoordinateLine(coordinates));
  } else if (!hasPermission) {
    previewLines.push('No location permission');
  }
  if (addressLines) {
    for (const line of addressLines) {
      if (line) {
        previewLines.push(line);
      }
    }
  }

  return {
    hasPermission,
    coordinates,
    addressLines,
    previewLines,
    start,
    stop,
  };
}
