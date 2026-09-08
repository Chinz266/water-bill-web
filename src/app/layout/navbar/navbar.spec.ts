import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';

import { Navbar } from './navbar';

describe('Navbar', () => {
  let component: Navbar;
  let fixture: ComponentFixture<Navbar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Navbar],
      // navbar ใช้ AuthService (HttpClient) กับ routerLink — ต้องมี provider จำลองใน TestBed
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Navbar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * ปุ่ม "เพิ่มเติม" เคยกดแล้วไม่มีอะไรขึ้น เพราะกฎ display:none ค้างอยู่ใน navbar.css
   * (ถูกคอมไพล์เป็น .more-menu[_ngcontent-xxx] specificity สูงกว่า) ส่วนกฎที่สั่งให้โผล่
   * ถูกย้ายไป styles.css — เทสต์นี้คุมฝั่ง component ว่ากดแล้วแผ่นเมนูต้องถูก render จริง
   * ส่วนกฎ CSS ทั้งสองชุดต้องอยู่ไฟล์เดียวกันเสมอ (มีคอมเมนต์ ⚠️ กำกับไว้ในทั้งสองไฟล์)
   */
  it('กดปุ่มเพิ่มเติม → แผ่นเมนูต้องถูก render และมีลิงก์ครบทุกหน้าที่ยุบไว้', () => {
    expect(fixture.nativeElement.querySelector('#mobile-more-menu')).toBeNull();

    component.toggleMore();
    fixture.detectChanges();

    const sheet = fixture.nativeElement.querySelector('#mobile-more-menu');
    expect(sheet).toBeTruthy();

    const links = Array.from(sheet.querySelectorAll('a')).map((a: any) => a.getAttribute('href'));
    expect(links).toEqual(['/unassigned', '/audit', '/reports', '/village-settings', '/account']);
  });

  it('ปิดแล้วแผ่นเมนูต้องหายไปจาก DOM ไม่ใช่แค่ซ่อนด้วย CSS', () => {
    component.toggleMore();
    fixture.detectChanges();
    component.closeMore();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#mobile-more-menu')).toBeNull();
  });

  /**
   * ทุกเส้นทางในแผ่นเมนูต้องอยู่ใน isMoreRouteActive() ด้วย ไม่งั้นยืนอยู่หน้านั้นแล้ว
   * ปุ่มเพิ่มเติมไม่ขึ้นสี เหมือนไม่ได้อยู่เมนูไหนเลย
   */
  it('เส้นทางในแผ่นเมนูต้องถูกนับว่า "อยู่ในเมนูเพิ่มเติม" ครบทุกอัน', () => {
    const router = TestBed.inject(Router);
    for (const path of ['/unassigned', '/audit', '/reports', '/village-settings', '/account']) {
      vi.spyOn(router, 'url', 'get').mockReturnValue(path);
      expect(component.isMoreRouteActive()).toBe(true);
    }

    vi.spyOn(router, 'url', 'get').mockReturnValue('/home');
    expect(component.isMoreRouteActive()).toBe(false);
  });
});
