/** Which element Tab should move to at the edge of a trapped region, or null to let the browser handle it. */
export function trapTarget<T>(elements: readonly T[], active: T | null, backwards: boolean): T | null {
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (first === undefined || last === undefined) return null;
  if (active === null || !elements.includes(active)) return backwards ? last : first;
  if (backwards && active === first) return last;
  if (!backwards && active === last) return first;
  return null;
}
