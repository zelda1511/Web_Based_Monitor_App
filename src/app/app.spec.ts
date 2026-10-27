import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { App } from './app';
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
    expect(compiled.querySelectorAll('nav a').length).toBe(14);
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
});
