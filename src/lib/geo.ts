import type { Coords } from "@/lib/api";

const EARTH_RADIUS_KM = 6371;

// ~10 km, like the server, so small GPS changes don't redo everything
export const roughly = (degrees: number) => Math.round(degrees * 10) / 10;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;

// Which way to face to look towards `to` (compass bearing, 0 = north) along the
// shortest path over the Earth (a great circle), and how far away it is.
export function directionTo(from: Coords, to: Coords) {
    const lat1 = toRad(from.latitude);
    const lat2 = toRad(to.latitude);
    const dLon = toRad(to.longitude - from.longitude);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

    // haversine
    const a = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const km = 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));

    return { bearing, km };
}

// 1240.6 -> "1,240 km" (locations are only known to ~10 km, so no finer than that)
export function formatDistance(km: number) {
    const rounded = Math.round(km / 10) * 10;
    return `${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} km`;
}
