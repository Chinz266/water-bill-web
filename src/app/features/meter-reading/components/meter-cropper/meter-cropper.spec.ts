import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MeterCropper } from './meter-cropper';

describe('MeterCropper', () => {
  let component: MeterCropper;
  let fixture: ComponentFixture<MeterCropper>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MeterCropper],
    }).compileComponents();

    fixture = TestBed.createComponent(MeterCropper);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
