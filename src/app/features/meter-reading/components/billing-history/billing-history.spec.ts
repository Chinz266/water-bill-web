import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { BillingHistoryComponent } from './billing-history';

describe('BillingHistoryComponent', () => {
  let component: BillingHistoryComponent;
  let fixture: ComponentFixture<BillingHistoryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BillingHistoryComponent],
      // component ยิง HTTP หาหลังบ้านและใช้ routerLink — ใน TestBed ต้องขอ provider จำลองเอง
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(BillingHistoryComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
