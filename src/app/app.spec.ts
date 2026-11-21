import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { App, SECTIONS, sectionOf } from './app';
import { SystemService } from './system.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain('System Monitor');
    expect(compiled.querySelectorAll('.sections a').length).toBe(5);
  });

  describe('sections and tabs', () => {
    it('hold all 14 pages once each, with the routes and labels the app always had', () => {
      expect(SECTIONS.flatMap((s) => s.pages.map((p) => `${p.path} ${p.label}`))).toEqual([
        '/ Dashboard',
        '/software Software',
        '/updates App updates',
        '/catalog App catalog',
        '/find Find apps',
        '/processes Processes',
        '/startup Startup',
        '/battery Battery',
        '/cleanup Cleanup',
        '/disk Disk space',
        '/backups Backups',
        '/drivers Drivers',
        '/blocked Blocked',
        '/automation Automation',
      ]);
    });

    it('find the section of a route, ignoring a query string, and fall back to the overview', () => {
      expect(sectionOf('/disk').id).toBe('clean');
      expect(sectionOf('/disk?tab=caches').id).toBe('clean');
      expect(sectionOf('/startup#x').id).toBe('monitor');
      expect(sectionOf('/').id).toBe('overview');
      expect(sectionOf('/nowhere').id).toBe('overview');
    });

    it('show the pages of the open section as tabs, and the rail goes back to the last page of a section', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([{ path: '**', children: [] }])] });
      const router = TestBed.inject(Router);
      const fixture = TestBed.createComponent(App);
      const el = fixture.nativeElement as HTMLElement;
      const tabs = () => Array.from(el.querySelectorAll('.tabs a')).map((a) => a.textContent?.trim());
      const rail = () => Array.from(el.querySelectorAll('.sections a')).map((a) => a.getAttribute('href'));

      await router.navigateByUrl('/disk');
      await fixture.whenStable();
      expect(tabs()).toEqual(['Cleanup', 'Disk space', 'Backups']);
      expect(el.querySelector('.sections a.active')?.textContent).toContain('Clean up');

      await router.navigateByUrl('/updates');
      await fixture.whenStable();
      expect(tabs()).toEqual(['Software', 'App updates', 'App catalog', 'Find apps']);
      expect(rail()).toContain('/disk'); // Clean up still points at the page it was last on
    });
  });

  describe('a clicked warning', () => {
    function open() {
      let deliver: (route: string) => void = () => {};
      const stopped = vi.fn();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [App],
        providers: [
          provideRouter([]),
          { provide: SystemService, useValue: { onNavigate: (cb: (r: string) => void) => { deliver = cb; return stopped; } } },
        ],
      });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      const fixture = TestBed.createComponent(App);
      return { fixture, navigate, stopped, deliver: (r: string) => deliver(r) };
    }

    it('opens the page it names, but only the pages on the allow-list', () => {
      const { navigate, deliver } = open();
      for (const r of ['/disk', '/battery', '/updates', '/startup', '/cleanup', '/automation']) deliver(r);
      expect(navigate.mock.calls.map((c) => c[0])).toEqual(['/disk', '/battery', '/updates', '/startup', '/cleanup', '/automation']);
      navigate.mockClear();
      for (const r of ['/software', '/', 'https://example.com', '/disk/../backups', '', '/drivers']) deliver(r);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('stops listening when the window is closed', () => {
      const { fixture, stopped } = open();
      expect(stopped).not.toHaveBeenCalled();
      fixture.destroy();
      expect(stopped).toHaveBeenCalledTimes(1);
    });
  });

  describe('Ctrl+K palette', () => {
    const ctrlK = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));

    async function start() {
      // jsdom has no showModal
      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([])] });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      const fixture = TestBed.createComponent(App);
      document.body.appendChild(fixture.nativeElement); // focus and showModal need the page
      await fixture.whenStable();
      return { fixture, navigate, el: fixture.nativeElement as HTMLElement };
    }

    it('opens, opens the chosen page on Enter, and closes', async () => {
      const { fixture, navigate, el } = await start();
      ctrlK();
      fixture.detectChanges();
      expect(el.querySelector('.pal')).not.toBeNull();
      const input = el.querySelector('.pal input') as HTMLInputElement;
      input.value = 'disk';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(navigate).toHaveBeenCalledWith('/disk');
      expect(el.querySelector('.pal')).toBeNull();
      fixture.destroy();
    });

    it('does not open over a pending confirm dialog, and a second Ctrl+K closes it', async () => {
      const { fixture, el } = await start();
      const dlg = document.createElement('dialog');
      dlg.setAttribute('open', '');
      document.body.appendChild(dlg);
      ctrlK();
      fixture.detectChanges();
      expect(el.querySelector('.pal')).toBeNull();
      dlg.remove();
      ctrlK();
      fixture.detectChanges();
      expect(el.querySelector('.pal')).not.toBeNull();
      ctrlK();
      fixture.detectChanges();
      expect(el.querySelector('.pal')).toBeNull();
      fixture.destroy();
    });
  });
});
