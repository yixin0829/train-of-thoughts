/**
 * The porcelain profile the simulation and the mesh share, for a bowl of unit diameter:
 * a flat foot, a shoulder where the wall leaves it, and a wall that curves out to the rim.
 * `lib/scene/bowl.ts` turns it on a lathe; `lib/sim.ts` uses it to know where two bowls
 * of different sizes actually touch.
 */

/** Height of the bowl as a fraction of its diameter. */
export const HEIGHT = 0.4;
/** Porcelain wall thickness as a fraction of the diameter. */
export const WALL = 0.012;
/** How deep a bowl sits in the water, as a fraction of its height. */
export const DRAFT = 0.16;
/** Height of the shoulder above the foot, where the wall begins. */
export const RISE = 0.03;
/** Radius of the shoulder. */
export const SHOULDER = 0.22;

/** Radius of the outer wall at height `y` above the foot (both as fractions of the diameter). */
export function outerRadius(y: number) {
  if (y <= RISE) return SHOULDER;
  const c = Math.max(-1, Math.min(1, 1 - (y - RISE) / (HEIGHT - RISE)));
  return SHOULDER + (0.5 - SHOULDER) * Math.sin(Math.acos(c));
}

/** Radius, as a fraction of the diameter, where the outer wall crosses the waterline. */
export const WATERLINE = outerRadius(DRAFT * HEIGHT);

/** Height of the rim above the water, cm, for a bowl `d` cm across. */
export const rimHeight = (d: number) => HEIGHT * (1 - DRAFT) * d;

/**
 * Where two floating bowls meet, cm from each centre. Equal bowls touch rim to rim; otherwise
 * the smaller bowl's rim meets the larger bowl's wall below its rim, where it is narrower.
 */
export function contactRadii(da: number, db: number): [number, number] {
  if (da === db) return [da / 2, db / 2];
  const [small, big] = da < db ? [da, db] : [db, da];
  const y = (rimHeight(small) + DRAFT * HEIGHT * big) / big; // small rim's height above the big bowl's foot
  const rBig = outerRadius(y) * big;
  return da < db ? [small / 2, rBig] : [rBig, small / 2];
}
