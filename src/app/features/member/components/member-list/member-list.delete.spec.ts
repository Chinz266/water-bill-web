import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MemberListComponent } from './member-list';

/**
 * ลบบ้าน = กดยืนยันครั้งเดียวจบ
 *
 * ของเดิมพอหลังบ้านตีกลับเพราะยังมีบิลผูกอยู่ เจ้าหน้าที่ต้องอ่าน error แล้วกด
 * "ล้างบิล" เอง แล้วกดลบใหม่อีกรอบ — สามจังหวะที่คนใช้ไม่รู้ว่าต้องทำ
 * ตอนนี้ระบบล้างให้แล้วลบซ้ำเอง แต่ต้องล้างได้ครั้งเดียว ไม่งั้นวนไม่จบ
 */

describe('MemberListComponent — ลบบ้าน', () => {
  let component: MemberListComponent;
  let http: HttpTestingController;

  const member = { id: 7, house_no: '99/1', fname: 'สมชาย', lname: 'ใจดี', phone: '0812345678', villages_id: 1 };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    const fixture = TestBed.createComponent(MemberListComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.match(r => r.url.endsWith('/member/all')).forEach(r => r.flush([member]));
    http.match(r => r.url.endsWith('/villages')).forEach(r => r.flush([]));
  });

  const startDelete = () => {
    component.askDelete(member);
    component.confirmDelete();
    return http.expectOne(r => r.url.endsWith('/member/remove'));
  };

  it('ลบผ่านรอบเดียว → ปิดหน้าต่างแล้วโหลดรายชื่อใหม่', () => {
    const req = startDelete();
    expect(req.request.body).toEqual({ id: 7 });
    req.flush({});

    http.expectOne(r => r.url.endsWith('/member/all')).flush([]);

    expect(component.memberToDelete).toBeNull();
    expect(component.isDeleting).toBe(false);
    expect(component.deleteBlockedReason).toBeNull();
  });

  it('ติดบิลที่ผูกอยู่ (500) → ล้างบิลของบ้านนี้แล้วลบซ้ำให้เอง', () => {
    startDelete().flush({}, { status: 500, statusText: 'Internal Server Error' });

    http.expectOne(r => r.url.endsWith('/bills')).flush([
      { id: 11, member: { id: 7 } },
      { id: 12, member: { id: 99 } },
      { id: 13, member: { id: 7 } }
    ]);

    // บิลของบ้านหลังอื่นต้องไม่โดนลูกหลง
    http.expectOne(r => r.url.endsWith('/bills/11') && r.method === 'DELETE').flush({});
    http.expectOne(r => r.url.endsWith('/bills/13') && r.method === 'DELETE').flush({});
    http.expectNone(r => r.url.endsWith('/bills/12'));

    // ไม่ต้องให้คนกดลบใหม่ — ยิงซ้ำให้เลย
    http.expectOne(r => r.url.endsWith('/member/remove')).flush({});
    http.expectOne(r => r.url.endsWith('/member/all')).flush([]);

    expect(component.memberToDelete).toBeNull();
    expect(component.deleteBlockedReason).toBeNull();
  });

  it('ล้างบิลหมดแล้วยังไม่ผ่าน → หยุด ไม่วนล้างซ้ำอีก', () => {
    startDelete().flush({}, { status: 500, statusText: 'Internal Server Error' });
    http.expectOne(r => r.url.endsWith('/bills')).flush([{ id: 11, member: { id: 7 } }]);
    http.expectOne(r => r.url.endsWith('/bills/11')).flush({});
    http.expectOne(r => r.url.endsWith('/member/remove')).flush({}, { status: 500, statusText: 'Internal Server Error' });

    http.expectNone(r => r.url.endsWith('/bills'));
    expect(component.isDeleting).toBe(false);
    expect(component.deleteBlockedReason).toContain('99/1');
  });

  it('ไม่มีบิลให้ล้างแต่ยังลบไม่ผ่าน → บอกให้แจ้งผู้ดูแล ไม่ยิงลบซ้ำ', () => {
    startDelete().flush({}, { status: 500, statusText: 'Internal Server Error' });
    http.expectOne(r => r.url.endsWith('/bills')).flush([{ id: 12, member: { id: 99 } }]);

    http.expectNone(r => r.url.endsWith('/member/remove'));
    expect(component.isDeleting).toBe(false);
    expect(component.deleteBlockedReason).toContain('ผู้ดูแลระบบ');
  });

  it('ไม่มีสิทธิ์ (403) → ไม่ไปยุ่งกับบิลเลย', () => {
    startDelete().flush({}, { status: 403, statusText: 'Forbidden' });

    http.expectNone(r => r.url.endsWith('/bills'));
    expect(component.deleteBlockedReason).toContain('สิทธิ์');
    expect(component.memberToDelete).not.toBeNull();
  });

  it('กดยืนยันรัว ๆ ต้องยิงลบครั้งเดียว', () => {
    component.askDelete(member);
    component.confirmDelete();
    component.confirmDelete();

    expect(http.match(r => r.url.endsWith('/member/remove')).length).toBe(1);
  });

  afterEach(() => http.verify());
});
