import { SECTIONS } from './app';
import { filterPalette, toPaletteItems } from './palette';

const paletteItems = () => toPaletteItems(SECTIONS);

describe('palette', () => {
  it('lists all 14 pages', () => {
    expect(paletteItems().length).toBe(14);
  });

  it('matches by page or section name, every word, ignoring case', () => {
    const items = paletteItems();
    expect(filterPalette(items, 'DISK').map((i) => i.path)).toEqual(['/disk']);
    expect(filterPalette(items, 'clean disk').map((i) => i.path)).toEqual(['/disk']);
    expect(filterPalette(items, 'apps').map((i) => i.path)).toContain('/catalog');
    expect(filterPalette(items, 'zzz')).toEqual([]);
    expect(filterPalette(items, '  ').length).toBe(14);
  });
});
