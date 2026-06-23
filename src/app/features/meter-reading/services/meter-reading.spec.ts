import { TestBed } from '@angular/core/testing';

import { MeterReading } from './meter-reading';

describe('MeterReading', () => {
  let service: MeterReading;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MeterReading);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
