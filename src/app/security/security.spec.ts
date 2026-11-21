import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SecurityReport } from '../api';
import { SystemService } from '../system.service';
import { Security } from './security';

const report = (over: Partial<SecurityReport> = {}): SecurityReport => ({
  checks: [
    {
      id: 'antivirus',
      label: 'Antivirus',
      status: 'ok',
      detail: 'Microsoft Defender real-time protection is on.',
    },
    {
      id: 'bitlocker',
      label: 'Disk encryption',
      status: 'warn',
      detail: 'The system drive is not encrypted.',
    },
    { id: 'sac', label: 'Smart App Control', status: 'info', detail: 'Off.' },
  ],
  summary: { ok: 1, warn: 1, info: 1 },
  readAt: Date.now(),
  ...over,
});

async function start(security: () => Promise<SecurityReport>) {
  TestBed.configureTestingModule({
    imports: [Security],
    providers: [{ provide: SystemService, useValue: { security } }],
  });
  const fixture = TestBed.createComponent(Security);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('Security page', () => {
  it('lists each check with its status in words, not only colour', async () => {
    const { el, fixture } = await start(() => Promise.resolve(report()));
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((r) =>
      Array.from(r.querySelectorAll('td')).map((c) => c.textContent!.trim()),
    );
    expect(rows[0]).toEqual([
      'Antivirus',
      'Fine',
      'Microsoft Defender real-time protection is on.',
    ]);
    expect(rows[1][1]).toBe('Look at this');
    expect(rows[2][1]).toBe('Note');
    expect(el.querySelector('.chip-warn')?.textContent).toContain('Look at this');
    fixture.destroy();
  });

  it('says what needs a look, or that nothing does', async () => {
    const a = await start(() => Promise.resolve(report()));
    expect(a.el.textContent).toContain('1 thing to look at, 1 fine.');
    a.fixture.destroy();
    TestBed.resetTestingModule();
    const b = await start(() => Promise.resolve(report({ summary: { ok: 3, warn: 0, info: 0 } })));
    expect(b.el.textContent).toContain('3 of 3 checks are fine, and nothing needs a look.');
    b.fixture.destroy();
  });

  it('reads again on "Check again" and shows an error from the system side', async () => {
    const security = vi
      .fn()
      .mockResolvedValueOnce(report())
      .mockRejectedValueOnce(new Error('could not read'));
    const { el, fixture } = await start(security);
    (
      Array.from(el.querySelectorAll('button')).find((b) =>
        /Check again/.test(b.textContent!),
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(security).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.alert-danger')?.textContent).toContain('could not read');
    fixture.destroy();
  });
});
