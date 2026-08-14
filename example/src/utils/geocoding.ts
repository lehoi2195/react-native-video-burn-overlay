export interface NominatimAddress {
  house_number?: string;
  road?: string;
  quarter?: string;
  suburb?: string;
  neighbourhood?: string;
  village?: string;
  city_district?: string;
  county?: string;
  district?: string;
  city?: string;
  town?: string;
  state?: string;
  country?: string;
  postcode?: string;
}

/** Two lines: house#/street/ward, then district/province/country/postcode. */
export type AddressLines = readonly [string, string];

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

/** Free, no API key; OSM's usage policy asks for max ~1 request/sec, so callers must throttle. */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<AddressLines | null> {
  const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&accept-language=vi&lat=${latitude}&lon=${longitude}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'react-native-video-burn-overlay-example/1.0' },
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { address?: NominatimAddress };
  if (!body.address) {
    return null;
  }
  return formatAddressLines(body.address);
}

function formatAddressLines(address: NominatimAddress): AddressLines {
  const ward =
    address.quarter ??
    address.suburb ??
    address.neighbourhood ??
    address.village;
  const line1 = [address.house_number, address.road, ward]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  const district = address.city_district ?? address.county ?? address.district;
  const province = address.city ?? address.state ?? address.town;
  const line2 = [district, province, address.country, address.postcode]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  return [line1, line2];
}

/** Haversine distance in meters; used to decide whether a moved-enough re-geocode is due. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
