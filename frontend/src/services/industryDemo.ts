/**
 * The demonstration goes through the same upload, extraction, photo and calculation as any file. Only its input is
 * prepared in advance, and the interface says so. All of it comes from the backend's demo set, except the supplier
 * list, whose lines were copied by hand from the suppliers' product pages on the date in the file.
 */
export const DEMO_DOCUMENT = { url: '/demo/industry/tv320_manual.pdf', name: 'tv320_manual.pdf' };

export const DEMO_PRICE_LIST = { url: '/demo/industry/demo_prices.csv', name: 'demo_prices.csv' };
export const VERIFIED_PRICE_LIST = { url: '/demo/industry/verified_suppliers.csv', name: 'verified_suppliers.csv' };

export const DEMO_PHOTOS = [
  { key: 'exact', url: '/demo/industry/marking_6205.png', name: 'marking_6205.png' },
  { key: 'close', url: '/demo/industry/marking_6205h.png', name: 'marking_6205h.png' },
  { key: 'type', url: '/demo/industry/part_no_marking.png', name: 'part_no_marking.png' },
  { key: 'blurry', url: '/demo/industry/marking_blurry.png', name: 'marking_blurry.png' },
] as const;

export const isDemoDocument = (name: string): boolean => name === DEMO_DOCUMENT.name;

export async function fetchDemoFile(url: string, name: string, type: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return new File([await response.blob()], name, { type });
}
