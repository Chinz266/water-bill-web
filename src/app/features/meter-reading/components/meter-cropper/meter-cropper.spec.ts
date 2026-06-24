import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MeterCropperComponent } from './meter-cropper';

describe('MeterCropperComponent', () => {
  let component: MeterCropperComponent;
  let fixture: ComponentFixture<MeterCropperComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MeterCropperComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MeterCropperComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
