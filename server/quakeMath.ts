/**
 * Quake math — pure. How a magnitude becomes a footprint, and a distance
 * becomes damage. No IO; the poller and the tick both lean on this.
 */

/** Felt radius in km — tuned so an M2 brushes a neighborhood, an M3 a region. */
export function quakeRadiusKm(mag: number): number {
  return Math.max(1, 1.5 + (mag - 1.5) * 4.3);
}

/** Peak degradation at the epicenter: M1.5 ≈ 4, M2 ≈ 9, M2.5 ≈ 16, M3 ≈ 25. */
export function quakePeakDamage(mag: number): number {
  return Math.min(30, Math.round(4 * Math.pow(mag - 0.5, 2)));
}

/** Gaussian falloff: full at the epicenter, ~1% at the felt radius. */
export function quakeIntensityAt(distKm: number, mag: number): number {
  const r = quakeRadiusKm(mag);
  if (distKm > r) return 0;
  const sigma = r / 3; // steep: the rim rattles windows, the epicenter bites
  return Math.exp(-(distKm * distKm) / (2 * sigma * sigma));
}

/** Damage points a parcel takes at `distKm` from an M`mag` epicenter. */
export function quakeDamageAt(distKm: number, mag: number): number {
  return Math.round(quakePeakDamage(mag) * quakeIntensityAt(distKm, mag));
}

/** Great-circle distance in km (haversine). */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
